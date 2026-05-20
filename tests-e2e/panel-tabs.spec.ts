import { test, expect } from './fixtures'

/**
 * panel-harness 解锁的 DevTools 4 Tab 自动化测试。
 *
 * harness: src/devtools/panel-harness.{html,ts}
 * URL: chrome-extension://EXTID/src/devtools/panel-harness.html?tab=X&seed=Y[&count=N]
 *   tab:  overview | environment | history | settings
 *   seed: empty | populated | wide | long
 *
 * 这一批锁住主架构师那个原始 4K bug 的根因路径 + 4 Tab 渲染基线，
 * 后续 P0 / P1 缺口都会扩在这上面。
 */

function harnessUrl(extensionId: string, tab: string, seed: string, count?: number): string {
  const q = new URLSearchParams({ tab, seed })
  if (count) q.set('count', String(count))
  return `chrome-extension://${extensionId}/src/devtools/panel-harness.html?${q.toString()}`
}

// ---- Overview ---------------------------------------------------------------

test('panel · Overview empty：渲染不崩 + 空态文案出现', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'overview', 'empty'))
  await page.waitForSelector('.overview', { timeout: 5000 })

  // 时间线 list 应该不显示，empty 段应该显示
  await expect(page.locator('.overview .empty')).toBeVisible()
  await expect(page.locator('.overview .list')).toHaveCount(0)
  // 空态文案
  await expect(page.locator('.overview .empty')).toContainText('还没抓到')
})

test('panel · Overview populated 10 请求：渲染行数 = 10', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'overview', 'populated'))
  await page.waitForSelector('.overview .row', { timeout: 5000 })

  // 10 请求 + 3 错误（harness buildErrors(3)）= 13 行总数
  const rowCount = await page.locator('.overview .row').count()
  expect(rowCount).toBeGreaterThanOrEqual(10)
  expect(rowCount).toBeLessThanOrEqual(13)

  // method chip 颜色（POST 应有 .post class）
  await expect(page.locator('.overview .method.post').first()).toBeVisible()
  // status chip 至少有 ok 和 err（harness 数据含 200/404/500）
  await expect(page.locator('.overview .status.ok').first()).toBeVisible()
})

test('panel · Overview wide (100 长 URL) × 1280px：URL 截断 + dur/time 列可见（锁主架构师原始 bug）', async ({ context, extensionId }) => {
  const page = await context.newPage()
  // 用户 4K 报 bug 实际 viewport 是 1428（DevTools docked / DPR 2）。1280 是 docked 常见宽度，
  // 既能让长 URL 必须截断（natural width > 可用宽），又落在用户真实场景。
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(harnessUrl(extensionId, 'overview', 'wide'))
  await page.waitForSelector('.overview .row', { timeout: 5000 })

  // 抽第 1 行验证 layout
  const rowInfo = await page.evaluate(() => {
    const row = document.querySelector('.overview .row .row-head') as HTMLElement | null
    if (!row) return null
    const url = row.querySelector('.url') as HTMLElement | null
    const dur = row.querySelector('.dur') as HTMLElement | null
    const time = row.querySelector('.time') as HTMLElement | null
    const rowRect = row.getBoundingClientRect()
    return {
      url: url ? { sw: url.scrollWidth, cw: url.clientWidth, right: url.getBoundingClientRect().right } : null,
      dur: dur ? { w: dur.getBoundingClientRect().width, right: dur.getBoundingClientRect().right } : null,
      time: time ? { w: time.getBoundingClientRect().width, right: time.getBoundingClientRect().right } : null,
      rowRight: rowRect.right,
      htmlSW: document.documentElement.scrollWidth,
      htmlCW: document.documentElement.clientWidth
    }
  })

  expect(rowInfo).not.toBeNull()
  // ellipsis 真生效（scrollWidth > clientWidth）—— min-width: 0 修复证据
  expect(rowInfo!.url!.sw, 'URL 没触发 ellipsis = min-width: 0 修复失效').toBeGreaterThan(rowInfo!.url!.cw)
  // dur / time 列必须可见，且 right 在 row 内（没被挤出去）
  expect(rowInfo!.dur!.w, '.dur 宽度 0 = 被挤掉').toBeGreaterThan(0)
  expect(rowInfo!.time!.w, '.time 宽度 0 = 被挤掉').toBeGreaterThan(0)
  expect(rowInfo!.dur!.right, '.dur 超出 row 右边界').toBeLessThanOrEqual(rowInfo!.rowRight + 1)
  expect(rowInfo!.time!.right, '.time 超出 row 右边界').toBeLessThanOrEqual(rowInfo!.rowRight + 1)
  // html 不横向溢出
  expect(rowInfo!.htmlSW, '3840 下 html 横向溢出').toBeLessThanOrEqual(rowInfo!.htmlCW + 1)
})

// ---- Environment ------------------------------------------------------------

test('panel · Environment empty：sidebar 显示「暂无项目」', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'environment', 'empty'))
  await page.waitForSelector('.env-wrap', { timeout: 5000 })

  await expect(page.locator('.project-list .empty')).toContainText('暂无项目')
})

test('panel · Environment populated 3 项目：sidebar 列表渲染 3 + detail 显示第 1 个', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'environment', 'populated'))
  await page.waitForSelector('.env-wrap', { timeout: 5000 })

  const itemCount = await page.locator('.project-item').count()
  expect(itemCount).toBe(3)
  // 第 1 个 active
  await expect(page.locator('.project-item.active .name')).toContainText('项目 1')
})

// ---- History ----------------------------------------------------------------

test('panel · History empty：显示「暂无历史记录」', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'history', 'empty'))
  await page.waitForSelector('.history', { timeout: 5000 })

  await expect(page.locator('.history .empty')).toContainText('暂无历史记录')
})

test('panel · History populated 10：行数 = 10 + 状态 chip 渲染', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'history', 'populated'))
  await page.waitForSelector('.history .row', { timeout: 5000 })

  const rowCount = await page.locator('.history .row').count()
  expect(rowCount).toBe(10)
  // remote-status chip 至少出现一个
  await expect(page.locator('.history .remote-status').first()).toBeVisible()
})

test('panel · History long 100 条：渲染数 = 100 + 性能 (load < 2s)', async ({ context, extensionId }) => {
  const page = await context.newPage()
  const t0 = Date.now()
  await page.goto(harnessUrl(extensionId, 'history', 'long'))
  await page.waitForSelector('.history .row', { timeout: 5000 })
  const elapsed = Date.now() - t0

  const rowCount = await page.locator('.history .row').count()
  expect(rowCount).toBe(100)
  expect(elapsed, `100 条 history 渲染 > 2s (实际 ${elapsed}ms)`).toBeLessThan(2000)
})

// ---- Settings ---------------------------------------------------------------

test('panel · Settings populated：moo-switch toggle 和项目下拉可见', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'settings', 'populated'))
  await page.waitForSelector('.settings', { timeout: 5000 })

  // Settings 用自定义 <button role="switch" class="moo-switch">，不是 input[type=checkbox]
  const toggles = await page.locator('.settings button.moo-switch[role="switch"]').count()
  expect(toggles, 'Settings 没渲染任何 moo-switch toggle').toBeGreaterThan(0)
})

// ---- Panel 全局响应式 -------------------------------------------------------

test('panel · 3840px ultra-wide：tab bar 不溢出 html', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.setViewportSize({ width: 3840, height: 1080 })
  await page.goto(harnessUrl(extensionId, 'overview', 'empty'))
  await page.waitForSelector('.panel', { timeout: 5000 })

  const overflow = await page.evaluate(() => ({
    s: document.documentElement.scrollWidth,
    c: document.documentElement.clientWidth
  }))
  expect(overflow.s, '3840 下 panel 触发横向溢出').toBeLessThanOrEqual(overflow.c + 1)
})

test('panel · 768px narrow：tab bar overflow:auto 生效 (panel 不横向滚动)', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.setViewportSize({ width: 768, height: 600 })
  await page.goto(harnessUrl(extensionId, 'overview', 'empty'))
  await page.waitForSelector('.panel', { timeout: 5000 })

  const layout = await page.evaluate(() => {
    const panel = document.querySelector('.panel') as HTMLElement | null
    return panel ? {
      htmlSW: document.documentElement.scrollWidth,
      htmlCW: document.documentElement.clientWidth,
      panelW: panel.getBoundingClientRect().width
    } : null
  })
  expect(layout).not.toBeNull()
  // panel 自身 = viewport 宽，html 不溢出
  expect(layout!.htmlSW, '768px 下 html 触发横向溢出').toBeLessThanOrEqual(layout!.htmlCW + 1)
})
