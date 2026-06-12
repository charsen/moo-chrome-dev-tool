/**
 * MooDialog v0.8.11 三件 UX 行为锁（harness 层）—— 淡遮罩 / header 拖拽 / 缩小恢复。
 * 复用 dialog-harness.html（open shadow，Playwright locator 直接穿透）。
 *
 * 覆盖：
 *   - UX1 light 遮罩：--light 类 + backdrop-filter none + scrim alpha ≈ .18
 *   - UX2 dark 模式下 light 遮罩翻浅雾色（rgba(226,232,240,.12)）
 *   - UX3 header 真鼠标拖拽：跟手位移 + --moved 类 + inline translate
 *   - UX4 拖拽 clamp：四向极限（左右 ≥48px 可抓 / 顶不出 / 底留 48）
 *   - UX5 <4px 纯点击不弄脏 pos（无 --moved、无 transform、不位移）
 *   - UX6 在缩小/×按钮上按下拖动不触发整窗拖拽，也不误触按钮语义
 *   - UX7 缩小→pill→恢复：mask 消失/宿主可点/表单保留/焦点回容器
 *   - UX8 缩小态 Esc = 恢复（不是 cancel）
 *   - UX9 缩小态 ⌘↵ 不提交；恢复后 ⌘↵ 正常提交（红→绿突变①靶点）
 *   - UX10 选元素 picking 期间 mask 与 pill 都不可见（shell v-show 回归锁）
 *
 * 不覆盖（real-flow spec 负责）：跨「再截一张」卸载重挂的位置记忆 + 无闪跳
 * （--moved animation:none）+ 真 closed shadow / 真宿主页交互。
 * mask 点击取消已有 dialog-submit D3 锁，不重复。
 */

import { test, expect, openExtensionPage } from './fixtures'
import type { Page } from '@playwright/test'

function harnessUrl(extensionId: string, search = ''): string {
  return `chrome-extension://${extensionId}/src/content/dialog-harness.html?case=submit${search ? '&' + search : ''}`
}

async function readEmits(page: Page): Promise<{ event: string }[]> {
  return await page.evaluate(() => {
    const log = (window as unknown as { __mooHarnessEmits?: { value: { event: string }[] } }).__mooHarnessEmits
    return log?.value.map((e) => ({ event: e.event })) ?? []
  })
}

async function openDialog(
  context: Parameters<typeof openExtensionPage>[0],
  sw: Parameters<typeof openExtensionPage>[1],
  extensionId: string,
  search = ''
): Promise<Page> {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, search))
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForSelector('#moo-title', { timeout: 5000 })
  // 入场动画（moo-dialog-in 0.2s：translateY(8px) scale(.99)）播放期 bbox 是瞬态值，
  // 等动画全部结束再开测 —— 否则拖拽位移断言拿到被动画污染的基准
  await page.locator('.moo-dialog').evaluate(async (el) => {
    await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})))
  })
  return page
}

/** 读 .moo-dialog 的拖拽相关状态（类 / 内联 transform / 视口矩形） */
async function dialogState(page: Page) {
  return await page.locator('.moo-dialog').evaluate((el) => {
    const r = el.getBoundingClientRect()
    return {
      moved: el.classList.contains('moo-dialog--moved'),
      inlineTransform: (el as HTMLElement).style.transform,
      x: r.x, y: r.y, width: r.width, height: r.height
    }
  })
}

/** 在 header 标题区（避开右侧按钮）拿一个可抓的真实坐标 */
async function headGrabPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('.moo-dialog-head').boundingBox()
  if (!box) throw new Error('header bbox missing')
  return { x: box.x + 60, y: box.y + box.height / 2 }
}

/** 合成 PointerEvent 拖拽（坐标可超视口 —— clamp 极限用；真鼠标拖在 UX3） */
async function syntheticDrag(page: Page, toX: number, toY: number): Promise<void> {
  await page.evaluate(([tx, ty]) => {
    const shadow = (window as unknown as { __mooHarnessShadow: ShadowRoot }).__mooHarnessShadow
    const head = shadow.querySelector('.moo-dialog-head')!
    const r = head.getBoundingClientRect()
    const sx = r.left + 60, sy = r.top + r.height / 2
    const opts = { pointerId: 7, button: 0, bubbles: true, composed: true }
    head.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: sx, clientY: sy }))
    // 两步 move：第一步越过 4px 阈值，第二步到目标
    window.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: sx + 20, clientY: sy + 20 }))
    window.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: tx!, clientY: ty! }))
    window.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: tx!, clientY: ty! }))
  }, [toX, toY])
}

// ═══════════════════════ 淡遮罩 ═══════════════════════

test('UX1 · light 遮罩：--light 类 + 无 blur + scrim alpha≈0.18（看得见底下页面）', async ({ context, extensionId, sw }) => {
  const page = await openDialog(context, sw, extensionId)

  const mask = page.locator('.moo-dialog-mask')
  await expect(mask).toHaveClass(/moo-dialog-mask--light/)

  const style = await mask.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { backdropFilter: cs.backdropFilter, background: cs.backgroundColor }
  })
  expect(style.backdropFilter, 'light variant 必须去掉 blur').toBe('none')
  // rgba(15, 23, 42, 0.18) —— slate-900 同源、alpha .18
  const m = style.background.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)
  expect(m, `scrim 应是 rgba 带透明度，实际: ${style.background}`).toBeTruthy()
  expect([m![1], m![2], m![3]]).toEqual(['15', '23', '42'])
  expect(Number(m![4])).toBeCloseTo(0.18, 2)
})

test('UX2 · dark 模式：light 遮罩翻成极淡浅雾 rgba(226,232,240,.12)', async ({ context, extensionId, sw }) => {
  const page = await openDialog(context, sw, extensionId)
  await page.emulateMedia({ colorScheme: 'dark' })

  const bg = await page.locator('.moo-dialog-mask').evaluate((el) => getComputedStyle(el).backgroundColor)
  const m = bg.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)
  expect(m, `dark 下 scrim 实际: ${bg}`).toBeTruthy()
  expect([m![1], m![2], m![3]]).toEqual(['226', '232', '240'])
  expect(Number(m![4])).toBeCloseTo(0.12, 2)
})

// ═══════════════════════ header 拖拽 ═══════════════════════

test('UX3 · 真鼠标 header 拖拽：跟手位移 + --moved 类 + inline translate', async ({ context, extensionId, sw }) => {
  const page = await openDialog(context, sw, extensionId)
  const before = await dialogState(page)
  expect(before.moved, '初始不带 --moved').toBe(false)
  expect(before.inlineTransform, '初始无内联 transform').toBe('')

  const grab = await headGrabPoint(page)
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x + 150, grab.y + 90, { steps: 6 })
  await page.mouse.up()

  const after = await dialogState(page)
  expect(after.moved).toBe(true)
  expect(after.inlineTransform).toBe('translate(150px, 90px)')
  expect(after.x - before.x).toBeCloseTo(150, 0)
  expect(after.y - before.y).toBeCloseTo(90, 0)

  // 无闪跳机制锁：--moved 必须干掉入场动画（styles.ts `.moo-dialog--moved{animation:none}`）。
  // moo-dialog-in 的 keyframes transform 播放期会盖过内联 translate —— 重挂还原位置时
  // 没这条规则就先「居中入场 0.2s」再跳到记忆位（真重挂闪跳断言在 real-flow F4）。
  // 断 computed animation-name 而非 getAnimations()：动画播完后 computed 值仍然稳定，
  // 不依赖采样时机。
  const animName = await page.locator('.moo-dialog').evaluate((el) => getComputedStyle(el).animationName)
  expect(animName, '--moved 后入场动画必须被 animation:none 干掉').toBe('none')

  // 第二次拖：增量叠加在当前 pos 上，不归零不跳变
  const grab2 = await headGrabPoint(page)
  await page.mouse.move(grab2.x, grab2.y)
  await page.mouse.down()
  await page.mouse.move(grab2.x - 70, grab2.y - 40, { steps: 4 })
  await page.mouse.up()
  const after2 = await dialogState(page)
  expect(after2.x - after.x).toBeCloseTo(-70, 0)
  expect(after2.y - after.y).toBeCloseTo(-40, 0)
})

test('UX4 · 拖拽 clamp：右/底极限留 48px 可抓，左可出但右缘 ≥48px，顶不许出', async ({ context, extensionId, sw }) => {
  const page = await openDialog(context, sw, extensionId)
  const vw = 1280, vh = 800

  // 往右下甩出 4000px → 左缘 clamp 到 vw-48、顶 clamp 到 vh-48
  await syntheticDrag(page, 4000, 4000)
  const s1 = await dialogState(page)
  expect(s1.moved).toBe(true)
  expect(s1.x).toBeCloseTo(vw - 48, 0)
  expect(s1.y).toBeCloseTo(vh - 48, 0)

  // 往左上甩 -4000px → 右缘 clamp 到 48（minLeft = 48 - width）、顶 clamp 到 0
  await syntheticDrag(page, -4000, -4000)
  const s2 = await dialogState(page)
  expect(s2.x + s2.width).toBeCloseTo(48, 0)
  expect(s2.y).toBeCloseTo(0, 0)
})

test('UX5 · header 上 <4px 移动 = 纯点击：不弄脏 pos（无 --moved/无 transform/零位移）', async ({ context, extensionId, sw }) => {
  const page = await openDialog(context, sw, extensionId)
  const before = await dialogState(page)

  const grab = await headGrabPoint(page)
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x + 2, grab.y + 1)
  await page.mouse.up()

  const after = await dialogState(page)
  expect(after.moved, '<4px 不应进入拖拽态').toBe(false)
  expect(after.inlineTransform).toBe('')
  expect(after.x).toBeCloseTo(before.x, 0)
  expect(after.y).toBeCloseTo(before.y, 0)
})

test('UX6 · 按住缩小/×按钮拖动：不触发整窗拖拽，也不误触按钮（拖离后松手 click 不成立）', async ({ context, extensionId, sw }) => {
  const page = await openDialog(context, sw, extensionId)
  const before = await dialogState(page)

  // 缩小按钮上按下 → 拖 60px（落点保持在 dialog 内）→ 松手。
  // ⚠ 落点不能出 dialog：press 在 dialog 内 + release 落 mask 时浏览器把 click 派发到
  //   共同祖先（= mask），@click.self 会误判成「点 mask」→ cancel。这是 MooDialog
  //   既有行为（非本次三件 UX 引入），本 spec 不锁它 —— 已单独上报。
  const minBox = await page.locator('.moo-dialog-min-btn').boundingBox()
  if (!minBox) throw new Error('min btn bbox missing')
  await page.mouse.move(minBox.x + minBox.width / 2, minBox.y + minBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(minBox.x - 60, minBox.y + 60, { steps: 4 })
  await page.mouse.up()

  let s = await dialogState(page)
  expect(s.moved, '按钮上的 pointerdown 不接管拖拽').toBe(false)
  expect(s.x).toBeCloseTo(before.x, 0)
  await expect(page.locator('.moo-dialog-restore-pill'), '拖离按钮松手不算 click，不应缩小').toHaveCount(0)

  // × 按钮同款：拖离（dialog 内落点）不关窗
  const closeBox = await page.locator('.moo-dialog-head .moo-close-btn').boundingBox()
  if (!closeBox) throw new Error('close btn bbox missing')
  await page.mouse.move(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(closeBox.x - 100, closeBox.y + 80, { steps: 4 })
  await page.mouse.up()

  s = await dialogState(page)
  expect(s.moved).toBe(false)
  await expect(page.locator('.moo-dialog')).toBeVisible()
  const emits = await readEmits(page)
  expect(emits.some((e) => e.event === 'cancel')).toBe(false)
})

// ═══════════════════════ 缩小 / 恢复 ═══════════════════════

test('UX7 · 缩小：mask 消失 + pill 出现 + 宿主页可点；pill 恢复：表单保留 + 焦点回容器', async ({ context, extensionId, sw }) => {
  const page = await openDialog(context, sw, extensionId)
  await page.locator('#moo-title').fill('缩小期间要保留的标题')

  await page.locator('.moo-dialog-min-btn').click()
  await expect(page.locator('.moo-dialog-mask')).toBeHidden()
  const pill = page.locator('.moo-dialog-restore-pill')
  await expect(pill).toBeVisible()
  await expect(pill).toContainText('继续填写 Bug')

  // 宿主页可交互：mask 不再拦截，点击落到 harness 页面 document
  await page.evaluate(() => {
    ;(window as unknown as { __pageClicked: boolean }).__pageClicked = false
    document.addEventListener('click', () => {
      ;(window as unknown as { __pageClicked: boolean }).__pageClicked = true
    }, { once: true })
  })
  await page.mouse.click(300, 200)   // 避开右下角 pill
  expect(await page.evaluate(() => (window as unknown as { __pageClicked: boolean }).__pageClicked)).toBe(true)

  // pill 点击恢复
  await pill.click()
  await expect(page.locator('.moo-dialog-mask')).toBeVisible()
  await expect(pill).toHaveCount(0)
  await expect(page.locator('#moo-title')).toHaveValue('缩小期间要保留的标题')

  // 焦点回 dialog 容器内（focusTrap paused 复位 flush:post → focusInitial；
  // SubmitDialog 的 stealPageFocus 链路随后还会把焦点细化到标题输入框 —— 异步，轮询断言）
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const shadow = (window as unknown as { __mooHarnessShadow?: ShadowRoot }).__mooHarnessShadow
      const dialog = shadow?.querySelector('.moo-dialog')
      return !!dialog && (dialog === shadow!.activeElement || dialog.contains(shadow!.activeElement))
    })
  }, { timeout: 2000, message: '恢复后焦点应回到 dialog 容器内' }).toBe(true)

  // 全程没有 cancel（缩小/恢复都不是关闭）
  const emits = await readEmits(page)
  expect(emits.some((e) => e.event === 'cancel')).toBe(false)
})

test('UX8 · 缩小态 Esc = 恢复弹窗（不是 cancel）', async ({ context, extensionId, sw }) => {
  const page = await openDialog(context, sw, extensionId)
  await page.locator('#moo-title').fill('esc 恢复')
  await page.locator('.moo-dialog-min-btn').click()
  await expect(page.locator('.moo-dialog-restore-pill')).toBeVisible()

  await page.keyboard.press('Escape')

  await expect(page.locator('.moo-dialog-mask')).toBeVisible()
  await expect(page.locator('.moo-dialog-restore-pill')).toHaveCount(0)
  await expect(page.locator('#moo-title')).toHaveValue('esc 恢复')
  const emits = await readEmits(page)
  expect(emits.some((e) => e.event === 'cancel'), '缩小态 Esc 不应触发 cancel').toBe(false)
})

test('UX9 · 缩小态 ⌘↵ 不提交；恢复后 ⌘↵ 正常提交', async ({ context, extensionId, sw }) => {
  const page = await openDialog(context, sw, extensionId, 'success=true')
  await page.locator('#moo-title').fill('快捷键守卫')
  await page.locator('.moo-dialog-min-btn').click()
  await expect(page.locator('.moo-dialog-restore-pill')).toBeVisible()

  // 缩小态：⌘↵ 必须被放行给宿主页（keydown guard 首行早返），不能触发提交
  await page.keyboard.press('ControlOrMeta+Enter')
  await page.waitForTimeout(200)
  await expect(page.locator('.moo-submit-success'), '缩小态 ⌘↵ 不应提交').toHaveCount(0)
  let emits = await readEmits(page)
  expect(emits.some((e) => e.event === 'submitted')).toBe(false)

  // 恢复后：⌘↵ 恢复提交语义（正控，证明快捷键链路本身是通的）
  await page.locator('.moo-dialog-restore-pill').click()
  await expect(page.locator('.moo-dialog-mask')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.locator('.moo-submit-success')).toBeVisible({ timeout: 3000 })
  emits = await readEmits(page)
  expect(emits.some((e) => e.event === 'cancel')).toBe(false)
})

// ═══════════════════════ picking 回归 ═══════════════════════

test('UX10 · 选元素 picking 期间：mask 与 pill 都不可见（shell v-show 整体隐藏回归锁）', async ({ context, extensionId, sw }) => {
  const page = await openDialog(context, sw, extensionId)
  await page.locator('#moo-title').fill('picking 期间保留')

  // 展开「附带元素」details → 点「选元素」
  await page.locator('.moo-attach-hd', { hasText: '附带元素' }).click()
  await page.locator('button', { hasText: '选元素' }).click()
  await page.waitForSelector('.moo-picker', { timeout: 5000 })

  await expect(page.locator('.moo-dialog-mask'), 'picking 期间整个 dialog shell 应隐藏').toBeHidden()
  await expect(page.locator('.moo-dialog-restore-pill'), 'picking 期间不应出现恢复 pill').toHaveCount(0)

  // Esc 退出 picker → dialog 回来，表单还在
  await page.keyboard.press('Escape')
  await expect(page.locator('.moo-picker')).toHaveCount(0)
  await expect(page.locator('.moo-dialog-mask')).toBeVisible()
  await expect(page.locator('#moo-title')).toHaveValue('picking 期间保留')
  const emits = await readEmits(page)
  expect(emits.some((e) => e.event === 'cancel')).toBe(false)
})
