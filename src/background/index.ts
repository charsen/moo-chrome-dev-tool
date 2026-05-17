import type {
  CaptureScreenshotRes,
  MatchProjectReq,
  MatchProjectRes,
  MooMessage,
  PreviewPayloadReq,
  PreviewPayloadRes,
  SubmitBugReq,
  SubmitBugRes
} from '@/types/messages'
import { MSG } from '@/types/messages'
import { loadConfig, matchProjects } from '@/storage/config'
import { addHistoryEntry, listHistory, updateHistoryEntry } from '@/storage/history'
import { renderTemplate } from '@/utils/template'
import type { BugServer, MooConfig, Project } from '@/types/config'
import type { BugHistoryEntry } from '@/types/history'

const RETRY_QUEUE_KEY = 'mooRetryQueue'
const RETRY_ALARM = 'mooRetry'

chrome.runtime.onInstalled.addListener(({ reason }) => {
  console.log('[Moo] installed:', reason)
  chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 5 })
})

chrome.runtime.onStartup?.addListener(() => {
  chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 5 })
  void flushRetryQueue()
})

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) void flushRetryQueue()
})

// SW 每次 spin-up（不止 onStartup）都立刻 flush 一次：MV3 SW 空闲 ~30s 被回收，
// 中途任何消息/alarm 唤醒都走这条路径。之前只 onStartup 主动 flush，意味着
// 用户在浏览器中途的失败 submit 要干等 alarm 周期（5min）才会重试。
;(async () => {
  try {
    const r = await chrome.storage.local.get(RETRY_QUEUE_KEY)
    const list = (r[RETRY_QUEUE_KEY] as QueuedRequest[]) ?? []
    if (list.length > 0) {
      console.log('[Moo] SW boot: 立即 flush', list.length, '条重试队列')
      await flushRetryQueue()
    }
  } catch (e) {
    console.warn('[Moo] SW boot flush 失败', e)
  }
})()

// 录屏入口必须由用户手势触发：chrome.commands 命中算手势，并直接把当前 tab 传进来。
// 悬浮球的 click 经 content script → message 转一道后手势就丢了，tabCapture.getMediaStreamId
// 会拒绝。所以 onCommand 内务必尽快（避免多余 await）调到 startTabRecording，让
// getMediaStreamId 在 user activation 还在的瞬间被 invoke。
chrome.commands?.onCommand.addListener((command, tab) => {
  console.log('[Moo cmd]', command, 'tab:', tab?.id, tab?.url)
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

chrome.runtime.onMessage.addListener((message: MooMessage, sender, sendResponse) => {
  // 校验消息来源：MV3 默认只接受同扩展，但 sender.id 为 undefined 时（极少数边缘情况）
  // 依然要拒。外部扩展 / 网站要发我们的消息必须显式声明 externally_connectable，
  // 而我们 manifest 没声明 —— 所以任何 sender.id !== runtime.id 一律视为非法。
  if (sender.id && sender.id !== chrome.runtime.id) {
    return false
  }
  ;(async () => {
    try {
      switch (message.type) {
        case MSG.CAPTURE_SCREENSHOT: {
          const res = await captureScreenshot(sender.tab?.windowId)
          sendResponse(res)
          break
        }
        case MSG.MATCH_PROJECT: {
          const { url } = (message.payload as MatchProjectReq) ?? { url: '' }
          const config = await loadConfig()
          const matches = matchProjects(config, url)
          sendResponse({ project: matches[0] ?? null, matches } satisfies MatchProjectRes)
          break
        }
        case MSG.PREVIEW_PAYLOAD: {
          const { server, context } = message.payload as PreviewPayloadReq
          const rendered = renderTemplate(server.payloadTemplate, context)
          sendResponse({ rendered } satisfies PreviewPayloadRes)
          break
        }
        case MSG.SUBMIT_BUG: {
          const tabId = sender.tab?.id
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
          sendResponse(res)
          break
        }
        case MSG.RECORD_STOP: {
          const res = await stopTabRecording()
          sendResponse(res)
          break
        }
        case MSG.RECORD_CANCEL: {
          await cancelTabRecording()
          sendResponse({ ok: true })
          break
        }
        default:
          sendResponse({ ok: false, error: `unknown message type: ${message.type}` })
      }
    } catch (err) {
      sendResponse({ ok: false, error: (err as Error).message })
    }
  })()
  return true
})

async function captureScreenshot(windowId?: number): Promise<CaptureScreenshotRes> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(
      windowId ?? chrome.windows.WINDOW_ID_CURRENT,
      { format: 'png' }
    )
    return { ok: true, dataUrl }
  } catch (err) {
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
    videoDuration: req.video?.duration ?? 0
  }

  const { body, headers } = buildRequestBody(server, ctx, project)
  const safeHeaders = sanitizeHeaders(headers)
  let result: SubmitBugRes
  let remoteId: string | undefined
  try {
    const resp = await fetch(server.endpoint, { method: server.method, headers: safeHeaders, body })
    const text = await resp.text()
    remoteId = parseRemoteId(text)
    if (!resp.ok) {
      // 注意：不能直接打 sentHeaders —— 里面含 Authorization: Bearer <token> 等
      // 敏感字段，落到 SW console 后任何能读 chrome://extensions 日志的进程
      // （或本扩展自身的录屏功能）都能偷走。只 log header **名字**便于确认
      // 是否真带上了 Authorization，需要 value 时去 DevTools Network 面板看。
      console.warn('[Moo submit-fail]', {
        endpoint: server.endpoint,
        finalUrl: resp.url,
        status: resp.status,
        statusText: resp.statusText,
        bodyPreview: text.slice(0, 400),
        headerNames: Object.keys(safeHeaders)
      })
    }
    result = { ok: resp.ok, status: resp.status, body: text, remoteId }
    if (!resp.ok && resp.status >= 500) {
      // 5xx → 尝试进重试队列；超 1MB（带视频）或 multipart 都不入队
      // 必须按 enqueue 真实结果设 queued，否则 toast 撒谎"已加入重试"
      result.queued = await enqueueRetry(req, server.endpoint, server.method, headers, body)
    }
  } catch (err) {
    // 网络错误 → 同上
    result = { ok: false, error: (err as Error).message }
    result.queued = await enqueueRetry(req, server.endpoint, server.method, headers, body)
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
    remoteBase: deriveRemoteBase(server.endpoint),
    remoteHeaders: pickPropagatedHeaders(applyAuthHeaders(project, { ...server.headers }))
  }
  try {
    const writeRes = await addHistoryEntry(entry)
    if (writeRes.trimmed > 0) {
      // storage quota 满，旧历史被丢了 trimmed 条。把信息透传给前端 toast 提示用户，
      // 不能再让它静默丢
      result.trimmedHistory = writeRes.trimmed
    }
  } catch (e) {
    console.warn('[Moo] failed to save history', e)
  }

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
    remoteBase: server?.endpoint ? deriveRemoteBase(server.endpoint) : undefined,
    remoteHeaders: server && project
      ? pickPropagatedHeaders(applyAuthHeaders(project, { ...(server.headers ?? {}) }))
      : undefined
  }
  try {
    await addHistoryEntry(entry)
  } catch (e) {
    console.warn('[Moo] writeFailureHistory failed', (e as Error).message)
  }
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

  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'START', streamId })
  if (!res?.ok) {
    await closeOffscreenDocument()
    return { ok: false, error: res?.error || '录屏后台进程启动失败，请稍后重试' }
  }
  return { ok: true }
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
    const [{ result }] = await chrome.scripting.executeScript({
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
    return (result as Record<string, { value: string | null; source: 'localStorage' | 'sessionStorage' | 'missing' }>) ?? {}
  } catch (e) {
    console.warn('[Moo] readPageStorage failed', e)
    return {}
  }
}

// ============================================================
// 上报 token
// ============================================================

/**
 * 把项目级 token 注入到 header：
 *   Authorization: Bearer {token}
 *   X-Scaffold-Token: {token}
 * 服务端 AccountStore 命中后会自动用账号 username 作为提交人。
 */
function applyAuthHeaders(project: Project, headers: Record<string, string>): Record<string, string> {
  const token = project.token?.trim()
  if (!token) return headers
  const out = { ...headers }
  // case-insensitive 检查：之前只看 `Authorization` / `authorization` 两种，
  // 攻击者导入配置时用 `AUTHORIZATION` 全大写就能绕过、保留预置的恶意 token。
  // 必须把 key 全 toLowerCase 后比较。
  const lowerKeys = new Set(Object.keys(out).map((k) => k.toLowerCase()))
  if (!lowerKeys.has('authorization')) {
    out['Authorization'] = `Bearer ${token}`
  }
  if (!lowerKeys.has('x-scaffold-token')) {
    out['X-Scaffold-Token'] = token
  }
  return out
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
// 重试队列
// ============================================================

interface QueuedRequest {
  enqueuedAt: number
  attempts: number
  endpoint: string
  method: string
  headers: Record<string, string>
  /** 只支持 JSON 字符串体重试。multipart 含二进制图片不易序列化，故不入队。 */
  bodyString: string
}

/** 单条 body 上限 1MB —— chrome.storage.local 全键合计 10MB，
 *  视频 base64 dataURL 单条就能 17MB+，整个队列直接爆配额。
 *  超限的 payload 自然不进队列，避免 set() 抛 QUOTA_BYTES 让整次提交失败。 */
const RETRY_MAX_BODY_BYTES = 1_000_000

/** @returns 是否真的入队（用于 caller 决定 toast 文案要不要提"已加入重试") */
async function enqueueRetry(
  _req: SubmitBugReq,
  endpoint: string,
  method: string,
  headers: Record<string, string>,
  body: BodyInit
): Promise<boolean> {
  if (typeof body !== 'string') return false // multipart 不重试
  if (body.length > RETRY_MAX_BODY_BYTES) return false // 太大不入队
  const queued: QueuedRequest = {
    enqueuedAt: Date.now(),
    attempts: 0,
    endpoint,
    method,
    headers,
    bodyString: body
  }
  try {
    const r = await chrome.storage.local.get(RETRY_QUEUE_KEY)
    const list = (r[RETRY_QUEUE_KEY] as QueuedRequest[]) ?? []
    list.push(queued)
    while (list.length > 50) list.shift()
    // 整体仍可能因为多条累计超配额而抛错
    await chrome.storage.local.set({ [RETRY_QUEUE_KEY]: list })
    return true
  } catch (e) {
    console.warn('[Moo] enqueueRetry storage set failed', (e as Error).message)
    return false
  }
}

async function flushRetryQueue(): Promise<number> {
  const r = await chrome.storage.local.get(RETRY_QUEUE_KEY)
  const list = (r[RETRY_QUEUE_KEY] as QueuedRequest[]) ?? []
  if (list.length === 0) return 0
  const remaining: QueuedRequest[] = []
  let processed = 0
  for (const q of list) {
    if (q.attempts >= 5) continue // 放弃
    try {
      const resp = await fetch(q.endpoint, {
        method: q.method,
        headers: q.headers,
        body: q.bodyString
      })
      if (resp.ok) {
        processed++
        continue
      }
      if (resp.status >= 400 && resp.status < 500) {
        // 4xx 是不会通过重试解决的，丢弃
        continue
      }
      q.attempts++
      remaining.push(q)
    } catch {
      q.attempts++
      remaining.push(q)
    }
  }
  await chrome.storage.local.set({ [RETRY_QUEUE_KEY]: remaining })
  return processed
}

// ============================================================
// 状态回查
// ============================================================

async function refreshHistoryStatus(): Promise<number> {
  const list = await listHistory()
  // 老 entry（v0.1.5 之前）没存 remoteHeaders；裸 GET 会被服务端 401 拒，
  // 用户的「同步状态」按钮永远显示 0 已更新。每次同步前用当前 config 给
  // 这些 entry 补一份 token —— 现网账号体系仍合法时能跑通。
  const config = await loadConfig()
  let updated = 0
  for (const entry of list) {
    if (!entry.remoteId || !entry.remoteBase) continue
    try {
      const url = `${entry.remoteBase}/${entry.remoteId}/status-public`
      const headers = pickTokenHeaders(entry, config)
      const resp = await fetch(url, { method: 'GET', headers })
      if (!resp.ok) continue
      const data = await resp.json()
      if (data && data.ok && data.status) {
        const prev = entry.remoteStatus
        entry.remoteStatus = data.status
        entry.remoteStatusUpdatedAt = new Date().toISOString()
        if (prev !== data.status) updated++
        await updateHistoryEntry(entry.id, entry)
      }
    } catch {
      // ignore single failure
    }
  }
  return updated
}

function pickTokenHeaders(entry: BugHistoryEntry, config?: MooConfig): Record<string, string> {
  // 优先用 entry 自带的（每次提交时 snapshot 的 token，最贴近上报当时的状态）
  if (entry.remoteHeaders && Object.keys(entry.remoteHeaders).length > 0) {
    return entry.remoteHeaders
  }
  // fallback：从当前 config 找回项目 + 服务器，重新构造 auth header
  if (!config) return {}
  const project = config.projects.find((p) => p.id === entry.projectId)
  if (!project) return {}
  const server = project.servers.find((s) => s.id === entry.serverId)
  if (!server) return {}
  return pickPropagatedHeaders(applyAuthHeaders(project, { ...(server.headers ?? {}) }))
}

/** 仅保留状态回查需要的 token 类 header，避免把 Content-Type 等也带过去 */
function pickPropagatedHeaders(src: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(src)) {
    const lk = k.toLowerCase()
    if (lk === 'x-scaffold-token' || lk === 'authorization' || lk.startsWith('x-submitter')) {
      out[k] = v
    }
  }
  return out
}

/** remoteId 后续会被拼到 GET ${remoteBase}/${remoteId}/status-public 里，
 *  必须限制字符集防恶意服务端注入路径 / query（如 `../../admin?token=`）。
 *  服务端正常会返 ULID / UUID / 数字主键这类标识，全部命中 [A-Za-z0-9_-]。 */
const REMOTE_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const REMOTE_ID_MAX = 128

function parseRemoteId(text: string): string | undefined {
  // 上报响应体一般几百字节 JSON；防御性：>64KB 直接放弃 parse，避免误把超大 HTML 错误页喂给 JSON.parse 卡 service worker
  if (!text || text.length > 64 * 1024) return undefined
  try {
    const obj = JSON.parse(text)
    if (!obj || typeof obj !== 'object') return undefined
    const id = obj.id
    if (typeof id !== 'string' || !id) return undefined
    if (id.length > REMOTE_ID_MAX) return undefined
    if (!REMOTE_ID_PATTERN.test(id)) return undefined
    return id
  } catch {
    // not json
  }
  return undefined
}

function deriveRemoteBase(endpoint: string): string {
  // 'http://host/scaffold/todos/intake' → 'http://host/scaffold/todos'
  return endpoint.replace(/\/intake\/?$/, '')
}

function buildRequestBody(
  server: BugServer,
  ctx: Record<string, unknown>,
  project: Project
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
    const headers = applyAuthHeaders(project, { ...server.headers })
    delete headers['Content-Type']
    delete headers['content-type']
    return { body: form, headers }
  }
  const headers = applyAuthHeaders(project, { ...server.headers })
  return { body: rendered, headers }
}

function dataUrlToBlob(dataUrl: string): Blob {
  // 空字符串 / 非 data URL 形态：返回空 Blob 而不是 atob(undefined) 抛 InvalidCharacterError
  // 触发场景：multipart 提交但用户没截图（image 模板渲染为空串）
  if (!dataUrl || !dataUrl.startsWith('data:')) {
    return new Blob([], { type: 'application/octet-stream' })
  }
  const commaIdx = dataUrl.indexOf(',')
  if (commaIdx < 0) return new Blob([], { type: 'application/octet-stream' })
  const meta = dataUrl.slice(0, commaIdx)
  const b64 = dataUrl.slice(commaIdx + 1)
  const mime = meta.match(/data:(.*?);base64/)?.[1] ?? 'image/png'
  if (!b64) return new Blob([], { type: mime })
  let bin: string
  try {
    bin = atob(b64)
  } catch {
    // base64 损坏（出现非法字符）— 不让整个 submitBug 链路因此崩，返回空 blob
    return new Blob([], { type: mime })
  }
  const len = bin.length
  const buf = new Uint8Array(len)
  for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i)
  return new Blob([buf], { type: mime })
}
