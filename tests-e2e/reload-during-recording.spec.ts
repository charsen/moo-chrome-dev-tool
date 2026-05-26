import { test, expect, seedStorage } from './fixtures'

/**
 * v0.7.5/v0.7.6 探索性 e2e — popup 「③ 重新加载」按钮：录屏中点击应弹 confirm 防丢，
 * 用户拒绝时 chrome.runtime.reload 必须不被调用。
 *
 * 测的是真 popup Vue + 真 useVersionCheck composable —— 通过 update-banner 内的
 * `<button @click="reloadExtension">③ 重新加载</button>` 触发，注入 stub 拦截
 * chrome.runtime.sendMessage(QUERY_RECORDING_STATE) 和 chrome.runtime.reload。
 *
 * 不测的：confirm 真弹窗交互（chrome 内置 confirm 在扩展页 + headless 模式行为不一致，
 * 用 playwright `page.on('dialog')` 拦截 + 选 dismiss/accept）。
 *
 * 已知折衷：注入脚本在 popup 加载后才跑，可能 popup 内 reloadExtension 已经被 Vue 闭包到
 * 原始 chrome.runtime.sendMessage。修法：用 page.addInitScript 在脚本上下文初始化前注入。
 */

const VERSION_CHECK_FLAG_KEY = 'mooLatestVersionInfo'

async function openPopupWithStubs(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
  sw: import('@playwright/test').Worker,
  recording: boolean
): Promise<{ popup: import('@playwright/test').Page; reloadCalled: () => Promise<boolean> }> {
  // 等 fresh install onInstalled settle
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 250)))

  // 清 upgrade flag + 其它优先级更高 banner，确保 update-banner 渲染（v-else-if 链路）
  await sw.evaluate(async () => {
    await chrome.storage.local.remove([
      'mooNeedsHostPermUpgrade',
      'mooDroppedMatchPatterns',
      'mooUpgradedToast'
    ])
  })

  // seed VERSION_CHECK_FLAG_KEY 让 popup 显 update-banner（含「③ 重新加载」按钮）
  await seedStorage(sw, {
    [VERSION_CHECK_FLAG_KEY]: {
      latest: '9.9.9',
      current: '0.0.1',
      url: 'https://example.com/releases/v9.9.9',
      checkedAt: Date.now()
    }
  })

  const popup = await context.newPage()

  // 注入 stub：override sendMessage 拦 QUERY_RECORDING_STATE + override reload 计数
  // 必须用 addInitScript 在 popup script eval 前抢先注入，否则 useVersionCheck 闭包到原始 API
  await popup.addInitScript((rec) => {
    // 标记 reload 是否被调用
    ;(window as unknown as { __mooReloadCalled: boolean }).__mooReloadCalled = false
    const origSend = chrome.runtime.sendMessage.bind(chrome.runtime)
    // override sendMessage — 仅 QUERY_RECORDING_STATE 走 stub，其它转发
    chrome.runtime.sendMessage = ((message: unknown, ...rest: unknown[]) => {
      if (message && typeof message === 'object' && (message as { type?: string }).type === 'QUERY_RECORDING_STATE') {
        return Promise.resolve({ recording: rec })
      }
      return (origSend as (...a: unknown[]) => unknown)(message, ...rest)
    }) as typeof chrome.runtime.sendMessage
    // override reload — 不真的 reload 扩展（否则 popup 直接 detach 测试也 detach）
    chrome.runtime.reload = () => {
      ;(window as unknown as { __mooReloadCalled: boolean }).__mooReloadCalled = true
    }
  }, recording)

  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
  await popup.waitForSelector('.update-banner', { timeout: 5000 })

  const reloadCalled = async (): Promise<boolean> => {
    return await popup.evaluate(() => (window as unknown as { __mooReloadCalled: boolean }).__mooReloadCalled)
  }

  return { popup, reloadCalled }
}

// ---------------------------------------------------------------------------
// R1. recording=true + confirm dismiss → chrome.runtime.reload 不被调用
// ---------------------------------------------------------------------------
test('R1 · 录屏中 + confirm 拒绝 → chrome.runtime.reload 不被调用', async ({ context, extensionId, sw }) => {
  const { popup, reloadCalled } = await openPopupWithStubs(context, extensionId, sw, true)

  // 拦截 confirm 弹窗 — dismiss 视作「不要丢录屏」
  popup.on('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm')
    expect(dialog.message()).toContain('录屏')
    expect(dialog.message()).toContain('丢失')
    await dialog.dismiss()
  })

  // 点击 update-banner 内的「③ 重新加载」按钮
  const reloadBtn = popup.locator('.update-banner button:has-text("重新加载")')
  await expect(reloadBtn).toBeVisible()
  await reloadBtn.click()

  // 等一下让 reloadExtension 异步链跑完（sendMessage await + confirm await）
  await popup.waitForTimeout(500)

  // 关键断言：reload 不被调用
  expect(await reloadCalled()).toBe(false)

  // 同时验：UPGRADE_INTENT 也不该被写（写 intent 在 reload 前一步，confirm 拒绝时整个分支返回）
  const intent = await sw.evaluate(async () => (await chrome.storage.local.get('mooUpgradeIntent'))['mooUpgradeIntent'])
  expect(intent).toBeUndefined()

  await popup.close()
})

// ---------------------------------------------------------------------------
// R2. recording=true + confirm accept → chrome.runtime.reload 被调用 + intent 被写
// ---------------------------------------------------------------------------
test('R2 · 录屏中 + confirm 接受 → reload 被调用 + UPGRADE_INTENT 被写', async ({ context, extensionId, sw }) => {
  const { popup, reloadCalled } = await openPopupWithStubs(context, extensionId, sw, true)

  popup.on('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm')
    await dialog.accept()
  })

  await popup.locator('.update-banner button:has-text("重新加载")').click()
  await popup.waitForTimeout(500)

  expect(await reloadCalled()).toBe(true)

  // intent 应被写（expected = updateInfo.latest = '9.9.9'）
  const intent = await sw.evaluate(async () => (await chrome.storage.local.get('mooUpgradeIntent'))['mooUpgradeIntent']) as { expected?: string; at?: number } | undefined
  expect(intent).toBeTruthy()
  expect(intent!.expected).toBe('9.9.9')
  expect(typeof intent!.at).toBe('number')

  await popup.close()
})

// ---------------------------------------------------------------------------
// R3. recording=false → 无 confirm 弹窗 + 直接 reload + intent 被写
// ---------------------------------------------------------------------------
test('R3 · 未录屏 → 不弹 confirm，reload 直接被调用 + UPGRADE_INTENT 被写', async ({ context, extensionId, sw }) => {
  const { popup, reloadCalled } = await openPopupWithStubs(context, extensionId, sw, false)

  let dialogFired = false
  popup.on('dialog', async (dialog) => {
    dialogFired = true
    await dialog.dismiss()
  })

  await popup.locator('.update-banner button:has-text("重新加载")').click()
  await popup.waitForTimeout(500)

  expect(dialogFired).toBe(false)  // 未录屏不应弹 confirm
  expect(await reloadCalled()).toBe(true)

  const intent = await sw.evaluate(async () => (await chrome.storage.local.get('mooUpgradeIntent'))['mooUpgradeIntent']) as { expected?: string } | undefined
  expect(intent?.expected).toBe('9.9.9')

  await popup.close()
})
