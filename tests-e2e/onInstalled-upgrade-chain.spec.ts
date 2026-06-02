import { test, expect, readBadgeText, waitForBadgeText } from './fixtures'

/**
 * lab-tester 二审 v0.6.3 复盘 — 锁住 onInstalled / upgrade flag / badge / popup banner 链路。
 *
 * 背景：v0.6.1 给 badge.ts 加「mooNeedsHostPermUpgrade flag 优先于 failure 计数」，单测全过但
 * 11 个 badge e2e 集体挂（fresh install onInstalled 写 flag → badge 永远 '!'）。v0.6.1 + v0.6.2
 * 都没跑 e2e，11 fail 持续 2 个 minor 版本无人发现。
 *
 * 真问题：「onInstalled writes flag → popup banner / badge '!'」链路根本没 e2e 覆盖。修
 * fixture 让其它 spec 聚焦 failure count 行为后，这里专门补这条链。
 *
 * 注：本 spec 故意不用 fixtures.ts 的 `seedStorage` helper —— 它会 remove UPGRADE_FLAG_KEY
 * 抹平 fresh install 行为；这里要测的恰恰是 flag 真实存在的状态。直接 sw.evaluate 操作 storage。
 *
 * MV3 限制：playwright 无法真正触发 `chrome.runtime.onInstalled.addListener(reason='update')` —
 * chrome 自身 install/update lifecycle 不暴露给测试 driver。所以 update path 通过「直接 seed
 * flag 模拟 listener 已 fire 完的副作用 + 验下游链」来覆盖。这是 v0.6.3 dogfood 同款风险面。
 */

const UPGRADE_FLAG = 'mooNeedsHostPermUpgrade'
const VERSION_FLAG = 'mooLatestVersionInfo'

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

/** 等 onInstalled 真实 fire 完写完 upgrade flag — fresh install context 必走这段。 */
async function waitForOnInstalledSettled(sw: import('@playwright/test').Worker): Promise<void> {
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 250)))
}

// ---------------------------------------------------------------------------
// A1. fresh install fresh state → flag 写入 → badge '!' → popup 显 upgrade-banner
// ---------------------------------------------------------------------------
test('A1 · fresh install：onInstalled 写 upgrade flag + badge "!" + popup banner', async ({ context, extensionId, sw }) => {
  // fresh persistent context 启动即触发 onInstalled reason='install'
  // listener 内 chrome.permissions.contains({ origins: ['<all_urls>'] }) 应返 false（optional 没授）
  // → set { mooNeedsHostPermUpgrade: true } → refreshBadge → badge '!'
  await waitForOnInstalledSettled(sw)

  // 1) flag 真写进去了
  const flag = await sw.evaluate(async (k) => (await chrome.storage.local.get(k))[k], UPGRADE_FLAG)
  expect(flag).toBe(true)

  // 2) badge 应显 '!' — 用 waitForBadgeText 容忍 SW spin-up refreshBadge 完成的微秒延时
  const badge = await waitForBadgeText(sw, '!')
  expect(badge).toBe('!')

  // 3) popup 打开应渲染 upgrade-banner（v-if needsHostPermUpgrade）
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
  await popup.waitForSelector('.upgrade-banner', { timeout: 5000 })
  await expect(popup.locator('.upgrade-banner')).toBeVisible()
  // v0.7.0 banner title 通用化（删 v0.6.0 字样，复用于 v0.6.0 + v0.7.0 BREAKING 升级路径）
  await expect(popup.locator('.upgrade-banner .upgrade-title')).toContainText('升级')
  await expect(popup.locator('.upgrade-banner .upgrade-title')).toContainText('上报功能')
  // 文案命中关键短语（避免随版本调整全字匹配 brittle）
  await expect(popup.locator('.upgrade-banner button.moo-btn--danger')).toContainText('启用上报功能')

  await popup.close()
})

// ---------------------------------------------------------------------------
// A2. badge flag 优先级 — flag 在时，即使 history 有 failure，badge 也只显 '!'
//     这是 v0.6.1 单测过 / e2e 全挂的根因 — 必须在 e2e 锁住。
// ---------------------------------------------------------------------------
test('A2 · upgrade flag 优先级：flag=true + 3 条失败 history → badge "!" 而非 "3"', async ({ sw }) => {
  await waitForOnInstalledSettled(sw)

  const now = Date.now()
  // 注意：不能用 seedStorage（会清 flag）。手动 set 保留 flag。
  await sw.evaluate(async ({ history }) => {
    await chrome.storage.local.set({
      mooHistory: history,
      mooNeedsHostPermUpgrade: true  // 显式保留（onInstalled 已写过但 set mooHistory 不会清它）
    })
  }, {
    history: [
      entry({ timestamp: now - 60_000, result: { ok: false, error: 'a' } }),
      entry({ timestamp: now - 120_000, result: { ok: false, status: 500, error: 'b' } }),
      entry({ timestamp: now - 180_000, result: { ok: false, error: 'c' } })
    ]
  })

  // history 写入触发 onHistoryChanged → refreshBadge — flag 仍在所以应是 '!' 不是 '3'
  const badge = await waitForBadgeText(sw, '!')
  expect(badge).toBe('!')
  // 反证：不应该是 '3'（如果 flag 优先级回归就会显 '3'，正是 v0.6.1 引入 + 没 e2e 没发现的失效模式）
  expect(badge).not.toBe('3')
})

// ---------------------------------------------------------------------------
// B1. update path — 模拟「老用户从 v0.5.x 升 v0.6.x」：flag 先被 onInstalled('update') 写入
//     验 popup banner + badge '!' 共同表现。
//     注：onInstalled('update') 真触发 playwright 做不到，这里 seed flag 模拟 listener 副作用。
// ---------------------------------------------------------------------------
test('B1 · update path（模拟）：flag 已写 → popup banner + badge "!" 一致显示', async ({ context, extensionId, sw }) => {
  await waitForOnInstalledSettled(sw)

  // 模拟 onInstalled reason='update' 的副作用：listener 内已经 set flag + 调 refreshBadge。
  // fresh install 自身也会写同一 flag — 二者下游表现应一致（这正是 v0.6.1 设计「fresh install 也写 flag」）
  await sw.evaluate(async () => {
    await chrome.storage.local.set({ mooNeedsHostPermUpgrade: true })
    // 直接调 chrome.action API 模拟 refreshBadge — 不能从 SW 拿到内部函数引用，
    // 但 storage.onChanged listener 会监听 UPGRADE_FLAG_KEY 变更主动触发 refreshBadge
  })

  // SW 的 chrome.storage.onChanged listener 应捕到 flag 变更 → refreshBadge → '!'
  const badge = await waitForBadgeText(sw, '!')
  expect(badge).toBe('!')

  // popup 也应显 banner
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
  await popup.waitForSelector('.upgrade-banner', { timeout: 5000 })
  await expect(popup.locator('.upgrade-banner')).toBeVisible()

  await popup.close()
})

// ---------------------------------------------------------------------------
// C1. dismiss / permissions.onAdded 链路 — flag 被清后 SW storage.onChanged 触发 refreshBadge
//     badge 从 '!' 回落到 failure count 文本。
//     v0.6.1 mv3-pro review 报告 2：popup 不能直接 setBadgeText('') 误清 failure 计数 —
//     必须让 SW 监听 flag 变更主动 refreshBadge。这条链是产品行为正确的关键。
// ---------------------------------------------------------------------------
test('C1 · dismiss 链：清 flag → SW onChanged → badge 从 "!" 切到 failure count', async ({ sw }) => {
  await waitForOnInstalledSettled(sw)

  const now = Date.now()
  // 准备：flag 在 + 2 条 24h 内 failure
  await sw.evaluate(async ({ history }) => {
    await chrome.storage.local.set({
      mooHistory: history,
      mooNeedsHostPermUpgrade: true
    })
  }, {
    history: [
      entry({ timestamp: now - 60_000, result: { ok: false, error: 'x' } }),
      entry({ timestamp: now - 120_000, result: { ok: false, status: 500, error: 'y' } })
    ]
  })

  // 先验 badge 是 '!' 不是 '2'
  expect(await waitForBadgeText(sw, '!')).toBe('!')

  // 模拟 popup dismiss / chrome.permissions.onAdded 副作用：清 flag
  await sw.evaluate(async () => {
    await chrome.storage.local.remove('mooNeedsHostPermUpgrade')
  })

  // SW 的 chrome.storage.onChanged listener 应 fire → refreshBadge → 重读 storage flag（已无）→ 取 failure count '2'
  const badge = await waitForBadgeText(sw, '2')
  expect(badge).toBe('2')
})

// ---------------------------------------------------------------------------
// C2. popup 跨 SW 同步 update-banner — popup 已开后 SW 异步 runVersionCheck 写
//     mooLatestVersionInfo → popup storage.onChanged listener 实时显 update-banner。
//     v0.6.3 mv3-pro 三审 fix 1 修过这个 race —— 用 e2e 锁住未来不回归。
// ---------------------------------------------------------------------------
test('C2 · popup 跨 SW 同步：SW 写 mooLatestVersionInfo → popup 实时弹 update-banner', async ({ context, extensionId, sw }) => {
  await waitForOnInstalledSettled(sw)

  // 先清 upgrade flag — 否则 v-else-if updateInfo 永远显不出来（设计上 update-banner 排他于 upgrade-banner）
  // 这步是触发 update-banner 路径的前置条件，不是测试场景污染
  await sw.evaluate(async () => {
    await chrome.storage.local.remove('mooNeedsHostPermUpgrade')
  })

  // popup 先开（mount 时未写 version flag，所以 update-banner 不显）
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
  // 等 popup mount 完成
  await popup.waitForSelector('main', { timeout: 5000 })
  // update-banner 此刻应不存在
  await expect(popup.locator('.update-banner')).toHaveCount(0)

  // 模拟 SW runVersionCheck 命中新版 → 写 flag（chrome.storage.onChanged 跨进程触发 popup 监听）
  await sw.evaluate(async () => {
    await chrome.storage.local.set({
      mooLatestVersionInfo: {
        latest: '9.9.9',
        current: '0.6.3',
        url: 'https://example.com/releases/v9.9.9',
        checkedAt: Date.now()
      }
    })
  })

  // popup 的 storage.onChanged listener 应 fire → updateInfo.value 赋值 → 渲染 update-banner
  await popup.waitForSelector('.update-banner', { timeout: 5000 })
  await expect(popup.locator('.update-banner')).toBeVisible()
  await expect(popup.locator('.update-banner .update-title')).toContainText('v9.9.9')
  // v0.8.5：banner 的「当前 v」改用 LIVE manifest version —— fix 后不信 flag 缓存的 current（这里写的 0.6.3）
  const liveVersion = await sw.evaluate(() => chrome.runtime.getManifest().version)
  await expect(popup.locator('.update-banner .update-title')).toContainText(`v${liveVersion}`)

  // 反向链路：SW 清 flag → popup 也应隐藏 banner
  await sw.evaluate(async () => {
    await chrome.storage.local.remove('mooLatestVersionInfo')
  })
  await expect(popup.locator('.update-banner')).toHaveCount(0, { timeout: 3000 })

  await popup.close()
})

// ---------------------------------------------------------------------------
// D1. v0.7.0 dropped-banner — 同事老 matchPatterns 升级后被 translator drop 时，
//     popup 弹 .dropped-banner 引导去环境改。同 v0.6.1 silent 回归同款防护链。
// ---------------------------------------------------------------------------
test('D1 · v0.7.0 dropped-banner：SW syncContentScripts drop pattern → popup 实时显示', async ({ context, extensionId, sw }) => {
  await waitForOnInstalledSettled(sw)

  // 清 upgrade flag — dropped-banner v-else-if 排他于 upgrade-banner
  await sw.evaluate(async () => {
    await chrome.storage.local.remove('mooNeedsHostPermUpgrade')
  })

  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
  await popup.waitForSelector('main', { timeout: 5000 })
  await expect(popup.locator('.dropped-banner')).toHaveCount(0)

  // 模拟 SW dynamicScripts.syncContentScripts drop 了用户老 patterns 写 flag
  await sw.evaluate(async () => {
    await chrome.storage.local.set({
      mooDroppedMatchPatterns: {
        count: 2,
        samples: ['*', 'example.com/*'],
        at: Date.now()
      }
    })
  })

  // popup storage.onChanged listener fire → droppedPatternsInfo 赋值 → 渲染
  await popup.waitForSelector('.dropped-banner', { timeout: 5000 })
  await expect(popup.locator('.dropped-banner')).toBeVisible()
  await expect(popup.locator('.dropped-banner .dropped-title')).toContainText('2')
  await expect(popup.locator('.dropped-banner .dropped-title')).toContainText('v0.7.0 不兼容')
  await expect(popup.locator('.dropped-banner .dropped-samples')).toContainText('*')
  await expect(popup.locator('.dropped-banner .dropped-samples')).toContainText('example.com/*')

  // 反向：SW 清 flag → popup 隐藏
  await sw.evaluate(async () => {
    await chrome.storage.local.remove('mooDroppedMatchPatterns')
  })
  await expect(popup.locator('.dropped-banner')).toHaveCount(0, { timeout: 3000 })

  await popup.close()
})
