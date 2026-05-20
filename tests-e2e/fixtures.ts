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
 */
export async function seedStorage(sw: Worker, data: Record<string, unknown>) {
  await sw.evaluate(async (d) => {
    // @ts-expect-error chrome 类型不在 worker scope，但 SW 里实际可用
    await chrome.storage.local.set(d)
  }, data)
}

export async function readBadgeText(sw: Worker): Promise<string> {
  return await sw.evaluate(async () => {
    // @ts-expect-error 同上
    return await chrome.action.getBadgeText({})
  })
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
