/**
 * Annotator「复制」按钮行为锁 —— 覆盖 v0.8.x 新增「下载」左侧的「复制」按钮
 * （把标注后的图片复制到剪贴板，可直接粘进 IM / 文档 / 工单）。
 *
 * 这是 E2E 层（Playwright + 真 chromium 加载 dist + content shadow harness）：
 *   - copyImage() 走 navigator.clipboard.write([ClipboardItem]) —— 真剪贴板写入只有
 *     真 chromium + 安全上下文（chrome-extension://）才有语义，jsdom 单测锁不住 → 必须 E2E。
 *   - ClipboardItem 传 Promise<Blob> 保住 click 手势，这条「不在 write 前 await toBlob」
 *     的时序约束只有真浏览器 transient activation 才暴露，纯逻辑测不出。
 *
 * 覆盖：
 *   - C1 工具栏「复制」按钮存在、enabled（harness=chrome-extension:// 安全上下文 →
 *     canCopyImage 恒 true），且位于「取消」与「下载」之间
 *   - C2 点「复制」→ 剪贴板真有 PNG：context 全局 grant clipboard-read/write 后
 *     navigator.clipboard.read() 断言有 image/png 项，读出 blob 验 PNG magic bytes
 *   - C3 点「复制」后按钮文字变「已复制 ✓」（成功反馈），≤1.5s 后回「复制」
 *   - C4 点「复制」不关闭 Annotator（不 emit finish/cancel），标注界面还在
 *
 * 不覆盖（其他层 / const 判定 / 手测）：
 *   - canCopyImage=false 的 HTTP 普通页置灰态：harness 永远是安全上下文，canCopyImage
 *     恒 true，无法在 harness 复现置灰。这是一个纯 const 判定
 *     （navigator.clipboard?.write 是 function + window.ClipboardItem 存在），
 *     HTTP 宿主页的真实置灰靠人肉手测（RELEASE_TEST_CHECKLIST）。
 *   - 真注入环境（悬浮球 → 截图 → Annotator）复制 —— harness 绕开前置链路，真链路靠手测。
 *   - 复制图的标注像素是否「画对」—— 业务渲染，非复制链路（与 download spec 同理）。
 *
 * headless clipboard 可行性（已实测确认，非假绿）：
 *   - chrome-extension:// 是 isSecureContext，navigator.clipboard.write 图片在
 *     --headless=new 下真成功（无「Document is not focused」失败，page 有 focus）。
 *   - clipboard.read() 的读权限：grantPermissions 不能给 chrome-extension（opaque origin
 *     会报 "Permission can't be granted to opaque origins"），但**不带 origin 的全局
 *     grantPermissions(['clipboard-read','clipboard-write'])** 能让 extension origin 的
 *     read() 放行 → 真读回 PNG（magic bytes 137,80,78,71,...）。
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

/** actions-right 里的「复制」按钮 —— 注意点击后文案会变「已复制 ✓」，故用位置定位（倒数第 3 个：复制/下载/下一步）。 */
async function locateCopyBtn(page: Page) {
  await page.waitForSelector('.moo-canvas-draw', { timeout: 5000 })
  // 末尾四按钮：取消 / 复制 / 下载 / 下一步 → 复制是倒数第 3
  return page.locator('.moo-annotator .actions-right button').nth(-3)
}

test('Annotator copy · C1 · 工具栏有「复制」按钮，enabled，位于「取消」与「下载」之间', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId))
  await page.waitForSelector('.moo-canvas-draw', { timeout: 5000 })

  // 顺序断言：actions-right 末尾四按钮应为 取消 / 复制 / 下载 / 下一步
  const labels = await page.locator('.moo-annotator .actions-right button').allInnerTexts()
  const tail = labels.slice(-4).map((t) => t.trim())
  expect(tail).toEqual(['取消', '复制', '下载', '下一步'])

  // harness=chrome-extension:// 是安全上下文，canCopyImage 恒 true → 按钮 enabled（不置灰）
  const copy = await locateCopyBtn(page)
  await expect(copy).toBeVisible()
  await expect(copy).toBeEnabled()
})

test('Annotator copy · C2 · 点「复制」→ 剪贴板真有 PNG（read 回验 magic bytes）', async ({ context, extensionId, sw }) => {
  // 不带 origin 的全局 grant：能让 chrome-extension origin 的 clipboard.read() 放行
  // （带 origin 会因 opaque origin 被拒）。write 本身在安全上下文无需 grant。
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])

  const page = await openExtensionPage(context, sw, harnessUrl(extensionId))
  const copy = await locateCopyBtn(page)
  // headless 下 clipboard.write 要求 document focused —— 确保 page 在前台
  await page.bringToFront()

  await copy.click()

  // 直接 poll 剪贴板内容（write 的真效果），不用按钮文案做前置门 ——
  // 「已复制 ✓」只显示 1.5s，headless 调度下成功反馈可能在轮询间隙一闪而过
  // （实测：grant-clipboard-read 后首个 write resolve 极快，剪贴板已有图但文案已
  // reset 回「复制」）。剪贴板有 PNG 才是 copy 成功的硬证据，UI 反馈交给 C3 单独锁。
  // 读回剪贴板：用 expect.poll（对 falsy 返回有明确 retry-until-match 语义，
  // 比 waitForFunction 处理 async/null 边界稳）。读出 image/png blob 的前 8 字节。
  const readMagic = (): Promise<number[] | null> =>
    page.evaluate(async () => {
      try {
        const items = await navigator.clipboard.read()
        for (const it of items) {
          if (it.types.includes('image/png')) {
            const blob = await it.getType('image/png')
            const buf = new Uint8Array(await blob.arrayBuffer())
            return Array.from(buf.slice(0, 8))
          }
        }
      } catch {
        // read 权限未 settle / NotAllowed → 返回 null 继续轮询
      }
      return null
    })

  // PNG 签名 89 50 4E 47 0D 0A 1A 0A
  await expect
    .poll(readMagic, { timeout: 5000, intervals: [100, 200, 300] })
    .toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
})

test('Annotator copy · C3 · 点「复制」后按钮文字变「已复制 ✓」（成功反馈），随后回「复制」', async ({ context, extensionId, sw }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])

  const page = await openExtensionPage(context, sw, harnessUrl(extensionId))
  const copy = await locateCopyBtn(page)
  await page.bringToFront()
  await expect(copy).toHaveText('复制')

  await copy.click()
  // write 成功 → copyState='done' → label「已复制 ✓」（失败会是「复制失败」，断言成功路径）
  await expect(copy).toHaveText('已复制 ✓', { timeout: 3000 })

  // copyHintTimer 1.5s 后 copyState 回 idle → label 回「复制」
  await expect(copy).toHaveText('复制', { timeout: 3000 })
})

test('Annotator copy · C4 · 点「复制」不关闭 Annotator（不 emit finish/cancel）', async ({ context, extensionId, sw }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])

  const page = await openExtensionPage(context, sw, harnessUrl(extensionId))
  const copy = await locateCopyBtn(page)
  await page.bringToFront()

  await copy.click()
  // 等成功反馈出现，确认 copyImage 真跑完一轮
  await expect(copy).toHaveText('已复制 ✓', { timeout: 3000 })

  // Annotator 仍挂载、工具栏在
  await expect(page.locator('.moo-annotator')).toBeVisible()
  // 不 emit cancel / finish（copy 故意不退出标注界面）
  const emits = await readEmits(page)
  expect(emits.filter((e) => e.event === 'cancel').length).toBe(0)
  expect(emits.filter((e) => e.event === 'finish').length).toBe(0)
})
