/**
 * webhook adapter — v0.1.x 起的「自定义 HTTP 上报」路径。
 *
 * 实装 IssueAdapter<'webhook'>。包整个 webhook 提交链路：
 *   - readPageStorage（按项目白名单抓 localStorage / sessionStorage 快照）
 *   - buildRequestBody（模板渲染 / multipart 装配）
 *   - sanitizeHeaders（CRLF 拦截 + 非 ASCII percent-encode）
 *   - fetch + parseRemoteId
 *   - serializeForRetry / retryFromPayload（保 endpoint+headers+bodyString 入队）
 *
 * v0.5.2 P0 router 化后从 handlers/submit.ts 抽出来 — submit.ts 缩到 ~router 角色，
 * 业务逻辑下放到 adapter。adapter 接 Project + AdapterSubmitCtx，输出 AdapterSubmitOutcome。
 * router 写 history / 刷 badge / 入队是 router 的事，不在 adapter 内。
 *
 * 不在 adapter 处理（保留为 router 职责）：
 *   - server.id 解析 / project 缺失检查 / endpoint 空检查 / writeFailureHistory
 *     —— 这些是「能不能让 adapter 跑」的前置 gate，由 router 拦
 *   - retryQueue.enqueueRetry 真实入队 —— router 拿到 AdapterRetryPayload 后自决
 *   - deriveRemoteBase —— history.remoteBase 是 router 字段
 */

import type { Project, BugServer } from '@/types/config'
import type { SubmitBugReq } from '@/types/messages'
import type { BugHistoryEntry } from '@/types/history'
import type {
  IssueAdapter,
  AdapterSubmitCtx,
  AdapterSubmitOutcome,
  AdapterRetryPayload,
  AdapterRetryOutcome,
  AdapterStatus,
  AdapterFetchStatusCtx
} from './IssueAdapter'
import { renderTemplate } from '@/utils/template'
import { parseRemoteId } from '@/utils/remoteHeaders'
import { dataUrlToBlob } from '@/utils/dataUrl'
import { t } from '@/i18n'

/**
 * webhook retry payload 形态：保留 endpoint + method + headers + bodyString。
 * multipart 不入队（adapter.serializeForRetry 返 null）。
 */
export interface WebhookRetryPayload {
  kind: 'webhook'
  endpoint: string
  method: string
  headers: Record<string, string>
  bodyString: string
}

/** 单条 body 上限 1MB，超出不入队 */
const RETRY_MAX_BODY_BYTES = 1_000_000

export const webhookAdapter: IssueAdapter<'webhook'> = {
  kind: 'webhook',

  async submit(req, project, ctx): Promise<AdapterSubmitOutcome> {
    const server = project.servers.find((s) => s.id === req.serverId)
    if (!server) return { ok: false, error: t('submit.server.not-found') }
    if (!server.endpoint) return { ok: false, error: t('submit.server.no-endpoint', { name: server.name }) }

    // 按项目白名单抓取页面 storage（localStorage 优先，找不到尝试 sessionStorage）
    const storageKeys = project.capture?.storageKeys ?? []
    const storage = storageKeys.length > 0 ? await readPageStorage(ctx.tabId, storageKeys) : {}

    const renderCtx: Record<string, unknown> = {
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

    const { body, headers } = buildRequestBody(server, renderCtx)
    const safeHeaders = sanitizeHeaders(headers)

    try {
      const resp = await fetch(server.endpoint, { method: server.method, headers: safeHeaders, body })
      const text = await resp.text()
      const remoteId = parseRemoteId(text)
      if (!resp.ok) {
        // 只 log header 名字不打 value：用户配的 server.headers 可能含敏感字段
        // （token 已经在 body 里，但有人会额外手配 Authorization 等），SW console
        // 落盘后任何能读 chrome://extensions 日志的进程都能拿到。
        // v0.7.6 general-purpose P2-3：bodyPreview 默认不打（即便有 ⚠ 警告，敏感
        // 数据仍写入 SW console 落盘）。需要时设 chrome.storage.local.mooDebug=true 打开。
        const debugInfo = await chrome.storage.local.get('mooDebug').catch(() => ({}))
        const logBody = (debugInfo as { mooDebug?: boolean }).mooDebug === true
        console.warn('[Moo submit-fail]', {
          endpoint: server.endpoint,
          finalUrl: resp.url,
          status: resp.status,
          statusText: resp.statusText,
          ...(logBody ? { bodyPreview: text.slice(0, 200) } : { bodyHint: '(bodyPreview hidden — chrome.storage.local.set({mooDebug:true}) to enable)' }),
          headerNames: Object.keys(safeHeaders)
        })
      }
      return {
        ok: resp.ok,
        remoteId,
        status: resp.status,
        body: text,
        // 5xx 适合重试，4xx 不重试
        retryable: !resp.ok ? resp.status >= 500 : undefined
      }
    } catch (err) {
      return {
        ok: false,
        error: (err as Error).message,
        retryable: true
      }
    }
  },

  async fetchStatus(project, remoteId, ctx?: AdapterFetchStatusCtx): Promise<AdapterStatus | undefined> {
    // 老 webhook 路径：POST {remoteBase}/{id}/status-public 走 body.token 鉴权
    const token = project.token?.trim() ?? ''
    // 优先用 entry 当时记录的 remoteBase（用户改 server.endpoint 后状态查仍指向原 base）；
    // 缺省 fallback：v0.7.6 P1-4 按 entry.serverId 反查（多 server 项目下 first endpoint 可能错），
    // 再 fallback first endpoint（v0.5.x 老 entry 没存 serverId）
    let remoteBase = ctx?.remoteBase
    if (!remoteBase) {
      const server = (ctx?.serverId && project.servers.find(s => s.id === ctx.serverId))
        || project.servers.find(s => s.endpoint)
      if (!server?.endpoint) return undefined
      remoteBase = deriveRemoteBase(server.endpoint)
    }
    const url = `${remoteBase}/${remoteId}/status-public`
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      })
      if (!resp.ok) return undefined
      const data = await resp.json() as { ok?: boolean; status?: BugHistoryEntry['remoteStatus'] }
      return (data && data.ok && data.status) || undefined
    } catch {
      return undefined
    }
  },

  serializeForRetry(req, project): AdapterRetryPayload | null {
    const server = project.servers.find(s => s.id === req.serverId)
    if (!server?.endpoint) return null

    // 拼一次 body 看是否可序列化为 string（multipart 直接 false）。
    // serialize 阶段不读 page storage（page tab 可能已关）—— storage 字段视为空快照
    const renderCtx: Record<string, unknown> = {
      title: req.title, description: req.description, image: req.image,
      url: req.url, userAgent: req.userAgent, viewport: req.viewport,
      timestamp: req.timestamp, requests: req.requests, errors: req.errors,
      elements: req.elements ?? [], storage: {}, video: req.video?.dataUrl ?? '',
      videoBytes: req.video?.bytes ?? 0, videoDuration: req.video?.duration ?? 0,
      token: project.token ?? ''
    }
    const { body, headers } = buildRequestBody(server, renderCtx)
    if (typeof body !== 'string') return null   // multipart 不入队
    if (body.length > RETRY_MAX_BODY_BYTES) return null
    const payload: WebhookRetryPayload = {
      kind: 'webhook',
      endpoint: server.endpoint,
      method: server.method,
      headers,
      bodyString: body
    }
    return payload
  },

  async retryFromPayload(payload, _project): Promise<AdapterRetryOutcome> {
    // _project 当前 doFlush 永远传 undefined（webhook payload 无 projectId）。
    // Plan patch 3 audit 结论：「project kind 切换 → drop webhook 队列」需要 payload 加
    // projectId 字段 + doFlush 改造，工作量超 v0.6.1 范围，攒到 v0.7.0（task #131 备忘）。
    // 当前路径：依赖 attempts cap (5) 自然停止，无死循环风险。
    const q = payload as WebhookRetryPayload
    if (q.kind !== 'webhook') {
      return { kind: 'drop', reason: 'webhook adapter 收到非 webhook payload' }
    }
    try {
      const resp = await fetch(q.endpoint, { method: q.method, headers: q.headers, body: q.bodyString })
      if (resp.ok) return { kind: 'ok' }
      if (resp.status >= 400 && resp.status < 500) {
        return { kind: 'drop', reason: `HTTP ${resp.status}（不重试）` }
      }
      return { kind: 'keep', status: resp.status, error: resp.statusText || `HTTP ${resp.status}` }
    } catch (e) {
      return { kind: 'keep', error: (e as Error)?.message || '网络错误' }
    }
  }
}

// ─────────────────────── 内部工具（从 handlers/submit.ts 搬来）───────────────────────

async function readPageStorage(
  tabId: number | undefined,
  keys: string[]
): Promise<Record<string, { value: string | null; source: 'localStorage' | 'sessionStorage' | 'missing' }>> {
  if (!tabId || keys.length === 0) return {}
  try {
    // executeScript 返回 InjectionResult[]，frame 数为 0 时数组空 —— noUncheckedIndexedAccess
    // 把 [0] 标 possibly-undefined。tab 进程崩溃 / 页面已 unload 时确实会 0 长度。
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
          } catch { /* 安全异常忽略 */ }
          if (v === null) {
            try {
              v = sessionStorage.getItem(k)
              if (v !== null) src = 'sessionStorage'
            } catch { /* ignore */ }
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
// 顺便拦 CRLF：HTTP header injection 的经典攻击载体；浏览器层 fetch 大多数会自己拒，但代码层主动 scrub 给出明确错误更清晰。
function sanitizeHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(h)) {
    if (/[\r\n]/.test(v)) {
      console.warn('[Moo] dropped header with CRLF:', k)
      continue
    }
    out[k] = /[^\x20-\x7E]/.test(v) ? encodeURIComponent(v) : v
  }
  return out
}

/** 给 router 算 history.remoteBase 用 */
export function deriveRemoteBase(endpoint: string): string {
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
