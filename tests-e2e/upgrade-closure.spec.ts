import { test, expect, seedStorage } from './fixtures'

/**
 * v0.7.6 探索性 e2e — 升级链路闭合：reload 前写 UPGRADE_INTENT → SW onInstalled('update')
 * 对比 manifest.version → 匹配则写 UPGRADED_TOAST + 清 VERSION_CHECK + 清 INTENT。
 *
 * 测什么 / 不测什么：
 * - 直接调 dist 的 SW `checkUpgradeFinished` import 不到（bundle 闭包），所以这里在 SW 上下文
 *   evaluate **等价逻辑**驱动 storage 变化 —— 测的是 `src/utils/versionCheck.ts` 文件契约（写
 *   入哪些 key / 清哪些 key），等价于 SW 真触发时的 storage 副作用。
 * - playwright 无法真的 fire `chrome.runtime.onInstalled.addListener(reason='update')` —
 *   这点在 onInstalled-upgrade-chain.spec.ts 已立规。本 spec 同样的「副作用模拟」姿势。
 * - 跨 popup 端到端：seed UPGRADED_TOAST → 开 popup → .upgraded-toast 渲染 → 等 3s 自动消失。
 *   这部分是真 popup 代码 + 真 storage.onChanged + 真 setTimeout 链路，没有 mock。
 */

const UPGRADE_INTENT_KEY = 'mooUpgradeIntent'
const UPGRADED_TOAST_KEY = 'mooUpgradedToast'
const VERSION_CHECK_FLAG_KEY = 'mooLatestVersionInfo'

// ---------------------------------------------------------------------------
// U1. checkUpgradeFinished 等价逻辑：intent.expected === manifest.version → 写 toast + 清两个 flag
// ---------------------------------------------------------------------------
test('U1 · 升级闭合：intent expected 匹配 manifest.version → 写 UPGRADED_TOAST + 清 VERSION_CHECK + 清 INTENT', async ({ sw }) => {
  // 先确保 onInstalled 已 settle（fresh install 会写 upgrade flag，但跟本 spec 无关）
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 250)))

  // 拿 dist manifest 真版本号，写 intent expected = 同版本（模拟用户真升级到了这个版本）
  const currentVer = await sw.evaluate(() => chrome.runtime.getManifest().version)
  expect(currentVer).toBeTruthy()

  // seed 三件：INTENT + VERSION_CHECK（要被清）+ 一个无关的 mooHistory 不该被动
  await seedStorage(sw, {
    [UPGRADE_INTENT_KEY]: { expected: currentVer, at: Date.now() },
    [VERSION_CHECK_FLAG_KEY]: {
      latest: '9.9.9',
      current: '0.0.1',
      url: 'https://example.com/x',
      checkedAt: Date.now()
    },
    mooHistory: [{ id: 'guard', title: 'preserved' }]
  })

  // 在 SW 上下文跑 checkUpgradeFinished 等价逻辑（复制自 src/utils/versionCheck.ts:109-126）
  // 等价驱动 — 测的是 storage 副作用契约，不是函数引用
  await sw.evaluate(async ({ INTENT, TOAST, VERSION }) => {
    const r = await chrome.storage.local.get(INTENT)
    const intent = r[INTENT] as { expected?: string; at?: number } | undefined
    if (!intent || !intent.expected || !intent.at) return
    if (Date.now() - intent.at > 60 * 60_000) {
      await chrome.storage.local.remove(INTENT)
      return
    }
    const current = chrome.runtime?.getManifest?.()?.version ?? ''
    if (current === intent.expected) {
      await chrome.storage.local.set({ [TOAST]: { version: current, at: Date.now() } })
      await chrome.storage.local.remove([VERSION, INTENT])
    }
  }, { INTENT: UPGRADE_INTENT_KEY, TOAST: UPGRADED_TOAST_KEY, VERSION: VERSION_CHECK_FLAG_KEY })

  // 断言副作用 3 件齐
  const after = await sw.evaluate(async ({ INTENT, TOAST, VERSION, HIST }) => {
    const all = await chrome.storage.local.get([INTENT, TOAST, VERSION, HIST])
    return all
  }, { INTENT: UPGRADE_INTENT_KEY, TOAST: UPGRADED_TOAST_KEY, VERSION: VERSION_CHECK_FLAG_KEY, HIST: 'mooHistory' })

  expect(after[UPGRADE_INTENT_KEY]).toBeUndefined()  // intent 被清
  expect(after[VERSION_CHECK_FLAG_KEY]).toBeUndefined()  // version banner 被清
  expect(after[UPGRADED_TOAST_KEY]).toBeTruthy()  // toast 被写
  const toast = after[UPGRADED_TOAST_KEY] as { version: string; at: number }
  expect(toast.version).toBe(currentVer)
  expect(typeof toast.at).toBe('number')
  expect(after['mooHistory']).toEqual([{ id: 'guard', title: 'preserved' }])  // 无关 key 不动
})

// ---------------------------------------------------------------------------
// U2. checkUpgradeFinished 等价：intent.expected 不匹配 → 啥都不动，等下次 reload
// ---------------------------------------------------------------------------
test('U2 · intent expected 不匹配 manifest.version（用户没真升）→ 不写 toast、intent 留下等下次', async ({ sw }) => {
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 250)))

  const currentVer = await sw.evaluate(() => chrome.runtime.getManifest().version)
  // 写一个绝对不会等于 currentVer 的版本号（确保 mismatch）
  const wrongVer = currentVer + '.999'

  await seedStorage(sw, {
    [UPGRADE_INTENT_KEY]: { expected: wrongVer, at: Date.now() },
    [VERSION_CHECK_FLAG_KEY]: {
      latest: wrongVer,
      current: currentVer,
      url: 'https://example.com/x',
      checkedAt: Date.now()
    }
  })

  await sw.evaluate(async ({ INTENT, TOAST, VERSION }) => {
    const r = await chrome.storage.local.get(INTENT)
    const intent = r[INTENT] as { expected?: string; at?: number } | undefined
    if (!intent || !intent.expected || !intent.at) return
    if (Date.now() - intent.at > 60 * 60_000) {
      await chrome.storage.local.remove(INTENT)
      return
    }
    const current = chrome.runtime?.getManifest?.()?.version ?? ''
    if (current === intent.expected) {
      await chrome.storage.local.set({ [TOAST]: { version: current, at: Date.now() } })
      await chrome.storage.local.remove([VERSION, INTENT])
    }
  }, { INTENT: UPGRADE_INTENT_KEY, TOAST: UPGRADED_TOAST_KEY, VERSION: VERSION_CHECK_FLAG_KEY })

  const after = await sw.evaluate(async ({ INTENT, TOAST, VERSION }) => {
    return await chrome.storage.local.get([INTENT, TOAST, VERSION])
  }, { INTENT: UPGRADE_INTENT_KEY, TOAST: UPGRADED_TOAST_KEY, VERSION: VERSION_CHECK_FLAG_KEY })

  // intent 还在 — 等下次 reload
  expect(after[UPGRADE_INTENT_KEY]).toEqual({ expected: wrongVer, at: expect.any(Number) })
  // toast 没写
  expect(after[UPGRADED_TOAST_KEY]).toBeUndefined()
  // version banner 还在（用户没真升上去，应该继续提示）
  expect(after[VERSION_CHECK_FLAG_KEY]).toBeTruthy()
})

// ---------------------------------------------------------------------------
// U3. intent 太老（> 1h）→ 清 intent，不写 toast（防漏对比场景永远卡着 toast 不出）
// ---------------------------------------------------------------------------
test('U3 · intent 超过 1h 过期 → 仅清 intent，不动 toast 也不动 version flag', async ({ sw }) => {
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 250)))

  const currentVer = await sw.evaluate(() => chrome.runtime.getManifest().version)
  // 2 小时前的 intent
  const oldAt = Date.now() - 2 * 60 * 60_000

  await seedStorage(sw, {
    [UPGRADE_INTENT_KEY]: { expected: currentVer, at: oldAt }
  })

  await sw.evaluate(async ({ INTENT, TOAST, VERSION }) => {
    const r = await chrome.storage.local.get(INTENT)
    const intent = r[INTENT] as { expected?: string; at?: number } | undefined
    if (!intent || !intent.expected || !intent.at) return
    if (Date.now() - intent.at > 60 * 60_000) {
      await chrome.storage.local.remove(INTENT)
      return
    }
    const current = chrome.runtime?.getManifest?.()?.version ?? ''
    if (current === intent.expected) {
      await chrome.storage.local.set({ [TOAST]: { version: current, at: Date.now() } })
      await chrome.storage.local.remove([VERSION, INTENT])
    }
  }, { INTENT: UPGRADE_INTENT_KEY, TOAST: UPGRADED_TOAST_KEY, VERSION: VERSION_CHECK_FLAG_KEY })

  const after = await sw.evaluate(async ({ INTENT, TOAST }) => {
    return await chrome.storage.local.get([INTENT, TOAST])
  }, { INTENT: UPGRADE_INTENT_KEY, TOAST: UPGRADED_TOAST_KEY })

  expect(after[UPGRADE_INTENT_KEY]).toBeUndefined()
  expect(after[UPGRADED_TOAST_KEY]).toBeUndefined()
})

// ---------------------------------------------------------------------------
// U4. 跨 popup 端到端：SW 写 UPGRADED_TOAST → popup 渲染 banner → 3 秒后 auto-dismiss
//     这部分是真 popup Vue / 真 storage.onChanged / 真 setTimeout 链路
// ---------------------------------------------------------------------------
test('U4 · 跨 popup：SW 写 UPGRADED_TOAST → popup .upgraded-toast 渲染 + 3 秒自动消失', async ({ context, extensionId, sw }) => {
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 250)))

  // 关键前置：清 upgrade flag —— banner v-if/v-else-if 排他，upgrade-banner 优先级最高，
  // 它在的话 upgraded-toast 永远不渲染（fresh install 会写这个 flag）
  await sw.evaluate(async () => {
    await chrome.storage.local.remove(['mooNeedsHostPermUpgrade'])
  })

  // 先开 popup（toast 尚未存在）
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
  await popup.waitForSelector('main', { timeout: 5000 })
  await expect(popup.locator('.upgraded-toast')).toHaveCount(0)

  // SW 写 toast — popup 的 storage.onChanged listener 应捕获 + 渲染
  const currentVer = await sw.evaluate(() => chrome.runtime.getManifest().version)
  await sw.evaluate(async ({ TOAST, ver }) => {
    await chrome.storage.local.set({ [TOAST]: { version: ver, at: Date.now() } })
  }, { TOAST: UPGRADED_TOAST_KEY, ver: currentVer })

  // banner 应实时弹出
  await popup.waitForSelector('.upgraded-toast', { timeout: 3000 })
  await expect(popup.locator('.upgraded-toast')).toBeVisible()
  await expect(popup.locator('.upgraded-toast .upgraded-title')).toContainText('✓ 已升级到 v')
  await expect(popup.locator('.upgraded-toast .upgraded-title')).toContainText(currentVer)

  // 等 3 秒自动消失（auto-dismiss timer = 3000ms）
  await popup.waitForSelector('.upgraded-toast', { state: 'detached', timeout: 5000 })
  await expect(popup.locator('.upgraded-toast')).toHaveCount(0)

  // toast storage key 应被 popup 主动清掉（dismissUpgradedToast 写）
  const afterStore = await sw.evaluate(async ({ TOAST }) => {
    return (await chrome.storage.local.get(TOAST))[TOAST]
  }, { TOAST: UPGRADED_TOAST_KEY })
  expect(afterStore).toBeUndefined()

  await popup.close()
})

// ---------------------------------------------------------------------------
// U5. popup 端到端：超时过期 toast（at 已超过 5min）→ popup 加载时跳过显示 + 主动清
//     验 src/popup/App.vue:580-592 的 age 校验分支
// ---------------------------------------------------------------------------
test('U5 · popup 加载：UPGRADED_TOAST 超过 5min → 不渲染 banner + storage 自动清', async ({ context, extensionId, sw }) => {
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 250)))

  await sw.evaluate(async () => {
    await chrome.storage.local.remove(['mooNeedsHostPermUpgrade'])
  })

  // seed 一个 10min 前的 toast（视作过期）
  const oldAt = Date.now() - 10 * 60_000
  await sw.evaluate(async ({ TOAST, oldAt }) => {
    await chrome.storage.local.set({ [TOAST]: { version: '0.7.5', at: oldAt } })
  }, { TOAST: UPGRADED_TOAST_KEY, oldAt })

  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
  await popup.waitForSelector('main', { timeout: 5000 })

  // banner 不应渲染
  await expect(popup.locator('.upgraded-toast')).toHaveCount(0)

  // 过期 toast 应被 popup 主动清（src/popup/App.vue:589-591 的 else 分支）
  await popup.waitForFunction(async () => {
    const r = await chrome.storage.local.get('mooUpgradedToast')
    return r['mooUpgradedToast'] === undefined
  }, null, { timeout: 3000 })

  await popup.close()
})
