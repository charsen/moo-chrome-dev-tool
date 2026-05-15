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
import { loadConfig, matchProject } from '@/storage/config'
import { addHistoryEntry, readHistory, updateHistoryEntry } from '@/storage/history'
import { renderTemplate } from '@/utils/template'
import type { BugServer, Project } from '@/types/config'
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

// 接住 devtools 面板的 keepalive 端口
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === '__panel_keepalive__') {
    port.onDisconnect.addListener(() => {})
  }
})

chrome.runtime.onMessage.addListener((message: MooMessage, sender, sendResponse) => {
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
          const project = matchProject(config, url)
          sendResponse({ project } satisfies MatchProjectRes)
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
  if (!project) return { ok: false, error: 'project not found' }
  const server = project.servers.find((s) => s.id === req.serverId)
  if (!server) return { ok: false, error: 'server not found' }
  if (!server.endpoint) return { ok: false, error: 'server endpoint is empty' }

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
    result = { ok: resp.ok, status: resp.status, body: text, remoteId }
    if (!resp.ok && resp.status >= 500) {
      // 5xx → 进重试队列
      await enqueueRetry(req, server.endpoint, server.method, headers, body)
      result.queued = true
    }
  } catch (err) {
    // 网络错误 → 进重试队列
    result = { ok: false, error: (err as Error).message }
    await enqueueRetry(req, server.endpoint, server.method, headers, body)
    result.queued = true
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
    await addHistoryEntry(entry)
  } catch (e) {
    console.warn('[Moo] failed to save history', e)
  }

  return result
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
  if (!out['Authorization'] && !out['authorization']) {
    out['Authorization'] = `Bearer ${token}`
  }
  if (!out['X-Scaffold-Token'] && !out['x-scaffold-token']) {
    out['X-Scaffold-Token'] = token
  }
  return out
}

// HTTP header 值只允许 ISO-8859-1（基本就是 ASCII），中文/emoji 必须 percent-encode；
// 服务端拿到后 decodeURIComponent 即可还原。
function sanitizeHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(h)) {
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

async function enqueueRetry(
  _req: SubmitBugReq,
  endpoint: string,
  method: string,
  headers: Record<string, string>,
  body: BodyInit
): Promise<void> {
  if (typeof body !== 'string') return // multipart 不重试
  const queued: QueuedRequest = {
    enqueuedAt: Date.now(),
    attempts: 0,
    endpoint,
    method,
    headers,
    bodyString: body
  }
  const r = await chrome.storage.local.get(RETRY_QUEUE_KEY)
  const list = (r[RETRY_QUEUE_KEY] as QueuedRequest[]) ?? []
  list.push(queued)
  while (list.length > 50) list.shift()
  await chrome.storage.local.set({ [RETRY_QUEUE_KEY]: list })
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
  const list = await readHistory()
  let updated = 0
  for (const entry of list) {
    if (!entry.remoteId || !entry.remoteBase) continue
    try {
      const url = `${entry.remoteBase}/${entry.remoteId}/status-public`
      const headers = pickTokenHeaders(entry)
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

function pickTokenHeaders(entry: BugHistoryEntry): Record<string, string> {
  return entry.remoteHeaders ?? {}
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

function parseRemoteId(text: string): string | undefined {
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === 'object' && typeof obj.id === 'string') return obj.id
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
  const [meta, b64] = dataUrl.split(',')
  const mime = meta.match(/data:(.*?);base64/)?.[1] ?? 'image/png'
  const bin = atob(b64)
  const len = bin.length
  const buf = new Uint8Array(len)
  for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i)
  return new Blob([buf], { type: mime })
}
