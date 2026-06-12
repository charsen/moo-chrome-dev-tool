/**
 * SubmitDialog 多张截图（v0.8.10）行为锁 —— dialog-harness `?case=submit&shots=N`
 * 生成 N 张占位图作 images prop。覆盖：
 *   - MS1 shots=3：3 张缩略 + 「＋ 再截一张（3/5）」可点 → emit add-shot
 *   - MS2 shots=3：删除第 2 张 → emit remove-shot,1（MooCloseBtn 常显不藏 hover）
 *   - MS3 shots=5：再截按钮 disabled + title 含上限说明
 *   - MS4 reannotate 带 index（无确认弹窗，直接 emit reannotate,2）
 *   - MS5 recapture 带 index：已填标题 → window.confirm；accept → emit recapture,1
 *   - MS6 recapture confirm dismiss → 不 emit（cancel-guard 不回归）
 *   - MS7 shots=0：截图行常显（0/5 按钮可点），dialog 不挂
 *
 * 不覆盖（ContentApp 持有 images 状态 + 截图/标注真流程，harness 驱不动）：
 *   - add-shot/remove-shot 之后缩略列表真增删（ContentApp splice）
 *   - dialogDraft 跨卸载草稿恢复（填表 → 再截 → 内容还在）→ 发版前真机手测项
 */

import { test, expect, openExtensionPage } from './fixtures'

function harnessUrl(extensionId: string, search = ''): string {
  return `chrome-extension://${extensionId}/src/content/dialog-harness.html?case=submit${search ? '&' + search : ''}`
}

interface EmitRecord { event: string; payload: unknown[] }

async function readEmits(page: import('@playwright/test').Page): Promise<EmitRecord[]> {
  return await page.evaluate(() => {
    const log = (window as unknown as { __mooHarnessEmits?: { value: { event: string; payload: unknown[] }[] } }).__mooHarnessEmits
    return log?.value.map((e) => ({ event: e.event, payload: e.payload })) ?? []
  })
}

test('SubmitDialog · MS1 · shots=3：3 张缩略 + 再截按钮（3/5）可点 → emit add-shot', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 'shots=3'))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  // 3 张缩略卡
  await expect(page.locator('.moo-shots .moo-thumb-wrap')).toHaveCount(3)
  // 每张都有「重新标注 / 重新截图」两个 action + 1 个删除 ×
  await expect(page.locator('.moo-shots .moo-thumb-wrap .moo-thumb-action')).toHaveCount(6)
  await expect(page.locator('.moo-shots .moo-thumb-wrap .moo-close-btn')).toHaveCount(3)

  const addBtn = page.locator('.moo-shots > .moo-btn.small')
  await expect(addBtn).toContainText('再截一张（3/5）')
  await expect(addBtn).toBeEnabled()

  await addBtn.click()
  const emits = await readEmits(page)
  expect(emits.filter((e) => e.event === 'add-shot')).toHaveLength(1)
})

test('SubmitDialog · MS2 · shots=3：删除第 2 张 → emit remove-shot,1', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 'shots=3'))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  // MooCloseBtn 常显（不进 hover overlay），第 2 张 = index 1
  await page.locator('.moo-shots .moo-thumb-wrap').nth(1).locator('.moo-close-btn').click()

  const emits = await readEmits(page)
  const removes = emits.filter((e) => e.event === 'remove-shot')
  expect(removes).toHaveLength(1)
  expect(removes[0]!.payload).toEqual([1])
  // 单张删除不弹确认（设计语义：重截成本低），dialog 仍在
  await expect(page.locator('.moo-dialog')).toBeVisible()
})

test('SubmitDialog · MS3 · shots=5：再截按钮 disabled + title 含上限说明', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 'shots=5'))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  await expect(page.locator('.moo-shots .moo-thumb-wrap')).toHaveCount(5)
  const addBtn = page.locator('.moo-shots > .moo-btn.small')
  await expect(addBtn).toContainText('再截一张（5/5）')
  await expect(addBtn).toBeDisabled()
  await expect(addBtn).toHaveAttribute('title', /最多附 5 张/)

  // disabled 按钮 force click 也不应 emit（@click 不触发是 Vue/DOM 语义，锁一道）
  await addBtn.click({ force: true })
  const emits = await readEmits(page)
  expect(emits.filter((e) => e.event === 'add-shot')).toHaveLength(0)
})

test('SubmitDialog · MS4 · 重新标注第 3 张 → emit reannotate,2（无确认弹窗）', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 'shots=3'))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  // overlay 默认半透常显（v0.4.7 起 opacity .35），hover 后全显；Playwright click 自带 hover
  const thumb3 = page.locator('.moo-shots .moo-thumb-wrap').nth(2)
  await thumb3.hover()
  await thumb3.locator('.moo-thumb-action', { hasText: '重新标注' }).click()

  const emits = await readEmits(page)
  const re = emits.filter((e) => e.event === 'reannotate')
  expect(re).toHaveLength(1)
  expect(re[0]!.payload).toEqual([2])
})

test('SubmitDialog · MS5 · 已填标题 + 重新截图第 2 张 → confirm accept → emit recapture,1', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 'shots=3'))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  // 填了标题才会触发 window.confirm（cancel-guard）
  await page.locator('#moo-title').fill('多图重截确认流')

  let confirmMessage = ''
  page.once('dialog', (d) => {
    confirmMessage = d.message()
    void d.accept()
  })
  const thumb2 = page.locator('.moo-shots .moo-thumb-wrap').nth(1)
  await thumb2.hover()
  await thumb2.locator('.moo-thumb-action', { hasText: '重新截图' }).click()

  const emits = await readEmits(page)
  const rc = emits.filter((e) => e.event === 'recapture')
  expect(rc).toHaveLength(1)
  expect(rc[0]!.payload).toEqual([1])
  // v0.8.10 文案改"真话"：只丢该张标注，其余截图与已填内容保留
  expect(confirmMessage).toContain('重新截这张')
  expect(confirmMessage).toContain('其余截图与已填内容保留')
})

test('SubmitDialog · MS6 · 重新截图 confirm dismiss → 不 emit recapture', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 'shots=2'))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  await page.locator('#moo-title').fill('反悔不重截')
  page.once('dialog', (d) => { void d.dismiss() })

  const thumb1 = page.locator('.moo-shots .moo-thumb-wrap').nth(0)
  await thumb1.hover()
  await thumb1.locator('.moo-thumb-action', { hasText: '重新截图' }).click()

  const emits = await readEmits(page)
  expect(emits.filter((e) => e.event === 'recapture')).toHaveLength(0)
  await expect(page.locator('.moo-dialog')).toBeVisible()
})

test('SubmitDialog · MS7 · shots=0：截图行常显（0/5），dialog 正常可用', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId))   // 缺省 shots=0
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  // 截图行不再 v-if 隐藏：0 张也显示「再截一张」入口（录屏流程 / 删光后可补截）
  await expect(page.locator('.moo-shots')).toBeVisible()
  await expect(page.locator('.moo-shots .moo-thumb-wrap')).toHaveCount(0)
  const addBtn = page.locator('.moo-shots > .moo-btn.small')
  await expect(addBtn).toContainText('再截一张（0/5）')
  await expect(addBtn).toBeEnabled()

  // dialog 不挂：标题可输入，ESC 仍能 cancel
  await page.locator('#moo-title').fill('still alive')
  await page.locator('.moo-dialog').press('Escape')
  const emits = await readEmits(page)
  expect(emits.some((e) => e.event === 'cancel')).toBe(true)
})
