import { test, expect, openExtensionPage } from './fixtures'

/**
 * v0.7.4 commit 39f3293：popup「⚙ 完整配置」按钮 → chrome.windows.create 独立 760×720
 * 浮窗加载 chrome-extension://EXTID/src/options/index.html，复用 Environment / History /
 * Settings 三个 Tab 组件。
 *
 * 这条 spec 验 options 页面**加载链路**——不验 windows.create UX 真弹窗（那是 chrome 行为
 * 不是页面行为）。直接 navigate chrome-extension:// URL 等同于 windows.create 加载的目标。
 *
 * 覆盖：
 * - 页面加载无 console error / pageerror
 * - 3 个 tab button（环境 / 历史 / 设置）渲染 + 默认 active = 环境
 * - 切「历史」「设置」KeepAlive 切换不崩
 */

test('OPT1 · options 页面加载干净（无 console error / pageerror）+ 3 tab buttons + 默认 active=环境', async ({ context, sw, extensionId }) => {
  const url = `chrome-extension://${extensionId}/src/options/index.html`
  const page = await openExtensionPage(context, sw, url)

  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

  // 给 Vue mount + tabs 渲染时间
  await page.waitForSelector('.tab', { timeout: 5000 })
  await page.waitForTimeout(300)

  // 3 个 tab button
  const tabs = page.locator('.tabs .tab')
  await expect(tabs).toHaveCount(3)

  // 文本 = 环境 / 历史 / 设置
  await expect(tabs.nth(0)).toContainText('环境')
  await expect(tabs.nth(1)).toContainText('历史')
  await expect(tabs.nth(2)).toContainText('设置')

  // 默认 active = 环境
  await expect(tabs.nth(0)).toHaveClass(/is-active/)
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.nth(1)).not.toHaveClass(/is-active/)
  await expect(tabs.nth(2)).not.toHaveClass(/is-active/)

  // brand 区文案
  await expect(page.locator('.brand-name')).toHaveText('Moo Dev Tool')
  await expect(page.locator('.brand-meta')).toContainText('完整配置')

  // 主 tabpanel 渲染（aria-labelledby 关联到 active tab）
  const panel = page.locator('main[role="tabpanel"]')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('id', 'opt-tabpanel-env')

  expect(consoleErrors, `console errors should be empty, got:\n${consoleErrors.join('\n')}`).toEqual([])

  await page.close()
})

test('OPT2 · 切「历史」tab → tabpanel id 切到 history + 「设置」同理 + KeepAlive 切换无错', async ({ context, sw, extensionId }) => {
  const url = `chrome-extension://${extensionId}/src/options/index.html`
  const page = await openExtensionPage(context, sw, url)
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

  await page.waitForSelector('.tab', { timeout: 5000 })
  await page.waitForTimeout(200)

  const tabs = page.locator('.tabs .tab')

  // 点「历史」
  await tabs.nth(1).click()
  await page.waitForTimeout(200)
  await expect(tabs.nth(1)).toHaveClass(/is-active/)
  await expect(tabs.nth(0)).not.toHaveClass(/is-active/)
  await expect(page.locator('main[role="tabpanel"]')).toHaveAttribute('id', 'opt-tabpanel-history')

  // 点「设置」
  await tabs.nth(2).click()
  await page.waitForTimeout(200)
  await expect(tabs.nth(2)).toHaveClass(/is-active/)
  await expect(tabs.nth(1)).not.toHaveClass(/is-active/)
  await expect(page.locator('main[role="tabpanel"]')).toHaveAttribute('id', 'opt-tabpanel-settings')

  // 回「环境」（验 KeepAlive 切回不崩）
  await tabs.nth(0).click()
  await page.waitForTimeout(200)
  await expect(tabs.nth(0)).toHaveClass(/is-active/)
  await expect(page.locator('main[role="tabpanel"]')).toHaveAttribute('id', 'opt-tabpanel-env')

  expect(consoleErrors, `tab switch should not produce console errors, got:\n${consoleErrors.join('\n')}`).toEqual([])

  await page.close()
})
