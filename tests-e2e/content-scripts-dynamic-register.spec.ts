import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect, seedStorage } from './fixtures'

/**
 * lab-tester 三审 v0.7.1 候选 — 锁住 v0.7.0 content_scripts 动态注册真实链路。
 *
 * 背景：
 * v0.7.0 manifest.content_scripts.matches 改 placeholder（IANA 保留域永不命中），
 * 真实匹配靠 SW 调 chrome.scripting.registerContentScripts，源是 mooConfig.projects[*].matchPatterns。
 * 旧 e2e（106 个）全过，但没一个**直接 assert dynamic register 真发生**：
 * - dialog-* harness spec 是 chrome-extension:// 内 page 不模拟跨 origin 注入
 * - onInstalled-upgrade-chain D1 只验 dropped flag 写入这条**副作用**，不验 register 本身
 *
 * 所以 v0.7.0 后这条链路 silent 坏掉只能等同事 dogfood 投诉。本 spec 补这缺。
 *
 * 范围 + 限制（重要）：
 * - 主断言：chrome.scripting.getRegisteredContentScripts → 验 id 数 + matches 正确性
 * - **不验**「真 navigate 到 http://localhost:PORT 后 content script 真注入到 DOM」—
 *   manifest 用的是 optional_host_permissions: ['<all_urls>']，fresh install 时 chrome
 *   未真授权任意 host_permission。registerContentScripts API 能 accept 注册（patterns
 *   是 optional_host_permissions 子集），但实际**注入**需要用户在 chrome:// 弹窗里
 *   手动授权 — 这一步 playwright 驱不了（permissions.request 需 user gesture，SW 内
 *   evaluate 拿不到 gesture）。
 *   → 因此本 spec 锁的是「SW 把 register 调对了」这条契约；真注入 DOM 留 RELEASE_TEST_CHECKLIST 手测。
 *
 * 起 http server：spec 自管（test.beforeAll 起 / afterAll 关）。不进 fixtures.ts —
 * 这是单 spec 文件用的，其它 spec 不需要 HTTP，避免污染共享 fixture 增加 SW spin-up 时序面。
 */

let server: Server
let PORT: number

test.beforeAll(async () => {
  server = createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><html><head><title>moo e2e fixture</title></head><body>hi</body></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  PORT = (server.address() as AddressInfo).port
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const SCRIPT_ID_MAIN = 'moo-main-world'
const SCRIPT_ID_ISO = 'moo-content'

/** Helper：构造合法 mooConfig — 只关心 matchPatterns + enabled + globalEnabled 三字段，
 * 其余字段交给 normalizeProject 兜底补齐。 */
function makeConfig(matchPatterns: string[], opts: { globalEnabled?: boolean; enabled?: boolean } = {}) {
  return {
    globalEnabled: opts.globalEnabled ?? true,
    projects: [
      {
        id: 'p-e2e',
        name: 'e2e fixture',
        matchPatterns,
        kind: 'webhook' as const,
        servers: [],
        defaultServerId: '',
        enabled: opts.enabled ?? true
      }
    ]
  }
}

/** 等 syncContentScripts 200ms debounce + 实际 register API 完成 — 400ms 兜底 CI 慢机器。 */
async function waitForSyncSettled(sw: import('@playwright/test').Worker): Promise<void> {
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 400)))
}

/** 读当前 registered scripts — 返 id 列表 + matches 全集。 */
async function readRegistered(sw: import('@playwright/test').Worker): Promise<Array<{ id: string; matches: string[] }>> {
  return await sw.evaluate(async ({ ids }) => {
    const list = await chrome.scripting.getRegisteredContentScripts({ ids }).catch(() => [])
    return list.map(s => ({ id: s.id, matches: (s.matches ?? []).slice() }))
  }, { ids: [SCRIPT_ID_MAIN, SCRIPT_ID_ISO] })
}

// ---------------------------------------------------------------------------
// E1. dynamic register happy path
//     seedStorage 写合法 mooConfig（http://localhost:PORT/* 合规 pattern）
//     → 200ms debounce → SW 调 registerContentScripts
//     → 验 2 个 id 真注册 + matches 包含 localhost URL
// ---------------------------------------------------------------------------
test('E1 · dynamic register：合法 matchPattern → SW register 2 个 content script', async ({ sw }) => {
  // 前置：fresh install 时 onInstalled 已跑过一次 syncContentScripts（无 config → 注册 0 个）
  // 这里 seed 真 config 触发 storage.onChanged → 200ms debounce 后第二次 sync。
  const pattern = `http://localhost:${PORT}/*`
  await seedStorage(sw, { mooConfig: makeConfig([pattern]) })
  await waitForSyncSettled(sw)

  const registered = await readRegistered(sw)
  expect(registered).toHaveLength(2)

  // 两个 id 都存在
  const ids = registered.map(s => s.id).sort()
  expect(ids).toEqual([SCRIPT_ID_ISO, SCRIPT_ID_MAIN].sort())

  // 两个 script 的 matches 都该包含我们设的 pattern
  for (const s of registered) {
    expect(s.matches).toContain(pattern)
  }

  // dropped flag 不应被写入（合法 pattern 全 valid）
  const droppedFlag = await sw.evaluate(async () => (await chrome.storage.local.get('mooDroppedMatchPatterns')).mooDroppedMatchPatterns)
  expect(droppedFlag).toBeUndefined()
})

// ---------------------------------------------------------------------------
// E2. translator drop → unregister + dropped flag
//     用户老配置 ['*', 'example.com/*'] 全部不符 chrome MV3 scheme://host/path 要求
//     → toChromeMatchPatterns 全 drop → matches=[] → unregisterContentScripts
//     → mooDroppedMatchPatterns flag 写入（popup banner 用）
// ---------------------------------------------------------------------------
test('E2 · 全部 pattern 被 drop：unregister + 写 dropped flag', async ({ sw }) => {
  // 先放合法 pattern 让 register 真发生
  await seedStorage(sw, { mooConfig: makeConfig([`http://localhost:${PORT}/*`]) })
  await waitForSyncSettled(sw)
  expect(await readRegistered(sw)).toHaveLength(2)

  // 改成全非法 pattern（chrome MV3 不收 '*' 也不收无 scheme 形式）
  await seedStorage(sw, { mooConfig: makeConfig(['*', 'example.com/*']) })
  await waitForSyncSettled(sw)

  // 注册数应为 0
  const registered = await readRegistered(sw)
  expect(registered).toHaveLength(0)

  // dropped flag 写入 — popup .dropped-banner 据此显示
  const dropped = await sw.evaluate(async () => (await chrome.storage.local.get('mooDroppedMatchPatterns')).mooDroppedMatchPatterns)
  expect(dropped).toBeTruthy()
  expect((dropped as { count: number }).count).toBe(2)
  expect((dropped as { samples: string[] }).samples).toContain('*')
  expect((dropped as { samples: string[] }).samples).toContain('example.com/*')
})

// ---------------------------------------------------------------------------
// E3. globalEnabled=false → unregister 即使有合法 pattern（mv3-pro 四审 P0-1）
//     v0.6.x 静态 <all_urls> 时 content script 总注入，靠 ContentApp 内部读
//     globalEnabled 决定是否挂悬浮球。v0.7.0 dynamic 化后必须在 register 阶段就拦下，
//     否则全局关闭后悬浮球仍可能挂（regress 用户报过的「关了还在」bug）。
// ---------------------------------------------------------------------------
test('E3 · globalEnabled=false：即使有合法 pattern 也 unregister', async ({ sw }) => {
  // 先注册合法 pattern + globalEnabled:true
  await seedStorage(sw, { mooConfig: makeConfig([`http://localhost:${PORT}/*`], { globalEnabled: true }) })
  await waitForSyncSettled(sw)
  expect(await readRegistered(sw)).toHaveLength(2)

  // 翻 globalEnabled → false（保留同一个合法 pattern）
  await seedStorage(sw, { mooConfig: makeConfig([`http://localhost:${PORT}/*`], { globalEnabled: false }) })
  await waitForSyncSettled(sw)

  const registered = await readRegistered(sw)
  expect(registered).toHaveLength(0)

  // dropped flag 也不该写（globalEnabled=false 不是 pattern 不合法，是产品语义关闭）
  const droppedFlag = await sw.evaluate(async () => (await chrome.storage.local.get('mooDroppedMatchPatterns')).mooDroppedMatchPatterns)
  expect(droppedFlag).toBeUndefined()
})
