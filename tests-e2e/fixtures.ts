import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXT_PATH = path.resolve(__dirname, '../dist')

// chromium 新版 headless 模式（--headless=new）支持加载扩展；旧的 --headless 不行。
// `launchPersistentContext` 是 playwright 加载扩展的唯一姿势——extensions 必须挂 profile。
//
// 注：MV3 service worker 在扩展刚装好那一瞬间不会自动 register；要等触发——
// 最稳的触发是「打开任意页面后等 serviceworker event」。所以 fixture 里
// 我们 newPage() 一次再等。

interface ExtFixtures {
  context: BrowserContext
  extensionId: string
  /** background service worker（用于注入 chrome.storage / 读 badge 状态） */
  sw: Worker
}

export const test = base.extend<ExtFixtures>({
  context: async ({}, use) => {
    const ctx = await chromium.launchPersistentContext('', {
      // 新 headless mode：能加载扩展且不弹窗。本地调试想看真窗口把这行注释掉
      headless: true,
      channel: 'chromium',
      args: [
        `--headless=new`,
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`
      ]
    })
    await use(ctx)
    await ctx.close()
  },

  extensionId: async ({ context }, use) => {
    // 先开一个空白页触发 SW register；不开页面有些 MV3 扩展 SW 不立刻起来
    const warm = await context.newPage()
    await warm.goto('about:blank')

    let [sw] = context.serviceWorkers()
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', { timeout: 10_000 })
    }
    // chrome-extension://<ID>/service-worker-loader.js
    const id = new URL(sw.url()).host
    await warm.close()
    await use(id)
  },

  sw: async ({ context }, use) => {
    let [sw] = context.serviceWorkers()
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 })
    await use(sw)
  }
})

export const expect = test.expect

/**
 * 通过 SW 上下文写 chrome.storage.local（绕过页面 origin 限制）。
 * onHistoryChanged listener 在 background 里会捕到这个变更并刷 badge——
 * 测试中调一次再 sleep ~300ms 就能拿到稳定状态。
 *
 * v0.6.3 e2e 盲点（claude 二轮同款扫描）：
 * - fresh install onInstalled 会写 `mooNeedsHostPermUpgrade` flag → badge 显 '!' 覆盖失败计数
 * - SW 内 `runVersionCheck` fire-and-forget fetch Gitee 写 `mooLatestVersionInfo` flag
 *   → 随机时间污染 popup/badge 测试，跟 v0.6.1 silent 回归同款 race
 *
 * 修法：seedStorage 内主动 remove 两个 flag + 200ms 兜底（轮询 onInstalled 完成 sentinel）。
 * Gitee fetch 在 fixture launchPersistentContext args 加 `--host-resolver-rules` block
 * （留个备忘，未发现 popup-* 测试受 update-banner 干扰前先不动 launch args）。
 */
// v0.7.6 lab-tester 13 审：补 mooDroppedMatchPatterns（v0.7.0 加的 SW
// syncContentScripts 副产物，fullyParallel=false 串行跑前面 spec 残留时让
// onInstalled-upgrade-chain D1 偶发红）+ mooUpgradeIntent / mooUpgradedToast
// （v0.7.6 升级闭合 flag，理论上 SW 不会主动写但 spec 间残留写过测过的）
const E2E_TRANSIENT_FLAGS = [
  'mooNeedsHostPermUpgrade',
  'mooLatestVersionInfo',
  'mooDroppedMatchPatterns',
  'mooUpgradeIntent',
  'mooUpgradedToast'
] as const

export async function seedStorage(sw: Worker, data: Record<string, unknown>) {
  await sw.evaluate(async ({ d, flags }) => {
    // 轮询直到 SW onInstalled 把 transient flag 写完，最多 1.5s（CI 慢机器兜底）
    const deadline = Date.now() + 1500
    while (Date.now() < deadline) {
      const result = await chrome.storage.local.get(flags as unknown as string[])
      if (flags.some((k) => (result as Record<string, unknown>)[k] !== undefined)) break
      await new Promise<void>((r) => setTimeout(r, 50))
    }
    await chrome.storage.local.remove(flags as unknown as string[])
    await chrome.storage.local.set(d)
  }, { d: data, flags: E2E_TRANSIENT_FLAGS })
}

export async function readBadgeText(sw: Worker): Promise<string> {
  return await sw.evaluate(async () => {
    return await chrome.action.getBadgeText({})
  })
}

/**
 * 打开 chrome-extension:// 页面带 retry。
 *
 * 已知 flake：persistent context + MV3 SW 注册时序 race 偶发触发
 * `ERR_FILE_NOT_FOUND` —— chrome 文件 URL resolver 在 SW register 完成后
 * 还需要 ~50-200ms 才能解析扩展资源，第一次 goto 撞上空窗就崩。
 *
 * 修复：goto 前先 ping SW（保证 SW 真活着），失败时关掉重试 1 次。
 * 比 retry-on-fail 整段重跑稳。
 */
export async function openExtensionPage(
  context: BrowserContext,
  sw: Worker,
  url: string,
  tries = 2
): Promise<import('@playwright/test').Page> {
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    const page = await context.newPage()
    try {
      // 1 次 ping 确保 SW 真有响应（chrome 把 extension 资源 ready 跟 SW alive 强关联）
      await sw.evaluate(() => 1)
      await page.goto(url)
      return page
    } catch (e) {
      lastErr = e
      await page.close().catch(() => {})
      // 50ms 让 chrome 把 SW 注册彻底 settle
      await new Promise((r) => setTimeout(r, 50))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('openExtensionPage failed')
}

/**
 * 轮询 badge text 直到匹配 expected 或超时——比固定 sleep 稳得多。
 *
 * 用于 seedStorage → onHistoryChanged → updateActionBadge 的异步链验证。
 * 之前用 `await sleep(800)` 偶发 flaky（SW 时序 race），改成 50ms 轮询 + 3s 上限。
 *
 * 返回的是「停止轮询那一刻读到的 badge」——可能匹配也可能不匹配，由调用方 expect 决定。
 */
export async function waitForBadgeText(sw: Worker, expected: string, timeoutMs = 3000): Promise<string> {
  const start = Date.now()
  let cur = ''
  while (Date.now() - start < timeoutMs) {
    cur = await readBadgeText(sw)
    if (cur === expected) return cur
    await new Promise((r) => setTimeout(r, 50))
  }
  return cur
}
