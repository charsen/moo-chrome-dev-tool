/**
 * 禅道 client（B' 路径）—— SW 跨 origin 提交 bug 的所有禅道 HTTP 调用集中点。
 *
 * 决策见 docs/PLAN_v0.2.0.md：
 * - 禅道无 PAT，token 必须 account+password 换。本地存密码，SW 内存缓存 token，
 *   401 自动重 login。
 * - 用 `Token: xxx` header + `X-Requested-With: XMLHttpRequest`，不带 cookie，
 *   避免误用浏览器 session 造成「在 A 账号下提交到 B 账号 cookie」的混淆。
 * - SW 内存里 productId 也 24h 缓存，避免每次 submit 都 fetch 84KB form HTML。
 */

export interface ZentaoEnv {
  /** 不带 trailing slash */
  baseUrl: string
  account: string
  password: string
  projectId: number
  moduleId: number
}

export interface ZentaoSubmitFields {
  title: string
  /** HTML 富文本，禅道 steps 字段直传 */
  steps: string
  severity: 1 | 2 | 3 | 4
  pri: 1 | 2 | 3 | 4
  type: string
  assignedTo?: string
}

export interface ZentaoFile {
  /** 附件文件名，禅道会把 .sh 改写为 .txt（安全策略） */
  name: string
  blob: Blob
}

export type ZentaoResult<T> = { ok: true; data: T } | { ok: false; error: string }

interface ZentaoProfile {
  id: number
  account: string
  realname: string
}

interface ZentaoProjectSummary {
  id: number
  name: string
  type: string
  status: string
}

// ─────────── 模块级 SW 内存缓存（重启 SW 自动清空，这正是想要的） ───────────

const tokenCache = new Map<string, string>()
const productCache = new Map<string, { productId: number; cachedAt: number }>()
const PRODUCT_TTL = 24 * 60 * 60 * 1000

function envKey(env: ZentaoEnv): string {
  return `${env.baseUrl}::${env.account}`
}

function projectKey(env: ZentaoEnv): string {
  return `${env.baseUrl}::${env.projectId}`
}

/** 测试钩子：单测 / 退出时清干净 */
export function _clearZentaoCaches(): void {
  tokenCache.clear()
  productCache.clear()
}

// ─────────────────────────── 底层 fetch helper ───────────────────────────

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function buildHeaders(extra: Record<string, string> = {}): Headers {
  // X-Requested-With 是禅道返 JSON 的开关：不加则一律回 84KB HTML 登录壳。
  const h = new Headers({ 'X-Requested-With': 'XMLHttpRequest', ...extra })
  return h
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try { return JSON.parse(text) }
  catch { return { _rawText: text.slice(0, 500) } }
}

// ─────────────────────────────── login ────────────────────────────────

/**
 * 用 account+password 换 token。无副作用（不写缓存）。
 *
 * 走 v2 端点（2026-05 实测 yourcompany.chandao.net biz12）：
 *   POST /api.php/v2/users/login
 *   body: {account, password}
 *   成功（HTTP 200）: {status:'success', token:'...', user:{id, account, realname, ...}}
 *   失败（HTTP 200）: {status:'failed', reason:'登录失败...'}
 *
 * 注意 v2 失败也返 200，必须看 status 字段；v2 token 在 v1 的其他端点
 * (/user /products form 端点) 完全兼容，所以其他方法不用动。
 */
export async function login(baseUrl: string, account: string, password: string): Promise<ZentaoResult<string>> {
  const url = `${trimBase(baseUrl)}/api.php/v2/users/login`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ account, password })
    })
  } catch (e) {
    return { ok: false, error: `网络错误：${(e as Error).message}` }
  }
  const body = await readJson(res) as { status?: string; token?: string; reason?: string; error?: string } | null
  if (res.ok && body?.status === 'success' && typeof body.token === 'string' && body.token) {
    return { ok: true, data: body.token }
  }
  const errMsg = body?.reason || body?.error
    || (body && typeof body === 'object' && '_rawText' in body ? String((body as any)._rawText) : `HTTP ${res.status}`)
  return { ok: false, error: errMsg }
}

/** 缓存命中复用，未命中 login 后写入缓存。401 时上层应 _clearToken 后重调一次。 */
export async function ensureToken(env: ZentaoEnv): Promise<ZentaoResult<string>> {
  const k = envKey(env)
  const cached = tokenCache.get(k)
  if (cached) return { ok: true, data: cached }
  const r = await login(env.baseUrl, env.account, env.password)
  if (r.ok) tokenCache.set(k, r.data)
  return r
}

function _clearToken(env: ZentaoEnv): void {
  tokenCache.delete(envKey(env))
}

// ──────────────────────────── uploadEditorFile ────────────────────────────

/**
 * 上传一个文件到禅道，拿到一个图床式 URL（形如 `/file-read-N.png`），
 * 再 inline 进 steps 富文本里 `<img>` / `<a>` 渲染。
 *
 * 这是禅道 zui editor 的图片粘贴上传路径（从 zui3 source 里挖到）：
 *   端点：POST /file-ajaxUpload.html?uid=xxx&extra=editor&field=imgFile&gid=xxx
 *   字段名：imgFile（**不是** files[]，这是 v0.2.0 初版踩的坑）
 *   认证：**必须 cookie session**，Token 路径下返 200 空 body 但实际没存
 *   响应：{error:0, url:"/file-read-N.png"}
 *
 * 因为依赖 cookie，用户必须**先在浏览器里登录禅道页面**。没登录时 cookie 没在，
 * 返 error≠0 或空 body —— caller 应该兜住 fallback（steps 里说明截图未传）。
 *
 * 注意：非图片文件会被禅道**强制改名** .txt（.webm / .sh / .json 都被改）。
 * caller 用返回的 url 拼 `<a>` 链接给用户「下载」是 OK 的，但 `<video src>` 不能用
 * （Content-Type 是 application/octet-stream + zentao sanitizer 也剥 video 标签）。
 */
export async function uploadEditorFile(
  baseUrl: string,
  blob: Blob,
  filename: string
): Promise<ZentaoResult<{ url: string }>> {
  const editorUid = genUid()
  const gid = btoa(`moo-${filename}-${Date.now()}`)
  const url = `${trimBase(baseUrl)}/file-ajaxUpload.html`
    + `?uid=${editorUid}&extra=editor&field=imgFile&gid=${encodeURIComponent(gid)}`
  const fd = new FormData()
  fd.append('imgFile', blob, filename)
  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: new Headers({ 'X-Requested-With': 'XMLHttpRequest' }),
      body: fd
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const text = await res.text()
    if (!text) {
      return { ok: false, error: '禅道未返响应体（请确认浏览器里已登录禅道：附件上传依赖 cookie session）' }
    }
    let body: { error?: number; url?: string; message?: string } | null = null
    try { body = JSON.parse(text) } catch { return { ok: false, error: `禅道返非 JSON: ${text.slice(0, 100)}` } }
    if (body?.error !== 0 || typeof body.url !== 'string') {
      return { ok: false, error: body?.message || '上传失败' }
    }
    return { ok: true, data: { url: body.url } }
  } catch (e) {
    return { ok: false, error: `网络错误：${(e as Error).message}` }
  }
}

// ──────────────────────────────── ping ────────────────────────────────

/** 验 token 有效性 + 拿用户信息。Settings「测试连接」按钮用。 */
export async function ping(env: ZentaoEnv): Promise<ZentaoResult<ZentaoProfile>> {
  return withAuth(env, async (token) => {
    const url = `${trimBase(env.baseUrl)}/api.php/v1/user`
    const res = await fetch(url, {
      credentials: 'omit',
      headers: buildHeaders({ 'Token': token })
    })
    if (res.status === 401) return { _retry: true as const }
    const body = await readJson(res) as { profile?: ZentaoProfile } | null
    if (res.ok && body?.profile) return { ok: true as const, data: body.profile }
    return { ok: false as const, error: `HTTP ${res.status}` }
  })
}

// ─────────────────────────── listProjects ────────────────────────────

/** Settings「从禅道拉列表」用。 */
export async function listProjects(env: ZentaoEnv, limit = 50): Promise<ZentaoResult<ZentaoProjectSummary[]>> {
  return withAuth(env, async (token) => {
    const url = `${trimBase(env.baseUrl)}/api.php/v1/projects?limit=${limit}`
    const res = await fetch(url, {
      credentials: 'omit',
      headers: buildHeaders({ 'Token': token })
    })
    if (res.status === 401) return { _retry: true as const }
    const body = await readJson(res) as { projects?: ZentaoProjectSummary[] } | null
    if (res.ok && Array.isArray(body?.projects)) return { ok: true as const, data: body.projects }
    return { ok: false as const, error: `HTTP ${res.status}` }
  })
}

// ────────────────────────── discoverProduct ──────────────────────────

/**
 * 拿 project 关联的 product id。
 *
 * 旧设计是抓 form HTML 解析 hidden input —— 实测 2026-05 yourcompany.chandao.net
 * 用的是 zin 框架 SPA 渲染，form 在 JS state 里 hydrate，server 给的 72KB HTML
 * 里根本没 `<form>` 标签，纯 zin 路由配置。改走 REST：
 *
 *   GET /api.php/v1/products?project={pid}  →  {products:[{id, name, ...}]}
 *
 * 单条返回，干净。结果按 baseUrl+projectId 缓存 24h（避免每次 submit 都 fetch）。
 */
export async function discoverProduct(env: ZentaoEnv): Promise<ZentaoResult<number>> {
  const pk = projectKey(env)
  const cached = productCache.get(pk)
  if (cached && Date.now() - cached.cachedAt < PRODUCT_TTL) {
    return { ok: true, data: cached.productId }
  }
  return withAuth(env, async (token) => {
    const url = `${trimBase(env.baseUrl)}/api.php/v1/products?project=${env.projectId}`
    const res = await fetch(url, {
      credentials: 'omit',
      headers: buildHeaders({ 'Token': token })
    })
    if (res.status === 401) return { _retry: true as const }
    if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}` }
    const body = await readJson(res) as { products?: Array<{ id: number; name: string }> } | null
    const first = body?.products?.[0]
    if (!first || typeof first.id !== 'number') {
      return { ok: false as const, error: '该项目未关联任何 product；请先在禅道里给项目绑定 product' }
    }
    productCache.set(pk, { productId: first.id, cachedAt: Date.now() })
    return { ok: true as const, data: first.id }
  })
}

// ─────────────────────────────── submitBug ────────────────────────────

export interface SubmitSuccess {
  bugId: number
  /** 完整的 bug 查看 URL，给 SubmitDialog 显示「禅道里看」链接用 */
  viewUrl: string
}

/**
 * 一发 multipart POST。包含 discoverProduct（缓存命中则直接用）。
 * 字段定义与禅道实测一致 —— 详见 docs/PLAN_v0.2.0.md「已实测确认的禅道 API」。
 */
export async function submitBug(
  env: ZentaoEnv,
  fields: ZentaoSubmitFields,
  files: ZentaoFile[]
): Promise<ZentaoResult<SubmitSuccess>> {
  const prod = await discoverProduct(env)
  if (!prod.ok) return prod

  const fd = new FormData()
  fd.append('uid', genUid())
  fd.append('product', String(prod.data))
  fd.append('module', String(env.moduleId))
  fd.append('project', String(env.projectId))
  fd.append('execution', '')
  fd.append('plan', '')
  fd.append('allBuilds', 'on')
  // 'trunk' 是 magic value：项目没构建时也必填，否则禅道返「『影响版本』不能为空」
  fd.append('openedBuild[]', 'trunk')
  fd.append('allUsers', 'on')
  fd.append('type', fields.type)
  fd.append('severity', String(fields.severity))
  fd.append('pri', String(fields.pri))
  fd.append('title', fields.title)
  fd.append('steps', fields.steps)
  fd.append('assignedTo', fields.assignedTo ?? '')
  fd.append('color', '')
  // 这堆 hidden 字段不填禅道会报「未知错误」，全 '0'/'' 兜住
  fd.append('fromCase', '0')
  fd.append('caseVersion', '0')
  fd.append('result', '0')
  fd.append('testtask', '0')
  fd.append('fileList', '[]')
  fd.append('case', '')
  fd.append('story', '')
  fd.append('task', '')
  fd.append('feedbackBy', '')
  fd.append('notifyEmail', '')
  fd.append('contactList', '')
  fd.append('keywords', '')
  // files 参数保留兼容旧调用（已经被禅道服务端忽略，附件实际走 file-ajaxUpload 链路）
  for (const f of files) {
    fd.append('files[]', f.blob, f.name)
  }

  // 提交必须走 cookie session（不带 Token header）—— Token 路径下禅道 form 端点
  // 不查 token→user 映射，bug.openedBy 会落 'system' 看不出谁提的（实测 9279/9285）。
  // cookie session 路径下 openedBy 正确绑到登录用户（实测 9286 → openedBy=13800000000）。
  // 跟附件链路 (file-ajaxUpload) 保持一致：用户必须先在浏览器登录禅道，cookie 才在。
  const url = `${trimBase(env.baseUrl)}/bug-create-0-all-projectID=${env.projectId},moduleID=${env.moduleId}.html`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: new Headers({ 'X-Requested-With': 'XMLHttpRequest' }),
      body: fd
    })
  } catch (e) {
    return { ok: false, error: `网络错误：${(e as Error).message}` }
  }

  const body = await readJson(res) as { result?: string | boolean; message?: unknown; load?: string } | null

  if (body && (body.result === 'success' || body.result === true)) {
    const bugId = parseBugIdFromLoad(body.load) ?? (await fetchLatestBugId(env))
    const viewUrl = bugId > 0
      ? `${trimBase(env.baseUrl)}/bug-view-${bugId}.html`
      : trimBase(env.baseUrl) + (body.load ?? '')
    return { ok: true, data: { bugId, viewUrl } }
  }
  // {result:false, load:'login'} / 「登录已超时」表示 cookie 失效。retry 救不了，
  // 直接报错让用户去登录禅道。SubmitDialog 会显示这条提示。
  if (body && (body.load === 'login' || /登录|未登录|登入/.test(formatMessage(body.message)))) {
    return { ok: false, error: '禅道登录已失效；请打开禅道页面重新登录后再提交' }
  }
  return { ok: false, error: formatMessage(body?.message) || `HTTP ${res.status}` }
}

/**
 * 提交后 bug.load 字段不一定带 bugId（cookie session 可能返 /bug-browse-N.html 列表页），
 * 这时调 REST 列表拿最新 id 给 SubmitDialog「禅道里看」链接用。
 * 走 Token 路径（这里只是查询，token 缓存命中就一次 HTTP）。
 */
async function fetchLatestBugId(env: ZentaoEnv): Promise<number> {
  const t = await ensureToken(env)
  if (!t.ok) return 0
  try {
    const url = `${trimBase(env.baseUrl)}/api.php/v1/projects/${env.projectId}/bugs?limit=1`
    const res = await fetch(url, { credentials: 'omit', headers: buildHeaders({ 'Token': t.data }) })
    if (!res.ok) return 0
    const body = await readJson(res) as { bugs?: Array<{ id: number }> } | null
    return body?.bugs?.[0]?.id ?? 0
  } catch { return 0 }
}

// ───────────────────────── auth-retry harness ─────────────────────────

/**
 * 包裹一段需要 token 的逻辑。inner 返 { _retry:true } 表示遇到 401/login 转登录，
 * 此 harness 清掉 token 缓存后再 ensureToken + 重跑一次。第二次仍失败就吐错。
 */
async function withAuth<T>(
  env: ZentaoEnv,
  inner: (token: string) => Promise<{ ok: true; data: T } | { ok: false; error: string } | { _retry: true }>
): Promise<ZentaoResult<T>> {
  const t1 = await ensureToken(env)
  if (!t1.ok) return t1
  const r1 = await inner(t1.data)
  if ('_retry' in r1 && r1._retry) {
    _clearToken(env)
    const t2 = await ensureToken(env)
    if (!t2.ok) return t2
    const r2 = await inner(t2.data)
    if ('_retry' in r2 && r2._retry) {
      return { ok: false, error: '认证持续失败（重 login 后仍 401）' }
    }
    return r2 as ZentaoResult<T>
  }
  return r1 as ZentaoResult<T>
}

// ─────────────────────────── small utilities ──────────────────────────

/** 13 位 hex；禅道实测要求 13 字符就行，不挑 charset 但 hex 最稳 */
function genUid(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 13)
}

/** 从 {load:'/bug-view-9999.html'} 或 {load:'/project-bug-26.html'} 提取 bugId */
function parseBugIdFromLoad(load: unknown): number | undefined {
  if (typeof load !== 'string') return undefined
  const m = load.match(/bug-view-(\d+)\.html/)
  return m ? Number(m[1]) : undefined
}

/** message 可能是 string 也可能是 {fieldName:['错误1','错误2']} 结构 */
function formatMessage(message: unknown): string {
  if (typeof message === 'string') return message
  if (message && typeof message === 'object') {
    const parts: string[] = []
    for (const [k, v] of Object.entries(message)) {
      if (Array.isArray(v)) parts.push(`${k}: ${v.join('; ')}`)
      else parts.push(`${k}: ${String(v)}`)
    }
    return parts.join(' | ')
  }
  return ''
}
