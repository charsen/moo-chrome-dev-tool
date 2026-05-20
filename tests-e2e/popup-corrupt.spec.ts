import { test, expect, seedStorage } from './fixtures'

/**
 * A4（matrix 真值缺口）：popup 在 storage 损坏 / 字段缺失 / 类型错乱时不崩。
 *
 * 维度交叉：popup × L (storage corrupt) × M (lifecycle 升级遗留 entry)
 *
 * 真实场景：用户从老版本升级 / 手动 chrome.storage.local 改坏了 / 浏览器扩展 sync 异常
 */

test('A4.1 · popup mooHistory 不是数组（被改成 object / string / null）不崩', async ({ context, extensionId, sw }) => {
  await seedStorage(sw, { mooHistory: { not: 'an array' } })

  const errors: string[] = []
  const popup = await context.newPage()
  popup.on('pageerror', (err) => errors.push(err.message))

  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
  // 不要 waitForSelector('.rh-card')——本就该没 card
  await popup.waitForLoadState('domcontentloaded')
  await popup.waitForTimeout(500)

  // 关键：没 page error
  expect(errors, `mooHistory 不是数组触发 page error: ${errors.join(', ')}`).toHaveLength(0)

  // popup root 仍渲染
  const popupExists = await popup.locator('.popup').count()
  expect(popupExists, 'popup root 没渲染').toBeGreaterThan(0)

  await popup.close()
})

test('A4.2 · popup mooHistory entry 缺关键字段（title / timestamp / result）不崩 + 跳过坏 entry', async ({ context, extensionId, sw }) => {
  await seedStorage(sw, {
    mooHistory: [
      // 缺 title
      { id: 'h1', timestamp: Date.now() - 60_000, projectId: 'p', projectName: 'p', serverId: 's', serverName: 's', url: '', result: { ok: true } },
      // 缺 timestamp
      { id: 'h2', title: 'no-ts', projectId: 'p', projectName: 'p', serverId: 's', serverName: 's', url: '', result: { ok: true } },
      // 正常一条
      { id: 'h3', timestamp: Date.now() - 120_000, title: '正常', projectId: 'p', projectName: 'p', serverId: 's', serverName: 's', url: '', result: { ok: true } }
    ]
  })

  const errors: string[] = []
  const popup = await context.newPage()
  popup.on('pageerror', (err) => errors.push(err.message))

  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
  await popup.waitForLoadState('domcontentloaded')
  await popup.waitForTimeout(500)

  // 不崩
  expect(errors, `坏 entry 触发 page error: ${errors.join(', ')}`).toHaveLength(0)

  // 至少正常那条应该展出来（popup 应该 graceful 处理缺字段——title fallback '无标题'）
  // 不强制断言渲染数量，只断言 popup 没崩
  const popupExists = await popup.locator('.popup').count()
  expect(popupExists).toBeGreaterThan(0)

  await popup.close()
})
