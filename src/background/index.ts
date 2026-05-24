import type {
  CaptureScreenshotRes,
  IncomingMessage,
  MatchProjectRes,
  PreviewPayloadRes,
  SubmitBugReq,
  SubmitBugRes
} from '@/types/messages'
import { MSG } from '@/types/messages'
import { loadConfig, matchProjects } from '@/storage/config'
import { addHistoryEntry, listHistory, onHistoryChanged, updateHistoryEntry } from '@/storage/history'
import { renderTemplate } from '@/utils/template'
import { parseRemoteId } from '@/utils/remoteHeaders'
import { updateActionBadge } from '@/utils/badge'
import { enqueueRetry, enqueueZentaoRetry, flushRetryQueue, getQueueLength } from '@/background/retryQueue'
import {
  login as zentaoLogin,
  ping as zentaoPing,
  listProjects as zentaoListProjects,
  listUsers as zentaoListUsers,
  listModules as zentaoListModules,
  discoverProduct as zentaoDiscoverProduct,
  ensureCookieSession as zentaoEnsureCookie,
  getBug as zentaoGetBug,
  _clearZentaoCaches,
  type ZentaoEnv,
  type ZentaoBugDetail
} from '@/background/zentao/client'
import { submitToZentao } from '@/background/zentao/submit'
import { mapZentaoStatus } from '@/background/zentaoStatus'
import { dataUrlToBlob } from '@/utils/dataUrl'
import type { BugServer, MooConfig, Project } from '@/types/config'
import type { BugHistoryEntry } from '@/types/history'

/** 「测试连接」/「拉列表」只用 baseUrl+account+password，projectId/moduleId 此时
 *  还没拍板。用 0 占位让 ZentaoEnv 类型满足；这两个 endpoint 不读这两个字段。 */
function makeZentaoEnv(creds: { baseUrl: string; account: string; password: string }): ZentaoEnv {
  return { ...creds, projectId: 0, moduleId: 0 }
}

const RETRY_ALARM = 'mooRetry'

/** 当前录屏中的 tab 与开始时刻。content script 重挂时通过 QUERY_RECORDING_STATE
 *  查这个状态恢复 UI；offscreen 自动 stop 时清空并广播给原 tab。 */
let currentRecording: { tabId: number; startedAt: number } | null = null

// v0.4.5：onInstalled + onStartup 都 create 同名 alarm，chrome 行为是同名覆盖会重置计时。
// 用户首次失败入队后再过 4:59 被 onStartup 重置成 0，等于「重试周期最长能拖到 ~10min」。
// 改成 alarms.get 先判断再 create —— 已存在就 noop，避免重置。
async function ensureRetryAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(RETRY_ALARM)
  if (!existing) {
    chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 5 })
  }
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  console.log('[Moo] installed:', reason)
  void ensureRetryAlarm()
  void refreshBadge()
})

chrome.runtime.onStartup?.addListener(() => {
  void ensureRetryAlarm()
  void flushRetryQueue()
  void refreshBadge()
})

async function refreshBadge(): Promise<void> {
  try {
    await updateActionBadge(await listHistory())
  } catch {
    // history 读失败 / chrome.action 不可用——badge 不是关键路径，静默
  }
}

// History tab 里的删除 / 清空也要让 badge 同步缩水。submitBug 自己已经显式调
// refreshBadge，所以这里事件回调被自身写入触发是无害的——只是多读一次 storage
onHistoryChanged(() => { void refreshBadge() })

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) void flushRetryQueue()
})

// v0.4.8：关 window 时如果 currentRecording 是这个 window 的 tab → 尝试 best-effort 紧急停录
// （SW 可能马上被销毁，能 await 多少看运气；至少 offscreen 端 cleanup → stream tracks stop 让
// chrome UI 不卡在「正在分享」条；丢的录像数据无解，用户感知是「以为录上了实际没」）
chrome.windows?.onRemoved?.addListener(async (windowId) => {
  if (!currentRecording) return
  try {
    const tab = await chrome.tabs.get(currentRecording.tabId).catch(() => null)
    if (!tab || tab.windowId === windowId) {
      console.log('[Moo] window closed during recording, emergency stop')
      await cancelTabRecording().catch(() => {})
      currentRecording = null
    }
  } catch { /* SW 可能已被销毁 */ }
})

// SW 每次 spin-up（不止 onStartup）都立刻 flush 一次：MV3 SW 空闲 ~30s 被回收，
// 中途任何消息/alarm 唤醒都走这条路径。之前只 onStartup 主动 flush，意味着
// 用户在浏览器中途的失败 submit 要干等 alarm 周期（5min）才会重试。
;(async () => {
  try {
    const n = await getQueueLength()
    if (n > 0) {
      console.log('[Moo] SW boot: 立即 flush', n, '条重试队列')
      await flushRetryQueue()
    }
  } catch (e) {
    console.warn('[Moo] SW boot flush 失败', e)
  }
  // SW 每次 spin-up 都同步一次 badge：onStartup 只触发于浏览器启动，
  // SW 30s 闲置回收后再次唤醒时 onStartup 不会再触发，badge 状态会过期
  void refreshBadge()
  // v0.4.4：从 offscreen 恢复录屏状态（SW 内存丢但 offscreen 还在录的边缘场景）
  void rehydrateRecordingFromOffscreen()
  // v0.4.5：offscreen track-ended 时如果 SW 刚回收，sendMessage 会丢。spin-up 时读 storage flag 兜底
  void checkOffscreenAutoStoppedFlag()
})()

async function checkOffscreenAutoStoppedFlag(): Promise<void> {
  try {
    const { mooOffscreenAutoStopped } = await chrome.storage.local.get('mooOffscreenAutoStopped')
    if (!mooOffscreenAutoStopped?.at) return
    // 5 分钟内的 flag 才处理 —— 太老的可能是历史残留，避免广播过期事件
    if (Date.now() - mooOffscreenAutoStopped.at > 5 * 60_000) {
      await chrome.storage.local.remove('mooOffscreenAutoStopped')
      return
    }
    if (currentRecording) {
      console.log('[Moo] SW boot: 从 storage flag 感知到 offscreen auto-stopped，广播给 tabs')
      currentRecording = null
      await broadcastAutoStopped('chrome-ui')
    }
    await chrome.storage.local.remove('mooOffscreenAutoStopped')
  } catch (e) {
    console.warn('[Moo] checkOffscreenAutoStoppedFlag failed:', (e as Error).message)
  }
}

// 录屏入口必须由用户手势触发：chrome.commands 命中算手势，并直接把当前 tab 传进来。
// 悬浮球的 click 经 content script → message 转一道后手势就丢了，tabCapture.getMediaStreamId
// 会拒绝。所以 onCommand 内务必尽快（避免多余 await）调到 startTabRecording，让
// getMediaStreamId 在 user activation 还在的瞬间被 invoke。
chrome.commands?.onCommand.addListener((command, tab) => {
  console.log('[Moo cmd]', command, 'tab:', tab?.id, tab?.url)

  if (command === 'open-popup') {
    // chrome.action.openPopup() 在 MV3 SW 里可用（Chrome 99+），不需要 tab 上下文
    // 失败常见原因：浏览器窗口非焦点 / popup 已经打开。失败时只 log，不弹通知（噪音）
    chrome.action.openPopup().catch((err) => {
      console.warn('[Moo cmd] openPopup failed:', (err as Error).message)
    })
    return
  }

  if (command !== 'start-recording') return
  const tabId = tab?.id
  if (!tabId) {
    console.warn('[Moo cmd] 无 tabId（可能焦点不在 tab 内容上）')
    return
  }
  // 不 await：让 startTabRecording 内的 getMediaStreamId 在当前同步栈完成调用，
  // 拿到 streamId 后再把后续编排（offscreen + 通知 content）丢给 microtask。
  void startTabRecording(tabId).then(async (res) => {
    console.log('[Moo cmd] startTabRecording →', res)
    if (res.ok) currentRecording = { tabId, startedAt: Date.now() }
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: MSG.RECORD_EXTERNAL_STARTED,
        ok: res.ok,
        error: res.error
      })
    } catch (e) {
      console.warn('[Moo cmd] 通知 content script 失败：', (e as Error).message)
    }
  })
})

// 接住 devtools 面板的 keepalive 端口（仅 dev：HMR 重载扩展时面板靠它感知 disconnect 后自刷新）。
// 生产 panel.ts 已不连这个 port，这里也对称屏蔽掉，避免被外部随意 connect 撑活 SW。
if (import.meta.env.DEV) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === '__panel_keepalive__') {
      port.onDisconnect.addListener(() => {})
    }
  })
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  // 严格校验消息来源（v0.4.4 复盘加固，旧代码 `sender.id &&` 短路放过 undefined）：
  // 我们 manifest 没声明 externally_connectable，所以同扩展发的 sender.id 必须 === runtime.id。
  // 任何不匹配（含 undefined / 不同 ext id）直接拒。
  if (sender.id !== chrome.runtime.id) {
    return false
  }
  // raw 来自跨进程 IPC，TS 编译期保证不了；先做最基本 shape 校验再 narrow 为 IncomingMessage。
  if (!raw || typeof raw !== 'object' || typeof (raw as { type?: unknown }).type !== 'string') {
    return false
  }
  const message = raw as IncomingMessage
  ;(async () => {
    try {
      switch (message.type) {
        case MSG.CAPTURE_SCREENSHOT: {
          const res = await captureScreenshot(sender.tab?.windowId)
          sendResponse(res)
          break
        }
        case MSG.MATCH_PROJECT: {
          try {
            const url = message.payload?.url ?? ''
            const config = await loadConfig()
            const matches = matchProjects(config, url)
            sendResponse({ project: matches[0] ?? null, matches } satisfies MatchProjectRes)
          } catch (err) {
            // 保持 shape 一致：outer catch 默认返 {ok:false,error} 不符 MatchProjectRes 声明，
            // ContentApp 那边读 res.matches 拿到 undefined → 悬浮球默默消失没解释。
            console.warn('[Moo] MATCH_PROJECT failed:', (err as Error).message)
            sendResponse({ project: null, matches: [] } satisfies MatchProjectRes)
          }
          break
        }
        case MSG.PREVIEW_PAYLOAD: {
          const payload = message.payload
          if (!payload || !payload.server) {
            sendResponse({ ok: false, error: 'PREVIEW_PAYLOAD payload 缺 server' } satisfies PreviewPayloadRes)
            break
          }
          try {
            const rendered = renderTemplate(payload.server.payloadTemplate, payload.context ?? {})
            sendResponse({ ok: true, rendered } satisfies PreviewPayloadRes)
          } catch (e) {
            sendResponse({ ok: false, error: (e as Error).message } satisfies PreviewPayloadRes)
          }
          break
        }
        case MSG.SUBMIT_BUG: {
          const tabId = sender.tab?.id
          // payload 是 IncomingMessage 里的 required 字段，TS 已 narrow，无需 as 强转。
          // 但仍要防 caller 端漏传：runtime 一道 shape 校验。
          if (!message.payload || typeof message.payload !== 'object') {
            sendResponse({ ok: false, error: 'SUBMIT_BUG payload 缺失' } satisfies SubmitBugRes)
            break
          }
          const res = await submitBug(message.payload as SubmitBugReq, tabId)
          sendResponse(res)
          break
        }
        case MSG.REFRESH_HISTORY_STATUS: {
          const updated = await refreshHistoryStatus()
          sendResponse({ ok: true, updated })
          break
        }
        case MSG.RETRY_QUEUE_FLUSH: {
          const n = await flushRetryQueue()
          sendResponse({ ok: true, processed: n })
          break
        }
        case MSG.RECORD_START: {
          const tabId = sender.tab?.id
          const res = await startTabRecording(tabId)
          if (res.ok && tabId) currentRecording = { tabId, startedAt: Date.now() }
          sendResponse(res)
          break
        }
        case MSG.RECORD_STOP: {
          const res = await stopTabRecording()
          currentRecording = null
          // 操作发起者拿到 dataUrl 走 SubmitDialog；其它 tab 上的远程 rec-bar
          // 必须被通知退掉，否则会卡在 recording 倒计时永远不动。
          await broadcastAutoStopped('user-stop', sender.tab?.id)
          sendResponse(res)
          break
        }
        case MSG.RECORD_CANCEL: {
          await cancelTabRecording()
          currentRecording = null
          await broadcastAutoStopped('user-cancel', sender.tab?.id)
          sendResponse({ ok: true })
          break
        }
        case MSG.QUERY_RECORDING_STATE: {
          // content script 挂载（任意 tab）查全局录屏状态；命中就回 startedAt
          // 让 ContentApp 在本 tab 拉起 rec-bar 走外挂倒计时。曾绑死 sender tab
          // 等于"只有原录屏 tab 自己 reload 才能恢复"，切到其它 tab 看不到
          // 任何录屏指示——按 #97 用户反馈改为全局可见。
          sendResponse(currentRecording
            ? { recording: true, startedAt: currentRecording.startedAt }
            : { recording: false })
          break
        }
        case MSG.OFFSCREEN_AUTO_STOPPED: {
          // offscreen 报告 track 'ended'（最常见：用户点了 Chrome 顶部"停止共享"
          // 条）。广播给所有 tab —— 任意 tab 都可能挂着远程 rec-bar，要一起退。
          if (currentRecording) {
            currentRecording = null
            await broadcastAutoStopped('chrome-ui')
          }
          sendResponse({ ok: true })
          break
        }
        case MSG.ZENTAO_TEST_CONNECTION: {
          const { baseUrl, account, password } = message.payload
          const loginRes = await zentaoLogin(baseUrl, account, password)
          if (!loginRes.ok) { sendResponse({ ok: false, error: loginRes.error }); break }
          const env = makeZentaoEnv(message.payload)
          const ping = await zentaoPing(env)
          if (!ping.ok) { sendResponse({ ok: false, error: ping.error }); break }
          sendResponse({ ok: true, realname: ping.data.realname, account: ping.data.account })
          break
        }
        case MSG.ZENTAO_LIST_PROJECTS: {
          const { baseUrl, account, password } = message.payload
          const loginRes = await zentaoLogin(baseUrl, account, password)
          if (!loginRes.ok) { sendResponse({ ok: false, error: loginRes.error }); break }
          const env = makeZentaoEnv(message.payload)
          const list = await zentaoListProjects(env)
          if (!list.ok) { sendResponse({ ok: false, error: list.error }); break }
          sendResponse({ ok: true, projects: list.data.map(p => ({ id: p.id, name: p.name, status: p.status })) })
          break
        }
        case MSG.ZENTAO_LIST_USERS: {
          const { baseUrl, account, password } = message.payload
          const loginRes = await zentaoLogin(baseUrl, account, password)
          if (!loginRes.ok) { sendResponse({ ok: false, error: loginRes.error }); break }
          const env = makeZentaoEnv(message.payload)
          const list = await zentaoListUsers(env)
          if (!list.ok) { sendResponse({ ok: false, error: list.error }); break }
          sendResponse({ ok: true, users: list.data })
          break
        }
        case MSG.ZENTAO_LIST_MODULES: {
          const { baseUrl, account, password, projectId } = message.payload
          if (!projectId) { sendResponse({ ok: false, error: 'projectId 必填' }); break }
          const loginRes = await zentaoLogin(baseUrl, account, password)
          if (!loginRes.ok) { sendResponse({ ok: false, error: loginRes.error }); break }
          // 先 discoverProduct 拿 productId，再 listModules
          const env: ZentaoEnv = { baseUrl, account, password, projectId, moduleId: 0 }
          const prod = await zentaoDiscoverProduct(env)
          if (!prod.ok) { sendResponse({ ok: false, error: prod.error }); break }
          const modules = await zentaoListModules(env, prod.data)
          if (!modules.ok) { sendResponse({ ok: false, error: modules.error }); break }
          sendResponse({ ok: true, modules: modules.data })
          break
        }
        case MSG.ZENTAO_PING_COOKIE: {
          // v0.2.3 改：payload 含账号密码 → 调 ensureCookieSession 自动登录（cookie 没在
          // 就用账号密码 login 同时拿 token+写 cookie）。用户不再需要手动登录禅道。
          const env = makeZentaoEnv(message.payload)
          const ensured = await zentaoEnsureCookie(env)
          if (ensured.ok) sendResponse({ ok: true, realname: ensured.data.realname })
          else sendResponse({ ok: false, error: ensured.error })
          break
        }
        case MSG.ZENTAO_CLEAR_CACHE: {
          // v0.4.7：Environment 改密码/账号/baseUrl/projectId 后必发，防 envKey 不变导致老 token 复用
          _clearZentaoCaches()
          sendResponse({ ok: true })
          break
        }
        default: {
          // 编译期 narrow：如果 IncomingMessage 里漏了某个 case，下面的 `never`
          // 赋值会 TS 错误。这是 discriminated union 的关键保护点。
          const _exhaustive: never = message
          sendResponse({ ok: false, error: `unknown message type` })
          void _exhaustive
        }
      }
    } catch (err) {
      sendResponse({ ok: false, error: (err as Error).message })
    }
  })()
  return true
})

/**
 * 把"录屏已结束"广播给所有 tab 的 content script。
 * - excludeTabId：通常是触发 STOP/CANCEL 的 sender tab，那个 tab 走 sendResponse
 *   拿 dataUrl + SubmitDialog，不该再收到 AUTO_STOPPED（否则 useRecorder
 *   externallyStopped 会抢先 resolve 成 null，SubmitDialog 永远拿不到视频）。
 * - chrome.tabs.sendMessage 对没注入 content script 的 tab（chrome:// / 应用
 *   商店 / pdf viewer）会 reject，catch 兜住即可。
 */
async function broadcastAutoStopped(reason: string, excludeTabId?: number): Promise<void> {
  let tabs: chrome.tabs.Tab[] = []
  try {
    tabs = await chrome.tabs.query({})
  } catch {
    return
  }
  await Promise.all(tabs.map(async (t) => {
    if (!t.id || t.id === excludeTabId) return
    try {
      await chrome.tabs.sendMessage(t.id, { type: MSG.RECORD_AUTO_STOPPED, reason })
    } catch {
      // tab 不接消息（无 content script / 已关）—— 静默
      // v0.4.5：80+ tabs 时 chrome 会把 reject 同时设到全局 lastError 里，必须显式 read
      // 否则扩展错误页刷一堆「unchecked runtime.lastError」噪音
      void chrome.runtime.lastError
    }
  }))
}

async function captureScreenshot(windowId?: number): Promise<CaptureScreenshotRes> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(
      windowId ?? chrome.windows.WINDOW_ID_CURRENT,
      { format: 'png' }
    )
    return { ok: true, dataUrl }
  } catch (err) {
    // v0.4.5：Promise 版的 captureVisibleTab 失败时 reject Error，理论上不会留 lastError。
    // 但 chrome 109-115 实现历史上有版本两条都设，防御性 read 一下避免 unchecked 警告
    void chrome.runtime.lastError
    return { ok: false, error: (err as Error).message }
  }
}

async function submitBug(req: SubmitBugReq, tabId?: number): Promise<SubmitBugRes> {
  const config = await loadConfig()
  const project = config.projects.find((p) => p.id === req.projectId)
  if (!project) {
    const err = '找不到对应项目（可能项目刚被删除）。请回到 DevTools → Moo → 环境 重新选择'
    await writeFailureHistory(req, undefined, undefined, err)
    return { ok: false, error: err }
  }

  // v0.2.0：kind='zentao' 走专用分支，避开 webhook 的 server/endpoint 校验。
  // 提交链路全在 zentao/submit.ts 里 orchestration，本函数仅负责 history + badge。
  if (project.kind === 'zentao') {
    return await submitBugViaZentao(req, project)
  }

  const server = project.servers.find((s) => s.id === req.serverId)
  if (!server) {
    const err = '找不到选中的上报服务器（可能刚被删除）。请回到 DevTools → Moo → 环境 重新选择'
    await writeFailureHistory(req, project, undefined, err)
    return { ok: false, error: err }
  }
  if (!server.endpoint) {
    const err = `上报服务器「${server.name}」还没填请求 URL。请去 DevTools → Moo → 环境 → 上报服务器，在「请求 URL」那一行填上后端地址后再试`
    await writeFailureHistory(req, project, server, err)
    return { ok: false, error: err }
  }

  // 按项目白名单抓取页面 storage（localStorage 优先，找不到尝试 sessionStorage）
  const storageKeys = project.capture?.storageKeys ?? []
  const storage = storageKeys.length > 0 ? await readPageStorage(tabId, storageKeys) : {}

  const ctx: Record<string, unknown> = {
    title: req.title,
    description: req.description,
    image: req.image,
    url: req.url,
    userAgent: req.userAgent,
    viewport: req.viewport,
    timestamp: req.timestamp,
    requests: req.requests,
    errors: req.errors,
    elements: req.elements ?? [],
    storage,
    video: req.video ? req.video.dataUrl : '',
    videoBytes: req.video?.bytes ?? 0,
    videoDuration: req.video?.duration ?? 0,
    // 让模板可以用 {{token}} 把项目 token 写进 body。
    // 后端只读 body 字段做鉴权时（不走 Authorization header）必须有这个。
    token: project.token ?? ''
  }

  const { body, headers } = buildRequestBody(server, ctx)
  const safeHeaders = sanitizeHeaders(headers)
  let result: SubmitBugRes
  let remoteId: string | undefined
  try {
    const resp = await fetch(server.endpoint, { method: server.method, headers: safeHeaders, body })
    const text = await resp.text()
    remoteId = parseRemoteId(text)
    if (!resp.ok) {
      // 只 log header 名字不打 value：用户配的 server.headers 可能含敏感字段
      // （token 已经在 body 里，但有人会额外手配 Authorization 等），SW console
      // 落盘后任何能读 chrome://extensions 日志的进程都能拿到。
      // v0.4.8：bodyPreview 缩短到 200 + 显式 ⚠ 警告（服务端响应可能回显用户提交内容含 token / 截图 base64，
      // SW console 落盘后 chrome://extensions 错误页能看，敏感数据扩散）
      console.warn('[Moo submit-fail] ⚠ bodyPreview 可能含 token / 截图 base64 等敏感数据', {
        endpoint: server.endpoint,
        finalUrl: resp.url,
        status: resp.status,
        statusText: resp.statusText,
        bodyPreview: text.slice(0, 200),
        headerNames: Object.keys(safeHeaders)
      })
    }
    result = { ok: resp.ok, status: resp.status, body: text, remoteId }
    if (!resp.ok && resp.status >= 500) {
      // 5xx → 尝试进重试队列；超 1MB（带视频）或 multipart 都不入队
      // 必须按 enqueue 真实结果设 queued，否则 toast 撒谎"已加入重试"
      result.queued = await enqueueRetry(server.endpoint, server.method, headers, body)
    } else if (!resp.ok) {
      // v0.4.7：4xx 显式 queued = false，让 toast 告诉用户「这种失败不会自动重试」
      result.queued = false
    }
  } catch (err) {
    // 网络错误 → 同上
    result = { ok: false, error: (err as Error).message }
    result.queued = await enqueueRetry(server.endpoint, server.method, headers, body)
  }

  const entry: BugHistoryEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    projectId: project.id,
    projectName: project.name,
    serverId: server.id,
    serverName: server.name,
    title: req.title,
    description: req.description,
    image: req.image,
    hasVideo: !!req.video,
    videoDuration: req.video?.duration ?? 0,
    url: req.url,
    userAgent: req.userAgent,
    viewport: req.viewport,
    requests: req.requests,
    errors: req.errors,
    result,
    remoteId,
    remoteBase: deriveRemoteBase(server.endpoint)
  }
  try {
    const writeRes = await addHistoryEntry(entry)
    if (writeRes.allDropped) {
      // storage 整体异常 —— 连本次新条都没存到本地。UI 必须告诉用户「服务端已收到
      // 但本地没记录」，否则下次去 History tab 找不到这条提交还以为是 bug。
      result.historyAllDropped = true
    } else if (writeRes.trimmed > 0) {
      // 旧历史被丢了 trimmed 条，新条已落地。UI 提示用户去清空一些项目腾空间。
      result.trimmedHistory = writeRes.trimmed
    }
  } catch (e) {
    console.warn('[Moo] failed to save history', e)
  }

  // 提交成功/失败都刷一次 badge：成功条让 24h 内的失败计数不动，但读 history
  // 也顺手处理掉「老 entry 超出 24h 窗口要从 badge 里减掉」的衰减
  void refreshBadge()

  return result
}

/**
 * project/server 缺失或 endpoint 没填时仍然把"本次尝试"落到 history，方便用户
 * 在 History tab 看到失败记录、决定要不要去环境 tab 修配置后重发。
 * 不然会出现"我刚提交了一条 bug 怎么 History 里完全没痕迹"的体验黑洞。
 */
async function writeFailureHistory(
  req: SubmitBugReq,
  project: Project | undefined,
  server: BugServer | undefined,
  errorMsg: string
): Promise<void> {
  const entry: BugHistoryEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    projectId: req.projectId,
    projectName: project?.name ?? '(项目已被删除)',
    serverId: req.serverId,
    serverName: server?.name ?? '(服务器已被删除)',
    title: req.title,
    description: req.description,
    image: req.image,
    hasVideo: !!req.video,
    videoDuration: req.video?.duration ?? 0,
    url: req.url,
    userAgent: req.userAgent,
    viewport: req.viewport,
    requests: req.requests,
    errors: req.errors,
    result: { ok: false, error: errorMsg },
    remoteBase: server?.endpoint ? deriveRemoteBase(server.endpoint) : undefined
  }
  try {
    await addHistoryEntry(entry)
  } catch (e) {
    console.warn('[Moo] writeFailureHistory failed', (e as Error).message)
  }
  void refreshBadge()
}

// ============================================================
// 屏幕录制（通过 offscreen document 走 tabCapture）
// ============================================================

const OFFSCREEN_URL = 'src/offscreen/index.html'

async function ensureOffscreenDocument(): Promise<void> {
  const hasApi = !!(chrome as any).offscreen
  if (!hasApi) throw new Error('当前 Chrome 版本不支持 offscreen documents（需要 109+）')

  let exists = false
  try {
    const getCtx = (chrome.runtime as any).getContexts
    if (typeof getCtx === 'function') {
      const contexts = await getCtx({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
      exists = Array.isArray(contexts) && contexts.length > 0
    }
  } catch {
    // ignore
  }
  if (exists) return

  await (chrome as any).offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: '录制当前标签页画面以附在 bug 提交中'
  })
}

async function closeOffscreenDocument(): Promise<void> {
  try {
    await (chrome as any).offscreen.closeDocument()
  } catch {
    // ignore
  }
}

async function startTabRecording(tabId?: number): Promise<{ ok: boolean; error?: string }> {
  if (!tabId) return { ok: false, error: '没找到要录的标签页。请确保焦点在网页上（不要在 DevTools 内）再按 ⌥⇧R' }

  // tabCapture 是 optional_permission，用户需要先在 popup 主动启用。这里同步检查，
  // 没授权直接返回引导文案 —— 不能在录屏入口 chrome.permissions.request：
  // request 是异步弹窗，await 后 user activation 已失效，getMediaStreamId 必崩。
  const hasPerm = await chrome.permissions.contains({ permissions: ['tabCapture'] })
  if (!hasPerm) {
    return { ok: false, error: '录屏功能尚未启用。请点击浏览器右上角的 Moo 图标 → 启用录屏后再试' }
  }

  // 关键：getMediaStreamId 必须在 user activation 还有效时立即 invoke。
  // 任何 await（包括 ensureOffscreenDocument）放在它前面，都会让手势在 microtask 后丢失。
  let streamId: string
  try {
    streamId = await new Promise<string>((resolve, reject) => {
      ;(chrome.tabCapture as any).getMediaStreamId({ targetTabId: tabId }, (id: string) => {
        const err = chrome.runtime.lastError
        if (err || !id) reject(new Error(err?.message || '获取屏幕流失败'))
        else resolve(id)
      })
    })
  } catch (e) {
    return { ok: false, error: '浏览器拒绝了录屏请求：' + (e as Error).message + '。建议直接按 ⌥⇧R（不要通过点击悬浮球），否则用户手势会失效' }
  }

  try {
    await ensureOffscreenDocument()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  // v0.4.4：tabId 一并传给 offscreen，SW 30s 闲置回收后能从 QUERY_STATE 拿回原录屏 tab
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'START', streamId, tabId })
  if (!res?.ok) {
    await closeOffscreenDocument()
    return { ok: false, error: res?.error || '录屏后台进程启动失败，请稍后重试' }
  }
  return { ok: true }
}

/**
 * v0.4.4：SW spin-up 时查 offscreen 真实录屏状态。
 *
 * 为什么需要：SW 闲置 30s 被回收 → 内存 currentRecording 丢；offscreen document 自带
 * keep-alive 仍在录。新 SW 唤醒后调 QUERY_RECORDING_STATE 会假返 {recording:false}，
 * 用户在新 tab 看不到 rec-bar，再按 ⌥⇧R 也撞 offscreen state !== 'idle' 拒绝。
 *
 * 修法：spin-up 时调 getContexts 看 offscreen 是否还活着，活着就发 QUERY_STATE 拿
 * { state, meta: { tabId, startedAt } } 回填 currentRecording。
 */
async function rehydrateRecordingFromOffscreen(): Promise<void> {
  try {
    const getCtx = (chrome.runtime as any).getContexts
    if (typeof getCtx !== 'function') return
    const contexts = await getCtx({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
    if (!Array.isArray(contexts) || contexts.length === 0) return
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'QUERY_STATE' })
    if (!res || typeof res !== 'object') return
    const { state, meta } = res as { state?: string; meta?: { tabId?: number; startedAt?: number } | null }
    if ((state === 'recording' || state === 'starting') && meta && meta.startedAt) {
      currentRecording = {
        tabId: meta.tabId ?? -1,  // 没传 tabId 时占位（不影响 QUERY_RECORDING_STATE 回 {recording:true}）
        startedAt: meta.startedAt
      }
      console.log('[Moo] SW boot: 从 offscreen 恢复 currentRecording', currentRecording)
    }
  } catch (e) {
    console.warn('[Moo] rehydrateRecordingFromOffscreen failed:', (e as Error).message)
  }
}

async function stopTabRecording(): Promise<{ ok: boolean; dataUrl?: string; bytes?: number; mime?: string; error?: string }> {
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP' })
  await closeOffscreenDocument()
  return res ?? { ok: false, error: '录屏后台没响应，可能已经被浏览器卸载。请重新开始录制' }
}

async function cancelTabRecording(): Promise<void> {
  try { await chrome.runtime.sendMessage({ target: 'offscreen', type: 'CANCEL' }) } catch { /* ignore */ }
  await closeOffscreenDocument()
}

// ============================================================
// 页面 storage 白名单快照
// ============================================================

/**
 * 从目标 tab 的页面读取一组 storage key。
 * 优先 localStorage；找不到再试 sessionStorage；都没有则记 null。
 *
 * 返回每个 key 对应的 { value, source }，便于服务端区分。
 */
async function readPageStorage(
  tabId: number | undefined,
  keys: string[]
): Promise<Record<string, { value: string | null; source: 'localStorage' | 'sessionStorage' | 'missing' }>> {
  if (!tabId || keys.length === 0) return {}
  try {
    // executeScript 返回 InjectionResult[]，frame 数为 0 时数组空 —— noUncheckedIndexedAccess
    // 把 [0] 标 possibly-undefined。tab 进程崩溃 / 页面已 unload 时确实会 0 长度，
    // 防一道返空 storage 比 throw 给上游友好得多。
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (ks: string[]) => {
        const out: Record<string, { value: string | null; source: 'localStorage' | 'sessionStorage' | 'missing' }> = {}
        for (const k of ks) {
          let v: string | null = null
          let src: 'localStorage' | 'sessionStorage' | 'missing' = 'missing'
          try {
            v = localStorage.getItem(k)
            if (v !== null) src = 'localStorage'
          } catch {
            /* 安全异常忽略 */
          }
          if (v === null) {
            try {
              v = sessionStorage.getItem(k)
              if (v !== null) src = 'sessionStorage'
            } catch {
              /* ignore */
            }
          }
          out[k] = { value: v, source: src }
        }
        return out
      },
      args: [keys]
    })
    const result = results[0]?.result
    return (result as Record<string, { value: string | null; source: 'localStorage' | 'sessionStorage' | 'missing' }>) ?? {}
  } catch (e) {
    console.warn('[Moo] readPageStorage failed', e)
    return {}
  }
}

// HTTP header 值只允许 ISO-8859-1（基本就是 ASCII），中文/emoji 必须 percent-encode；
// 服务端拿到后 decodeURIComponent 即可还原。
// 顺便拦 CRLF：HTTP header injection 的经典攻击载体（`X-Foo: bar\r\nAuthorization: Bearer evil`）。
// 浏览器层 fetch 大多数情况下会自己拒掉，但代码层主动 scrub 给出明确错误更清晰。
function sanitizeHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(h)) {
    if (/[\r\n]/.test(v)) {
      // 不静默修复——header injection 是严重信号，直接拒（fetch 也会拒）
      console.warn('[Moo] dropped header with CRLF:', k)
      continue
    }
    out[k] = /[^\x20-\x7E]/.test(v) ? encodeURIComponent(v) : v
  }
  return out
}

// ============================================================
// 状态回查
// ============================================================

async function refreshHistoryStatus(): Promise<number> {
  const list = await listHistory()
  const config = await loadConfig()
  let updated = 0
  for (const entry of list) {
    if (!entry.remoteId) continue
    const project = config.projects.find((p) => p.id === entry.projectId)
    try {
      let newStatus: BugHistoryEntry['remoteStatus'] | undefined
      // v0.3：禅道路径走 v1/bugs/{id} 详情，按 status 字段映射
      if (project?.kind === 'zentao' && project.zentao?.baseUrl) {
        newStatus = await fetchZentaoBugStatus(project, entry.remoteId)
      } else if (entry.remoteBase) {
        // 老 webhook 路径：POST {remoteBase}/{id}/status-public 走 body.token 鉴权
        newStatus = await fetchWebhookBugStatus(entry, project)
      }
      if (newStatus && newStatus !== entry.remoteStatus) {
        entry.remoteStatus = newStatus
        entry.remoteStatusUpdatedAt = new Date().toISOString()
        await updateHistoryEntry(entry.id, entry)
        updated++
      }
    } catch {
      // ignore single failure；继续下一条
    }
  }
  return updated
}

async function fetchZentaoBugStatus(project: Project, remoteId: string): Promise<BugHistoryEntry['remoteStatus']> {
  const z = project.zentao
  if (!z?.baseUrl || !z.account || !z.password) return undefined
  const bugId = Number(remoteId)
  if (!Number.isFinite(bugId) || bugId <= 0) return undefined
  const env: ZentaoEnv = {
    baseUrl: z.baseUrl, account: z.account, password: z.password,
    projectId: z.projectId, moduleId: z.moduleId
  }
  const r = await zentaoGetBug(env, bugId)
  if (!r.ok) return undefined
  return mapZentaoStatus(r.data)
}

async function fetchWebhookBugStatus(entry: BugHistoryEntry, project: Project | undefined): Promise<BugHistoryEntry['remoteStatus']> {
  if (!entry.remoteBase) return undefined
  const token = project?.token?.trim() ?? ''
  const url = `${entry.remoteBase}/${entry.remoteId}/status-public`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  })
  if (!resp.ok) return undefined
  const data = await resp.json() as { ok?: boolean; status?: BugHistoryEntry['remoteStatus'] }
  return (data && data.ok && data.status) || undefined
}

function deriveRemoteBase(endpoint: string): string {
  // 'http://host/scaffold/todos/intake' → 'http://host/scaffold/todos'
  return endpoint.replace(/\/intake\/?$/, '')
}

function buildRequestBody(
  server: BugServer,
  ctx: Record<string, unknown>
): { body: BodyInit; headers: Record<string, string> } {
  const rendered = renderTemplate(server.payloadTemplate, ctx)
  if (server.imageFormat === 'multipart') {
    const form = new FormData()
    try {
      const obj = JSON.parse(rendered) as Record<string, unknown>
      for (const [k, v] of Object.entries(obj)) {
        if (k === server.imageField) continue
        form.append(k, typeof v === 'string' ? v : JSON.stringify(v))
      }
    } catch {
      form.append('payload', rendered)
    }
    form.append(server.imageField, dataUrlToBlob(String(ctx.image)), 'screenshot.png')
    const headers = { ...server.headers }
    delete headers['Content-Type']
    delete headers['content-type']
    return { body: form, headers }
  }
  return { body: rendered, headers: { ...server.headers } }
}

/**
 * v0.2.0 禅道路径：调 zentao/submit.ts → 写 history → 刷 badge。
 * 与 webhook 路径并行，不复用 server 校验那段（zentao 没 server 概念）。
 */
async function submitBugViaZentao(req: SubmitBugReq, project: Project): Promise<SubmitBugRes> {
  const res = await submitToZentao(req, project, dataUrlToBlob, { mooVersion: chrome.runtime?.getManifest?.()?.version })

  // 失败入队（仅网络 / server 抽风类失败；认证 / 配置缺失这种重试也救不了的 error 由 retryQueue
  // 内部的 retryZentao 走 drop 路径，不重试）。estimateZentaoSize 内做 1MB 上限校验，
  // 带 video 的请求几乎肯定超 → 直接 false，跟 webhook multipart 不入队保持一致行为。
  if (!res.ok) {
    res.queued = await enqueueZentaoRetry(project.id, req)
  }

  // history 字段：zentao 没 server 概念，serverId / serverName 用占位串
  // 保持 BugHistoryEntry schema 不变（v0.1.x 历史读取不破）
  const entry: BugHistoryEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    projectId: project.id,
    projectName: project.name,
    serverId: 'zentao',
    serverName: `禅道（${project.zentao?.baseUrl ?? ''}）`,
    title: req.title,
    description: req.description,
    image: req.image,
    hasVideo: !!req.video,
    videoDuration: req.video?.duration ?? 0,
    url: req.url,
    userAgent: req.userAgent,
    viewport: req.viewport,
    requests: req.requests,
    errors: req.errors,
    result: res.ok
      ? { ok: true, status: 200, body: res.viewUrl ?? '' }
      : { ok: false, error: res.error },
    remoteId: res.remoteId,
    remoteBase: project.zentao?.baseUrl
  }
  try {
    const writeRes = await addHistoryEntry(entry)
    if (writeRes.allDropped) res.historyAllDropped = true
    else if (writeRes.trimmed > 0) res.trimmedHistory = writeRes.trimmed
  } catch (e) {
    console.warn('[Moo] failed to save zentao history', e)
  }
  void refreshBadge()
  return res
}

// dataUrlToBlob 已抽到 @/utils/dataUrl —— retryQueue flush + zentao submit 都要用
