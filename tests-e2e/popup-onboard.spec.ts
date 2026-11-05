import { test, expect, openExtensionPage, seedStorage } from './fixtures'

/**
 * popup 首次引导的「知道了」入口（v0.8.19 补完）：
 * ONBOARD_KEY 之前只有读没有写 → 空态永远停在「欢迎使用」。现在 dismiss 会写
 * mooOnboardedAt，文案回到普通的「还没有项目」。
 */
test('popup 首次引导：无项目 → 欢迎 → 点「知道了」落 key 并切普通空态', async ({ context, extensionId, sw }) => {
  await seedStorage(sw, { mooConfig: { projects: [], globalEnabled: true }, mooHistory: [] })

  const page = await openExtensionPage(context, sw, `chrome-extension://${extensionId}/src/popup/index.html`)
  await expect(page.locator('.state-title')).toHaveText('欢迎使用 Moo Dev Tool', { timeout: 5000 })

  const dismiss = page.locator('.onboard-dismiss')
  await expect(dismiss).toBeVisible()
  await dismiss.click()

  await expect(page.locator('.state-title')).toHaveText('还没有项目')
  const flag = await sw.evaluate(async () => {
    const r = await chrome.storage.local.get('mooOnboardedAt')
    return r.mooOnboardedAt as unknown
  })
  expect(typeof flag).toBe('number')
})
