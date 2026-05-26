import { test, expect, openExtensionPage, seedStorage } from './fixtures'

/**
 * v0.7.5：工作台（options）头部新增「⟳ 检查更新」按钮（无新版时）+
 * 「⬆ vX 下载 / ③ 重新加载」（有新版时）。
 *
 * 这个 spec 验「无新版」分支：mock Gitee 返 tag = 当前版本 → runVersionCheck
 * 清 flag → loadUpdateFlag 让 updateInfo=null → v-else 分支渲染 .update-check 按钮 →
 * 点击进 spinner → 最小 600ms → 「✓ 已是最新（HH:mm）」。
 *
 * chrome.runtime.reload() 路径不在本 spec 验：
 *   - 它只在 .update-link / .update-reload 元素出现时可点击
 *   - 那要求 storage 里有 mooLatestVersionInfo（即「有新版」），与本 spec 的「已是最新」
 *     断言互斥
 *   - 真 reload() 会拆掉 playwright 上下文
 * → 需要 RELEASE_TEST_CHECKLIST 人肉点 reload 验「真重新加载扩展」
 */
test('OPT-UPDATE-1 · 工作台 .update-check 点击 → 检查中（≥ 600ms）→ 已是最新', async ({ context, sw, extensionId }) => {
  // 清 flag，进 v-else（.update-check）分支
  await seedStorage(sw, {})
  const currentVersion = await sw.evaluate(() => chrome.runtime.getManifest().version)

  const page = await openExtensionPage(
    context,
    sw,
    `chrome-extension://${extensionId}/src/options/index.html`
  )

  await page.route('https://gitee.com/api/v5/repos/charsen/moo-chrome-dev-tool/releases/latest', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tag_name: `v${currentVersion}`,
        html_url: 'https://gitee.com/charsen/moo-chrome-dev-tool/releases'
      })
    })
  })

  const btn = page.locator('.update-check')
  await btn.waitFor({ timeout: 5000 })
  await expect(btn).not.toBeDisabled()
  // 初态文案：「⟳ 检查更新」或「⟳ 检查更新（上次 HH:mm）」
  await expect(btn).toContainText('检查更新')

  const clickAt = Date.now()
  await btn.click()

  await expect(btn).toContainText('检查中', { timeout: 200 })
  await expect(btn).toBeDisabled()

  await expect(btn).toContainText('已是最新', { timeout: 5000 })
  const doneAt = Date.now()
  expect(doneAt - clickAt).toBeGreaterThanOrEqual(550)
  await expect(btn).not.toBeDisabled()

  // is-done class 应附加（CSS 高亮分支）
  await expect(btn).toHaveClass(/is-done/)

  await page.close()
})

test('OPT-UPDATE-2 · 工作台有新版时 update-link + update-reload 按钮存在但不点 reload', async ({ context, sw, extensionId }) => {
  // 预置 mooLatestVersionInfo 让 v-if=updateInfo 分支渲染（带 ⬆ 下载 + ③ 重新加载）
  await seedStorage(sw, {
    mooLatestVersionInfo: {
      latest: '99.99.99',
      current: '0.7.4',
      url: 'https://gitee.com/charsen/moo-chrome-dev-tool/releases/v99.99.99',
      checkedAt: Date.now()
    }
  })

  const page = await openExtensionPage(
    context,
    sw,
    `chrome-extension://${extensionId}/src/options/index.html`
  )

  // 等头部任一更新元素渲染（update-line 内 v-if/v-else 两条互斥分支，有新版分支：link + reload 按钮）
  await page.locator('.update-link').waitFor({ timeout: 5000 })
  await expect(page.locator('.update-link')).toContainText('99.99.99')
  // reload 按钮存在且可点 —— 但故意不点（真 reload 会断 playwright 上下文）
  const reloadBtn = page.locator('.update-reload')
  await expect(reloadBtn).toBeVisible()
  await expect(reloadBtn).toContainText('重新加载')
  await expect(reloadBtn).not.toBeDisabled()
  // 不点击它 —— 验「按钮存在 + 可点」就够，真触发 reload 留给 RELEASE_TEST_CHECKLIST 手测

  // 此时 .update-check 不应渲染（v-else 分支）
  await expect(page.locator('.update-check')).toHaveCount(0)

  await page.close()
})
