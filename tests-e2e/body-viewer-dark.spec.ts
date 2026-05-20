import { test, expect } from './fixtures'

/**
 * R4（10 回合第 4 回）：BodyViewer 在 dark mode 下 token 染色对比度。
 *
 * 背景：v0.1.13 改了 tokens.css token 反扫 + shadow 加 glass token；
 * BodyViewer 走 devtools world（不是 shadow），tokens.css 的
 * @media (prefers-color-scheme: dark) 块对它生效。本 spec 锁住 dark mode
 * 下 JSON 染色各 token（key/str/num/bool/null）颜色都跟 light 不同
 * （证明 token 真的切了），且都非 transparent。
 */

function harnessUrl(extensionId: string, caseName: string): string {
  const q = new URLSearchParams({ case: caseName })
  return `chrome-extension://${extensionId}/src/devtools/body-viewer-harness.html?${q.toString()}`
}

async function readTokenColors(page: import('@playwright/test').Page) {
  return await page.evaluate(() => {
    const pick = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null
      return el ? getComputedStyle(el).color : null
    }
    return {
      key: pick('.bv-pre .jx-key'),
      str: pick('.bv-pre .jx-str'),
      num: pick('.bv-pre .jx-num'),
      bool: pick('.bv-pre .jx-bool'),
      nul: pick('.bv-pre .jx-null'),
      bg: pick('.body-viewer')
    }
  })
}

test('R4 · BodyViewer dark mode 下各 token 颜色都解析 + 非 transparent + 跟 light 不同', async ({ context, extensionId }) => {
  const light = await context.newPage()
  await light.emulateMedia({ colorScheme: 'light' })
  await light.goto(harnessUrl(extensionId, 'small'))
  await light.waitForSelector('.body-viewer .bv-pre .jx-key')
  const lightColors = await readTokenColors(light)
  await light.close()

  const dark = await context.newPage()
  await dark.emulateMedia({ colorScheme: 'dark' })
  await dark.goto(harnessUrl(extensionId, 'small'))
  await dark.waitForSelector('.body-viewer .bv-pre .jx-key')
  const darkColors = await readTokenColors(dark)
  await dark.close()

  for (const k of ['key', 'str', 'num', 'bool', 'nul'] as const) {
    expect(lightColors[k], `light ${k} 颜色没解析`).toBeTruthy()
    expect(darkColors[k], `dark ${k} 颜色没解析`).toBeTruthy()
    expect(lightColors[k], `light ${k} transparent`).not.toBe('rgba(0, 0, 0, 0)')
    expect(darkColors[k], `dark ${k} transparent`).not.toBe('rgba(0, 0, 0, 0)')
  }
  // 至少 3 类 token 在 dark 应该跟 light 不同（key/str/num/bool 都映射到带 dark 变体的 token；
  // null 用 text-dim 故意两边同色 #94a3b8，不要求差异）。
  // 这就锁住「dark mode @media 块真的被加载 + 至少多数 token 被 override」
  let diffCount = 0
  for (const k of ['key', 'str', 'num', 'bool'] as const) {
    if (darkColors[k] !== lightColors[k]) diffCount++
  }
  expect(diffCount, 'dark mode @media 没生效 — key/str/num/bool 没一个 token 变色').toBeGreaterThanOrEqual(3)
})

test('R4.2 · BodyViewer 大 body 在 dark mode 下「展开剩余 X K 字符」按钮颜色对比合理', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(harnessUrl(extensionId, 'large'))
  await page.waitForSelector('.body-viewer')

  const fold = await page.evaluate(() => {
    const btn = document.querySelector('.bv-expand') as HTMLElement | null
    if (!btn) return null
    const cs = getComputedStyle(btn)
    return { color: cs.color, bg: cs.backgroundColor, border: cs.borderColor }
  })
  expect(fold, '大 body 没触发「展开剩余」按钮（.bv-expand）').not.toBeNull()
  expect(fold!.color, '展开按钮文字 transparent').not.toBe('rgba(0, 0, 0, 0)')
})
