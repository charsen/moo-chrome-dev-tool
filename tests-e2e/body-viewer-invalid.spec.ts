import { test, expect } from './fixtures'

/**
 * A2（matrix 真值缺口）：BodyViewer 在 invalid / 非 JSON / 空 body 输入下不破。
 *
 * 维度交叉：A (BodyViewer) × K (invalid input) × L (storage corrupt-ish 输入)。
 *
 * harness 提供的 case: small / large / text / invalid / xss
 * 已 covered：small / large / text / xss
 * 这次补：invalid（看起来像 JSON 但 parse 失败）+ 一些边界
 */

function harnessUrl(extensionId: string, caseName: string): string {
  return `chrome-extension://${extensionId}/src/devtools/body-viewer-harness.html?case=${caseName}`
}

test('A2.1 · BodyViewer invalid JSON：不应崩溃，应当退回原文展示', async ({ context, extensionId }) => {
  const errors: string[] = []
  const page = await context.newPage()
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })

  await page.goto(harnessUrl(extensionId, 'invalid'))
  await page.waitForSelector('.body-viewer')

  // pre 块仍有内容（原文展示）
  const text = await page.locator('.body-viewer .bv-pre').textContent()
  expect(text, 'invalid case 没渲染任何内容').toBeTruthy()
  expect(text, 'invalid case 应保留原文 "broken json"').toContain('broken json')

  // JSON chip 不应该亮（parse 失败 = 不是 JSON）
  const chip = await page.locator('.body-viewer .bv-tag').count()
  expect(chip, 'invalid case 不应该被识别为 JSON').toBe(0)

  // 没有 jx-* 染色 token（parse 失败就不染色）
  const colored = await page.locator('.body-viewer .bv-pre .jx-key').count()
  expect(colored, 'invalid case 不应该有 jx-* 染色').toBe(0)

  // 关键：没 page error / console error
  expect(errors, `invalid case 触发了 ${errors.length} 个 page error: ${errors.join(', ')}`).toHaveLength(0)

  await page.close()
})

test('A2.2 · BodyViewer text case（纯文本，非 JSON）正常渲染', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'text'))
  await page.waitForSelector('.body-viewer')

  const text = await page.locator('.body-viewer .bv-pre').textContent()
  expect(text).toContain('plain text')

  // 不出 JSON chip
  expect(await page.locator('.body-viewer .bv-tag').count()).toBe(0)

  await page.close()
})

test('A2.3 · BodyViewer XSS case：string value 里的 <script> 不会被注入 + DOM 结构正确', async ({ context, extensionId }) => {
  let hacked = false
  const page = await context.newPage()
  await page.exposeFunction('__signalHack', () => { hacked = true })

  // harness 渲染 XSS case 后，如果 escape 失败 <script>alert(1)</script> 会跑
  // playwright 自动 dismiss alert（默认），但我们额外用 globalThis hook 兜底
  await page.addInitScript(() => {
    const origAlert = window.alert
    window.alert = (msg) => { (window as unknown as { __sigh: (m: unknown) => void }).__sigh?.(msg); origAlert?.call(window, msg) }
  })

  await page.goto(harnessUrl(extensionId, 'xss'))
  await page.waitForSelector('.body-viewer')

  // 内容里的 <script> / <b> 应该当文本展示，不是 element
  const html = await page.locator('.body-viewer .bv-pre').innerHTML()
  expect(html, 'XSS case 真有 <script> 元素被注入').not.toContain('<script>alert')
  expect(html, '"<script>" 字符串应该 escape 成 &lt;script&gt;').toContain('&lt;script&gt;')

  expect(hacked).toBe(false)
  await page.close()
})

test('A2.4 · BodyViewer 不存在的 case 名：harness 自身不崩，pre 是空', async ({ context, extensionId }) => {
  const errors: string[] = []
  const page = await context.newPage()
  page.on('pageerror', (err) => errors.push(err.message))

  await page.goto(harnessUrl(extensionId, 'totally-fake-case-name-xxx'))
  await page.waitForSelector('.body-viewer', { timeout: 3000 })

  // body-viewer 仍挂上来，pre 应该是空（harness 的 default 是 return ''）
  const exists = await page.locator('.body-viewer').count()
  expect(exists).toBe(1)
  expect(errors).toHaveLength(0)

  await page.close()
})
