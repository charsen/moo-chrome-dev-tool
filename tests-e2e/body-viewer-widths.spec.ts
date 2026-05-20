import { test, expect } from './fixtures'

/**
 * R3（10 回合第 3 回）：BodyViewer 在极宽 / 极窄宽度下渲染。
 *
 * 用户大分辨率截图反映「界面没展示完整」。BodyViewer 是 Overview 行展开时
 * 渲染请求 / 响应 body 的核心组件——它的 <pre> 块要在多种宽度下都不破：
 *   - 不撑爆父容器（导致整个 DevTools 横向滚动）
 *   - 不在窄宽下被裁掉关键内容
 */

function harnessUrl(extensionId: string, caseName: string, search = ''): string {
  const q = new URLSearchParams({ case: caseName, search })
  return `chrome-extension://${extensionId}/src/devtools/body-viewer-harness.html?${q.toString()}`
}

const WIDTHS = [400, 768, 1280, 1920, 3840]

for (const width of WIDTHS) {
  test(`R3 · BodyViewer 在 ${width}px 宽下不撑爆父 + body 内容仍可见`, async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.setViewportSize({ width, height: 800 })
    await page.goto(harnessUrl(extensionId, 'small'))
    await page.waitForSelector('.body-viewer')

    const root = await page.evaluate(() => {
      const bv = document.querySelector('.body-viewer') as HTMLElement | null
      if (!bv) return null
      const pre = document.querySelector('.body-viewer .bv-pre') as HTMLElement | null
      return {
        bvWidth: bv.getBoundingClientRect().width,
        bvScrollWidth: bv.scrollWidth,
        bvClientWidth: bv.clientWidth,
        htmlScrollWidth: document.documentElement.scrollWidth,
        htmlClientWidth: document.documentElement.clientWidth,
        preExists: !!pre,
        preScrollWidth: pre?.scrollWidth ?? 0,
        preClientWidth: pre?.clientWidth ?? 0,
        preTextLength: pre?.textContent?.length ?? 0
      }
    })

    expect(root, 'BodyViewer 没渲染').not.toBeNull()
    // 1) html 不横向滚动（pre 的 overflow-x: auto 或 white-space: pre-wrap 应该兜底）
    expect(root!.htmlScrollWidth, `${width}px 下 html 横向溢出 — pre 块没护栏`).toBeLessThanOrEqual(root!.htmlClientWidth + 1)
    // 2) bv 容器本身不超过 viewport
    expect(root!.bvWidth, `BodyViewer 实际宽度超 viewport`).toBeLessThanOrEqual(width + 1)
    // 3) pre 存在 + 有内容
    expect(root!.preExists, 'bv-pre 缺失').toBe(true)
    expect(root!.preTextLength, 'bv-pre 内容为空').toBeGreaterThan(0)
  })
}

test('R3.2 · BodyViewer XSS case 在窄宽下不破（验证文字内容含 < / > 不撑爆）', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.setViewportSize({ width: 400, height: 800 })
  await page.goto(harnessUrl(extensionId, 'xss'))
  await page.waitForSelector('.body-viewer')

  const overflow = await page.evaluate(() => ({
    s: document.documentElement.scrollWidth,
    c: document.documentElement.clientWidth
  }))
  expect(overflow.s, 'xss case 在 400px 下 html 横向溢出').toBeLessThanOrEqual(overflow.c + 1)
})
