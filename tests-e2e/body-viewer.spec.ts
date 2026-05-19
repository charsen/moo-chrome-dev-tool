import { test, expect } from './fixtures'

/**
 * BodyViewer 在真 Chrome 里的渲染验证。
 * 通过 harness 页面（src/devtools/body-viewer-harness.html）按 ?case=xxx 切场景。
 */

function harnessUrl(extensionId: string, caseName: string, search = ''): string {
  const q = new URLSearchParams({ case: caseName, search })
  return `chrome-extension://${extensionId}/src/devtools/body-viewer-harness.html?${q.toString()}`
}

test('BodyViewer · small JSON：自动检测 + 格式化 + 染色', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'small'))
  await page.waitForSelector('.body-viewer')

  // toolbar 标识：JSON chip + 格式化 toggle on
  await expect(page.locator('.bv-tag')).toHaveText('JSON')
  await expect(page.locator('.bv-btn.is-on')).toHaveText('格式化')

  // 各类 token span 存在
  await expect(page.locator('.bv-pre .jx-key').first()).toBeVisible()
  await expect(page.locator('.bv-pre .jx-str').first()).toBeVisible()
  await expect(page.locator('.bv-pre .jx-num').first()).toBeVisible()
  await expect(page.locator('.bv-pre .jx-bool').first()).toBeVisible()
  await expect(page.locator('.bv-pre .jx-null').first()).toBeVisible()

  // 内容是 pretty 形态（含换行）
  const text = await page.locator('.bv-pre').textContent()
  expect(text).toContain('\n')
  expect(text).toContain('"id"')

  await page.screenshot({ path: 'tests-e2e/screenshots/body-viewer-small.png' })
})

test('BodyViewer · 切换原文 toggle', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'small'))
  await page.waitForSelector('.body-viewer')

  await page.locator('.bv-btn').first().click() // 切到原文
  await expect(page.locator('.bv-btn.is-on')).toHaveCount(0)
  // 原文态没有 jx-* span
  await expect(page.locator('.bv-pre .jx-key')).toHaveCount(0)
  // 内容单行（不含 \n）
  const text = await page.locator('.bv-pre').textContent()
  expect(text).not.toContain('\n')
})

test('BodyViewer · large JSON：自动折叠 + 展开按钮', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'large'))
  await page.waitForSelector('.body-viewer')

  // 折叠按钮存在
  const expandBtn = page.locator('.bv-expand')
  await expect(expandBtn).toBeVisible()
  await expect(expandBtn).toContainText('展开剩余')

  // 先截图（带按钮的折叠态），再点击验证消失
  await page.screenshot({ path: 'tests-e2e/screenshots/body-viewer-large.png' })

  await expandBtn.click()
  await expect(page.locator('.bv-expand')).toHaveCount(0)
})

test('BodyViewer · 非 JSON 纯文本：不出 JSON chip + 不染色', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'text'))
  await page.waitForSelector('.body-viewer')

  await expect(page.locator('.bv-tag')).toHaveCount(0)
  await expect(page.locator('.bv-btn.is-on')).toHaveCount(0)
  await expect(page.locator('.bv-pre .jx-key')).toHaveCount(0)
  await expect(page.locator('.bv-pre')).toContainText('this is just plain text')
})

test('BodyViewer · XSS 防护：string 里的 <script> 不会注入', async ({ context, extensionId }) => {
  const page = await context.newPage()
  // 故意要看 console / runtime 报警：harness 也不应被 evaluate 跑
  page.on('dialog', async (d) => {
    await d.dismiss()
    throw new Error('!! XSS escaped, alert dialog fired: ' + d.message())
  })
  await page.goto(harnessUrl(extensionId, 'xss'))
  await page.waitForSelector('.body-viewer')

  // 等一下，确保任何 inline script 都有机会跑
  await page.waitForTimeout(300)

  // DOM 内不应该有 <script> 元素
  const scriptCount = await page.locator('.bv-pre script').count()
  expect(scriptCount).toBe(0)

  // 但文本里应该看到 escape 后的字面量
  const text = await page.locator('.bv-pre').textContent()
  expect(text).toContain('<script>alert(1)</script>')
})

test('BodyViewer · search 高亮：mark 标签注入', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'small', 'alice'))
  await page.waitForSelector('.body-viewer')

  await expect(page.locator('.bv-pre mark')).toHaveCount(1)
  await expect(page.locator('.bv-pre mark')).toHaveText('alice')
})
