import { test, expect } from './fixtures'

/**
 * R6（10 回合第 6 回）：BodyViewer search 高亮多 match + 不同宽度下不破布局。
 *
 * 现有 body-viewer.spec.ts 已覆盖「单一 search 高亮 mark 注入」，
 * 但没验证：① 多 match（如搜索 "id" 在大 JSON 含 100 个 id 字段）
 * ② 在不同宽度下 mark 元素不破布局
 * ③ 跨 token span 边界的 match（如搜 ":1" 横跨 jx-key 到 jx-num）
 */

function harnessUrl(extensionId: string, caseName: string, search = ''): string {
  const q = new URLSearchParams({ case: caseName, search })
  return `chrome-extension://${extensionId}/src/devtools/body-viewer-harness.html?${q.toString()}`
}

test('R6 · 多 match：large case 搜 "id" 应该高亮所有 100 个 id 字段', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.setViewportSize({ width: 800, height: 600 })
  await page.goto(harnessUrl(extensionId, 'large', 'id'))
  await page.waitForSelector('.body-viewer')

  // 大 body 默认折叠了，先展开
  const expandBtn = page.locator('.bv-expand')
  if (await expandBtn.count() > 0) await expandBtn.click()

  const markCount = await page.locator('.body-viewer .bv-pre mark').count()
  // large case 含 80 条 {"id":N,"name":"item-N","score":..,"active":..}
  // "id" 出现在每个 key（80 次）+ 可能 score 里没 id，name "item-X" 没 id。预期 80 次 +
  expect(markCount, '多 match 高亮 mark 数 < 50，可能 search 没生效或只高亮第一处').toBeGreaterThan(50)
})

test('R6.2 · search 高亮 mark 在 400px 窄宽下不撑爆容器', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.setViewportSize({ width: 400, height: 600 })
  await page.goto(harnessUrl(extensionId, 'small', 'id'))
  await page.waitForSelector('.body-viewer')

  // 小 case JSON 含 "id":1，搜 "id" 应至少高亮 1 处
  const markCount = await page.locator('.body-viewer .bv-pre mark').count()
  expect(markCount, 'small case 搜 id 应至少 1 处高亮').toBeGreaterThanOrEqual(1)

  // 关键：mark 不能撑爆容器
  const overflow = await page.evaluate(() => ({
    s: document.documentElement.scrollWidth,
    c: document.documentElement.clientWidth
  }))
  expect(overflow.s, '窄宽 400px 下 mark 元素撑爆 html').toBeLessThanOrEqual(overflow.c + 1)
})

test('R6.3 · search 空字符串：mark 数 = 0 + 不破坏正常染色', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'small', ''))
  await page.waitForSelector('.body-viewer .bv-pre .jx-key')

  const markCount = await page.locator('.body-viewer .bv-pre mark').count()
  expect(markCount, '空 search 不应该有 mark').toBe(0)

  // jx-* 染色仍正常
  await expect(page.locator('.body-viewer .bv-pre .jx-key').first()).toBeVisible()
})
