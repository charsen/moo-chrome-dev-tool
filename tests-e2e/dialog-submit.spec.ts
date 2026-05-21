/**
 * SubmitDialog 行为锁 —— 用 src/content/dialog-harness.html 在 chrome-extension://
 * 页面内复现 shadow root + 组件实例化。覆盖原 v0.1.14 手摸 checklist 第 3 步：
 *   - 初始焦点在标题输入框
 *   - ESC / mask click → emit 'cancel'
 *   - Tab 焦点循环不出 dialog
 *   - 成功视图 1.5s 保护期：ESC / mask 都不应再 emit cancel
 *   - 失败横幅 × 只关横幅，dialog 仍在
 *
 * 实现要点：
 * - mock chrome.runtime.sendMessage 在 harness.ts 内做了，根据 ?fail / ?success 切语义
 * - emit 走 window.__mooHarnessEmits 数组，spec 通过 evaluate 读取断言
 * - locator 自动穿透 closed shadow，无需手动跨 shadow boundary
 */

import { test, expect, openExtensionPage } from './fixtures'

function harnessUrl(extensionId: string, search = ''): string {
  return `chrome-extension://${extensionId}/src/content/dialog-harness.html?case=submit${search ? '&' + search : ''}`
}

async function readEmits(page: import('@playwright/test').Page): Promise<{ event: string }[]> {
  return await page.evaluate(() => {
    const log = (window as unknown as { __mooHarnessEmits?: { value: { event: string }[] } }).__mooHarnessEmits
    return log?.value.map((e) => ({ event: e.event })) ?? []
  })
}

test('SubmitDialog · D1 · 初始焦点在标题输入框', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  // SubmitDialog.onMounted 用 nextTick → focus；给一帧时间稳定
  await page.waitForFunction(() => {
    const root = (document.getElementById('__moo_dev_tool_host__') as HTMLElement & {
      shadowRoot: ShadowRoot | null
    })
    // closed shadow 在外层直接读 shadowRoot 是 null，走 harness 暴露的 hook
    const shadow = (window as unknown as { __mooHarnessShadow?: ShadowRoot }).__mooHarnessShadow ?? root.shadowRoot
    return shadow?.activeElement?.id === 'moo-title'
  }, { timeout: 3000 })
})

test('SubmitDialog · D2 · ESC → emit cancel', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  // ESC 走 useFocusTrap → onEscape → MooDialog emit 'close' → SubmitDialog onMaskClick → emit('cancel')
  await page.locator('.moo-dialog').press('Escape')

  const emits = await readEmits(page)
  expect(emits.some((e) => e.event === 'cancel')).toBe(true)
})

test('SubmitDialog · D3 · 点 mask 外灰区 → emit cancel', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId))
  await page.waitForSelector('.moo-dialog-mask', { timeout: 5000 })

  // mask 上找一个 dialog 容器外的点击位置：取 mask 左上角偏移一点
  const mask = page.locator('.moo-dialog-mask')
  const box = await mask.boundingBox()
  if (!box) throw new Error('mask bbox missing')
  // 点 mask 左上 20,20 —— 一定不在 .moo-dialog 容器内（容器居中）
  await page.mouse.click(box.x + 20, box.y + 20)

  const emits = await readEmits(page)
  expect(emits.some((e) => e.event === 'cancel')).toBe(true)
})

test('SubmitDialog · D4 · Tab 焦点在 dialog 内循环（不走出宿主页）', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId))
  await page.waitForSelector('#moo-title', { timeout: 5000 })
  await page.waitForFunction(() => {
    const shadow = (window as unknown as { __mooHarnessShadow?: ShadowRoot }).__mooHarnessShadow
    return shadow?.activeElement?.id === 'moo-title'
  })

  // 连按 Tab 30 下后焦点必须仍在 dialog 内（focusable 集合远小于 30，必然循环至少一次）
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab')
  }
  const inDialog = await page.evaluate(() => {
    const shadow = (window as unknown as { __mooHarnessShadow?: ShadowRoot }).__mooHarnessShadow
    if (!shadow) return false
    const dialog = shadow.querySelector('.moo-dialog')
    return !!dialog?.contains(shadow.activeElement)
  })
  expect(inDialog).toBe(true)
})

test('SubmitDialog · D5 · 成功视图 1.5s 保护期：ESC 不触发 cancel', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 'success=true'))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  // 填标题 → 点提交 → 等 ✓ 成功视图
  await page.locator('#moo-title').fill('mock submit')
  await page.locator('.moo-dialog-foot .moo-btn.primary').click()
  await page.waitForSelector('.moo-submit-success', { timeout: 3000 })

  // 成功视图期间 ESC 不应触发 cancel（onMaskClick 早返）。successTimer 1.5s 后才
  // 触发 'submitted' —— 时间窗内只断言保护期：cancel 没发出来
  await page.locator('.moo-dialog').press('Escape')
  await page.waitForTimeout(50)
  const emits = await readEmits(page)
  expect(emits.some((e) => e.event === 'cancel')).toBe(false)
})

test('SubmitDialog · D6 · 成功视图 1.5s 保护期：点 mask 不触发 cancel', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 'success=true'))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  await page.locator('#moo-title').fill('mock submit 2')
  await page.locator('.moo-dialog-foot .moo-btn.primary').click()
  await page.waitForSelector('.moo-submit-success', { timeout: 3000 })

  const mask = page.locator('.moo-dialog-mask')
  const box = await mask.boundingBox()
  if (!box) throw new Error('mask bbox missing')
  await page.mouse.click(box.x + 20, box.y + 20)
  await page.waitForTimeout(50)

  const emits = await readEmits(page)
  expect(emits.filter((e) => e.event === 'cancel').length).toBe(0)
})

test('SubmitDialog · D7 · 失败横幅 × 只关横幅，dialog 仍在', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 'fail=true'))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  await page.locator('#moo-title').fill('mock fail')
  await page.locator('.moo-dialog-foot .moo-btn.primary').click()

  // 失败横幅出现
  const banner = page.locator('.moo-submit-fail')
  await expect(banner).toBeVisible({ timeout: 3000 })
  await expect(banner).toContainText('提交失败')
  await expect(banner).toContainText('mock failure: server 503')

  // 点横幅 × 关
  await page.locator('.moo-submit-fail-dismiss').click()
  await expect(banner).toHaveCount(0, { timeout: 1000 })

  // dialog 仍在 + 没有 'cancel' emit
  await expect(page.locator('.moo-dialog')).toBeVisible()
  const emits = await readEmits(page)
  expect(emits.filter((e) => e.event === 'cancel').length).toBe(0)
})
