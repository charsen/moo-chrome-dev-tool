import { test, expect, seedStorage } from './fixtures'

/**
 * v0.8.6 改动 A 锁：popup matched 卡片副行 `.proj-meta` 按 kind 分支（projMeta(p)）。
 *
 * 这是「单测/E2E」中的 E2E 层 —— 覆盖 popup 真实 onMounted 链路（loadConfig →
 * normalizeConfig → urlMatches 命中 → 渲染 .proj-card/.proj-meta）。不覆盖纯
 * projMeta(p) 字符串分支的穷举（那是纯函数，归单测）；这里只验「真 config seed
 * 进 storage → popup 渲染出正确副行文本」的端到端串联。
 *
 * popup 的 matched 判定走真 chrome.tabs.query({active,currentWindow})，e2e 里 popup
 * 自身那个 tab 的 url 是 chrome-extension://...（不命中 http pattern）。用 addInitScript
 * 在 popup 脚本执行前覆盖 chrome.tabs.query 返回一个 http url，让 matchPatterns
 * 'https://app.example.com/*' 真命中 → 进入 matched 态。
 */

const MATCH_URL = 'https://app.example.com/dashboard'

// popup onMounted: Promise.all 第一个就是 chrome.tabs.query；覆盖它返回 http url，
// 其余 chrome.* 维持真实实现（permissions / storage 等照常）。
const TABS_QUERY_OVERRIDE = `
  (() => {
    const realQuery = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (info, cb) => {
      const fake = [{ id: 999, url: '${MATCH_URL}', active: true, currentWindow: true }];
      if (typeof cb === 'function') { cb(fake); return; }
      return Promise.resolve(fake);
    };
  })();
`

function zentaoProject(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pz',
    name: '禅道项目',
    matchPatterns: ['https://app.example.com/*'],
    kind: 'zentao',
    servers: [],
    defaultServerId: '',
    zentao: {
      baseUrl: 'https://zentao.example.com',
      account: 'u',
      password: '',
      projectId: 42,
      productId: 1,
      moduleId: 0,
      defaultType: 'codeerror',
      defaultSeverity: 3,
      defaultPri: 3,
      defaultKeywords: ''
    },
    capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
    redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: true },
    enabled: true,
    ...over
  }
}

function webhookProject(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pw',
    name: 'Webhook 项目',
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

async function openPopupMatched(context: import('@playwright/test').BrowserContext, extensionId: string) {
  const page = await context.newPage()
  await page.setViewportSize({ width: 360, height: 600 })
  await page.addInitScript(TABS_QUERY_OVERRIDE)
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
  // matched 态渲染 .state--matched + .proj-card
  await page.waitForSelector('.state--matched .proj-card', { timeout: 5000 })
  return page
}

test('A1 · popup 禅道项目（配了 projectId, servers=[]）→ 副行显「禅道单 · 项目 #42」不显「0 个上报服务器」', async ({ context, extensionId, sw }) => {
  await seedStorage(sw, {
    mooConfig: { projects: [zentaoProject()], globalEnabled: true },
    mooHistory: []
  })
  const page = await openPopupMatched(context, extensionId)

  const meta = await page.locator('.proj-card .proj-meta').innerText()
  expect(meta, `实际渲染：「${meta}」`).toContain('禅道单 · 项目 #42')
  // 关键回归点：禅道项目不能再显「0 个上报服务器」/「无上报服务器」
  expect(meta).not.toContain('上报服务器')
  expect(meta).not.toContain('个上报')

  await page.close()
})

test('A1b · popup 禅道项目没配 projectId → 副行显「⚠ 禅道未配项目 ID」', async ({ context, extensionId, sw }) => {
  await seedStorage(sw, {
    mooConfig: {
      projects: [zentaoProject({ zentao: { ...(zentaoProject().zentao as object), projectId: 0 } })],
      globalEnabled: true
    },
    mooHistory: []
  })
  const page = await openPopupMatched(context, extensionId)

  const meta = await page.locator('.proj-card .proj-meta').innerText()
  expect(meta, `实际渲染：「${meta}」`).toContain('禅道未配项目 ID')

  await page.close()
})

test('A2 · popup webhook 多服务器（defaultServerId 指向第二个）→ 副行显 default(第二个) 服务器名，不是第一个', async ({ context, extensionId, sw }) => {
  await seedStorage(sw, {
    mooConfig: {
      projects: [webhookProject({
        servers: [server('s1', '生产上报'), server('s2', '测试上报')],
        defaultServerId: 's2'
      })],
      globalEnabled: true
    },
    mooHistory: []
  })
  const page = await openPopupMatched(context, extensionId)

  const meta = await page.locator('.proj-card .proj-meta').innerText()
  expect(meta, `实际渲染：「${meta}」`).toContain('上报服务器：测试上报')
  // 不能错取 servers[0]
  expect(meta).not.toContain('生产上报')

  await page.close()
})

test('A3 · popup webhook 0 服务器 → 副行显「⚠ 无上报服务器」', async ({ context, extensionId, sw }) => {
  await seedStorage(sw, {
    mooConfig: {
      projects: [webhookProject({ servers: [], defaultServerId: '' })],
      globalEnabled: true
    },
    mooHistory: []
  })
  const page = await openPopupMatched(context, extensionId)

  const meta = await page.locator('.proj-card .proj-meta').innerText()
  expect(meta, `实际渲染：「${meta}」`).toContain('无上报服务器')

  await page.close()
})
