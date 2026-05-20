import { test, expect } from './fixtures'

/**
 * Overview 行展开 detail 渲染路径锁定。
 *
 * panel-tabs.spec 只验了 row 列表渲染，row click → row-detail 展开 +
 * BodyViewer / Headers / stack 染色路径从来没 E2E 覆盖过 —— 一旦
 * Overview.vue 的 toggle / highlightStack / BodyViewer 嵌入哪天回归
 * 没人能发现。这批锁住交互后的 detail 渲染基线。
 *
 * harness 数据（src/devtools/panel-harness.ts buildRequests / buildErrors）：
 *   i % 3 === 0 → kind=xhr，否则 fetch
 *   i % 4 === 1 → requestBody = '{"a":1,"b":2}'
 *   i === 2     → duration=1500（≥1s 橙 .dur--slow）
 *   i === 5     → duration=4200（≥3s 红 .dur--xslow）
 *   i % 7 === 6 → status=500；i % 5 === 4 → status=404
 *   error i=0   → level='error'（ERR tag）
 */

function harnessUrl(extensionId: string, tab: string, seed: string, count?: number): string {
  const q = new URLSearchParams({ tab, seed })
  if (count) q.set('count', String(count))
  return `chrome-extension://${extensionId}/src/devtools/panel-harness.html?${q.toString()}`
}

test('panel · Overview row click → row-detail 展开（含 URL / Kind kv + Request Headers section）', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'overview', 'populated'))
  await page.waitForSelector('.overview .row', { timeout: 5000 })

  // 第 1 个请求行（按时间线倒排，最新在上）—— 不限定是哪条 i，
  // 只要点开能渲染基础 detail 框架就算锁住了 toggle / row-detail 路径
  const firstReqHead = page.locator('.overview .row:not(.row--err) .row-head').first()
  await firstReqHead.click()

  // detail 展开
  const detail = page.locator('.overview .row.open .row-detail').first()
  await expect(detail).toBeVisible()

  // 基础 kv：URL 和 Kind 必须有
  const kvKeys = await detail.locator('.kv .k').allInnerTexts()
  expect(kvKeys, 'row-detail 缺 URL kv').toContain('URL')
  expect(kvKeys, 'row-detail 缺 Kind kv').toContain('Kind')

  // Request Headers section（harness 每个请求都有 Content-Type header）
  // h5 CSS 是 text-transform: uppercase —— allInnerTexts() 拿到的是渲染后的大写
  const headings = await detail.locator('h5').allInnerTexts()
  expect(headings, 'row-detail 缺 Request Headers section').toContain('REQUEST HEADERS')

  // headers pre 内容含 Content-Type；hasText 用 RegExp 大小写不敏感避开 uppercase 干扰
  await expect(
    detail.locator('section').filter({ has: page.locator('h5', { hasText: /request headers/i }) }).locator('pre')
  ).toContainText('Content-Type')
})

test('panel · Overview 慢请求 duration 染色（1500ms .dur--slow / 4200ms .dur--xslow）', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'overview', 'populated'))
  await page.waitForSelector('.overview .row', { timeout: 5000 })

  // 不依赖时间线顺序，按 .dur 的可见文本定位（"1500ms" / "4200ms"）。
  // filter({ hasText }) 是子串匹配，但 "1500ms" 不会跟其它 dur (80~129ms) 冲突
  const slow = page.locator('.overview .row-head .dur', { hasText: '1500ms' })
  await expect(slow, 'i=2 的 1500ms dur 没出现').toHaveCount(1)
  await expect(slow, '1500ms 没拿到 .dur--slow class（橙色染色失效）').toHaveClass(/dur--slow/)

  const xslow = page.locator('.overview .row-head .dur', { hasText: '4200ms' })
  await expect(xslow, 'i=5 的 4200ms dur 没出现').toHaveCount(1)
  await expect(xslow, '4200ms 没拿到 .dur--xslow class（红色染色失效）').toHaveClass(/dur--xslow/)
})

test('panel · Overview 错误行展开 → stack section + 行内染色 span (.st-fn / .st-file / .st-loc)', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'overview', 'populated'))
  await page.waitForSelector('.overview .row--err', { timeout: 5000 })

  // populated seed 含 3 errors，全有 stack
  const errCount = await page.locator('.overview .row--err').count()
  expect(errCount, 'populated 错误数应该 = 3').toBe(3)

  // 点第 1 条错误行
  await page.locator('.overview .row--err .row-head').first().click()

  const detail = page.locator('.overview .row--err.open .row-detail').first()
  await expect(detail).toBeVisible()

  // Stack section 存在
  await expect(detail.locator('h5', { hasText: 'Stack' })).toBeVisible()
  const stackPre = detail.locator('pre.stack')
  await expect(stackPre).toBeVisible()

  // highlightStack 真生效：内有 .st-fn / .st-file / .st-loc 行内 span
  // harness 的 stack: "Error: x\n    at foo (app.js:10:5)\n    at bar (app.js:20:8)"
  // → 必有 fn (foo/bar) + file (app.js) + loc (:行:列)
  await expect(stackPre.locator('.st-fn').first(), 'stack 没渲染 .st-fn span = highlightStack 失效').toBeVisible()
  await expect(stackPre.locator('.st-file').first(), 'stack 没渲染 .st-file span').toBeVisible()
  await expect(stackPre.locator('.st-loc').first(), 'stack 没渲染 .st-loc span').toBeVisible()
})

test('panel · Overview 含 body 的请求展开 → Request Body section + BodyViewer 渲染 + JSON bv-tag', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'overview', 'populated'))
  await page.waitForSelector('.overview .row', { timeout: 5000 })

  // i%4===1 的请求有 requestBody = '{"a":1,"b":2}'（i=1,5,9）。
  // 任选一条，按 URL path "/api/items/1" 定位（最简单）
  const targetRow = page.locator('.overview .row', {
    has: page.locator('.url', { hasText: '/api/items/1' })
  }).filter({ hasNot: page.locator('.url[title*="/api/items/10"]') }).first()
  // ↑ 排除 /api/items/10 / /11 ... 的子串匹配（populated 默认 10 条 i=0..9 不会撞，
  //   但 count 一旦被覆盖到 ≥11 就要小心；这里只跑 default populated 10 条）

  await targetRow.locator('.row-head').click()
  const detail = targetRow.locator('.row-detail')
  await expect(detail).toBeVisible()

  // Request Body section 存在
  await expect(detail.locator('h5', { hasText: 'Request Body' })).toBeVisible()

  // BodyViewer 嵌入
  const bv = detail.locator('section').filter({ has: page.locator('h5', { hasText: 'Request Body' }) }).locator('.body-viewer')
  await expect(bv, 'Request Body section 内没找到 .body-viewer 元素').toBeVisible()

  // JSON 自动识别 tag
  await expect(bv.locator('.bv-tag'), 'BodyViewer JSON tag 缺失（isJson 检测失效）').toHaveText('JSON')
})
