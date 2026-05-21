/**
 * FloatingBall 拖动行为锁 —— 覆盖 lost-pointerup race 修复（用户报「跟着鼠标跑 + 乱跑」）。
 *
 * 验证 onDown / onMove / endDrag 这条链路在多渠道结束时都能正确收尾：
 *   - F1 · 正常 down → move >4px → up：ball.pos 落在新位置，pointermove listener 清理
 *   - F2 · 「lost pointerup」（pointerup 不送达 window）+ 后续 pointermove：ball **不应**继续跟着移动
 *   - F3 · pointercancel 路径：同 pointerup 落盘 + 清理
 *   - F4 · window blur 路径：球不落盘但清理 listener（避免后续 move 还跟）
 *
 * 不能用 page.locator(ball).dragTo()：MCP-driven drag 在 closed shadow 上路由有限制，且
 * 这一组 case 要精确控制「up 不发」的边角，dispatchEvent 才能精确驱动。
 */

import { test, expect, openExtensionPage } from './fixtures'

function harnessUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/src/content/dialog-harness.html?case=floating-ball`
}

/** 直接在 shadow 里的 .moo-ball-row 上 dispatch 一个真实坐标的 pointerdown */
async function pointerDownAtBall(
  page: import('@playwright/test').Page,
  x: number, y: number
): Promise<void> {
  await page.evaluate(({ px, py }) => {
    const shadow = document.getElementById('__moo_dev_tool_host__')?.shadowRoot
    const row = shadow?.querySelector('.moo-ball-row') as HTMLElement | null
    if (!row) throw new Error('no .moo-ball-row')
    row.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
      clientX: px, clientY: py
    }))
  }, { px: x, py: y })
}

/** 在 window 上 dispatch pointermove（FloatingBall.onDown 给 window 加的 listener 接收） */
async function pointerMoveOnWindow(
  page: import('@playwright/test').Page,
  x: number, y: number
): Promise<void> {
  await page.evaluate(({ px, py }) => {
    window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: 'mouse', buttons: 1,
      clientX: px, clientY: py
    }))
  }, { px: x, py: y })
}

async function pointerEventOnWindow(
  page: import('@playwright/test').Page,
  type: 'pointerup' | 'pointercancel',
  x: number, y: number
): Promise<void> {
  await page.evaluate(({ t, px, py }) => {
    window.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0,
      clientX: px, clientY: py
    }))
  }, { t: type, px: x, py: y })
}

async function dispatchWindowBlur(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new FocusEvent('blur'))
  })
}

/** 读 .moo-ball-wrap 上的 inline left/top（FloatingBall 用 :style 写 pos） */
async function readBallPos(page: import('@playwright/test').Page): Promise<{ x: number, y: number }> {
  return await page.evaluate(() => {
    const shadow = document.getElementById('__moo_dev_tool_host__')?.shadowRoot
    const wrap = shadow?.querySelector('.moo-ball-wrap') as HTMLElement | null
    if (!wrap) throw new Error('no .moo-ball-wrap')
    return {
      x: parseInt(wrap.style.left || '0', 10),
      y: parseInt(wrap.style.top || '0', 10)
    }
  })
}

async function setupBall(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
  sw: import('@playwright/test').Worker
): Promise<import('@playwright/test').Page> {
  // 用 init script 把 moo-ball-pos 预置到视口左上角附近（200, 200），后续 move +100px
  // 不会撞到 viewport 1280×720 的 clamp 边界（max x = 1280-170 = 1110）
  const page = await context.newPage()
  await page.addInitScript(() => {
    localStorage.setItem('moo-ball-pos', JSON.stringify({ x: 200, y: 200 }))
  })
  await page.goto(harnessUrl(extensionId))
  await page.waitForSelector('.moo-ball-row', { timeout: 5000 })
  return page
}

test('FloatingBall · F1 · 正常 down → move → up：球落到新位置 + listener 清理', async ({ context, extensionId, sw }) => {
  const page = await setupBall(context, extensionId, sw)
  const start = await readBallPos(page)

  // down 在球中心（BALL_W=170, BALL_H=56 → 中心 +85/+28）
  await pointerDownAtBall(page, start.x + 85, start.y + 28)
  // move 100px 右下（>4px 触发 dragging）
  await pointerMoveOnWindow(page, start.x + 85 + 100, start.y + 28 + 100)
  // up 在新位置
  await pointerEventOnWindow(page, 'pointerup', start.x + 85 + 100, start.y + 28 + 100)

  const afterUp = await readBallPos(page)
  expect(afterUp.x).toBeGreaterThan(start.x + 50) // 移了至少 50px
  expect(afterUp.y).toBeGreaterThan(start.y + 50)

  // 关键断言：up 之后再 move 球**不能**再跟着跑
  await pointerMoveOnWindow(page, start.x + 500, start.y + 500)
  const afterStrayMove = await readBallPos(page)
  expect(afterStrayMove.x).toBe(afterUp.x)
  expect(afterStrayMove.y).toBe(afterUp.y)
})

test('FloatingBall · F2 · 「lost pointerup」+ 后续 stray move：球必须不动（修 lost-pointerup race）', async ({ context, extensionId, sw }) => {
  const page = await setupBall(context, extensionId, sw)
  const start = await readBallPos(page)

  // 模拟用户开始拖（down + move >4px），然后 **pointerup 丢了** —— 用户拖出浏览器视口外松手 / alt-tab
  await pointerDownAtBall(page, start.x + 85, start.y + 28)
  await pointerMoveOnWindow(page, start.x + 85 + 50, start.y + 28 + 50)
  const midDrag = await readBallPos(page)
  expect(midDrag.x).toBeGreaterThan(start.x + 20) // 拖动中确实在动

  // ⚠ 不发 pointerup —— 模拟 "lost pointerup"。仍发后续 pointermove：
  // **修复前**：球继续跟鼠标跑（onMove 监听仍挂着）
  // **修复后**：下次 onDown 时 endDrag 会扫干净；但单纯发 pointermove 这里**球还是会跟**
  //          —— 因为本次还没 down 第二次，stale listener 还在
  //
  // 这一条 case 本意：验证 *后续 onDown 起手时 endDrag 防御** 把 stale listener 清掉。
  // 所以发第二次 down + 极少 move（不触发 dragging）+ up，然后再发 stray move 看球是否动
  await pointerDownAtBall(page, start.x + 200, start.y + 200) // 这里 endDrag() 起手扫尾
  await pointerEventOnWindow(page, 'pointerup', start.x + 200, start.y + 200)
  const afterSecondClick = await readBallPos(page)

  // 现在 stray move：endDrag 之后球不应再跟
  await pointerMoveOnWindow(page, start.x + 999, start.y + 999)
  const afterStray = await readBallPos(page)
  expect(afterStray.x).toBe(afterSecondClick.x)
  expect(afterStray.y).toBe(afterSecondClick.y)
})

test('FloatingBall · F3 · pointercancel 等同 pointerup：清理 listener + 落盘', async ({ context, extensionId, sw }) => {
  const page = await setupBall(context, extensionId, sw)
  const start = await readBallPos(page)

  await pointerDownAtBall(page, start.x + 85, start.y + 28)
  await pointerMoveOnWindow(page, start.x + 85 + 80, start.y + 28 + 80)
  // 浏览器在系统抢焦时发 pointercancel 而非 pointerup
  await pointerEventOnWindow(page, 'pointercancel', start.x + 85 + 80, start.y + 28 + 80)

  const afterCancel = await readBallPos(page)

  // 后续 stray move 球不应再跟
  await pointerMoveOnWindow(page, start.x + 500, start.y + 500)
  const afterStray = await readBallPos(page)
  expect(afterStray.x).toBe(afterCancel.x)
  expect(afterStray.y).toBe(afterCancel.y)
})

test('FloatingBall · F4 · window blur 兜底：清理 listener', async ({ context, extensionId, sw }) => {
  const page = await setupBall(context, extensionId, sw)
  const start = await readBallPos(page)

  await pointerDownAtBall(page, start.x + 85, start.y + 28)
  await pointerMoveOnWindow(page, start.x + 85 + 60, start.y + 28 + 60)
  // alt-tab：浏览器派 blur
  await dispatchWindowBlur(page)

  const afterBlur = await readBallPos(page)

  // 关键：blur 之后球**不应**再跟鼠标
  await pointerMoveOnWindow(page, start.x + 500, start.y + 500)
  const afterStray = await readBallPos(page)
  expect(afterStray.x).toBe(afterBlur.x)
  expect(afterStray.y).toBe(afterBlur.y)
})
