import { test, expect, seedStorage } from './fixtures'

/**
 * R1（10 回合响应式扫修第 1 回）：
 * popup 长字符串 + 极窄场景 — 锁住 flex truncate（min-width: 0）+ 无横向溢出。
 *
 * 背景：用户大分辨率截图反馈 DevTools 面板「界面没展示完整」，
 * 根因是 .row-head .url 等 flex:1 + ellipsis 缺 min-width: 0。
 * popup 同样模式 .rh-title / .rh-row-title 已修；本 spec 加 E2E 锁住，
 * 任何回归都立即被 CI 卡住。
 *
 * 不依赖 chrome.runtime.openPopup（programmatic 打不开），
 * 走 chrome-extension://EXTID/src/popup/index.html 直访方式
 * （popup 加载的是 standalone iframe，跟点扩展图标渲染同一份 App.vue）。
 */

function longEntry(over: Record<string, unknown> = {}): Record<string, unknown> {
  const longTitle = '页面在打开商品详情页面时——尤其是带视频的商品——会突然空白且无任何错误提示，需重启浏览器才能恢复，发生概率约 30%'
  const longUrl = 'https://very-long-subdomain.api-gateway-internal.platform.example.com/api/v2/products/catalog/categories/12345/items/67890/variants/abc-def-ghi-jkl?include=images,reviews,related,inventory,pricing,promotions&sort=relevance&filter[brand]=A&filter[category]=B'
  return {
    id: 'h-' + Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    projectId: 'p1',
    projectName: '示例项目',
    serverId: 's1',
    serverName: 'srv',
    title: longTitle,
    description: '',
    image: '',
    hasVideo: false,
    videoDuration: 0,
    url: longUrl,
    userAgent: '',
    viewport: '',
    requests: [],
    errors: [],
    result: { ok: true },
    ...over
  }
}

test('R1 · popup 长 title / 长 URL：不撑爆容器、不触发横向滚动', async ({ context, extensionId, sw }) => {
  const now = Date.now()
  await seedStorage(sw, {
    mooHistory: [
      longEntry({ timestamp: now - 5 * 60_000, remoteStatus: 'in_progress' }),
      longEntry({ timestamp: now - 30 * 60_000, result: { ok: false, error: 'CONN_TIMEOUT_LONG_TOKEN_eyJhbGciOiJIUzI1NiJ9' } }),
      longEntry({ timestamp: now - 60 * 60_000, remoteStatus: 'done' })
    ]
  })

  const popup = await context.newPage()
  await popup.setViewportSize({ width: 360, height: 600 }) // popup 实际宽度典型值
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
  await popup.waitForSelector('.rh-card, .rh-row', { timeout: 5000 })

  // 1) body 不横向溢出
  const overflow = await popup.evaluate(() => {
    const root = document.documentElement
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth }
  })
  expect(overflow.scrollWidth, '<html> 横向溢出——某个 flex 元素没截断把容器撑爆').toBeLessThanOrEqual(overflow.clientWidth + 1)

  // 2) prominent 卡的 .rh-title 实际宽度 < 父容器（说明 ellipsis 真的生效）
  const titleFit = await popup.evaluate(() => {
    const t = document.querySelector('.rh-card .rh-title') as HTMLElement | null
    if (!t) return null
    const parent = t.parentElement as HTMLElement
    return {
      titleWidth: t.getBoundingClientRect().width,
      parentWidth: parent.getBoundingClientRect().width,
      titleScrollWidth: t.scrollWidth,
      titleClientWidth: t.clientWidth
    }
  })
  expect(titleFit, 'prominent 卡未渲染或 .rh-title 缺').not.toBeNull()
  // ellipsis 生效 = scrollWidth > clientWidth（内容比可视宽，但被裁了）
  expect(titleFit!.titleScrollWidth, '长标题没触发 ellipsis').toBeGreaterThan(titleFit!.titleClientWidth)

  // 3) compact 行 .rh-row-title 同样验证
  const rowTitle = await popup.evaluate(() => {
    const t = document.querySelector('.rh-row .rh-row-title') as HTMLElement | null
    if (!t) return null
    return { scrollWidth: t.scrollWidth, clientWidth: t.clientWidth }
  })
  expect(rowTitle).not.toBeNull()
  expect(rowTitle!.scrollWidth, 'compact 行长标题没触发 ellipsis').toBeGreaterThan(rowTitle!.clientWidth)

  // 4) 时间元素 .rh-row-time 仍可见（没被长标题挤出可视区）
  const timeVisible = await popup.evaluate(() => {
    const t = document.querySelector('.rh-row .rh-row-time') as HTMLElement | null
    if (!t) return null
    const rect = t.getBoundingClientRect()
    return { width: rect.width, right: rect.right, parentRight: t.parentElement!.getBoundingClientRect().right }
  })
  expect(timeVisible, '.rh-row-time 缺').not.toBeNull()
  expect(timeVisible!.width, '.rh-row-time 宽度 0 = 被挤掉了').toBeGreaterThan(0)
  expect(timeVisible!.right, '.rh-row-time 超出父容器右边界').toBeLessThanOrEqual(timeVisible!.parentRight + 0.5)

  await popup.close()
})

// 注：之前这里有个 R1.2 测 popup 在 280px viewport 下不溢出，但 popup 的
// .popup 类硬编码 width: 320px + 14px padding（设计如此），任何 < 348px
// viewport 都注定横向滚——而 Chrome 永远按 popup 自身的设计宽度开（≥ 320），
// 不会出现 280 viewport 的场景。删掉避免误报。
