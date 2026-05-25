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
 * v0.6.3：fresh install 时 onInstalled 会写 mooNeedsHostPermUpgrade=true 让 badge
 * 显 '!' 优先于失败计数。e2e 跑 fresh install 必撞这个 flag。先等 200ms 让 onInstalled
 * 写完，再 remove flag + set 测试数据 — 保证 badge 测试聚焦 failure count 行为。
 */
export async function seedStorage(sw: Worker, data: Record<string, unknown>) {
  await sw.evaluate(async (d) => {
    // 等 onInstalled 把 upgrade flag 写完（race 防御 — fresh install + permission optional 必走这条路）
    await new Promise<void>((r) => setTimeout(r, 200))
    await chrome.storage.local.remove('mooNeedsHostPermUpgrade')
    await chrome.storage.local.set(d)
  }, data)
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
