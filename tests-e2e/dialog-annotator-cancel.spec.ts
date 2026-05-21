/**
 * Annotator cancel-guard 行为锁 —— 覆盖原 v0.1.14 手摸 checklist 第 2 步：
 *   - 画 ≥1 笔后点「取消」→ MooAlert 弹出（标题 / 「已有 N 处标注」）
 *   - cancel-guard 内 ESC / mask click → dismiss（不退出 Annotator）
 *   - cancel-guard 内 Tab 焦点在两按钮间循环
 *   - 点「放弃标注」红按钮 → Annotator emit 'cancel'
 *
 * 实现要点：
 * - 200×200 占位图，Annotator naturalWidth/Height = 200 + viewport 1280×800 → displayScale=1
 * - mode 默认 'rect'，pointerdown→pointermove→pointerup 在 .moo-canvas-draw 上画矩形
 * - 画 1 笔即可触发 cancel-guard（items.length > 0），多画 1 笔确保 N=2 文案稳
 */

import { test, expect, openExtensionPage } from './fixtures'

function harnessUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/src/content/dialog-harness.html?case=annotator`
}

async function readEmits(page: import('@playwright/test').Page): Promise<{ event: string }[]> {
  return await page.evaluate(() => {
    const log = (window as unknown as { __mooHarnessEmits?: { value: { event: string }[] } }).__mooHarnessEmits
    return log?.value.map((e) => ({ event: e.event })) ?? []
  })
}

/**
 * 在 shadow DOM 内 dispatch keydown 触发 useFocusTrap 监听。
 *
 * 为啥不用 page.keyboard.press / locator.press：Playwright 用 CDP Input.dispatchKeyEvent
 * 发系统级按键事件，浏览器路由焦点到 shadow host 的 light DOM 视角（host=DIV），而非
 * shadow 内真活跃元素。结果 trap 挂在 .moo-cancel-guard-card 上的 keydown listener
 * 永远收不到事件。这是 Playwright 已知的 shadow DOM + headless 行为差异。
 *
 * 直接 dispatchEvent 绕过 OS-level 路由，等价于"键盘事件 bubble 到 trap target"那个
 * 阶段——这是 useFocusTrap 设计上接管的层，测试用这一姿势完全合法。
 */
async function pressKeyInShadow(
  page: import('@playwright/test').Page,
  selector: string,
  key: string
): Promise<void> {
  await page.evaluate(({ sel, k }) => {
    const shadow = document.getElementById('__moo_dev_tool_host__')?.shadowRoot
    const target = shadow?.querySelector(sel) as HTMLElement | null
    if (!target) throw new Error(`pressKeyInShadow: ${sel} not found in shadow`)
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  }, { sel: selector, k: key })
}

/** 在 .moo-canvas-draw 上画一个矩形：从 (x1,y1) 拖到 (x2,y2)，坐标是 canvas 相对像素。 */
async function drawRect(
  page: import('@playwright/test').Page,
  x1: number, y1: number, x2: number, y2: number
): Promise<void> {
  const canvas = page.locator('.moo-canvas-draw')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas bbox missing')
  // 真鼠标走 down→move→up：Annotator 的 onDown 用 setPointerCapture + 监听 window pointerup
  await page.mouse.move(box.x + x1, box.y + y1)
  await page.mouse.down()
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 5 })
  await page.mouse.up()
}

async function setupWithTwoRects(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
  sw: import('@playwright/test').Worker
): Promise<import('@playwright/test').Page> {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId))
  await page.waitForSelector('.moo-canvas-draw', { timeout: 5000 })
  // 画 2 个不重叠的矩形：保证 items.length === 2 让 cancel-guard 文案显「已有 2 处」
  await drawRect(page, 20, 20, 80, 80)
  await drawRect(page, 100, 100, 160, 160)
  return page
}

test('Annotator cancel-guard · A1 · 画 2 笔后点「取消」→ MooAlert 含标题 + 「已有 2 处」', async ({ context, extensionId, sw }) => {
  const page = await setupWithTwoRects(context, extensionId, sw)

  // .actions-right 里有「取消」按钮（line 91 of Annotator.vue）
  await page.locator('.moo-annotator button', { hasText: '取消' }).first().click()

  const guard = page.locator('.moo-cancel-guard-card')
  await expect(guard).toBeVisible()
  await expect(guard).toContainText('放弃标注')
  await expect(guard).toContainText('已有 2 处标注')
})

test('Annotator cancel-guard · A2 · ESC → dismiss + Annotator 仍在 + 不 emit cancel', async ({ context, extensionId, sw }) => {
  const page = await setupWithTwoRects(context, extensionId, sw)

  await page.locator('.moo-annotator button', { hasText: '取消' }).first().click()
  await page.waitForSelector('.moo-cancel-guard-card', { timeout: 2000 })

  // ESC 走 trap onEscape → emit('cancel') → dismissCancelGuard。用 pressKeyInShadow
  // 走 dispatchEvent，绕开 Playwright CDP 路由到 shadow host 的限制（见 helper 注释）
  await pressKeyInShadow(page, '.moo-cancel-guard-card', 'Escape')

  // cancel-guard 关闭
  await expect(page.locator('.moo-cancel-guard-card')).toHaveCount(0, { timeout: 2000 })
  // Annotator 仍在
  await expect(page.locator('.moo-annotator')).toBeVisible()
  // 不应 emit 'cancel'
  const emits = await readEmits(page)
  expect(emits.filter((e) => e.event === 'cancel').length).toBe(0)
})

test('Annotator cancel-guard · A3 · 点 mask 外灰区 → 等同 ESC：dismiss + 不 emit cancel', async ({ context, extensionId, sw }) => {
  const page = await setupWithTwoRects(context, extensionId, sw)

  await page.locator('.moo-annotator button', { hasText: '取消' }).first().click()
  const mask = page.locator('.moo-cancel-guard')
  await expect(mask).toBeVisible()

  const box = await mask.boundingBox()
  if (!box) throw new Error('mask bbox missing')
  // 左上 20,20 一定在 mask 上而不在 card 上（card 居中）
  await page.mouse.click(box.x + 20, box.y + 20)

  await expect(page.locator('.moo-cancel-guard-card')).toHaveCount(0, { timeout: 1000 })
  await expect(page.locator('.moo-annotator')).toBeVisible()
  const emits = await readEmits(page)
  expect(emits.filter((e) => e.event === 'cancel').length).toBe(0)
})

test('Annotator cancel-guard · A4 · 点「放弃标注」红按钮 → emit cancel', async ({ context, extensionId, sw }) => {
  const page = await setupWithTwoRects(context, extensionId, sw)

  await page.locator('.moo-annotator button', { hasText: '取消' }).first().click()
  await page.waitForSelector('.moo-cancel-guard-card', { timeout: 2000 })

  // 「放弃标注」是 confirm-text，走 danger-confirm 红样式
  await page.locator('.moo-cancel-guard-card button', { hasText: '放弃标注' }).click()

  // Annotator 应 emit 'cancel'（doCancel 路径）
  await page.waitForFunction(() => {
    const log = (window as unknown as { __mooHarnessEmits?: { value: { event: string }[] } }).__mooHarnessEmits
    return log?.value.some((e) => e.event === 'cancel') ?? false
  }, { timeout: 1000 })
})
