import { test, expect, seedStorage } from './fixtures'

/**
 * v0.8.9 行为变更锁：History.vue 进 Tab 自动「同步远端状态」条件放宽。
 *
 * 旧：仅「zentao kind 项目 + 该项目有 remoteId entry」才自动发 REFRESH_HISTORY_STATUS，
 *     webhook/cloud 项目的历史（有远端单号）每次都要用户手点「同步远端状态」。
 * 新：`list.some(e => e.remoteId)` —— 任何有远端单号的记录都自动回查一次；
 *     没有任何 remoteId 时仍然不发（不对没单号的库存乱 ping）。
 *
 * 测法：panel-harness ?seed=external + seedStorage 预置 webhook 项目 config + 定制
 * mooHistory，addInitScript 在页面任何 module 跑之前包一层 chrome.runtime.sendMessage
 * 按 msg.type 计数（panel-harness 有意不桩 runtime.sendMessage —— 消息发真 SW，
 * 见 src/devtools/panel-harness.ts:273 注释；handler 对单条失败 try/catch，无害）。
 *
 * 覆盖：进 Tab 时「发 / 不发」的触发条件（正反两面）。
 * 不覆盖：fetchStatus 回查协议本身（adapter 层单测）、手动按钮路径（人肉/已有流程）。
 */

function harnessUrl(extensionId: string): string {
  const q = new URLSearchParams({ tab: 'history', seed: 'external' })
  return `chrome-extension://${extensionId}/src/devtools/panel-harness.html?${q.toString()}`
}

declare global {
  interface Window {
    __mooRefreshCount: number
    __mooRefreshForces: unknown[]
  }
}

function webhookConfig(): Record<string, unknown> {
  return {
    projects: [{
      id: 'p1',
      name: 'Webhook 项目',
      matchPatterns: ['https://app.example.com/*'],
      kind: 'webhook',
      servers: [{
        id: 's1',
        name: '云上报',
        endpoint: 'https://intake.example.com/api/bugs',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        payloadTemplate: '{"title":"{{title}}"}',
        imageField: 'screenshot',
        imageFormat: 'base64'
      }],
      defaultServerId: 's1',
      capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
      redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: true },
      enabled: true
    }],
    globalEnabled: true
  }
}

function historyEntry(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'h-1',
    timestamp: Date.now(),
    projectId: 'p1',
    projectName: 'Webhook 项目',
    serverId: 's1',
    serverName: '云上报',
    title: '示例 bug',
    description: '',
    image: '',
    hasVideo: false,
    url: 'https://app.example.com/page',
    userAgent: 'Mozilla/5.0 (e2e)',
    viewport: '1280x800',
    requests: [],
    errors: [],
    result: { ok: true, status: 200, body: '{"ok":true,"id":"TD-1"}' },
    ...over
  }
}

/** 在页面任何 module 执行前包 chrome.runtime.sendMessage，按 type 计数后转发真 API */
async function hookSendMessageCounter(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __mooRefreshCount: number; __mooRefreshForces: unknown[] }
    w.__mooRefreshCount = 0
    w.__mooRefreshForces = []
    const rt = (globalThis as unknown as {
      chrome?: { runtime?: {
        sendMessage?: (...a: unknown[]) => unknown
        __mooHooked?: boolean
      } }
    }).chrome?.runtime
    if (!rt?.sendMessage || rt.__mooHooked) return
    rt.__mooHooked = true
    const orig = rt.sendMessage.bind(rt)
    rt.sendMessage = (...args: unknown[]) => {
      const msg = args[0] as { type?: string; payload?: { force?: unknown } } | undefined
      if (msg?.type === 'REFRESH_HISTORY_STATUS') {
        w.__mooRefreshCount++
        w.__mooRefreshForces.push(msg.payload?.force)
      }
      return orig(...args)
    }
  })
}

test('History 自动同步 · webhook entry 带 remoteId → 进 Tab 自动发 REFRESH_HISTORY_STATUS ≥1 次', async ({ context, extensionId, sw }) => {
  await seedStorage(sw, {
    mooConfig: webhookConfig(),
    // remoteId 存在 = 后端返回过单号 —— 新行为应自动回查（旧行为 zentao-only 时 0 次）
    mooHistory: [historyEntry({ remoteId: 'TD-1' })]
  })

  const page = await context.newPage()
  await hookSendMessageCounter(page)
  await page.goto(harnessUrl(extensionId))
  await page.waitForSelector('.history .row', { timeout: 5000 })

  await expect
    .poll(() => page.evaluate(() => window.__mooRefreshCount), {
      timeout: 4000,
      message: 'webhook entry 带 remoteId：进 History tab 应自动发 REFRESH_HISTORY_STATUS（旧 zentao-only 条件下为 0）'
    })
    .toBeGreaterThanOrEqual(1)

  await page.close()
})

// 裸引用 @click="syncRemoteStatus"（MouseEvent 当 force）已被 vue-tsc 在 build 期拦截
// （force 参数显式 boolean 类型）；本 case 守的是 payload 接线层 —— 比如手动路径
// payload 漏传 force / 改名 / 序列化丢失，类型查不出但语义破坏（手动按钮失去绕冷却能力）。
test('History 同步 force 语义 · auto 触发 force=false，手动按钮 force=true（防裸引用把 MouseEvent 当 force）', async ({ context, extensionId, sw }) => {
  await seedStorage(sw, {
    mooConfig: webhookConfig(),
    mooHistory: [historyEntry({ remoteId: 'TD-1' })]
  })

  const page = await context.newPage()
  await hookSendMessageCounter(page)
  await page.goto(harnessUrl(extensionId))
  await page.waitForSelector('.history .row', { timeout: 5000 })

  // 先等 auto 触发到位，确认 auto 路径不带 force=true
  await expect
    .poll(() => page.evaluate(() => window.__mooRefreshCount), { timeout: 4000 })
    .toBeGreaterThanOrEqual(1)
  const autoForces = await page.evaluate(() => window.__mooRefreshForces)
  expect(autoForces.includes(true), 'auto 触发不应带 force=true').toBe(false)

  // 手动点「同步远端状态」（Playwright 自动等 :disabled 解除 = syncing 完成）
  await page.getByRole('button', { name: '同步远端状态' }).click()
  await expect
    .poll(() => page.evaluate(() => window.__mooRefreshForces.includes(true)), {
      timeout: 4000,
      message: '手动按钮应发 payload.force === true（裸引用 @click 会把 MouseEvent 传成 force，序列化后丢失 ≠ true）'
    })
    .toBe(true)

  await page.close()
})

test('History 自动同步 · 无任何 remoteId（失败记录无单号）→ 进 Tab 不发 REFRESH_HISTORY_STATUS', async ({ context, extensionId, sw }) => {
  await seedStorage(sw, {
    mooConfig: webhookConfig(),
    // 提交失败、没拿到远端单号 —— 不应该对没单号的库存乱 ping
    mooHistory: [historyEntry({
      id: 'h-fail',
      result: { ok: false, status: 500, error: 'Internal Server Error' }
    })]
  })

  const page = await context.newPage()
  await hookSendMessageCounter(page)
  await page.goto(harnessUrl(extensionId))
  await page.waitForSelector('.history .row', { timeout: 5000 })

  // subscribeChanges 在 onActivated 里 await reload() 之后才判断 —— 给足 settle 时间再断 0
  await page.waitForTimeout(800)
  const count = await page.evaluate(() => window.__mooRefreshCount)
  expect(count, '无 remoteId 时不应自动发 REFRESH_HISTORY_STATUS').toBe(0)

  await page.close()
})
