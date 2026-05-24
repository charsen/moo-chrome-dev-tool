/**
 * SUBMIT_BUG 入口 + 子流程：webhook submit / zentao submit / failure history / page storage 快照。
 *
 * v0.5.2 P0 重构第 3 阶段：把 background/index.ts 内 submitBug + submitBugViaZentao +
 * buildRequestBody + sanitizeHeaders + readPageStorage + writeFailureHistory + deriveRemoteBase
 * 完整搬过来。这是 onMessage switch 内最重的一坨。
 *
 * background 现在调用：handleSubmitBug(req, tabId)。
 *
 * deriveRemoteBase 一并 export，refreshHistoryStatus 路径要算 remoteBase（其实没用到，已下放到
 * historyStatus 内直接读 entry.remoteBase）。
 */

import type { BugServer, Project } from '@/types/config'
import type { BugHistoryEntry } from '@/types/history'
import type { SubmitBugReq, SubmitBugRes } from '@/types/messages'
import { loadConfig } from '@/storage/config'
import { addHistoryEntry } from '@/storage/history'
import { renderTemplate } from '@/utils/template'
import { parseRemoteId } from '@/utils/remoteHeaders'
import { enqueueRetry, enqueueZentaoRetry } from '@/background/retryQueue'
import { submitToZentao } from '@/background/zentao/submit'
import { dataUrlToBlob } from '@/utils/dataUrl'
import { refreshBadge } from './badge'
import { t } from '@/i18n'

export async function handleSubmitBug(req: SubmitBugReq, tabId?: number): Promise<SubmitBugRes> {
  const config = await loadConfig()
  const project = config.projects.find((p) => p.id === req.projectId)
  if (!project) {
    const err = t('submit.project.not-found')
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
    const err = t('submit.server.not-found')
    await writeFailureHistory(req, project, undefined, err)
    return { ok: false, error: err }
  }
  if (!server.endpoint) {
    const err = t('submit.server.no-endpoint', { name: server.name })
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
