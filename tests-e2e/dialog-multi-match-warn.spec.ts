/**
 * SubmitDialog 多匹配警告条行为锁 —— 一个页面 URL 可能命中多个 Moo 项目
 * （matchPatterns 重叠）。快捷键 / 录屏 / 远程接管路径多匹配时静默 default 到首个，
 * 用户提交前看不到「提到哪」→ 容易提错。修复：body 顶部弹警告条把目标项目亮出来。
 *
 * dialog-harness `?case=submit&matchCount=N`（+ 可选 kind=zentao）驱动：
 *   - MW1 matchCount=3：警告条出现、含「3 个项目」+ 当前项目名
 *   - MW2 matchCount=1（缺省）：警告条不出现（唯一匹配，无歧义，零打扰）
 *   - MW3 matchCount=3 & kind=zentao：警告条额外带「· 禅道 #42」供核对
 *   - MW4 matchCount=2：边界（刚好 > 1）也出现
 */

import { test, expect, openExtensionPage } from './fixtures'

function harnessUrl(extensionId: string, search = ''): string {
  return `chrome-extension://${extensionId}/src/content/dialog-harness.html?case=submit${search ? '&' + search : ''}`
}

test('SubmitDialog · MW1 · matchCount=3：警告条出现含项目数 + 当前项目名', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 'matchCount=3'))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  const warn = page.locator('.moo-match-warn')
  await expect(warn).toBeVisible()
  await expect(warn).toContainText('本页命中')
  await expect(warn).toContainText('3')
  await expect(warn).toContainText('个项目')
  // 当前默认提交到的项目名（harness webhook 项目）
  await expect(warn).toContainText('示例项目')
  await expect(warn).toContainText('提错可在悬浮球切换项目后重提')
  // webhook 项目不带禅道 projectId
  await expect(warn).not.toContainText('禅道 #')
})

test('SubmitDialog · MW2 · matchCount=1（缺省）：警告条不出现', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId))   // 缺省 matchCount=1
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  // 唯一匹配无歧义 → 不渲染，零打扰
  await expect(page.locator('.moo-match-warn')).toHaveCount(0)
  // dialog 本身正常可用
  await expect(page.locator('#moo-title')).toBeVisible()
})

test('SubmitDialog · MW3 · matchCount=3 & kind=zentao：警告条带「· 禅道 #42」', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 'matchCount=3&kind=zentao'))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  const warn = page.locator('.moo-match-warn')
  await expect(warn).toBeVisible()
  await expect(warn).toContainText('禅道示例项目')
  // 禅道 projectId 一起亮出来供核对（harness 固定 42）
  await expect(warn).toContainText('禅道 #42')
})

test('SubmitDialog · MW4 · matchCount=2（边界 > 1）：警告条仍出现', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 'matchCount=2'))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  const warn = page.locator('.moo-match-warn')
  await expect(warn).toBeVisible()
  await expect(warn).toContainText('2')
})
