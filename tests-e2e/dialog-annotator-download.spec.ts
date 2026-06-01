/**
 * Annotator「下载」按钮行为锁 —— 覆盖 v0.8.3 新增「下一步」左侧的「下载」按钮。
 *
 * 这是 E2E 层（Playwright + 真 chromium 加载 dist + content shadow harness）：
 *   - 下载链路用 <a download> + a.click() 触发浏览器下载，page.waitForEvent('download')
 *     才能捕获，纯单测（jsdom 无下载语义）锁不住 → 必须 E2E。
 *
 * 覆盖：
 *   - D1 工具栏「下载」按钮存在，且在「取消」与「下一步」之间
 *   - D2 点击真触发下载事件：文件名匹配 moo-screenshot-\d{8}-\d{6}\.png + 是 PNG（magic bytes）
 *   - D3 下载内容是合成图：PNG 尺寸 = canvas 尺寸（200×200），证明不是空 / 0 字节
 *   - D4 点「下载」不关闭 Annotator（不 emit finish/cancel），标注界面还在 + 「下一步」仍可点
 *
 * 不覆盖（其他层 / 手测）：
 *   - 合成图的标注像素是否「画对」（drawXxx 逐工具像素正确性）—— 业务渲染，非下载链路
 *   - 真注入环境（悬浮球 → 截图 → Annotator）下载 —— harness 绕开前置链路，真链路靠手测
 *   - 文件落盘到用户真实「下载」目录 —— 浏览器侧行为，Playwright 落到临时路径
 *
 * 实现要点：
 * - 200×200 占位图（harness makeTinyPng），Annotator naturalWidth/Height=200 → canvas 200×200
 * - download() 走 composeCanvas().toBlob() 异步 → 用 Promise.all 同时挂 waitForEvent('download') + click
 */

import { test, expect, openExtensionPage } from './fixtures'
import type { Page } from '@playwright/test'

function harnessUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/src/content/dialog-harness.html?case=annotator`
}

async function readEmits(page: Page): Promise<{ event: string }[]> {
  return await page.evaluate(() => {
    const log = (window as unknown as { __mooHarnessEmits?: { value: { event: string }[] } }).__mooHarnessEmits
    return log?.value.map((e) => ({ event: e.event })) ?? []
  })
}

/** 读 PNG buffer 的宽高（IHDR：8 字节签名后 width@16..20 / height@20..24，big-endian）。 */
function pngSize(buf: Buffer): { width: number; height: number } {
  // PNG 签名 89 50 4E 47 0D 0A 1A 0A
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) throw new Error('not a PNG (bad signature)')
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

async function locateDownloadBtn(page: Page) {
  await page.waitForSelector('.moo-canvas-draw', { timeout: 5000 })
  return page.locator('.moo-annotator .actions-right button', { hasText: '下载' })
}

test('Annotator download · D1 · 工具栏有「下载」按钮，位于「复制」与「下一步」之间', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId))
  await page.waitForSelector('.moo-canvas-draw', { timeout: 5000 })

  const download = page.locator('.moo-annotator .actions-right button', { hasText: '下载' })
  await expect(download).toBeVisible()

  // 顺序断言：v0.8.x 加「复制」后，actions-right 末尾四按钮应为 取消 / 复制 / 下载 / 下一步
  const labels = await page.locator('.moo-annotator .actions-right button').allInnerTexts()
  const tail = labels.slice(-4).map((t) => t.trim())
  expect(tail).toEqual(['取消', '复制', '下载', '下一步'])
})

test('Annotator download · D2+D3 · 点击触发下载：文件名匹配 + 是 PNG + 尺寸=canvas(200×200)', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId))
  const download = await locateDownloadBtn(page)

  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    download.click()
  ])

  // D2: 文件名 moo-screenshot-YYYYMMDD-HHmmss.png
  expect(dl.suggestedFilename()).toMatch(/^moo-screenshot-\d{8}-\d{6}\.png$/)

  // D3: 落盘读 buffer，确认是 PNG 且尺寸 = canvas（合成图不是空图）
  const filePath = await dl.path()
  expect(filePath).toBeTruthy()
  const fs = await import('node:fs')
  const buf = fs.readFileSync(filePath!)
  expect(buf.length).toBeGreaterThan(0)
  const { width, height } = pngSize(buf)
  expect(width).toBe(200)
  expect(height).toBe(200)
})

test('Annotator download · D4 · 点「下载」不关闭 Annotator（不 emit finish/cancel）+「下一步」仍可点', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId))
  const download = await locateDownloadBtn(page)

  await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    download.click()
  ])

  // Annotator 仍挂载、工具栏在
  await expect(page.locator('.moo-annotator')).toBeVisible()
  // 不 emit cancel / finish（download 故意不退出标注界面）
  const emits = await readEmits(page)
  expect(emits.filter((e) => e.event === 'cancel').length).toBe(0)
  expect(emits.filter((e) => e.event === 'finish').length).toBe(0)

  // 「下一步」仍可点：点了应 emit finish（确认下载没破坏后续提交链路）
  await page.locator('.moo-annotator .actions-right button', { hasText: '下一步' }).click()
  await page.waitForFunction(() => {
    const log = (window as unknown as { __mooHarnessEmits?: { value: { event: string }[] } }).__mooHarnessEmits
    return log?.value.some((e) => e.event === 'finish') ?? false
  }, { timeout: 2000 })
})
