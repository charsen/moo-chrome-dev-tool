/**
 * SubmitDialog · v0.4.x 体感改动验证：
 *  1. 「📋 复制」按钮 —— 复制完整原文（不是 1500 字截断版）；点后变「✓ 已复制」，
 *     1.5s 后恢复。失败 fallback execCommand —— 这条只验主路 navigator.clipboard 成功。
 *  2. 「收起全部 (N)」按钮 —— expandedReqIds.size > 0 时才显示，点击清空展开 row。
 *
 * harness 走 ?case=submit&requests=N 注入 N 条 mock 请求。每条 requestBody 是
 * `LONG_BODY_<i>_` + 2000 个 'x'（> 2010 字符，越过 previewBody 1500 字阈值），
 * 这样我们能断言剪贴板里拿到的是完整原文而非截断版。
 *
 * 闭合 shadow 注：harness 用 open shadow（见 dialog-harness.ts:68），所以
 * locator 直接穿；剪贴板用 page.evaluate(navigator.clipboard.readText) 读。
 * 注意 chromium headless 下需要 grantPermissions(['clipboard-read','clipboard-write'])。
 */

import { test, expect, openExtensionPage } from './fixtures'

function harnessUrl(extensionId: string, n: number): string {
  return `chrome-extension://${extensionId}/src/content/dialog-harness.html?case=submit&requests=${n}`
}

test('SubmitDialog · COPY-1 · 复制按钮存在 + 文字 + 剪贴板拿到完整原文', async ({
  context,
  extensionId,
  sw
}) => {
  // navigator.clipboard.readText 需要权限
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])

  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 3))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  // 等 3 条 mock req 渲染出来
  await expect(page.locator('.req-row')).toHaveCount(3)

  // filtered 用 .slice().reverse() —— mockRequests=[0,1,2] → 显示顺序 [2,1,0]
  // 通过 url 文本定位 req-1（不依赖排序细节）
  const targetRow = page.locator('.req-row').filter({ hasText: 'endpoint-1' })
  await targetRow.locator('.req-expand-btn').click()

  // Request Body 区出现，复制按钮存在
  const reqCopyBtn = targetRow.locator('.req-copy-btn').first()
  await expect(reqCopyBtn).toBeVisible()
  await expect(reqCopyBtn).toContainText('复制')

  // 点击
  await reqCopyBtn.click()

  // 立刻变「✓ 已复制」
  await expect(reqCopyBtn).toContainText('已复制', { timeout: 500 })

  // 剪贴板里是完整原文（包含末尾的 xxxxx，> 2000 字）
  const clipText = await page.evaluate(() => navigator.clipboard.readText())
  expect(clipText.startsWith('LONG_BODY_1_')).toBe(true)
  expect(clipText.length).toBeGreaterThan(2000)
  // 而 previewBody 截断版会含 '… (前 1500 字' 字样 —— 完整原文不应有
  expect(clipText).not.toContain('(前 1500 字')

  // 等 1.5s 后恢复
  await expect(reqCopyBtn).toContainText('复制', { timeout: 2500 })
  await expect(reqCopyBtn).not.toContainText('已复制')
})

test('SubmitDialog · COPY-2 · Response Body 复制按钮独立工作（不串台）', async ({
  context,
  extensionId,
  sw
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])

  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 2))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  // 找 req-1（不依赖 reverse 顺序）
  const row = page.locator('.req-row').filter({ hasText: 'endpoint-1' })
  await row.locator('.req-expand-btn').click()

  // 一条 row 有两个 copy 按钮：req body + res body
  const copyBtns = row.locator('.req-copy-btn')
  await expect(copyBtns).toHaveCount(2)

  await copyBtns.nth(1).click()
  await expect(copyBtns.nth(1)).toContainText('已复制', { timeout: 500 })
  // 第一个 req copy 按钮不应受影响
  await expect(copyBtns.nth(0)).toContainText('复制')
  await expect(copyBtns.nth(0)).not.toContainText('已复制')

  const clipText = await page.evaluate(() => navigator.clipboard.readText())
  // mock responseBody 是 JSON 含 'response-1'
  expect(clipText).toContain('"payload":"response-1"')
})

test('SubmitDialog · COLLAPSE-1 · 收起全部按钮只在 expanded > 0 显示 + 点后清零', async ({
  context,
  extensionId,
  sw
}) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 3))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  // 初始：没展开 → 「收起全部」按钮不存在
  await expect(page.locator('.req-controls .moo-btn.small', { hasText: '收起全部' })).toHaveCount(0)

  // 展开 3 条
  const rows = page.locator('.req-row')
  await rows.nth(0).locator('.req-expand-btn').click()
  await rows.nth(1).locator('.req-expand-btn').click()
  await rows.nth(2).locator('.req-expand-btn').click()

  // 详情区都展开了
  await expect(page.locator('.req-detail')).toHaveCount(3)

  // 「收起全部 (3)」按钮出现
  const collapseBtn = page.locator('.req-controls .moo-btn.small', { hasText: '收起全部' })
  await expect(collapseBtn).toBeVisible()
  await expect(collapseBtn).toContainText('收起全部 (3)')

  // 点击
  await collapseBtn.click()

  // 所有 req-detail 消失
  await expect(page.locator('.req-detail')).toHaveCount(0)
  // 按钮自己也消失（v-if）
  await expect(page.locator('.req-controls .moo-btn.small', { hasText: '收起全部' })).toHaveCount(0)
})
