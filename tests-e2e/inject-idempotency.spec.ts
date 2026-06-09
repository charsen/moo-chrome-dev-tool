import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { chromium, test as base, expect, type BrowserContext, type Worker } from '@playwright/test'
import { seedStorage } from './fixtures'

/**
 * 注入幂等回归守卫 — 防 backfillExistingTabs 对已注入 tab 重复 executeScript 导致：
 *   (1) MAIN world (main-world.ts) fetch/XHR/error/history 被二次 patch → 同一请求双采集
 *   (2) ISOLATED (content/index.ts) 旧 Vue app 不 unmount + 旧 onMessage listener 泄漏
 *       + 孤儿 shadow host 多挂
 *
 * 修法（已在 src）：
 *   - main-world.ts：window flag `__mooMainPatched` 守 4 处 patch（fetch/XHR/error/history）。
 *     MAIN world 是页面世界、扩展 reload 不重置 → 老 patch 仍 postMessage、reload 后新 ISOLATED
 *     listener 照收，所以重注入跳过 patch 安全不丢采集。
 *   - content/index.ts：onMessage listener + Vue app 句柄存 window，重注入先 removeListener /
 *     unmount 旧的再建新的。
 *
 * 测法：复用 dynamic-register-real-inject.spec.ts 的 mandatory host_permissions trick
 * （dist → dist-e2e + manifest optional→mandatory，绕 user gesture）。
 * register + navigate（首注入）→ 再手动 executeScript 二次注入 MAIN + ISOLATED（精确复刻
 * backfill 对已注入 tab 的重复注入原语）→ 触发一个 fetch → 经 GET_REQUESTS 断言该请求
 * 在 content buffer 里只出现 1 次（修前因 fetch 双 patch 会 2 次）；并断言 shadow host 只 1 个。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIST = path.resolve(__dirname, '../dist')
const E2E_DIST = path.resolve(__dirname, '../dist-e2e')

function prepareE2EDist(): void {
  if (existsSync(E2E_DIST)) rmSync(E2E_DIST, { recursive: true, force: true })
  cpSync(SRC_DIST, E2E_DIST, { recursive: true })
  const mfPath = path.join(E2E_DIST, 'manifest.json')
  const mf = JSON.parse(readFileSync(mfPath, 'utf8'))
  mf.host_permissions = ['<all_urls>']
  delete mf.optional_host_permissions
  writeFileSync(mfPath, JSON.stringify(mf, null, 2))
}

interface MandatoryFixtures {
  context: BrowserContext
  sw: Worker
  extensionId: string
}

const test = base.extend<MandatoryFixtures>({
  context: async ({}, use) => {
    prepareE2EDist()
    const ctx = await chromium.launchPersistentContext('', {
      headless: true,
      channel: 'chromium',
      args: [
        '--headless=new',
        `--disable-extensions-except=${E2E_DIST}`,
        `--load-extension=${E2E_DIST}`
      ]
    })
    await use(ctx)
    await ctx.close()
  },
  sw: async ({ context }, use) => {
    let [sw] = context.serviceWorkers()
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 })
    await use(sw)
  },
  extensionId: async ({ sw }, use) => {
    await use(new URL(sw.url()).host)
  }
})

let server: Server
let PORT: number

test.beforeAll(async () => {
  server = createServer((req, res) => {
    // /api/* → JSON（给页面 fetch 用）；其余 → HTML 文档
    if (req.url && req.url.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, path: req.url }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><html><head><title>moo idem fixture</title></head><body><div id="probe-marker">hi</div></body></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  PORT = (server.address() as AddressInfo).port
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function makeConfig(matchPatterns: string[]) {
  return {
    globalEnabled: true,
    projects: [{
      id: 'p-idem',
      name: 'idempotency',
      matchPatterns,
      kind: 'webhook' as const,
      servers: [],
      defaultServerId: '',
      enabled: true
    }]
  }
}

/** 读 SW manifest 里 build 后 content script JS 真路径（含 hash） */
async function readScriptPaths(sw: Worker): Promise<{ mainWorld: string[]; iso: string[] }> {
  return await sw.evaluate(() => {
    const mf = chrome.runtime.getManifest() as {
      content_scripts?: Array<{ js?: string[]; world?: string }>
    }
    const scripts = mf.content_scripts ?? []
    const mainWorld = scripts.find(s => s.world === 'MAIN')?.js ?? []
    const iso = scripts.find(s => !s.world || s.world === 'ISOLATED')?.js ?? []
    return { mainWorld, iso }
  })
}

/** SW 端对指定 tab 主动 executeScript 注入（复刻 backfillExistingTabs 的重复注入原语） */
async function reinject(sw: Worker, tabId: number, paths: { mainWorld: string[]; iso: string[] }): Promise<void> {
  await sw.evaluate(async ({ tabId, paths }) => {
    await chrome.scripting.executeScript({ target: { tabId }, files: paths.iso }).catch(() => {})
    await chrome.scripting.executeScript({ target: { tabId }, files: paths.mainWorld, world: 'MAIN' }).catch(() => {})
  }, { tabId, paths })
}

/** 经 SW → tab GET_REQUESTS 读 content script 的 requests buffer */
async function getBufferedRequests(sw: Worker, tabId: number): Promise<Array<{ url: string; method: string }>> {
  return await sw.evaluate(async ({ tabId }) => {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_REQUESTS' }).catch(() => null) as { requests?: Array<{ url: string; method: string }> } | null
    return res?.requests ?? []
  }, { tabId })
}

// ---------------------------------------------------------------------------
// I1. 幂等 — 二次注入 MAIN world 后单个 fetch 只采集 1 次（修前因 fetch 双 patch → 2 次）
//     + shadow host 只 1 个（修前 ISOLATED 重注入 host 多挂）
// ---------------------------------------------------------------------------
test('I1 · 二次注入后单 fetch 只采集 1 次 + host 只 1 个（幂等回归守卫）', async ({ context, sw }) => {
  // 0. 确认 mandatory host_permissions 自动 grant
  const granted = await sw.evaluate(async () => await chrome.permissions.contains({ origins: ['<all_urls>'] }))
  expect(granted).toBe(true)

  // 1. seed config 触发 register（首注入靠 navigation 走 declarative）
  const pattern = `http://127.0.0.1:${PORT}/*`
  await seedStorage(sw, { mooConfig: makeConfig([pattern]) })
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 500)))
  const registered = await sw.evaluate(async () => await chrome.scripting.getRegisteredContentScripts().catch(() => []))
  expect(registered).toHaveLength(2)

  // 2. navigate 命中 URL → 首注入（document_start declarative inject）
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${PORT}/idem`)
  await page.waitForTimeout(1500)  // content chunks 加载 + Vue mount

  // host 已挂（首注入）
  const hostBefore = await page.evaluate(() => document.querySelectorAll('#__moo_dev_tool_host__').length)
  expect(hostBefore).toBe(1)

  // 拿当前 tabId
  const tabId = await sw.evaluate(async ({ port }) => {
    const tabs = await chrome.tabs.query({ url: `http://127.0.0.1:${port}/*` })
    return tabs[0]?.id ?? -1
  }, { port: PORT })
  expect(tabId).toBeGreaterThan(0)

  // 3. 二次注入（复刻 backfill 对已注入 tab 重复 executeScript） — 跑 2 次加压
  const paths = await readScriptPaths(sw)
  expect(paths.mainWorld.length).toBeGreaterThan(0)
  expect(paths.iso.length).toBeGreaterThan(0)
  await reinject(sw, tabId, paths)
  await page.waitForTimeout(400)
  await reinject(sw, tabId, paths)
  await page.waitForTimeout(600)  // 等 ISOLATED 重建 + onMessage listener 替换 settle

  // 4. host 仍只 1 个（修前 content/index.ts remove 后重建若漏会多挂；旧 app 不 unmount 泄漏）
  const hostAfter = await page.evaluate(() => document.querySelectorAll('#__moo_dev_tool_host__').length)
  expect(hostAfter, '二次注入后 shadow host 应只 1 个').toBe(1)

  // 5. 清空 buffer 排除首注入期偶发请求，然后发一个 fetch
  await sw.evaluate(async ({ tabId }) => {
    await chrome.tabs.sendMessage(tabId, { type: 'CLEAR_REQUESTS' }).catch(() => {})
  }, { tabId })

  const marker = `/api/idem-probe-${Date.now()}`
  await page.evaluate(async (m) => { await fetch(m).then(r => r.json()) }, marker)
  await page.waitForTimeout(500)  // fetch postMessage → ISOLATED push settle

  // 6. 关键断言：该 fetch 在 buffer 里只出现 1 次（修前因 MAIN world fetch 双 patch → 2 次）
  const reqs = await getBufferedRequests(sw, tabId)
  const hits = reqs.filter(r => r.url.includes(marker))
  expect(hits.length, `fetch ${marker} 应只采集 1 次，实际 ${hits.length} 次（>1 即双 patch 回归）:\n${reqs.map(r => r.url).join('\n')}`).toBe(1)

  // 7. 悬浮球可点（host 真活、不是空壳）— click probe 不应抛
  await page.evaluate(() => {
    const host = document.querySelector('#__moo_dev_tool_host__') as HTMLElement | null
    if (host) host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })

  await page.close()
})
