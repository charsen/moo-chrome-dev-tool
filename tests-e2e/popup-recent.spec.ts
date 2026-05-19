import { test, expect, seedStorage } from './fixtures'

/**
 * popup「最近提交」区视觉 + 状态 chip 逻辑验证。
 * 把假 history 塞进 storage.local 后开 popup URL，断言 DOM。
 */

function entry(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'h-' + Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    projectId: 'p1',
    projectName: '示例项目',
    serverId: 's1',
    serverName: 'srv',
    title: '默认标题',
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

test('popup 最近提交：1 prominent + 2 compact 行 + 状态 chip', async ({ context, extensionId, sw }) => {
  const now = Date.now()
  const history = [
    entry({ title: '页面突然崩了', timestamp: now - 5 * 60_000, result: { ok: true }, remoteStatus: 'in_progress' }),
    entry({ title: '按钮无响应',   timestamp: now - 30 * 60_000, result: { ok: false, error: '401' } }),
    entry({ title: '图片加载失败', timestamp: now - 60 * 60_000, result: { ok: true }, remoteStatus: 'done' }),
    // 第 4 条不应该显示（只取前 3）
    entry({ title: '更早的提交',   timestamp: now - 120 * 60_000, result: { ok: true } })
  ]
  await seedStorage(sw, { mooHistory: history })

  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
  await page.waitForSelector('.recent')

  // 标题 + 总数
  await expect(page.locator('.recent-title')).toHaveText('最近提交')
  await expect(page.locator('.recent-count')).toHaveText('3 条')  // listHistory().slice(0,3)

  // 第 1 条：prominent 卡
  await expect(page.locator('.rh-card .rh-title')).toHaveText('页面突然崩了')
  await expect(page.locator('.rh-card .rh-status')).toHaveText('处理中')
  await expect(page.locator('.rh-card .rh-status')).toHaveClass(/rh-prog/)
  await expect(page.locator('.rh-card .rh-proj')).toHaveText('示例项目')

  // 第 2、3 条：compact 行
  const rows = page.locator('.rh-list .rh-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0).locator('.rh-row-title')).toHaveText('按钮无响应')
  await expect(rows.nth(0).locator('.rh-status')).toHaveText('失败')
  await expect(rows.nth(0).locator('.rh-status')).toHaveClass(/rh-fail/)
  await expect(rows.nth(1).locator('.rh-row-title')).toHaveText('图片加载失败')
  await expect(rows.nth(1).locator('.rh-status')).toHaveText('完成')
  await expect(rows.nth(1).locator('.rh-status')).toHaveClass(/rh-done/)

  await page.screenshot({ path: 'tests-e2e/screenshots/popup-recent.png' })
})

test('popup 最近提交：queued / open / deleted 三态正确', async ({ context, extensionId, sw }) => {
  const now = Date.now()
  const history = [
    entry({ title: 'queued',  result: { ok: false, queued: true }, timestamp: now - 60_000 }),
    entry({ title: 'open',    result: { ok: true }, remoteStatus: 'open', timestamp: now - 120_000 }),
    entry({ title: 'deleted', result: { ok: true }, remoteStatus: 'deleted', timestamp: now - 180_000 })
  ]
  await seedStorage(sw, { mooHistory: history })

  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
  await page.waitForSelector('.recent')

  await expect(page.locator('.rh-card .rh-status')).toHaveText('重试中')
  await expect(page.locator('.rh-card .rh-status')).toHaveClass(/rh-queued/)

  const rows = page.locator('.rh-list .rh-row')
  await expect(rows.nth(0).locator('.rh-status')).toHaveText('待处理')
  await expect(rows.nth(0).locator('.rh-status')).toHaveClass(/rh-open/)
  await expect(rows.nth(1).locator('.rh-status')).toHaveText('已删')
  await expect(rows.nth(1).locator('.rh-status')).toHaveClass(/rh-del/)
})

test('popup 无 history：最近提交区不渲染', async ({ context, extensionId, sw }) => {
  await seedStorage(sw, { mooHistory: [] })

  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
  // 等 mount 完
  await page.waitForSelector('.popup')
  await expect(page.locator('.recent')).toHaveCount(0)
})
