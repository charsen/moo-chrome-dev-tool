import { test, expect } from './fixtures'

/**
 * v0.8.8 Fix C 回归：History.vue 双订阅泄漏。
 *
 * 背景：两宿主（Panel.vue / options App.vue）都用 KeepAlive 包 History，首挂时
 * onMounted + onActivated 双触发 —— 旧版两处都调 subscribeChanges()，且 dispose 赋值在
 * await reload() 之后，第二次调用穿过 `!dispose` 守卫 → 注册两个 onHistoryChanged，
 * dispose 被覆盖、第一个 listener 永远退订不掉（每次 history 变化双 reload）。
 * 修法：删 onMounted(subscribeChanges) + subscribeChanges 加 `subscribing` in-flight 守卫。
 *
 * 测法：panel-harness 真挂 Panel.vue（KeepAlive 路径），addInitScript 包一层
 * chrome.storage.onChanged.addListener/removeListener 计数。断言不变量：
 *   - 进 History tab 后 listener 数 = 基线 + 1（只注册一个）
 *   - 切走后回到基线（退订干净，无泄漏）
 *   - 来回多轮不增长
 * 页面内 storage.onChanged 动态订阅只有 History.vue 一处（onConfigChanged 是
 * useConfig 模块级一次性注册，进基线），计数不变量稳定。
 */

function harnessUrl(extensionId: string, tab: string, seed: string): string {
  return `chrome-extension://${extensionId}/src/devtools/panel-harness.html?tab=${tab}&seed=${seed}`
}

declare global {
  interface Window { __mooListenerCount: number }
}

test('panel · History 进出多轮：storage.onChanged listener 只 +1 且退订回基线（双订阅泄漏回归）', async ({ context, extensionId }) => {
  const page = await context.newPage()

  // 必须在页面任何 module 跑之前 hook（subscribeChanges 在 tab 激活时就会 addListener）
  await page.addInitScript(() => {
    const w = window as unknown as { __mooListenerCount: number }
    w.__mooListenerCount = 0
    const tryHook = () => {
      const ev = (globalThis as unknown as {
        chrome?: { storage?: { onChanged?: {
          addListener: (fn: unknown) => void
          removeListener: (fn: unknown) => void
          __mooHooked?: boolean
        } } }
      }).chrome?.storage?.onChanged
      if (!ev || ev.__mooHooked) return
      ev.__mooHooked = true
      const add = ev.addListener.bind(ev)
      const rem = ev.removeListener.bind(ev)
      ev.addListener = (fn: unknown) => { w.__mooListenerCount++; add(fn) }
      ev.removeListener = (fn: unknown) => { w.__mooListenerCount--; rem(fn) }
    }
    tryHook()
  })

  // 先停在 overview，等首屏稳定后取基线
  await page.goto(harnessUrl(extensionId, 'overview', 'populated'))
  await page.waitForSelector('.overview .row', { timeout: 5000 })
  await page.waitForTimeout(400)
  const base = await page.evaluate(() => window.__mooListenerCount)

  // 进 History（KeepAlive 首挂：mounted + activated 双触发的高危路径）
  await page.click('#moo-tab-history')
  await page.waitForSelector('.history .row', { timeout: 5000 })
  await page.waitForTimeout(400)
  const during = await page.evaluate(() => window.__mooListenerCount)
  expect(during, '进 History 后只能注册 1 个 onHistoryChanged').toBe(base + 1)

  // 切走：onDeactivated 必须把唯一那个 listener 退订掉
  await page.click('#moo-tab-overview')
  await page.waitForTimeout(400)
  const afterLeave = await page.evaluate(() => window.__mooListenerCount)
  expect(afterLeave, '切走 History 后 listener 数应回到基线（泄漏 = 比基线多）').toBe(base)

  // 再来回两轮，确认不随轮次增长
  for (let i = 0; i < 2; i++) {
    await page.click('#moo-tab-history')
    await page.waitForTimeout(300)
    await page.click('#moo-tab-overview')
    await page.waitForTimeout(300)
  }
  const final = await page.evaluate(() => window.__mooListenerCount)
  expect(final, '多轮进出后 listener 数不增长').toBe(base)

  await page.close()
})
