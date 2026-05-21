/**
 * 禅道提交编排层（B' 路径）—— 把 Moo 的 SubmitBugReq 转成 ZentaoSubmitFields
 * + ZentaoFile[]，调 client.submitBug 收 result，再翻译成 SubmitBugRes。
 *
 * 这里只做 orchestration + format，不做 fetch / storage 副作用（这两个全在 client.ts 里）。
 */

import type { Project, ZentaoProjectConfig } from '@/types/config'
import type { SubmitBugReq, SubmitBugRes } from '@/types/messages'
import { toCurlScript } from '@/utils/curlGenerator'
import {
  submitBug as zentaoClientSubmit,
  type ZentaoEnv,
  type ZentaoSubmitFields,
  type ZentaoFile
} from './client'

/**
 * 把项目里的 ZentaoProjectConfig 拼成 client.ts 要的 ZentaoEnv。
 * 在 BG 调用前做完 missing-field 校验，避免后续异步错误难定位。
 */
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
    env: {
      baseUrl: z.baseUrl,
      account: z.account,
      password: z.password,
      projectId: z.projectId,
      moduleId: z.moduleId
    }
  }
}

/**
 * 拼 steps 字段（HTML 富文本）。禅道 form 直接吃 HTML 渲染到 bug 详情页。
 * 结构：描述（可空）+ 环境信息列表 + 附件说明段。
 */
export function buildZentaoStepsHtml(req: SubmitBugReq, attachmentNames: string[]): string {
  const parts: string[] = []
  if (req.description?.trim()) {
    parts.push('<h3>描述</h3>')
    // description 来自用户输入，按段拆。h-escape 之后保留换行成 <br>
    parts.push(`<p>${escapeHtml(req.description).replace(/\n/g, '<br>')}</p>`)
  }
  parts.push('<h3>环境</h3>')
  parts.push('<ul>')
  parts.push(`<li>URL: ${escapeHtml(req.url)}</li>`)
  parts.push(`<li>UA: ${escapeHtml(req.userAgent)}</li>`)
  parts.push(`<li>视口: ${escapeHtml(req.viewport)}</li>`)
  parts.push(`<li>时间: ${escapeHtml(req.timestamp)}</li>`)
  if (req.video) {
    const secs = Math.round(req.video.duration / 1000)
    const mb = (req.video.bytes / 1024 / 1024).toFixed(2)
    parts.push(`<li>录像: ${secs}s / ${mb} MB</li>`)
  }
  parts.push('</ul>')
  if (attachmentNames.length) {
    parts.push('<h3>附件</h3>')
    parts.push('<ul>')
    for (const n of attachmentNames) parts.push(`<li>${escapeHtml(n)}</li>`)
    parts.push('</ul>')
    parts.push('<p>截图见附件；请求/错误明细见 *.json；curl 复现见 *.curl.sh（禅道会把 .sh 重命名为 .txt）。</p>')
  }
  return parts.join('\n')
}

/**
 * 构造禅道附件列表。bgIndex 注入 dataUrlToBlob（避免重复实现 base64 解码）。
 *
 * 附件列表：
 *   - moo-screenshot.png（必有，截图）
 *   - moo-recording.webm（可选，录像）
 *   - moo-requests.json（raw captured requests）
 *   - moo-requests.curl.sh（脱敏后的 curl 复现脚本）
 *   - moo-errors.json（raw console errors）
 *   - moo-context.json（URL / UA / viewport / timestamp 元信息）
 */
export function buildZentaoAttachments(
  req: SubmitBugReq,
  project: Project,
  dataUrlToBlob: (url: string) => Blob,
  opts: { mooVersion?: string } = {}
): ZentaoFile[] {
  const files: ZentaoFile[] = []

  if (req.image) {
    const blob = dataUrlToBlob(req.image)
    if (blob.size > 0) files.push({ name: 'moo-screenshot.png', blob })
  }

  if (req.video?.dataUrl) {
    const blob = dataUrlToBlob(req.video.dataUrl)
    if (blob.size > 0) {
      const ext = req.video.mime?.includes('mp4') ? 'mp4' : 'webm'
      files.push({ name: `moo-recording.${ext}`, blob })
    }
  }

  if (req.requests?.length) {
    files.push({
      name: 'moo-requests.json',
      blob: new Blob([JSON.stringify(req.requests, null, 2)], { type: 'application/json' })
    })
    // curl 脚本走 project.redact 规则脱敏；命中 Authorization / Cookie / X-API-Key / password 等
    // 一律 *** 化，避免凭据被原样吐到禅道附件里
    const script = toCurlScript(req.requests, project.redact, { mooVersion: opts.mooVersion })
    // 禅道把 .sh 自动改名 .txt（安全策略），attach 时两种名字都能用。我们用 .curl.sh
    // 让用户在 OS 下载列表里一眼看出"这是 shell 脚本"
    files.push({
      name: 'moo-requests.curl.sh',
      blob: new Blob([script], { type: 'text/x-shellscript' })
    })
  }

  if (req.errors?.length) {
    files.push({
      name: 'moo-errors.json',
      blob: new Blob([JSON.stringify(req.errors, null, 2)], { type: 'application/json' })
    })
  }

  files.push({
    name: 'moo-context.json',
    blob: new Blob([JSON.stringify({
      url: req.url,
      userAgent: req.userAgent,
      viewport: req.viewport,
      timestamp: req.timestamp,
      hasVideo: !!req.video,
      requestCount: req.requests?.length ?? 0,
      errorCount: req.errors?.length ?? 0
    }, null, 2)], { type: 'application/json' })
  })

  return files
}

/**
 * 顶层 orchestrator：env 校验 → 拼附件 → 拼 steps → 调 client → 翻译结果。
 * 失败时 error 串已经是用户可读消息，BG 层直接进 history。
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

  const files = buildZentaoAttachments(req, project, dataUrlToBlob, opts)
  const fields: ZentaoSubmitFields = {
    title: req.title,
    steps: buildZentaoStepsHtml(req, files.map(f => f.name)),
    severity: z.defaultSeverity,
    pri: z.defaultPri,
    type: z.defaultType,
    assignedTo: z.defaultAssignedTo
  }

  // submitBug / discoverProduct 内部 fetch 不再 catch（client.ts 故意保留异常透传给 caller
  // 看具体哪里炸）；submit 这层是 BG 顶层，必须把网络异常转 ZentaoResult，否则
  // retryQueue 的 flush 异常 throw 出来会被外层当 fatal，整个 flush 失败浪费一轮 alarm。
  try {
    const r = await zentaoClientSubmit(envRes.env, fields, files)
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

/** HTML 转义：steps 字段会被禅道渲染，用户输入的 < > & 等不能直接拼进去 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
