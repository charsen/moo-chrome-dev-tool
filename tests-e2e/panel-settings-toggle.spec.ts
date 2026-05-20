import { test, expect, seedStorage } from './fixtures'

/**
 * Settings Tab toggle 切换 + 持久化 E2E。
 *
 * 锁住的是「点 toggle → useAutoSave(0ms) 立即落盘 → chrome.storage.local mooConfig
 * 对应字段更新」这条链路；以及「清空重试队列」按钮 → confirmDialog → mooRetryQueue 归零。
 *
 * harness：src/devtools/panel-harness.ts (?tab=settings&seed=populated)
 *   - applySeed('populated') 会写 mooConfig（3 项目）+ mooHistory，但不动 mooRetryQueue。
 *   - 所以 retryQueue 必须在 page.goto 之前自己用 sw.evaluate seed。
 *
 * Switch 是自定义 <button role="switch" class="moo-switch">，
 * 注意它不是 input[type=checkbox]，aria-checked 是 string("true"/"false")。
 *
 * useAutoSave debounceMs=0 → click 后下一拍立即 doSave()；落盘是 chrome.storage.local.set，
 * 各 frame 之间消息有传播延迟，给 500ms 等持久化稳定。
 */

function harnessUrl(extensionId: string, seed = 'populated'): string {
  const q = new URLSearchParams({ tab: 'settings', seed })
  return `chrome-extension://${extensionId}/src/devtools/panel-harness.html?${q.toString()}`
}

async function readConfig(sw: import('@playwright/test').Worker) {
  return await sw.evaluate(async () => {
    // @ts-expect-error chrome 类型不在 worker scope
    const r = await chrome.storage.local.get('mooConfig')
    return r.mooConfig as {
      globalEnabled: boolean
      projects: Array<{
        id: string
        capture: { requests: boolean; consoleErrors: boolean }
        redact: { maskPasswordInputs: boolean }
      }>
    } | undefined
  })
}

async function readRetryQueue(sw: import('@playwright/test').Worker) {
  return await sw.evaluate(async () => {
    // @ts-expect-error chrome 类型不在 worker scope
    const r = await chrome.storage.local.get('mooRetryQueue')
    return (r.mooRetryQueue as unknown[] | undefined) ?? []
  })
}

// ---- G1 · 点全局开关 toggle → storage 落盘 ---------------------------------

test('panel · Settings G1：点「启用扩展」toggle → mooConfig.globalEnabled 翻转', async ({ context, extensionId, sw }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId))
  await page.waitForSelector('.settings button.moo-switch[role="switch"]', { timeout: 5000 })

  // 第一行就是「启用扩展」（全局卡片 first row）。seed=populated 默认 globalEnabled=true
  const globalSwitch = page.locator('.settings button.moo-switch[role="switch"]').first()
  await expect(globalSwitch).toHaveAttribute('aria-checked', 'true')

  const before = await readConfig(sw)
  expect(before?.globalEnabled).toBe(true)

  await globalSwitch.click()
  await expect(globalSwitch).toHaveAttribute('aria-checked', 'false')

  // useAutoSave(0ms) → 立即 doSave；给 storage 写入 + propagation 500ms 余量
  await page.waitForTimeout(500)
  const after = await readConfig(sw)
  expect(after?.globalEnabled, 'click toggle 后 mooConfig.globalEnabled 没落盘').toBe(false)
})

// ---- G2 · 双向切换 -------------------------------------------------------

test('panel · Settings G2：「网络请求」toggle 来回切 → storage 跟随', async ({ context, extensionId, sw }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId))
  await page.waitForSelector('.settings button.moo-switch[role="switch"]', { timeout: 5000 })

  // 项目设置卡片里第 1 个 toggle 是「网络请求」(active.capture.requests)。
  // 全局卡片占 1 个 switch（globalEnabled），所以项目里第 1 个 capture.requests = 第 2 个 switch。
  const reqSwitch = page.locator('.settings button.moo-switch[role="switch"]').nth(1)
  await expect(reqSwitch).toHaveAttribute('aria-checked', 'true')

  // 第一次：true → false
  await reqSwitch.click()
  await expect(reqSwitch).toHaveAttribute('aria-checked', 'false')
  await page.waitForTimeout(500)
  let cfg = await readConfig(sw)
  // 找 seed buildPopulatedConfig 里第一个项目 p1
  const p1Before = cfg?.projects.find((p) => p.id === 'p1')
  expect(p1Before?.capture.requests, '第一次 click 后 capture.requests 应为 false').toBe(false)

  // 第二次：false → true（反向）
  await reqSwitch.click()
  await expect(reqSwitch).toHaveAttribute('aria-checked', 'true')
  await page.waitForTimeout(500)
  cfg = await readConfig(sw)
  const p1After = cfg?.projects.find((p) => p.id === 'p1')
  expect(p1After?.capture.requests, '第二次 click 后 capture.requests 应回 true').toBe(true)
})

// ---- G3 · 清空重试队列 ---------------------------------------------------

test('panel · Settings G3：「清空」重试队列 → confirmDialog 确认 → storage 队列归零', async ({ context, extensionId, sw }) => {
  // harness applySeed 不动 mooRetryQueue，所以 goto 之前 seed 进去——SW 上下文 set 不走 origin 限制
  await seedStorage(sw, {
    mooRetryQueue: [
      {
        enqueuedAt: Date.now(),
        attempts: 1,
        endpoint: 'https://intake.example1.com/api/bugs',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        bodyString: '{"title":"待重试 1"}'
      },
      {
        enqueuedAt: Date.now(),
        attempts: 2,
        endpoint: 'https://intake.example1.com/api/bugs',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        bodyString: '{"title":"待重试 2"}'
      }
    ]
  })

  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId))
  await page.waitForSelector('.settings', { timeout: 5000 })

  // 「重试队列」Row 的 .stat 应显示 "2 条"。等 refreshStats() 完成（onMounted async）
  const queueStat = page.locator('.settings .moo-card', { hasText: '存储' }).locator('.row', { hasText: '重试队列' }).locator('.stat')
  await expect(queueStat).toHaveText('2 条', { timeout: 3000 })

  // 同一行内 2 个按钮：「立即重试」+「清空」，点后者
  const clearBtn = page.locator('.settings .moo-card', { hasText: '存储' }).locator('.row', { hasText: '重试队列' }).locator('button', { hasText: '清空' })
  await clearBtn.click()

  // ConfirmModal 弹出（mount 到 document.body 而非 .settings 内）
  const modal = page.locator('.modal[role="alertdialog"]')
  await expect(modal).toBeVisible({ timeout: 3000 })

  // danger=true → 主按钮 .moo-btn--danger-solid，文本「确认丢弃」
  await modal.locator('button.moo-btn--danger-solid', { hasText: '确认丢弃' }).click()

  // clearRetryQueue 写 storage + refreshStats 再读：UI 数字归零
  await expect(queueStat).toHaveText('0 条', { timeout: 3000 })

  // storage 验证（双保险，确认不是 UI 假象）
  const remaining = await readRetryQueue(sw)
  expect(remaining.length, 'storage 里 mooRetryQueue 应为空').toBe(0)
})

// ---- G4 · 不同 toggle 互相独立 -------------------------------------------

test('panel · Settings G4：toggle 之间互相独立（点 globalEnabled 不影响 capture.consoleErrors）', async ({ context, extensionId, sw }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId))
  await page.waitForSelector('.settings button.moo-switch[role="switch"]', { timeout: 5000 })

  const globalSwitch = page.locator('.settings button.moo-switch[role="switch"]').first()
  // nth(2) = 项目里第 2 个 toggle = capture.consoleErrors（globalEnabled / capture.requests / capture.consoleErrors / redact.maskPasswordInputs）
  const consoleErrSwitch = page.locator('.settings button.moo-switch[role="switch"]').nth(2)

  await expect(globalSwitch).toHaveAttribute('aria-checked', 'true')
  await expect(consoleErrSwitch).toHaveAttribute('aria-checked', 'true')

  await globalSwitch.click()
  await expect(globalSwitch).toHaveAttribute('aria-checked', 'false')
  await page.waitForTimeout(500)

  const cfg = await readConfig(sw)
  expect(cfg?.globalEnabled, 'globalEnabled 应变 false').toBe(false)
  const p1 = cfg?.projects.find((p) => p.id === 'p1')
  expect(p1?.capture.consoleErrors, '只点 globalEnabled，capture.consoleErrors 不应变').toBe(true)
  expect(p1?.capture.requests, '只点 globalEnabled，capture.requests 不应变').toBe(true)
  expect(p1?.redact.maskPasswordInputs, '只点 globalEnabled，redact.maskPasswordInputs 不应变').toBe(true)
  // UI 上 consoleErr 那一拨没被联动
  await expect(consoleErrSwitch).toHaveAttribute('aria-checked', 'true')
})
