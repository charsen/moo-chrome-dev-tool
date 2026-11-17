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

import type { BugServer, Project } from '@/types/config'
import type { BugHistoryEntry } from '@/types/history'
import type { SubmitBugReq } from '@/types/messages'
import type {
  IssueAdapter,
  AdapterSubmitOutcome,
  AdapterRetryPayload,
  AdapterRetryOutcome,
  AdapterStatus,
  AdapterFetchStatusCtx
} from './IssueAdapter'
import { renderTemplate } from '@/utils/template'
import { parseRemoteId } from '@/utils/remoteHeaders'
import { dataUrlToBlob } from '@/utils/dataUrl'
import { reencodeImage } from '@/utils/image'
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

    // v0.8.14 截图上传前有损重编码成 WebP（q0.9）压体积，治「2560px PNG 仍 >8MB 被云端
    // extractBinary 静默 skip」的丢图 bug。cloud MIME 白名单含 image/webp，最清晰。
    // ⚠ 只重编码「要发出去的副本」 —— 不碰 req.image/req.images（history 走原 req 保 PNG 无损）。
    const outImage = await reencodeImage(req.image ?? '', 'image/webp')
    const srcImages = req.images ?? (req.image ? [req.image] : [])
    const outImages = await Promise.all(srcImages.map((d) => reencodeImage(d, 'image/webp')))

    const renderCtx: Record<string, unknown> = {
      title: req.title,
      description: req.description,
      image: outImage,
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
      // v0.8.10 多图：模板可用 {{imagesJson}} 注入 JSON 数组（renderTemplate 的 xxxJson
      // 后缀自动 JSON.stringify）。不引用则零影响 —— 老模板/老服务端完全兼容。
      // v0.8.14：这里是已重编码的 WebP 副本（{{imagesJson}} 渲染出的也是 WebP）。
      images: outImages,
      // 让模板可以用 {{token}} 把项目 token 写进 body。
      // 后端只读 body 字段做鉴权时（不走 Authorization header）必须有这个。
      token: project.token ?? ''
    }

    // 云端待办（moo-scaffold-cloud）已支持截图/录像直传七牛：intake 只建待办主体，
    // 媒体走「票据 → 七牛直传 → confirm」三段，避免 base64 塞进 intake 请求把体积
    // 和 PHP post_max_size / 上传上限压爆。非 cloud endpoint 完全走原来的单请求路径。
    if (isCloudTodoIntakeEndpoint(server.endpoint)) {
      return await submitCloudTodo(req, project, server, renderCtx)
    }

    const { body, headers } = buildRequestBody(server, renderCtx)
    const safeHeaders = sanitizeHeaders(headers)

    try {
      const resp = await fetch(server.endpoint, { method: server.method, headers: safeHeaders, body })
      const text = await resp.text()
      const remoteId = parseRemoteId(text)
      if (!resp.ok) await logSubmitFailure(server.endpoint, resp, text, Object.keys(safeHeaders))
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

  async serializeForRetry(req, project): Promise<AdapterRetryPayload | null> {
    const server = project.servers.find(s => s.id === req.serverId)
    if (!server?.endpoint) return null
    // 云端直传是多步流程（intake 建单 → 票据 → 七牛 → confirm）：只重放 intake bodyString
    // 会建出「没有截图/录像」的半成品单，所以不自动入队；失败让用户到「历史」手动重提
    // （手动重提走完整 adapter.submit，会重新上传媒体）。
    if (isCloudTodoIntakeEndpoint(server.endpoint)) return null
    if (server.imageFormat === 'multipart') return null  // multipart 不可序列化

    // 跟 live submit 同款：先把截图重编码成 WebP 再渲染。否则 2560px PNG（默认模板还会
    // 把首图引用两次）几乎必然超过 1MB 上限 → 所有带截图的 5xx 都进不了重试队列。
    // 失败时 reencodeImage 会返回原图，size cap 仍兜底。
    const image = await reencodeImage(req.image ?? '', 'image/webp')
    const srcImages = req.images ?? (req.image ? [req.image] : [])
    const images = await Promise.all(srcImages.map((d) => reencodeImage(d, 'image/webp')))

    // 拼一次 body 看是否可序列化为 string（multipart 直接 false）。
    // serialize 阶段不读 page storage（page tab 可能已关）—— storage 字段视为空快照
    const renderCtx: Record<string, unknown> = {
      title: req.title, description: req.description, image,
      url: req.url, userAgent: req.userAgent, viewport: req.viewport,
      timestamp: req.timestamp, requests: req.requests, errors: req.errors,
      elements: req.elements ?? [], storage: {}, video: req.video?.dataUrl ?? '',
      videoBytes: req.video?.bytes ?? 0, videoDuration: req.video?.duration ?? 0,
      // 缺了 images，默认模板的 {{imagesJson}} 会被 renderTemplate 原样保留成字面量
      // → 重试 body 非法 JSON、多图全丢（v0.8.15 回归）
      images,
      token: project.token ?? ''
    }
    const { body, headers } = buildRequestBody(server, renderCtx)
    if (typeof body !== 'string') return null   // multipart 不入队
    if (body.length > RETRY_MAX_BODY_BYTES) return null
    const payload: WebhookRetryPayload = {
      kind: 'webhook',
      endpoint: server.endpoint,
      method: server.method,
      // 必须跟 live submit 一样过 sanitizeHeaders（CRLF / 非 ASCII percent-encode）：
      // 否则带中文 header 值的配置能首次提交成功、重试却每次 fetch 同步抛错，
      // 5 次 attempts 白烧完被丢弃，用户只看到「都还在失败」的假诊断。
      headers: sanitizeHeaders(headers),
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
      // 老版本入队的 payload 可能没经过 sanitize（直接存了原始 headers）→ 这里再过一次
      const resp = await fetch(q.endpoint, { method: q.method, headers: sanitizeHeaders(q.headers ?? {}), body: q.bodyString })
      if (resp.ok) {
        // 跟首次提交同款：响应体 id 是 remoteId（history 回填 + 状态回查用）。
        // 读体失败不影响成功判定 —— remoteId 缺省只是回填不上 id。
        let remoteId: string | undefined
        try { remoteId = parseRemoteId(await resp.text()) } catch { /* body 不可读 */ }
        return { kind: 'ok', remoteId }
      }
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
  // 'https://<cloud>/api/v1/todos/intake' → 'https://<cloud>/api/v1/todos'
  // (status-public 回查 = {remoteBase}/{id}/status-public,与云端 /api/v1 路由对齐)
  return endpoint.replace(/\/intake\/?$/, '')
}

// ───────────────────────── 云端待办：截图/录像直传七牛 ─────────────────────────
//
// moo-scaffold-cloud 的 /api/v1/todos/intake 只负责建待办主体；截图/录像不再 base64
// 塞进 intake，而是「票据 → 七牛直传 → confirm」三段（契约见 cloud 的 DirectUploads）：
//   1) POST {apiBase}/uploads/tickets  body: {token, business:'todo_images', todo_id,
//      attachment_type(=type, image|video), original_name, file_size, sha256, mime_type,
//      duration_seconds?}  → {ok, upload_id, key, region, token}
//   2) POST https://upload[-<region>].qiniup.com  multipart: token, key, file（字节不过 cloud）
//   3) POST {apiBase}/uploads/{upload_id}/confirm  body: {token} → 云端核验大小/SHA-256 后落附件
//
// 失败语义：待办主体建成即算成功；某张图/录像失败只进 warnings，绝不谎报已上传。

/** 云端 todo intake 的路径约定。命中的 endpoint 才走直传分支，其它 webhook/禅道保持原行为。 */
const CLOUD_TODO_INTAKE_RE = /\/api\/v1\/todos\/intake\/?$/i

/** 判断一个上报地址是不是云端待办 intake（路径以 /api/v1/todos/intake 结尾）。 */
export function isCloudTodoIntakeEndpoint(endpoint: string): boolean {
  const s = (endpoint || '').trim()
  if (!s) return false
  try {
    const u = new URL(s)
    if (CLOUD_TODO_INTAKE_RE.test(u.pathname)) return true
  } catch {
    // 相对地址 / 非标准 URL：退回字符串判定
  }
  return CLOUD_TODO_INTAKE_RE.test(s)
}

/** 七牛区域 → 直传域名：z0 无区域后缀，其余 upload-<region>；未知区域按 upload-<region> 兜底。 */
export const QINIU_UPLOAD_HOSTS: Record<string, string> = {
  z0: 'https://upload.qiniup.com',
  z1: 'https://upload-z1.qiniup.com',
  z2: 'https://upload-z2.qiniup.com',
  na0: 'https://upload-na0.qiniup.com',
  as0: 'https://upload-as0.qiniup.com'
}

export function qiniuUploadHost(region: string): string {
  const r = (region || '').trim()
  if (!r || r === 'z0') return QINIU_UPLOAD_HOSTS.z0!
  return QINIU_UPLOAD_HOSTS[r] ?? `https://upload-${r}.qiniup.com`
}

/** 'https://<cloud>/api/v1/todos/intake' → 'https://<cloud>/api/v1'（tickets/confirm 的公共前缀）。 */
function cloudApiBase(endpoint: string): string {
  const m = endpoint.match(/^(.*)\/todos\/intake\/?$/i)
  if (m && m[1]) return m[1]
  return endpoint.replace(/\/+$/, '')
}

interface CloudMediaItem {
  kind: 'image' | 'video'
  dataUrl: string
  label: string
  durationSeconds?: number
}

/** 云端待办提交流程：建主体 → 逐张直传媒体 → 汇总 warnings。 */
async function submitCloudTodo(
  req: SubmitBugReq,
  project: Project,
  server: BugServer,
  renderCtx: Record<string, unknown>
): Promise<AdapterSubmitOutcome> {
  const apiBase = cloudApiBase(server.endpoint)
  const headers = cloudJsonHeaders(server.headers)

  // ① 建待办主体：模板渲染成 JSON，剥掉截图/录像文件字段（媒体另走上传）
  const intakeBody = buildCloudIntakeBody(server, renderCtx)
  let resp: Response
  try {
    resp = await fetch(server.endpoint, { method: server.method, headers, body: intakeBody })
  } catch (err) {
    return { ok: false, error: (err as Error).message, retryable: true }
  }
  const text = await resp.text()
  if (!resp.ok) {
    await logSubmitFailure(server.endpoint, resp, text, Object.keys(headers))
    return {
      ok: false,
      status: resp.status,
      body: text,
      error: errorDetailFromText(text) || `HTTP ${resp.status}`,
      retryable: resp.status >= 500
    }
  }

  const todoId = parseCloudTodoId(text)
  if (!todoId) {
    // 待办主体建了却没拿到 id —— 后续媒体无处可挂，也不能当成功（否则用户以为图都存好了）
    return { ok: false, status: resp.status, body: text, error: '云端未返回待办 id（响应缺少 id）', retryable: false }
  }

  // ② 逐张截图/录像直传七牛；单个失败只记 warning，不推翻「待办已建」
  const media = collectCloudMedia(renderCtx, req)
  const warnings: string[] = []
  let failed = 0
  for (const item of media) {
    try {
      await uploadOneCloudMedia(apiBase, todoId, project.token ?? '', item)
    } catch (e) {
      failed++
      warnings.push(`${item.label}上传失败：${(e as Error).message}`)
    }
  }
  if (failed > 0) {
    warnings.push(`共 ${failed} 个附件上传失败，待办已创建，但这些截图/录像没有上传到云端`)
  }

  return { ok: true, remoteId: todoId, status: resp.status, body: text, warnings: warnings.length ? warnings : undefined }
}

/** intake body：模板渲染后用空媒体占位（避免把巨大 base64 先拼出来），再删掉媒体字段。 */
function buildCloudIntakeBody(server: BugServer, renderCtx: Record<string, unknown>): string {
  const ctx: Record<string, unknown> = { ...renderCtx, image: '', images: [], video: '' }
  const rendered = renderTemplate(server.payloadTemplate, ctx)
  let obj: Record<string, unknown>
  try {
    const parsed = JSON.parse(rendered) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return rendered
    obj = parsed as Record<string, unknown>
  } catch {
    // 用户模板写坏了：原样发（服务端会 400），保持与普通 webhook 一致的容错
    return rendered
  }
  const drop = new Set([
    'screenshot', 'screenshots', 'video', 'image', 'images',
    'video_duration', 'video_bytes', 'videoDuration', 'videoBytes'
  ])
  if (server.imageField) drop.add(server.imageField)
  for (const k of drop) delete obj[k]
  // token 兜底：自定义模板没写 {{token}} 时从项目配置注入，保证 body.token 存在（middleware 按 body.token 鉴权）
  if (typeof obj.token !== 'string' || obj.token.trim() === '') obj.token = renderCtx.token ?? ''
  return JSON.stringify(obj)
}

/** 云端 JSON 请求 headers：强制 application/json，剥掉用户手配的 content-type 变体避免重复/错误边界。 */
function cloudJsonHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(h)) {
    if (k.toLowerCase() === 'content-type') continue
    out[k] = v
  }
  out['Content-Type'] = 'application/json'
  return sanitizeHeaders(out)
}

/** 从 intake 响应取待办 id：优先顶层 id（parseRemoteId），再兼容 {todo:{id}}。 */
function parseCloudTodoId(text: string): string | undefined {
  const id = parseRemoteId(text)
  if (id) return id
  try {
    const obj = JSON.parse(text) as { todo?: { id?: unknown } }
    const t = obj?.todo?.id
    if (typeof t === 'string' && t.length <= 128 && /^[A-Za-z0-9_-]+$/.test(t)) return t
  } catch {
    /* not json */
  }
  return undefined
}

/** 收集要直传的媒体：多图（已重编码副本）+ 录像。 */
function collectCloudMedia(renderCtx: Record<string, unknown>, req: SubmitBugReq): CloudMediaItem[] {
  const items: CloudMediaItem[] = []
  const images = Array.isArray(renderCtx.images) ? (renderCtx.images as unknown[]) : []
  images.forEach((d, i) => {
    if (typeof d === 'string' && d) items.push({ kind: 'image', dataUrl: d, label: `第 ${i + 1} 张截图` })
  })
  const video = req.video?.dataUrl
  if (typeof video === 'string' && video) {
    items.push({ kind: 'video', dataUrl: video, label: '录像', durationSeconds: req.video?.duration ?? 0 })
  }
  return items
}

/** 单个媒体：票据 → 七牛直传 → confirm。任一步失败抛错，由调用方汇总成 warnings。 */
async function uploadOneCloudMedia(
  apiBase: string,
  todoId: string,
  token: string,
  item: CloudMediaItem
): Promise<void> {
  const blob = dataUrlToBlob(item.dataUrl)
  if (!blob || blob.size === 0) throw new Error('内容为空或不是合法的 data URL')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const mime = blob.type || (item.kind === 'video' ? 'video/webm' : 'image/webp')
  const sha256 = await sha256Hex(bytes)
  const originalName = `${item.kind === 'video' ? 'video' : 'screenshot'}-${Date.now()}.${extFromMime(mime, item.kind)}`

  // ① 申请直传票据
  const ticketBody: Record<string, unknown> = {
    token,
    business: 'todo_images',
    todo_id: todoId,
    // cloud 实际读 attachment_type（兼容 type）；media_type 是对外契约里的同义字段，一并带上
    media_type: item.kind,
    attachment_type: item.kind,
    original_name: originalName,
    file_size: bytes.byteLength,
    sha256,
    mime_type: mime
  }
  if (item.kind === 'video' && item.durationSeconds && item.durationSeconds > 0) {
    ticketBody.duration_seconds = Math.round(item.durationSeconds)
  }
  const ticket = await postCloudJson(`${apiBase}/uploads/tickets`, ticketBody)
  const uploadId = asStr(ticket.upload_id)
  const key = asStr(ticket.key)
  const region = asStr(ticket.region)
  const qiniuToken = asStr(ticket.token)
  if (!uploadId || !key || !region || !qiniuToken) throw new Error('票据响应缺少 upload_id/key/region/token')

  // ② 字节直传七牛（不经过 cloud）
  const form = new FormData()
  form.append('token', qiniuToken)
  form.append('key', key)
  form.append('file', new Blob([bytes as unknown as BlobPart], { type: mime }), originalName)
  let putResp: Response
  try {
    putResp = await fetch(qiniuUploadHost(region), { method: 'POST', body: form })
  } catch (e) {
    throw new Error(`七牛直传网络错误：${(e as Error).message}`)
  }
  const putText = await putResp.text()
  if (!putResp.ok && !isQiniuFileExists(putResp.status, putText)) {
    throw new Error(`七牛直传失败 HTTP ${putResp.status}${textDetail(putText)}`)
  }

  // ③ 确认：云端核验大小/SHA-256 后把对象登记成待办附件
  await postCloudJson(`${apiBase}/uploads/${encodeURIComponent(uploadId)}/confirm`, { token })
}

/** POST JSON 到云端并校验 {ok:true}，失败抛带服务端文案的 Error。 */
async function postCloudJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  } catch (e) {
    throw new Error(`请求失败：${(e as Error).message}`)
  }
  const text = await resp.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    /* 非 JSON 错误页 */
  }
  const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null
  if (!resp.ok || !obj || obj.ok !== true) {
    const detail = obj ? errorDetailFromBody(obj) : textDetail(text)
    throw new Error(`HTTP ${resp.status}${detail ? '：' + detail : ''}`)
  }
  return obj
}

function sha256Hex(bytes: Uint8Array): Promise<string> {
  // TS 5.9 lib 把 Uint8Array<ArrayBufferLike> 与 BufferSource 卡得很死（SharedArrayBuffer 不可赋给 ArrayBuffer），
  // 运行时字节一致，这里显式收窄到 BufferSource。
  return crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource).then((digest) => {
    const arr = new Uint8Array(digest)
    let out = ''
    for (const b of arr) out += b.toString(16).padStart(2, '0')
    return out
  })
}

function extFromMime(mime: string, kind: 'image' | 'video'): string {
  const m = mime.toLowerCase()
  if (m === 'image/png') return 'png'
  if (m === 'image/jpeg') return 'jpg'
  if (m === 'image/webp') return 'webp'
  if (m === 'image/gif') return 'gif'
  if (m === 'video/webm') return 'webm'
  if (m === 'video/mp4') return 'mp4'
  if (m === 'video/quicktime') return 'mov'
  return kind === 'video' ? 'webm' : 'png'
}

/** 七牛对「目标 key 已存在」返回 614 / {error:'file exists'}；同 key 即同内容，可视为已传。 */
function isQiniuFileExists(status: number, text: string): boolean {
  if (status === 614) return true
  try {
    const o = JSON.parse(text) as { error?: unknown }
    return typeof o?.error === 'string' && /file\s*exists/i.test(o.error)
  } catch {
    return false
  }
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** 服务端错误文案：error 优先，其次 Laravel errors{}，再 message。 */
function errorDetailFromBody(obj: Record<string, unknown>): string {
  if (typeof obj.error === 'string' && obj.error) return obj.error
  const errors = obj.errors
  if (errors && typeof errors === 'object') {
    const parts = Object.entries(errors as Record<string, unknown>)
      .map(([field, value]) => `${field}: ${Array.isArray(value) ? value.join(' ') : String(value)}`)
      .filter(Boolean)
    if (parts.length) return parts.join('; ')
  }
  if (typeof obj.message === 'string' && obj.message) return obj.message
  return ''
}

function errorDetailFromText(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return errorDetailFromBody(parsed as Record<string, unknown>)
    }
  } catch {
    /* not json */
  }
  return ''
}

function textDetail(text: string): string {
  if (!text) return ''
  return text.length > 200 ? text.slice(0, 200) + '…' : text
}

/** 统一失败日志：只打 header 名不打 value（server.headers 可能含用户手配的敏感字段）。 */
async function logSubmitFailure(
  endpoint: string,
  resp: Response,
  text: string,
  headerNames: string[]
): Promise<void> {
  // v0.7.6 general-purpose P2-3：bodyPreview 默认不打（敏感数据会写进 SW console 落盘）。
  // 需要时设 chrome.storage.local.mooDebug=true 打开。
  const debugInfo = await chrome.storage.local.get('mooDebug').catch(() => ({}))
  const logBody = (debugInfo as { mooDebug?: boolean }).mooDebug === true
  console.warn('[Moo submit-fail]', {
    endpoint,
    finalUrl: resp.url,
    status: resp.status,
    statusText: resp.statusText,
    ...(logBody ? { bodyPreview: text.slice(0, 200) } : { bodyHint: '(bodyPreview hidden — chrome.storage.local.set({mooDebug:true}) to enable)' }),
    headerNames
  })
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
    // 空图（无截图 / dataUrl 损坏）不要 append 一个 0 字节 part：多数后端会把它当
    // 「有一个空附件」静默丢弃，扩展侧却以为已经发了。
    const primaryBlob = dataUrlToBlob(String(ctx.image))
    if (primaryBlob.size > 0) form.append(server.imageField, primaryBlob, 'screenshot.png')
    // v0.8.10 多图：第 2 张起追加 `${imageField}_N` 字段（screenshot_2.png …）。
    // 不认识这些字段的老服务端会忽略 —— 非 BREAKING；要收多图的服务端按字段名约定取
    const extraShots = Array.isArray(ctx.images) ? (ctx.images as string[]).slice(1) : []
    extraShots.forEach((dataUrl, i) => {
      if (typeof dataUrl !== 'string' || !dataUrl) return
      const blob = dataUrlToBlob(dataUrl)
      if (blob.size === 0) return
      form.append(`${server.imageField}_${i + 2}`, blob, `screenshot_${i + 2}.png`)
    })
    const headers = { ...server.headers }
    // 大小写无关删除 —— 用户手敲的 `Content-type` / `CONTENT-TYPE` 变体若存活，
    // fetch 不再给 FormData 注入 boundary，服务端 multipart 解析直接失败（附件/字段全收不到）
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'content-type') delete headers[k]
    }
    return { body: form, headers }
  }
  return { body: rendered, headers: { ...server.headers } }
}
