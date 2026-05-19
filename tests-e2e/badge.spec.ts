import { test, expect, seedStorage, readBadgeText } from './fixtures'

// 等 background onHistoryChanged → refreshBadge → chrome.action.setBadgeText 走完
// 大致 100~200ms。本地 1s 足够稳。
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

test('badge：2 条 24h 内失败 + 1 条成功 → badge text = "2"', async ({ sw }) => {
  const now = Date.now()
  await seedStorage(sw, {
    mooHistory: [
      entry({ timestamp: now - 60_000, result: { ok: false, error: 'x' } }),
      entry({ timestamp: now - 120_000, result: { ok: false, status: 500, error: 'y' } }),
      entry({ timestamp: now - 180_000, result: { ok: true } })
    ]
  })
  await waitForBadge()
  expect(await readBadgeText(sw)).toBe('2')
})

test('badge：失败发生在 24h 外 → 不计入', async ({ sw }) => {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  await seedStorage(sw, {
    mooHistory: [
      entry({ timestamp: now - 60_000, result: { ok: false, error: 'recent fail' } }),
      entry({ timestamp: now - 2 * day, result: { ok: false, error: 'old fail' } })
    ]
  })
  await waitForBadge()
  expect(await readBadgeText(sw)).toBe('1')
})

test('badge：>99 显示 "99+"', async ({ sw }) => {
  const now = Date.now()
  const items: Record<string, unknown>[] = []
  for (let i = 0; i < 110; i++) {
    items.push(entry({ timestamp: now - i * 1000, result: { ok: false, error: 'x' } }))
  }
  await seedStorage(sw, { mooHistory: items })
  await waitForBadge()
  expect(await readBadgeText(sw)).toBe('99+')
})

test('badge：history 清空 → badge 也清', async ({ sw }) => {
  await seedStorage(sw, {
    mooHistory: [entry({ result: { ok: false, error: 'x' } })]
  })
  await waitForBadge()
  expect(await readBadgeText(sw)).toBe('1')

  await seedStorage(sw, { mooHistory: [] })
  await waitForBadge()
  expect(await readBadgeText(sw)).toBe('')
})
