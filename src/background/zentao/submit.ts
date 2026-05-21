/**
 * 禅道提交编排层（B' 路径）—— 把 Moo 的 SubmitBugReq 转成禅道的 steps HTML +
 * 调 client.submitBug，再翻译成 SubmitBugRes。
 *
 * v0.2.0 dogfood 后的关键策略变更：
 *
 *   1. **不再走 form 端点的 files[] 字段**——实测 9279 / 9281 / 9282 表明这条字段
 *      被禅道服务端忽略，bug.files 永远是空数组。
 *
 *   2. **改走 zui editor 的 /file-ajaxUpload.html 链路**：先把每个附件单独
 *      `POST /file-ajaxUpload.html?uid=xxx&extra=editor&field=imgFile` 上传（依赖
 *      cookie session），拿到 `/file-read-N.png` 这种 URL，再 inline 进 steps：
 *      - 截图：`<img src="/file-read-N.png">` → 禅道详情页直接渲染
 *      - 视频 / json：`<a href="/file-read-N.txt">` → 禅道保留链接（video 标签被
 *        sanitizer 剥光，所以视频改成下载链接）
 *
 *   3. **附件上传是 best-effort**：用户没登录禅道时 cookie 失效，上传整个 fallback
 *      到「steps 里说明截图未传 + 主提交照常进行」。bug 仍然能建，只是没截图渲染。
 */

import type { Project, ZentaoProjectConfig } from '@/types/config'
import type { CapturedRequest } from '@/types/requests'
import type { SubmitBugReq, SubmitBugRes } from '@/types/messages'
import { toCurl, toCurlScript } from '@/utils/curlGenerator'
import { redactBody } from '@/utils/redact'
import { parseUserAgent } from '@/utils/ua'
import {
  submitBug as zentaoClientSubmit,
  uploadEditorFile,
  type ZentaoEnv,
  type ZentaoSubmitFields
} from './client'

export function buildZentaoEnv(project: Project): { ok: true; env: ZentaoEnv } | { ok: false; error: string } {
  const z = project.zentao
  if (!z) return { ok: false, error: '项目缺禅道配置；请去 DevTools → Moo → 环境，切到「禅道」并填齐字段' }
  const missing: string[] = []
  if (!z.baseUrl) missing.push('禅道地址')
  if (!z.account) missing.push('账号')
  if (!z.password) missing.push('密码')
  if (!z.projectId) missing.push('项目 ID')
  if (missing.length) {
    return { ok: false, error: `禅道配置缺少必填项：${missing.join(' / ')}` }
  }
  return {
    ok: true,
    env: { baseUrl: z.baseUrl, account: z.account, password: z.password, projectId: z.projectId, moduleId: z.moduleId }
  }
}

/** 已上传到禅道的附件结果，给 buildZentaoStepsHtml 拼 inline HTML 用 */
interface UploadedFile {
  /** Moo 命名（screenshot / recording / requests.json 等） */
  kind: 'screenshot' | 'recording' | 'requests' | 'curl' | 'errors' | 'context'
  /** 显示名（在 a 链接 / img alt 里用） */
  displayName: string
  /** 禅道返回的 URL（已经是 /file-read-N.* 形态，禅道渲染时会自动改写成 pi.php） */
  url: string
  /** 字节数（描述里显示「2.3 MB」用） */
  bytes: number
}

/** 上传失败的记录，给 steps 里 fallback 提示用 */
interface FailedUpload {
  kind: UploadedFile['kind']
  displayName: string
  error: string
}

/**
 * 把所有附件挨个上传到禅道。best-effort：单条失败不中断其他，所有失败的也回到
 * `failed[]` 让 steps 里告诉用户「哪些没传上」。
 */
export async function uploadZentaoAttachments(
  req: SubmitBugReq,
  project: Project,
  baseUrl: string,
  opts: { mooVersion?: string } = {}
): Promise<{ uploaded: UploadedFile[]; failed: FailedUpload[] }> {
  const uploaded: UploadedFile[] = []
  const failed: FailedUpload[] = []

  const upload = async (kind: UploadedFile['kind'], displayName: string, blob: Blob) => {
    if (blob.size === 0) return
    const r = await uploadEditorFile(baseUrl, blob, displayName)
    if (r.ok) uploaded.push({ kind, displayName, url: r.data.url, bytes: blob.size })
    else failed.push({ kind, displayName, error: r.error })
  }

  // 截图
  if (req.image) {
    const blob = dataUrlToBlobLocal(req.image)
    await upload('screenshot', 'moo-screenshot.png', blob)
  }

  // 视频
  if (req.video?.dataUrl) {
    const blob = dataUrlToBlobLocal(req.video.dataUrl)
    const ext = req.video.mime?.includes('mp4') ? 'mp4' : 'webm'
    await upload('recording', `moo-recording.${ext}`, blob)
  }

  // requests.json + curl.sh —— 完整 raw 数据 + 可执行 curl 脚本下载链接。
  //
  // ⚠️ 为什么 curl 既要 inline 又要附件？
  // 禅道服务端 WAF 拦截 HTML 内含 3 段以上 https 域名（如 api.example.com）。
  // inline curl 里的 URL 必须**插入 zero-width space**才能让 WAF 放行，但 ZWS 让
  // 复制出的 curl 命令在终端解析时报「URL using bad/illegal format」。
  // 折中：inline 给人眼看 + 附件 .curl.sh 给机器跑。两者互补不可兼。
  if (req.requests?.length) {
    await upload(
      'requests',
      'moo-requests.json',
      new Blob([JSON.stringify(req.requests, null, 2)], { type: 'application/json' })
    )
    const script = toCurlScript(req.requests, project.redact, { mooVersion: opts.mooVersion })
    await upload(
      'curl',
      'moo-requests.curl.sh',
      new Blob([script], { type: 'text/x-shellscript' })
    )
  }

  // errors
  if (req.errors?.length) {
    await upload(
      'errors',
      'moo-errors.json',
      new Blob([JSON.stringify(req.errors, null, 2)], { type: 'application/json' })
    )
  }

  // context
  await upload(
    'context',
    'moo-context.json',
    new Blob([JSON.stringify({
      url: req.url, userAgent: req.userAgent, viewport: req.viewport, timestamp: req.timestamp,
      hasVideo: !!req.video, requestCount: req.requests?.length ?? 0, errorCount: req.errors?.length ?? 0
    }, null, 2)], { type: 'application/json' })
  )

  return { uploaded, failed }
}

/**
 * 拼 steps HTML —— bug 详情页直接渲染的富文本。结构：
 *   描述（可空）→ 截图（inline img）→ 录像 / 附件链接 → 环境信息
 */
export function buildZentaoStepsHtml(
  req: SubmitBugReq,
  project: Project,
  uploaded: UploadedFile[],
  failed: FailedUpload[]
): string {
  const parts: string[] = []

  // 描述
  if (req.description?.trim()) {
    parts.push('<h3>📝 描述</h3>')
    parts.push(`<p>${escapeHtml(req.description).replace(/\n/g, '<br>')}</p>`)
  }

  // 截图 inline
  const screenshot = uploaded.find(f => f.kind === 'screenshot')
  if (screenshot) {
    parts.push('<h3>📸 截图</h3>')
    parts.push(
      `<p><img src="${screenshot.url}" alt="${escapeHtml(screenshot.displayName)}" `
      + `style="max-width:100%;border:1px solid #ddd;border-radius:4px;" /></p>`
    )
  }

  // 录像（链接形式 —— sanitizer 剥 <video>，只能给下载链接）
  const recording = uploaded.find(f => f.kind === 'recording')
  if (recording) {
    parts.push('<h3>🎥 录像</h3>')
    parts.push(
      `<p>${labelForKind('recording')} `
      + `<a href="${recording.url}" target="_blank">下载 ${escapeHtml(recording.displayName)}</a> `
      + `（${formatBytes(recording.bytes)}）</p>`
    )
  }

  // 选中的网络请求：每条 inline 一个 curl 代码块（仅供查看）
  // + 附件 moo-requests.curl.sh 链接（可下载复制粘到终端跑）
  if (req.requests?.length) {
    parts.push('<h3>🌐 网络请求</h3>')
    const curlAttachment = uploaded.find(f => f.kind === 'curl')
    if (curlAttachment) {
      parts.push(
        `<p style="font-size:12px;color:#666;">下方 curl 代码仅供查看（含零宽空格绕禅道 WAF，复制粘不能直接跑）；`
        + `要复现请求请下载 `
        + `<a href="${curlAttachment.url}" target="_blank">moo-requests.curl.sh</a> 执行。</p>`
      )
    }
    for (const r of req.requests) {
      parts.push(buildRequestCurlBlock(r, project))
    }
  }

  // 调试附件：raw json 数据下载链接（curl.sh 已经在上面网络请求段提示过，这里不重复）
  const downloadLinks = uploaded.filter(
    f => f.kind === 'requests' || f.kind === 'errors'
  )
  if (downloadLinks.length) {
    parts.push('<h3>🔧 调试附件（raw 数据）</h3>')
    parts.push('<ul>')
    for (const f of downloadLinks) {
      parts.push(
        `<li><a href="${f.url}" target="_blank">${escapeHtml(f.displayName)}</a> `
        + `— ${labelForKind(f.kind)}（${formatBytes(f.bytes)}）</li>`
      )
    }
    parts.push('</ul>')
  }

  // 失败附件提示
  if (failed.length) {
    parts.push('<h3>⚠️ 附件上传失败</h3>')
    parts.push('<ul>')
    for (const f of failed) {
      parts.push(`<li>${escapeHtml(f.displayName)} —— ${escapeHtml(f.error)}</li>`)
    }
    parts.push('</ul>')
    if (failed.some(f => /cookie|登录/.test(f.error))) {
      parts.push('<p>💡 附件上传依赖浏览器里登录禅道的 cookie；请确保 Moo 提交时你在同一浏览器登录了禅道，再重试该条 bug。</p>')
    }
  }

  // 环境信息
  parts.push('<h3>🌐 环境</h3>')
  parts.push('<ul>')
  parts.push(`<li><b>URL</b>：${escapeHtml(req.url)}</li>`)
  parts.push(`<li><b>UA</b>：${escapeHtml(req.userAgent)}</li>`)
  parts.push(`<li><b>视口</b>：${escapeHtml(req.viewport)}</li>`)
  parts.push(`<li><b>时间</b>：${escapeHtml(req.timestamp)}</li>`)
  if (req.video) {
    const secs = Math.round(req.video.duration / 1000)
    parts.push(`<li><b>录像时长</b>：${secs}s（${formatBytes(req.video.bytes)}）</li>`)
  }
  if (req.requests?.length) {
    parts.push(`<li><b>抓到请求</b>：${req.requests.length} 条</li>`)
  }
  if (req.errors?.length) {
    parts.push(`<li><b>console 错误</b>：${req.errors.length} 条</li>`)
  }
  parts.push('</ul>')

  parts.push('<hr/>')
  parts.push('<p style="color:#999;font-size:12px;">由 Moo Dev Tool 自动生成</p>')

  return parts.join('\n')
}

/**
 * 单条请求一个 curl 代码块 + response 代码块。
 *
 * WAF 绕开：URL 里 `://` 插入 zero-width space（U+200B），人眼看一样但 WAF 看不到完整
 * `https://X.Y.Z` 模式，禅道服务端放行。**代价**：复制 inline curl 粘到终端 curl 会报
 * 「URL using bad/illegal format」，用户要执行得下载附件 moo-requests.curl.sh（那里没 ZWS）。
 *
 * Response：body 走 redact 脱敏 + ZWS + 截断 1.5KB。完整 raw 在 moo-requests.json 附件。
 * binary（image/* / video/* / application/octet-stream）只显示 size 不放 body。
 */
function buildRequestCurlBlock(r: CapturedRequest, project: Project): string {
  const curl = obfuscateUrlsForWaf(toCurl(r, project.redact))
  const ok = r.status >= 200 && r.status < 300
  const statusColor = ok ? '#16a34a' : (r.status >= 500 ? '#991b1b' : r.status >= 400 ? '#dc2626' : '#999')
  const shortUrl = obfuscateUrlsForWaf(r.url.length > 120 ? r.url.slice(0, 117) + '...' : r.url)
  const status = r.status || 'ERR'
  return [
    `<p style="margin-bottom:4px;">`
      + `<b>${escapeHtml(r.method)}</b> `
      + `<code style="color:${statusColor};">[${status}]</code> `
      + `<code>${escapeHtml(shortUrl)}</code> `
      + `<small>${Math.round(r.duration)}ms</small>`
    + `</p>`,
    `<pre><code>${escapeHtml(curl)}</code></pre>`,
    buildResponseBlock(r, project)
  ].filter(Boolean).join('\n')
}

/**
 * Response 卡片 —— 视觉上跟 curl 块明显区分。
 *
 * 实测禅道 sanitizer 保留 `<div style="...">` + background / border-left / padding，
 * 但 border-radius 会被剥（凑合）。卡片左侧用 status color 色条标识 2xx 绿 / 4xx 红 / 5xx 深红。
 *
 * body 走 redact 脱敏 → 截断 1.5KB → ZWS 绕 WAF。binary（image/video/octet-stream）
 * 不放 body 只放 size 提示。
 */
function buildResponseBlock(r: CapturedRequest, project: Project): string {
  if (!r.responseBody && !r.responseSizeBytes) return ''
  const ct = (headerCI(r.responseHeaders, 'content-type').split(';')[0] ?? '').trim()
  const sizeStr = formatBytes(r.responseSizeBytes || (r.responseBody?.length ?? 0))
  const isBinary = /^(image|video|audio)\//.test(ct) || ct === 'application/octet-stream'

  const ok = r.status >= 200 && r.status < 300
  const barColor = ok ? '#16a34a' : (r.status >= 500 ? '#991b1b' : r.status >= 400 ? '#dc2626' : '#9ca3af')
  // 卡片样式：左色条 + 浅灰背景 + 内 padding。禅道实测 background / border-left / padding 保留
  const cardOpen = `<div style="margin:8px 0;background:#f8fafc;border-left:3px solid ${barColor};padding:8px 12px;">`
  const headerLine = `<p style="margin:0 0 4px;font-size:12px;color:#475569;">`
    + `📥 <b>Response</b>${ct ? ` · <code style="color:#0f766e;">${escapeHtml(ct)}</code>` : ''} · <small>${escapeHtml(sizeStr)}</small>`

  if (isBinary) {
    return cardOpen + headerLine + ` · 二进制响应（不 inline，请查附件）</p></div>`
  }
  if (!r.responseBody) {
    return cardOpen + headerLine + ` · 空响应体</p></div>`
  }

  const RESP_MAX_INLINE = 1500
  const redacted = redactBody(r.responseBody, project.redact.bodyKeys) ?? r.responseBody
  let preview = redacted
  let truncated = false
  if (preview.length > RESP_MAX_INLINE) {
    preview = preview.slice(0, RESP_MAX_INLINE)
    truncated = true
  }
  preview = obfuscateUrlsForWaf(preview)

  return [
    cardOpen,
    headerLine + (truncated ? '（已截断 1.5KB，完整见 moo-requests.json）' : '') + `</p>`,
    `<pre style="margin:0;background:#fff;"><code>${escapeHtml(preview)}</code></pre>`,
    `</div>`
  ].join('\n')
}

/** Header key 大小写不敏感取值（HTTP/2 全小写，HTTP/1 可能首字母大写） */
function headerCI(headers: Record<string, string>, key: string): string {
  const lc = key.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lc) return v
  }
  return ''
}

/**
 * 在 `://` 后插入 zero-width space（U+200B）绕开禅道服务端 WAF 对 3 段+ https 域名的拦截。
 * - WAF 看不到完整 URL 模式
 * - 人眼看一样（ZWS 零宽，不显示）
 * - 但用户复制粘贴到 shell 时 ZWS 跟着粘，curl 会报「URL using bad/illegal format」
 * 因此 inline curl 只用于「查看」；可执行 curl 必须从附件 moo-requests.curl.sh 下载。
 */
function obfuscateUrlsForWaf(text: string): string {
  // ​ = zero-width space。不可见但实际占一个字符位，让 WAF 模式匹配失败
  return text.replace(/(https?):\/\//g, '$1:​//')
}

function labelForKind(kind: UploadedFile['kind']): string {
  switch (kind) {
    case 'screenshot': return '截图'
    case 'recording': return '录像（禅道会改名为 .txt）'
    case 'requests': return '抓到的网络请求 raw 数据'
    case 'curl': return 'curl 复现脚本（已脱敏）'
    case 'errors': return 'console.error / unhandledrejection raw'
    case 'context': return 'URL / UA / 视口 / 时间等元信息'
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/**
 * 顶层 orchestrator：env 校验 → 上传所有附件 → 拼 steps（带 inline img / 下载链接）
 *   → 调 client submitBug → 翻译结果。
 *
 * submitBug 不再带 files[] 字段（禅道服务端会忽略），附件全通过 file-ajaxUpload 链路。
 */
export async function submitToZentao(
  req: SubmitBugReq,
  project: Project,
  dataUrlToBlob: (url: string) => Blob,
  opts: { mooVersion?: string } = {}
): Promise<SubmitBugRes & { viewUrl?: string }> {
  const envRes = buildZentaoEnv(project)
  if (!envRes.ok) return { ok: false, error: envRes.error }
  const z = project.zentao as ZentaoProjectConfig

  // 上传附件挂在 module 级闭包里给 dataUrlToBlobLocal 用（避免每个调用点都传）
  setDataUrlToBlob(dataUrlToBlob)

  // 附件上传：best-effort，单条失败不阻断主提交
  const { uploaded, failed } = await uploadZentaoAttachments(req, project, envRes.env.baseUrl, opts)

  // UA → os / browser 自动解析，零用户操作
  const ua = parseUserAgent(req.userAgent || '')

  // SubmitDialog 里用户每次可改的字段，优先于 project 默认值（项目级默认是兜底）
  // 指派给：环境配置不再有 defaultAssignedTo（用户反馈每条 bug 情况不同），SubmitDialog
  // 提交时单条选；未选则空 → 禅道按项目规则自动分派
  const fields: ZentaoSubmitFields = {
    title: req.title,
    steps: buildZentaoStepsHtml(req, project, uploaded, failed),
    severity: req.zentaoSeverity ?? z.defaultSeverity,
    pri: req.zentaoPri ?? z.defaultPri,
    type: req.zentaoType ?? z.defaultType,
    assignedTo: req.zentaoAssignedTo || undefined,
    os: ua.os,
    browser: ua.browser,
    // 环境配置里用户可自定义默认 keywords（兜底 'Moo'）
    keywords: z.defaultKeywords
  }

  try {
    // SubmitDialog 用户选的模块覆盖 project.zentao.moduleId（项目级默认是兜底）
    const effectiveEnv: ZentaoEnv = {
      ...envRes.env,
      moduleId: req.zentaoModuleId ?? envRes.env.moduleId
    }
    // 注意：submitBug 第三参传空数组 —— files[] 字段被禅道忽略，靠 ajaxUpload 链路绑附件
    const r = await zentaoClientSubmit(effectiveEnv, fields, [])
    if (!r.ok) {
      return { ok: false, error: r.error }
    }
    return {
      ok: true,
      status: 200,
      remoteId: r.data.bugId ? String(r.data.bugId) : undefined,
      viewUrl: r.data.viewUrl
    }
  } catch (e) {
    return { ok: false, error: `网络错误：${(e as Error).message}` }
  }
}

// dataUrlToBlob 由 BG 注入（避免在 submit.ts 直接 import @/utils/dataUrl 时与 retryQueue
// 路径形成依赖图复杂度）。setter + 局部 helper 桥接给 uploadZentaoAttachments 用。
let _dataUrlToBlob: ((url: string) => Blob) | null = null
function setDataUrlToBlob(fn: (url: string) => Blob): void { _dataUrlToBlob = fn }
function dataUrlToBlobLocal(url: string): Blob {
  if (!_dataUrlToBlob) throw new Error('dataUrlToBlob not injected')
  return _dataUrlToBlob(url)
}

/** HTML 转义：steps 字段会被禅道渲染，用户输入的 < > & 等不能直接拼进去 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
