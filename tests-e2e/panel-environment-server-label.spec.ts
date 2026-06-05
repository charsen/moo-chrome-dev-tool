import { test, expect, seedStorage } from './fixtures'

/**
 * v0.8.6 改动 B 锁：Environment 侧栏徽标 `.count`（webhook 项目）从「servers.length 数字」
 * 改成 projectServerLabel(p) = default 服务器名（取 defaultServerId 对应的，不是裸 servers[0]）。
 *
 * E2E 层：Environment.vue 读真 chrome.storage.local。用 panel-harness 的 ?seed=external
 * 模式（不覆盖 mooConfig），由 seedStorage(sw, {mooConfig}) 预置自定义形状的项目，
 * 再开 harness 断言侧栏 .count 文本。
 *
 * 不覆盖：projectServerLabel 纯函数分支穷举（归单测）；这里只验「真 config → 侧栏渲染
 * 出 default 服务器名」端到端 + 多服务器且 default≠第一个时取对 default 那个。
 */

function harnessUrl(extensionId: string): string {
  const q = new URLSearchParams({ tab: 'environment', seed: 'external' })
  return `chrome-extension://${extensionId}/src/devtools/panel-harness.html?${q.toString()}`
}

function server(id: string, name: string): Record<string, unknown> {
  return {
    id,
    name,
    endpoint: `https://intake.example.com/${id}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    payloadTemplate: '{"title":"{{title}}"}',
    imageField: 'screenshot',
    imageFormat: 'base64'
  }
}

function project(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'p',
    name: '项目',
    matchPatterns: ['https://app.example.com/*'],
    kind: 'webhook',
    servers: [],
    defaultServerId: '',
    capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
    redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: true },
    enabled: true,
    ...over
  }
}

test('B1 · Environment 侧栏：webhook 多服务器（default 指向第二个）→ 徽标显 default(第二个) 服务器名', async ({ context, extensionId, sw }) => {
  await seedStorage(sw, {
    mooConfig: {
      projects: [
        project({
          id: 'p1',
          name: '多服务器项目',
          servers: [server('s1', '生产上报'), server('s2', '测试上报')],
          defaultServerId: 's2'
        })
      ],
      globalEnabled: true
    },
    mooHistory: []
  })

  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId))
  await page.waitForSelector('.env-wrap', { timeout: 5000 })
  await expect(page.locator('.project-item')).toHaveCount(1)

  const badge = page.locator('.project-item .count')
  const text = (await badge.innerText()).trim()
  expect(text, `实际徽标：「${text}」`).toBe('测试上报')
  // default≠第一个时不能错取 servers[0]
  expect(text).not.toBe('生产上报')
  // 走 webhook 有服务器分支（count--server，非 count--zero）
  await expect(badge).toHaveClass(/count--server/)

  await page.close()
})

test('B2 · Environment 侧栏：webhook 0 服务器 → 徽标显「⚠ 无服务器」', async ({ context, extensionId, sw }) => {
  await seedStorage(sw, {
    mooConfig: {
      projects: [project({ id: 'p2', name: '空服务器项目', servers: [], defaultServerId: '' })],
      globalEnabled: true
    },
    mooHistory: []
  })

  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId))
  await page.waitForSelector('.env-wrap', { timeout: 5000 })

  const badge = page.locator('.project-item .count')
  const text = (await badge.innerText()).trim()
  expect(text, `实际徽标：「${text}」`).toContain('无服务器')
  await expect(badge).toHaveClass(/count--zero/)

  await page.close()
})

test('B3 · Environment 侧栏：default 服务器名为空 → 回退「未命名」', async ({ context, extensionId, sw }) => {
  await seedStorage(sw, {
    mooConfig: {
      projects: [
        project({
          id: 'p3',
          name: '无名服务器项目',
          servers: [server('s1', '')],
          defaultServerId: 's1'
        })
      ],
      globalEnabled: true
    },
    mooHistory: []
  })

  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId))
  await page.waitForSelector('.env-wrap', { timeout: 5000 })

  const badge = page.locator('.project-item .count')
  const text = (await badge.innerText()).trim()
  expect(text, `实际徽标：「${text}」`).toBe('未命名')

  await page.close()
})
