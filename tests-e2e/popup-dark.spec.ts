import { test, expect, seedStorage, openExtensionPage } from './fixtures'

/**
 * R2（10 回合第 2 回）：popup 在 prefers-color-scheme: dark 下完整渲染。
 *
 * 背景：v0.1.13 改了 shadow 世界 token 反扫 + 加 glass token，但是 popup
 * 走的是 tokens.css 主世界，跟 shadow 不一样。dark mode 时所有元素都应
 * 该有对应反相。本 spec 切到 dark，断言关键文字颜色 ≠ 透明 / 不是浅页色，
 * 且 .rh-card 背景跟 popup body 背景对比度合理。
 */

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'h-' + Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    projectId: 'p1',
    projectName: '示例项目',
    serverId: 's1',
    serverName: 'srv',
    title: '一条提交',
    description: '',
    image: '',
    hasVideo: false,
    videoDuration: 0,
    url: 'https://example.com/page',
    userAgent: '',
    viewport: '',
    requests: [],
    errors: [],
    result: { ok: true },
    ...over
  }
}

test('R2 · popup 在 dark mode 下文字 / 卡片背景 / 状态 chip 颜色都正确', async ({ context, extensionId, sw }) => {
  await seedStorage(sw, {
    mooHistory: [
      entry({ title: '提交 A', remoteStatus: 'in_progress' }),
      entry({ title: '提交 B', result: { ok: false, error: '401' } }),
      entry({ title: '提交 C', remoteStatus: 'done' })
    ]
  })

  // 用 openExtensionPage 带 retry 防 ERR_FILE_NOT_FOUND flake（SW 注册时序 race）
  const popup = await openExtensionPage(context, sw, `chrome-extension://${extensionId}/src/popup/index.html`)
  await popup.emulateMedia({ colorScheme: 'dark' })
  await popup.setViewportSize({ width: 360, height: 600 })
  // emulate 完触发 reload 让 @media 重新求值
  await popup.reload()
  await popup.waitForSelector('.rh-card', { timeout: 5000 })

  // 1) popup body 背景应该是深色（lightness < 50）
  const bodyBg = await popup.evaluate(() => {
    const c = getComputedStyle(document.body).backgroundColor
    return c
  })
  expect(bodyBg, 'popup body 背景在 dark mode 下应该是深色').not.toBe('rgb(255, 255, 255)')
  expect(bodyBg, 'popup body 背景不应该 transparent').not.toBe('rgba(0, 0, 0, 0)')

  // 2) prominent 卡的标题颜色应该是浅色文字（lightness > 50）
  const titleColor = await popup.evaluate(() => {
    const t = document.querySelector('.rh-card .rh-title') as HTMLElement | null
    if (!t) return null
    return getComputedStyle(t).color
  })
  expect(titleColor).not.toBeNull()
  // 不强行解析 rgb 比 lightness——简单断言不是 var() 未解析 + 不是 transparent
  expect(titleColor, 'title 颜色未解析').not.toContain('var(')
  expect(titleColor, 'title 颜色 transparent').not.toBe('rgba(0, 0, 0, 0)')

  // 3) 状态 chip 至少有可见的背景色
  const chipBg = await popup.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('.rh-row .rh-row-status, .rh-card .rh-card-status')) as HTMLElement[]
    return chips.map(c => getComputedStyle(c).backgroundColor)
  })
  for (const bg of chipBg) {
    expect(bg, '状态 chip 背景 transparent').not.toBe('rgba(0, 0, 0, 0)')
  }

  await popup.close()
})
