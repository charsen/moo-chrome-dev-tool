import { test, expect, seedStorage, readBadgeText } from './fixtures'

/**
 * R7（10 回合第 7 回）：badge 时间窗口边界 + 大量 history 性能。
 *
 * 现有 badge.spec.ts 覆盖了 4 个主流 case，但漏了：
 * 1) 24h 边界精确值（exactly = 24h 还在不在？）
 * 2) 全是成功 history 时 badge text 应清空（vs undefined）
 * 3) 1000 条 history（大数据量）badge 更新仍在 1.5s 内完成
 */

async function waitForBadge(): Promise<void> {
  await new Promise((r) => setTimeout(r, 800))
}

function entry(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'h-' + Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    projectId: 'p',
    projectName: 'p',
    serverId: 's',
    serverName: 's',
    title: 't',
    description: '',
    image: '',
    hasVideo: false,
    videoDuration: 0,
    url: '',
    userAgent: '',
    viewport: '',
    requests: [],
    errors: [],
    result: { ok: true },
    ...over
  }
}

test('R7 · badge 24h 边界：刚刚到 24h 的失败 entry 应仍计入（< 24h - 1ms）', async ({ sw }) => {
  const now = Date.now()
  const justUnder24h = now - (24 * 60 * 60_000) + 1000 // 23h59m59s 前
  await seedStorage(sw, {
    mooHistory: [entry({ timestamp: justUnder24h, result: { ok: false, error: '边界 entry' } })]
  })
  await waitForBadge()
  const badge = await readBadgeText(sw)
  expect(badge, '刚到 24h 边界内 (< 24h) 的失败应该计入').toBe('1')
})

test('R7.2 · badge 24h 外：刚过 24h 1 秒的失败 entry 不计入', async ({ sw }) => {
  const now = Date.now()
  const justOver24h = now - (24 * 60 * 60_000) - 1000 // 24h1s 前
  await seedStorage(sw, {
    mooHistory: [entry({ timestamp: justOver24h, result: { ok: false, error: '过期 entry' } })]
  })
  await waitForBadge()
  const badge = await readBadgeText(sw)
  expect(badge, '刚过 24h 的失败 entry 不应该计入').toBe('')
})

test('R7.3 · 全是成功 history：badge text 是空串而非 undefined / "0"', async ({ sw }) => {
  const now = Date.now()
  await seedStorage(sw, {
    mooHistory: [
      entry({ timestamp: now - 60_000, result: { ok: true } }),
      entry({ timestamp: now - 120_000, result: { ok: true } }),
      entry({ timestamp: now - 180_000, result: { ok: true } })
    ]
  })
  await waitForBadge()
  const badge = await readBadgeText(sw)
  expect(badge, '全成功 history 应该 badge 空串').toBe('')
})

test('R7.4 · 1000 条 history seed：badge 仍能在 1.5s 内算出', async ({ sw }) => {
  const now = Date.now()
  const history = Array.from({ length: 1000 }, (_, i) => entry({
    timestamp: now - i * 30_000, // 每条间隔 30s，前面几条在 24h 内
    result: i % 3 === 0 ? { ok: false, error: 'fail' + i } : { ok: true }
  }))

  const t0 = Date.now()
  await seedStorage(sw, { mooHistory: history })
  await waitForBadge()
  const badge = await readBadgeText(sw)
  const elapsed = Date.now() - t0

  // 24h = 86400s ÷ 30s/entry = 2880 entries 在窗口内
  // 实际只 1000 entries 都在，且 1/3 失败 ≈ 333
  // 但 badge 显示 ">99" 时是 "99+"
  expect(badge, '1000 条 history 含 333 失败 → 应显示 99+').toBe('99+')
  expect(elapsed, `1000 条 history badge 计算超 1500ms (实际 ${elapsed}ms)`).toBeLessThan(1500)
})
