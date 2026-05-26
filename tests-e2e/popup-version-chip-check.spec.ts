import { test, expect, openExtensionPage, seedStorage } from './fixtures'

/**
 * v0.7.5：popup 版本号 chip 改成可点击「检查更新」按钮。
 *
 * 行为 spec：
 *  - 初始 chip 渲染 v{version} 文本（dist manifest 即当前版本）
 *  - 点击 → 立即进入 spinner 态：button 含「检查中」+ disabled=true
 *  - runVersionCheck 实际 < 500ms 但有最小 600ms spinner 兜底（防一闪而过）
 *  - 结束后 button 文本含「✓ 已是最新」（mock 返回 tag = manifest 版本 → 不新）
 *  - disabled 解除
 *
 * 关键：拦截 Gitee `/api/v5/repos/.../releases/latest` 返 mock，让 runVersionCheck
 * 走「已是最新」分支。不能真打 Gitee（headless 偶发 flake + 速度不可控 + CI 无网）。
 *
 * 不验 chrome.runtime.reload()：reload 会让 playwright 上下文断；popup 这个 chip
 * 也不点 reload（reload 按钮在 options 的 update-banner，且仅 updateInfo 存在时显）。
 */
test('POPUP-CHIP-1 · 版本 chip 点击 → 检查中（含最小 600ms spinner）→ 已是最新', async ({ context, sw, extensionId }) => {
  // 清掉 mooLatestVersionInfo flag，免得初始就被当成「有新版」
  await seedStorage(sw, {})

  // 读 manifest version 用作 mock latest tag（保证 isNewer = false）
  const currentVersion = await sw.evaluate(() => chrome.runtime.getManifest().version)

  const popup = await openExtensionPage(
    context,
    sw,
    `chrome-extension://${extensionId}/src/popup/index.html`
  )
  await popup.setViewportSize({ width: 360, height: 600 })

  // 拦截 Gitee API：返 tag = current → runVersionCheck 走「无新版」清 flag 分支
  await popup.route('https://gitee.com/api/v5/repos/charsen/moo-chrome-dev-tool/releases/latest', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tag_name: `v${currentVersion}`,
        html_url: 'https://gitee.com/charsen/moo-chrome-dev-tool/releases'
      })
    })
  })

  const chip = popup.locator('.moo-chip--btn')
  await chip.waitFor({ timeout: 5000 })

  // 初态：含 v{version}，非 disabled
  await expect(chip).toContainText(`v${currentVersion}`)
  await expect(chip).not.toBeDisabled()

  const clickAt = Date.now()
  await chip.click()

  // 立刻进 spinner（点击 sync 触发 versionChecking = true）
  await expect(chip).toContainText('检查中', { timeout: 200 })
  await expect(chip).toBeDisabled()

  // 等 spinner 消失（最小 600ms + fetch 时间）—— 用「已是最新」出现做信号
  await expect(chip).toContainText('已是最新', { timeout: 5000 })
  const doneAt = Date.now()

  // 最小 600ms 兜底验证：从 click 到 done 不应 < 600ms
  // 给 50ms 容差防 timer race
  expect(doneAt - clickAt).toBeGreaterThanOrEqual(550)

  // 完成后 disabled 解除
  await expect(chip).not.toBeDisabled()

  await popup.close()
})

test('POPUP-CHIP-2 · 版本 chip 再次点击不重入（spinner 期间忽略）', async ({ context, sw, extensionId }) => {
  await seedStorage(sw, {})
  const currentVersion = await sw.evaluate(() => chrome.runtime.getManifest().version)

  const popup = await openExtensionPage(
    context,
    sw,
    `chrome-extension://${extensionId}/src/popup/index.html`
  )
  await popup.setViewportSize({ width: 360, height: 600 })

  await popup.route('https://gitee.com/api/v5/repos/charsen/moo-chrome-dev-tool/releases/latest', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tag_name: `v${currentVersion}`,
        html_url: 'https://gitee.com/charsen/moo-chrome-dev-tool/releases'
      })
    })
  })

  const chip = popup.locator('.moo-chip--btn')
  await chip.waitFor({ timeout: 5000 })
  await chip.click()
  await expect(chip).toBeDisabled()

  // disabled 状态下再点（playwright force=true 绕开 actionability）应该被 manualVersionCheck
  // 早期 return 屏蔽 —— UI 不应崩，最终仍能走到「已是最新」
  await chip.click({ force: true }).catch(() => { /* disabled state click 可能直接被忽略 */ })
  await expect(chip).toContainText('已是最新', { timeout: 5000 })

  await popup.close()
})
