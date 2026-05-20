import { test, expect, seedStorage } from './fixtures'

/**
 * R5（10 回合第 5 回）：popup 在 100+ 条 history 时仍只渲染 top 3 + 不卡。
 *
 * 角度：性能 + 切片正确性。popup 设计上只显示「最近提交」前 3 条
 * （1 prominent + 2 compact），即使 storage 里塞 100 条也应该:
 * 1) 渲染数恰好 3
 * 2) load 后 DOM ready 在合理时间内（< 1.5s）
 * 3) html 不横向溢出（防大量数据触发不可预期 layout）
 */

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'h-' + Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    projectId: 'p1',
    projectName: '示例项目',
    serverId: 's1',
    serverName: 'srv',
    title: '提交',
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

test('R5 · popup 100 条 history：渲染 1 prominent + 2 compact + 总数恰好 3', async ({ context, extensionId, sw }) => {
  const now = Date.now()
  const history = Array.from({ length: 100 }, (_, i) => entry({
    title: `提交 ${i.toString().padStart(3, '0')}`,
    timestamp: now - i * 60_000 // 每条间隔 1 分钟
  }))
  await seedStorage(sw, { mooHistory: history })

  const popup = await context.newPage()
  await popup.setViewportSize({ width: 360, height: 600 })

  const t0 = Date.now()
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
  await popup.waitForSelector('.rh-card', { timeout: 5000 })
  const elapsed = Date.now() - t0

  // 1) 性能门限：从 goto 到 .rh-card 可见 < 1500ms（headless chromium 应该秒开）
  expect(elapsed, `popup 加载 + 渲染慢于 1500ms (实际 ${elapsed}ms)，可能 v-for 没用 limit`).toBeLessThan(1500)

  // 2) 切片：1 个 .rh-card + 2 个 .rh-row
  const counts = await popup.evaluate(() => ({
    cards: document.querySelectorAll('.rh-card').length,
    rows: document.querySelectorAll('.rh-row').length
  }))
  expect(counts.cards, 'prominent 卡数').toBe(1)
  expect(counts.rows, 'compact 行数').toBe(2)

  // 3) html 无横向溢出
  const overflow = await popup.evaluate(() => ({
    s: document.documentElement.scrollWidth,
    c: document.documentElement.clientWidth
  }))
  expect(overflow.s, '100 条 history 触发横向溢出').toBeLessThanOrEqual(overflow.c + 1)

  // 4) prominent 卡显示的是最新一条（timestamp 最大）：title 应该是「提交 000」
  const cardTitle = await popup.evaluate(() => {
    const t = document.querySelector('.rh-card .rh-title') as HTMLElement | null
    return t?.textContent?.trim() ?? null
  })
  expect(cardTitle, 'prominent 卡 title 不是最新一条').toBe('提交 000')

  await popup.close()
})
