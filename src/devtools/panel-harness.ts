// E2E 测试用 harness：把 Panel.vue（含 4 个 Tab）独立挂在 chrome-extension://EXT/.../panel-harness.html
// 上，Playwright 跑真 Chrome 来截图 + DOM 断言。不在 prod 流程里被任何真实 UI 引用。
//
// 真 DevTools 面板的特殊性：Panel.vue setup 顶层就 sync 读 chrome.devtools.inspectedWindow.tabId，
// 该 API 只在 chrome.devtools.panels.create() 注入的 iframe 上下文里有。harness 是个普通
// chrome-extension:// 页面，必须**在 import Panel.vue 之前**把 chrome.devtools 整套桩好，
// 否则 Vue 在 setup() 同步阶段直接 throw 让整个面板白屏。
//
// 同理 Overview.vue 用 chrome.tabs.sendMessage(tabId, ...) 拉请求/错误数据——harness 里
// 没有真 tab，必须 mock 一个返回 seed 数据的回调，不然 Overview 永远是「加载中…」。
//
// URL query：
//   ?tab=overview|environment|history|settings   把对应 tab 设为 active（默认 overview）
//   ?seed=empty|populated|wide|long              切换 seed 数据集
//   ?count=N                                     populated/long seed 下覆盖默认条数（请求 / history entry）
//
// 调用方在 newPage 之前用 fixture 的 seedStorage(sw, ...) 塞数据更可靠（绕 origin）；
// URL ?seed= 是兜底，方便手动打开 harness 自己调试。

import { createApp } from 'vue'

// ------------------- Mock chrome.devtools / chrome.tabs（必须在 import Panel 之前）---

interface FakeRequest {
  id: string
  kind: 'fetch' | 'xhr'
  method: string
  url: string
  requestHeaders: Record<string, string>
  requestBody: string | null
  status: number
  ok: boolean
  responseHeaders: Record<string, string>
  responseBody: string | null
  responseSizeBytes: number
  startTime: number
  duration: number
  startedAt: string
  error?: string
}
interface FakeError {
  id: string
  level: 'error' | 'rejection' | 'console'
  message: string
  startedAt: string
  startTime: number
  stack?: string
}

const params = new URLSearchParams(window.location.search)
const tabParam = params.get('tab') ?? 'overview'
const seedMode = params.get('seed') ?? 'empty'
const countOverride = Number(params.get('count') || '0')

// Overview.vue 通过 chrome.tabs.sendMessage 拉 GET_REQUESTS / GET_ERRORS。
// 在 harness 里没有真 content script 回应，存一份 in-memory seed，mock 的 sendMessage
// 按 msg.type 直接 callback 回去；CLEAR_* 也兜一下让"清空"按钮的 UI 流程能跑通。
let seedRequests: FakeRequest[] = []
let seedErrors: FakeError[] = []

function buildRequests(count: number, opts: { longUrl?: boolean } = {}): FakeRequest[] {
  const arr: FakeRequest[] = []
  const now = Date.now()
  for (let i = 0; i < count; i++) {
    const long = opts.longUrl ?? false
    // 长 URL 测试：把 path 拉到 200+ 字符锁主架构师那个原始 bug
    // —— 大宽度下 .url 不加 min-width:0 就会把 .dur/.time 列挤出可视区
    const path = long
      ? `/api/v2/very/deeply/nested/resource/that/keeps/going/and/going/with/many/segments/${i}?with=lots&of=query&params=to=make=it=extra=long&filter=foo&filter=bar&filter=baz&sort=created_at`
      : `/api/items/${i}`
    arr.push({
      id: `r-${i}`,
      kind: i % 3 === 0 ? 'xhr' : 'fetch',
      method: ['GET', 'POST', 'PUT', 'DELETE'][i % 4] ?? 'GET',
      url: `https://api.example.com${path}`,
      requestHeaders: { 'Content-Type': 'application/json' },
      requestBody: i % 4 === 1 ? '{"a":1,"b":2}' : null,
      status: i % 7 === 6 ? 500 : i % 5 === 4 ? 404 : 200,
      ok: i % 7 !== 6 && i % 5 !== 4,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: '{"ok":true,"id":' + i + '}',
      responseSizeBytes: 32,
      startTime: i * 100,
      // 慢请求样本：i=2 触发 ≥1s 橙；i=5 触发 ≥3s 红——锁住 dur 染色路径
      duration: i === 2 ? 1500 : i === 5 ? 4200 : 80 + (i % 50),
      startedAt: new Date(now - (count - i) * 1000).toISOString()
    })
  }
  return arr
}

function buildErrors(count: number): FakeError[] {
  const arr: FakeError[] = []
  const now = Date.now()
  for (let i = 0; i < count; i++) {
    arr.push({
      id: `e-${i}`,
      level: (['error', 'rejection', 'console'] as const)[i % 3] ?? 'error',
      message: `Sample error #${i}: something went wrong`,
      stack: `Error: x\n    at foo (app.js:${10 + i}:5)\n    at bar (app.js:${20 + i}:8)`,
      startedAt: new Date(now - (count - i) * 1000).toISOString(),
      startTime: i * 200
    })
  }
  return arr
}

function buildHistoryEntries(count: number) {
  const now = Date.now()
  const out: Record<string, unknown>[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      id: `h-${i}`,
      timestamp: now - i * 60_000,
      projectId: 'p1',
      projectName: '示例项目',
      serverId: 's1',
      serverName: '主上报',
      title: `Bug #${i}：示例标题`,
      description: `第 ${i} 条历史描述\n第二行内容`,
      image: '',
      hasVideo: i % 5 === 0,
      videoDuration: i % 5 === 0 ? 12 : undefined,
      url: `https://app.example.com/page/${i}`,
      userAgent: 'Mozilla/5.0 (harness)',
      viewport: '1280x800',
      requests: [],
      errors: [],
      result: {
        ok: i % 4 !== 3,
        status: i % 4 === 3 ? 500 : 200,
        body: '{"ok":true}'
      },
      remoteStatus: (['open', 'in_progress', 'done'] as const)[i % 3]
    })
  }
  return out
}

function buildPopulatedConfig(projectCount = 3) {
  const projects: unknown[] = []
  for (let i = 0; i < projectCount; i++) {
    projects.push({
      id: `p${i + 1}`,
      name: `项目 ${i + 1}`,
      matchPatterns: [`https://*.example${i + 1}.com/*`],
      servers: [
        {
          id: `s${i + 1}`,
          name: `服务器 ${i + 1}`,
          endpoint: `https://intake.example${i + 1}.com/api/bugs`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          payloadTemplate: '{"title":"{{title}}"}',
          imageField: 'screenshot',
          imageFormat: 'base64'
        }
      ],
      defaultServerId: `s${i + 1}`,
      capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
      redact: { headerKeys: ['authorization'], bodyKeys: ['password'], maskPasswordInputs: true },
      enabled: true,
      token: `tok-${i + 1}`
    })
  }
  return { projects, globalEnabled: true }
}

// ---- 装 seed 数据到 in-memory + chrome.storage.local --------------------------------
// 顺序很重要：先初始化 in-memory（给 Overview 的 sendMessage mock 用），
// 再写 storage（给 Environment / History / Settings 的 load 用，它们走真 chrome.storage）。
async function applySeed(): Promise<void> {
  switch (seedMode) {
    case 'populated': {
      const reqCount = countOverride > 0 ? countOverride : 10
      seedRequests = buildRequests(reqCount)
      seedErrors = buildErrors(3)
      const cfg = buildPopulatedConfig(3)
      await chrome.storage.local.set({
        mooConfig: cfg,
        mooHistory: buildHistoryEntries(10)
      })
      break
    }
    case 'wide': {
      // 长 URL 数据集：专门给「大宽度下 .url 必须截断 + .dur/.time 仍可见」case
      const reqCount = countOverride > 0 ? countOverride : 100
      seedRequests = buildRequests(reqCount, { longUrl: true })
      seedErrors = []
      await chrome.storage.local.set({
        mooConfig: buildPopulatedConfig(1),
        mooHistory: []
      })
      break
    }
    case 'long': {
      // 100 条 history：测 content-visibility 性能 + 列表渲染数
      const histCount = countOverride > 0 ? countOverride : 100
      seedRequests = []
      seedErrors = []
      await chrome.storage.local.set({
        mooConfig: buildPopulatedConfig(1),
        mooHistory: buildHistoryEntries(histCount)
      })
      break
    }
    case 'empty':
    default: {
      seedRequests = []
      seedErrors = []
      // 显式清掉 —— 上一次 harness 留下的 storage 在 fixture 之间是共享 profile
      await chrome.storage.local.set({ mooConfig: { projects: [], globalEnabled: true }, mooHistory: [] })
      break
    }
  }
}

// ---- mock chrome.devtools + chrome.tabs.sendMessage ------------------------------------
;(globalThis as { chrome?: unknown }).chrome = (globalThis as { chrome?: unknown }).chrome ?? {}
const chromeAny = (globalThis as { chrome: Record<string, unknown> }).chrome

chromeAny.devtools = {
  inspectedWindow: {
    tabId: 1,
    // Panel.vue 拿 hostname：cb 收 (result, isException)
    eval: (_expr: string, cb?: (result: unknown, isException: unknown) => void) => {
      if (typeof cb === 'function') cb('harness.local', false)
    }
  },
  network: {
    onNavigated: {
      addListener: () => {},
      removeListener: () => {}
    }
  }
}

// chrome.tabs 在 chrome-extension:// 上下文下通常可用，但 sendMessage 没有真 content
// script 接听会触发 chrome.runtime.lastError = "Could not establish connection..."。
// 直接覆盖一个 mock 版让 Overview 拉数据走 seed。
chromeAny.tabs = chromeAny.tabs ?? {}
const tabsAny = chromeAny.tabs as Record<string, unknown>
// v0.7.1：Environment.vue addProject 自动填 URL + suggestPattern banner 需要 chrome.tabs.get(tabId)
// harness 真 chrome-extension:// 上下文 chrome.tabs.get(1) 不存在会 throw → mock 返合理 tab.url
tabsAny.get = async (_tabId: number) => ({ id: 1, url: 'https://harness.local/test' })
tabsAny.sendMessage = (
  _tabId: number,
  msg: { type: string },
  cb?: (response: unknown) => void
) => {
  // 异步回调贴合真实 chrome.tabs.sendMessage 行为（同步 cb 会让 Vue 的 onMounted 顺序错乱）
  queueMicrotask(() => {
    let res: unknown = { ok: true }
    switch (msg.type) {
      case 'GET_REQUESTS': res = { requests: seedRequests }; break
      case 'GET_ERRORS':   res = { errors: seedErrors };     break
      case 'CLEAR_REQUESTS': seedRequests = []; res = { ok: true }; break
      case 'CLEAR_ERRORS':   seedErrors = [];   res = { ok: true }; break
      default: res = { ok: true }
    }
    if (typeof cb === 'function') cb(res)
  })
}

// History.vue 同步状态走 safeSendMessage → chrome.runtime.sendMessage。
// 在 chrome-extension:// 页面里 runtime.sendMessage 默认发到本扩展 SW，让真 SW 处理
// REFRESH_HISTORY_STATUS / RETRY_QUEUE_FLUSH —— 这是有意保留的（题目说「sendMessage 给
// SW 走真 SW」）。所以我们**不**桩 runtime.sendMessage。

// ------------------- 应用 seed + 挂 Vue ------------------------------------------------

// active tab 的桩：Panel.vue 自己管 active state，没有外部 API；这里通过给 #app 元素
// 加 data-init-tab 属性 + 在 mount 后 click 对应 tab button 来切换（不动 Panel.vue 代码）
function initTabKey(): string {
  switch (tabParam) {
    case 'environment':
    case 'env':       return 'env'
    case 'history':   return 'history'
    case 'settings':  return 'settings'
    case 'overview':
    default:          return 'overview'
  }
}

async function bootstrap() {
  await applySeed()

  const Panel = (await import('./Panel.vue')).default
  await import('@/styles/tokens.css')

  const app = createApp(Panel)
  app.mount('#app')

  // mount 完用 click 切到目标 tab —— 比改 Panel.vue 接受 prop 风险小，
  // 而且测试也是模拟用户点击的姿势
  // v0.7.5：tab 顺序改成「概览/历史/环境/设置」（按使用频率，同事反馈），idx 不再
  // hardcode，改用 button id 查找。`id="moo-tab-${key}"` 是 Panel.vue 模板写死的稳定锚。
  const want = initTabKey()
  if (want !== 'overview') {
    requestAnimationFrame(() => {
      const btn = document.getElementById(`moo-tab-${want}`) as HTMLButtonElement | null
      btn?.click()
    })
  }
}

void bootstrap()
