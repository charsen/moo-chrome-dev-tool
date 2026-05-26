import { test, expect, openExtensionPage } from './fixtures'

/**
 * v0.7.4 commit 39f3293：popup「⚙ 完整配置」按钮 → chrome.windows.create 独立 760×720
 * 浮窗加载 chrome-extension://EXTID/src/options/index.html。
 * v0.7.5：浮窗升级成「工作区」— 4 Tab（概览 / 环境 / 历史 / 设置），跟 DevTools panel
 * 1:1 同款，default active = overview。
 *
 * Overview.vue 顶层用 chrome.devtools.inspectedWindow.tabId，options/main.ts pre-mount
 * 注入 shim：getLastFocused({windowTypes:['normal']}) 排除浮窗自身 → 拿主 chrome 窗口
 * active tab id 填进 chrome.devtools fake。Overview.vue 0 改动复用。
 *
 * 这条 spec 验 options 页面**加载链路**——不验 windows.create UX 真弹窗。
 * 直接 navigate chrome-extension:// URL 等同于 windows.create 加载的目标。
 */

test('OPT1 · options 工作区加载干净 + 4 tab buttons + 默认 active=概览', async ({ context, sw, extensionId }) => {
  const url = `chrome-extension://${extensionId}/src/options/index.html`
  const page = await openExtensionPage(context, sw, url)

  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

  // 给 Vue mount + main.ts pre-mount shim getLastFocused / tabs.query 异步链路时间
  await page.waitForSelector('.tab', { timeout: 5000 })
  await page.waitForTimeout(300)

  // 4 个 tab button（v0.7.5 加 Overview）
  const tabs = page.locator('.tabs .tab')
  await expect(tabs).toHaveCount(4)

  // v0.7.5：tab 顺序按使用频率 = 概览 / 历史 / 环境 / 设置
  await expect(tabs.nth(0)).toContainText('概览')
  await expect(tabs.nth(1)).toContainText('历史')
  await expect(tabs.nth(2)).toContainText('环境')
  await expect(tabs.nth(3)).toContainText('设置')

  // 默认 active = 概览（跟 DevTools panel 一致）
  await expect(tabs.nth(0)).toHaveClass(/is-active/)
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')

  // brand 区文案（fallback「工作区（独立浮窗）」— playwright launchPersistentContext
  // 启的 chrome 没有 normal window，shim 拿不到 host，走默认文案）
  await expect(page.locator('.brand-name')).toHaveText('Moo Dev Tool')
  await expect(page.locator('.brand-meta')).toContainText(/工作区|📍/)

  // 主 tabpanel 渲染（aria-labelledby 关联到 active tab）
  const panel = page.locator('main[role="tabpanel"]')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('id', 'opt-tabpanel-overview')

  expect(consoleErrors, `console errors should be empty, got:\n${consoleErrors.join('\n')}`).toEqual([])

  await page.close()
})

test('OPT2 · 切 4 tab → tabpanel id 切对 + KeepAlive 切换无错', async ({ context, sw, extensionId }) => {
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

  // v0.7.5 顺序：nth(1)=历史 nth(2)=环境 nth(3)=设置
  // 点「历史」
  await tabs.nth(1).click()
  await page.waitForTimeout(200)
  await expect(tabs.nth(1)).toHaveClass(/is-active/)
  await expect(page.locator('main[role="tabpanel"]')).toHaveAttribute('id', 'opt-tabpanel-history')

  // 点「环境」
  await tabs.nth(2).click()
  await page.waitForTimeout(200)
  await expect(tabs.nth(2)).toHaveClass(/is-active/)
  await expect(page.locator('main[role="tabpanel"]')).toHaveAttribute('id', 'opt-tabpanel-env')

  // 点「设置」
  await tabs.nth(3).click()
  await page.waitForTimeout(200)
  await expect(tabs.nth(3)).toHaveClass(/is-active/)
  await expect(page.locator('main[role="tabpanel"]')).toHaveAttribute('id', 'opt-tabpanel-settings')

  // 回「概览」（验 KeepAlive 切回不崩；Overview shim tabId=-1 fallback 时 send<T>() 会
  // chrome.runtime.lastError 但不应抛 setup error / Vue render error，console errors 允许有
  // 「拿不到 inspected tab」类业务 error 但不应有 TypeError / 未定义引用类 hard error）
  await tabs.nth(0).click()
  await page.waitForTimeout(200)
  await expect(tabs.nth(0)).toHaveClass(/is-active/)
  await expect(page.locator('main[role="tabpanel"]')).toHaveAttribute('id', 'opt-tabpanel-overview')

  // 过滤掉 Overview send<T>() 在 tabId=-1 时的预期 chrome.runtime.lastError noise
  const hardErrors = consoleErrors.filter(e =>
    !e.includes('No tab with id') &&
    !e.includes('Receiving end does not exist') &&
    !e.includes('Could not establish connection')
  )
  expect(hardErrors, `tab switch should not produce hard console errors, got:\n${hardErrors.join('\n')}`).toEqual([])

  await page.close()
})
