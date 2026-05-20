import { test, expect } from './fixtures'

/**
 * 4 Tab × dark mode 颜色解析 / 对比覆盖。
 *
 * 背景：v0.1.13 以来反扫硬编码 hex / 重排 token 频次较高，加上 panel-harness
 * 刚解锁的 4 Tab 自动化驱动姿势，把「dark mode 下关键元素颜色都解析了 + 跟 light
 * 不同」这层守起来。Panel 走 devtools world，tokens.css @media
 * (prefers-color-scheme: dark) 块对它生效；shadow content 不在此 scope。
 *
 * 共通断言策略（跟 popup-dark.spec.ts / body-viewer-dark.spec.ts 一致）：
 *   1) 不是 'rgba(0, 0, 0, 0)' —— 排除 transparent 漏色
 *   2) 不含 'var(' —— getComputedStyle 拿到字面色，没出现 var() = 解析成功
 *   3) 关键背景 ≠ 'rgb(255, 255, 255)' —— dark 不能漏到纯白
 *   4) 至少 1 case 显式 light vs dark 对比，证明 @media 块真生效
 *
 * 4 Tab 关键元素：
 *   - Overview：.status.ok chip bg + .row-head .method/.url 文字色
 *   - Environment：.project-item.active bg (brand-soft) + .dot bg (success)
 *   - History：.remote-status bg + .thumb-empty 边框
 *   - Settings：button.moo-switch bg + .moo-switch-thumb bg
 *     （moo-switch 关闭态用字面 #cbd5e1，开启态用 var(--moo-c-brand)；
 *      thumb 永远 #fff —— 这条算法是「dark 下也得有可读对比」的 design choice，
 *      所以这里只断「都解析了 + 非 transparent」，不要求 dark/light 必不同）
 */

function harnessUrl(extensionId: string, tab: string, seed: string): string {
  const q = new URLSearchParams({ tab, seed })
  return `chrome-extension://${extensionId}/src/devtools/panel-harness.html?${q.toString()}`
}

function isTransparent(c: string | null | undefined): boolean {
  return c === 'rgba(0, 0, 0, 0)' || c === 'transparent'
}

// ---- Overview ---------------------------------------------------------------

test('panel-dark · Overview populated：.status.ok chip + row-head 文字色解析 + body 非纯白 + light/dark 对比生效', async ({ context, extensionId }) => {
  // 先抓 light 基线
  const light = await context.newPage()
  await light.emulateMedia({ colorScheme: 'light' })
  await light.goto(harnessUrl(extensionId, 'overview', 'populated'))
  await light.waitForSelector('.overview .row-head .status.ok', { timeout: 5000 })
  const lightSnap = await light.evaluate(() => {
    const body = document.body
    const chip = document.querySelector('.overview .row-head .status.ok') as HTMLElement | null
    return {
      bodyBg: getComputedStyle(body).backgroundColor,
      chipBg: chip ? getComputedStyle(chip).backgroundColor : null,
      chipFg: chip ? getComputedStyle(chip).color : null
    }
  })
  await light.close()

  // dark 主战场
  const dark = await context.newPage()
  await dark.emulateMedia({ colorScheme: 'dark' })
  await dark.goto(harnessUrl(extensionId, 'overview', 'populated'))
  await dark.waitForSelector('.overview .row-head .status.ok', { timeout: 5000 })
  const darkSnap = await dark.evaluate(() => {
    const body = document.body
    const chip = document.querySelector('.overview .row-head .status.ok') as HTMLElement | null
    const method = document.querySelector('.overview .row-head .method') as HTMLElement | null
    const url = document.querySelector('.overview .row-head .url') as HTMLElement | null
    return {
      bodyBg: getComputedStyle(body).backgroundColor,
      chipBg: chip ? getComputedStyle(chip).backgroundColor : null,
      chipFg: chip ? getComputedStyle(chip).color : null,
      methodColor: method ? getComputedStyle(method).color : null,
      urlColor: url ? getComputedStyle(url).color : null
    }
  })
  await dark.close()

  // body 背景：dark 不能是纯白，也不能 transparent
  expect(darkSnap.bodyBg, 'Overview dark body 背景 transparent').not.toBe('rgba(0, 0, 0, 0)')
  expect(darkSnap.bodyBg, 'Overview dark body 背景仍是纯白 = tokens.css dark 块没生效').not.toBe('rgb(255, 255, 255)')

  // .status.ok chip：bg + fg 都解析
  expect(darkSnap.chipBg).not.toBeNull()
  expect(isTransparent(darkSnap.chipBg), 'dark .status.ok 背景 transparent').toBe(false)
  expect(darkSnap.chipBg, 'dark .status.ok 背景未解析 var()').not.toContain('var(')
  expect(darkSnap.chipFg, 'dark .status.ok 文字色 transparent').not.toBe('rgba(0, 0, 0, 0)')
  expect(darkSnap.chipFg, 'dark .status.ok 文字色未解析 var()').not.toContain('var(')

  // .row-head 内文字色都解析
  expect(darkSnap.methodColor, 'dark .row-head .method 文字色 transparent').not.toBe('rgba(0, 0, 0, 0)')
  expect(darkSnap.methodColor, 'dark .row-head .method 文字色未解析 var()').not.toContain('var(')
  expect(darkSnap.urlColor, 'dark .row-head .url 文字色 transparent').not.toBe('rgba(0, 0, 0, 0)')
  expect(darkSnap.urlColor, 'dark .row-head .url 文字色未解析 var()').not.toContain('var(')

  // light vs dark 对比：body bg 必须不同（证明 @media (prefers-color-scheme: dark) 真生效）
  expect(darkSnap.bodyBg, 'light vs dark body bg 相同 = dark 块没切换').not.toBe(lightSnap.bodyBg)
  // .status.ok 在 dark 用 --moo-c-success-soft 的 rgba(34, 197, 94, .18)，light 用更淡的；
  // 不要求 chipFg 必不同（success-fg 在 light/dark 都用绿系），只要求 chipBg 差异
  expect(darkSnap.chipBg, 'light vs dark .status.ok 背景相同 = success-soft token 没分 dark 变体').not.toBe(lightSnap.chipBg)
})

// ---- Environment ------------------------------------------------------------

test('panel-dark · Environment populated：.project-item.active 背景非 transparent + .dot 颜色解析', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(harnessUrl(extensionId, 'environment', 'populated'))
  await page.waitForSelector('.project-item.active', { timeout: 5000 })

  const snap = await page.evaluate(() => {
    const active = document.querySelector('.project-item.active') as HTMLElement | null
    const dot = document.querySelector('.project-item .dot') as HTMLElement | null
    const name = active?.querySelector('.name') as HTMLElement | null
    return {
      activeBg: active ? getComputedStyle(active).backgroundColor : null,
      activeColor: active ? getComputedStyle(active).color : null,
      dotBg: dot ? getComputedStyle(dot).backgroundColor : null,
      nameColor: name ? getComputedStyle(name).color : null
    }
  })
  await page.close()

  // .project-item.active 用 var(--moo-c-brand-soft) bg + var(--moo-c-brand) 文字色
  expect(snap.activeBg).not.toBeNull()
  expect(isTransparent(snap.activeBg), 'dark .project-item.active 背景 transparent = brand-soft 没解析').toBe(false)
  expect(snap.activeBg, 'dark .project-item.active 背景含 var() 未解析').not.toContain('var(')
  expect(snap.activeColor, 'dark .project-item.active 文字色 transparent').not.toBe('rgba(0, 0, 0, 0)')
  expect(snap.activeColor, 'dark .project-item.active 文字色未解析 var()').not.toContain('var(')

  // .dot 用 var(--moo-c-success)，dark 仍应是绿系
  expect(snap.dotBg).not.toBeNull()
  expect(isTransparent(snap.dotBg), 'dark .dot 背景 transparent').toBe(false)
  expect(snap.dotBg, 'dark .dot 背景未解析 var()').not.toContain('var(')

  // sidebar 名字色解析
  expect(snap.nameColor, 'dark .project-item .name 文字色 transparent').not.toBe('rgba(0, 0, 0, 0)')
  expect(snap.nameColor, 'dark .project-item .name 文字色未解析 var()').not.toContain('var(')
})

// ---- History ----------------------------------------------------------------

test('panel-dark · History populated 10：.remote-status chip + .thumb 区域颜色解析', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(harnessUrl(extensionId, 'history', 'populated'))
  await page.waitForSelector('.history .row', { timeout: 5000 })

  const snap = await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('.history .remote-status')) as HTMLElement[]
    const thumb = document.querySelector('.history .thumb') as HTMLElement | null
    return {
      chips: chips.map(c => ({
        bg: getComputedStyle(c).backgroundColor,
        color: getComputedStyle(c).color,
        border: getComputedStyle(c).borderColor
      })),
      thumb: thumb ? {
        bg: getComputedStyle(thumb).backgroundColor,
        border: getComputedStyle(thumb).borderColor
      } : null
    }
  })
  await page.close()

  // 每个 chip 三色都得解析 + 非 transparent
  expect(snap.chips.length, 'History harness populated 10 应该至少出现 1 个 .remote-status').toBeGreaterThan(0)
  for (const [i, c] of snap.chips.entries()) {
    expect(isTransparent(c.bg), `dark .remote-status[${i}] 背景 transparent = rs-* soft token 没解析`).toBe(false)
    expect(c.bg, `dark .remote-status[${i}] 背景未解析 var()`).not.toContain('var(')
    expect(c.color, `dark .remote-status[${i}] 文字 transparent`).not.toBe('rgba(0, 0, 0, 0)')
    expect(c.color, `dark .remote-status[${i}] 文字未解析 var()`).not.toContain('var(')
    expect(c.border, `dark .remote-status[${i}] 边框未解析 var()`).not.toContain('var(')
  }

  // .thumb 至少有一个；它用 var(--moo-c-bg-elev) 背景 + var(--moo-c-border) 边框，
  // dark 下两者应该都解析 + 跟 panel 主 bg 形成可见对比
  expect(snap.thumb, 'History populated 10 应该至少有 1 个 .thumb').not.toBeNull()
  expect(isTransparent(snap.thumb!.bg), 'dark .thumb 背景 transparent = bg-elev 没解析').toBe(false)
  expect(snap.thumb!.bg, 'dark .thumb 背景未解析 var()').not.toContain('var(')
  expect(snap.thumb!.border, 'dark .thumb 边框未解析 var()').not.toContain('var(')
})

// ---- Settings ---------------------------------------------------------------

test('panel-dark · Settings populated：button.moo-switch + .moo-switch-thumb 颜色解析', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto(harnessUrl(extensionId, 'settings', 'populated'))
  await page.waitForSelector('.settings button.moo-switch[role="switch"]', { timeout: 5000 })

  const snap = await page.evaluate(() => {
    const switches = Array.from(document.querySelectorAll('.settings button.moo-switch')) as HTMLElement[]
    return switches.map(sw => {
      const thumb = sw.querySelector('.moo-switch-thumb') as HTMLElement | null
      return {
        isOn: sw.classList.contains('is-on'),
        trackBg: getComputedStyle(sw).backgroundColor,
        thumbBg: thumb ? getComputedStyle(thumb).backgroundColor : null
      }
    })
  })
  await page.close()

  expect(snap.length, 'Settings 没渲染任何 moo-switch').toBeGreaterThan(0)
  for (const [i, sw] of snap.entries()) {
    // 关闭态字面 #cbd5e1（rgb(203,213,225)）/ 开启态 var(--moo-c-brand) —— 两边都得解析
    expect(isTransparent(sw.trackBg), `dark moo-switch[${i}] 轨道 transparent`).toBe(false)
    expect(sw.trackBg, `dark moo-switch[${i}] 轨道未解析 var()`).not.toContain('var(')
    // thumb 永远 #fff（rgb(255, 255, 255)），是 design choice（关闭态浅灰 / 开启态 brand 实心都需白色识别）
    expect(sw.thumbBg, `dark moo-switch[${i}] thumb 缺失`).not.toBeNull()
    expect(isTransparent(sw.thumbBg), `dark moo-switch[${i}] thumb transparent`).toBe(false)
    expect(sw.thumbBg, `dark moo-switch[${i}] thumb 未解析 var()`).not.toContain('var(')
  }
})
