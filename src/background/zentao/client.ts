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
  return withAuth(env, async (token) => {
    const fd = new FormData()
    // 13 位 hex uid，禅道用来绑附件
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
    for (const f of files) {
      fd.append('files[]', f.blob, f.name)
    }
    const url = `${trimBase(env.baseUrl)}/bug-create-0-all-projectID=${env.projectId},moduleID=${env.moduleId}.html`
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: buildHeaders({ 'Token': token }),
      // 注意：不要手动设 Content-Type，让 fetch 自动加 multipart boundary
      body: fd
    })
    if (res.status === 401) return { _retry: true as const }
    const body = await readJson(res) as { result?: string | boolean; message?: unknown; load?: string } | null

    // 禅道 form 端点的响应有两种形态（2026-05 实测）：
    //   - cookie session 路径：{result:'success', message:'保存成功', load:'/bug-view-N'}
    //   - Token header 路径：HTTP 200 + 空 body（bug 实际已写入数据库）
    // 我们走 Token，所以「200 + 空 body」是成功信号。但要再问 server 拿 bugId
    // —— 否则 SubmitDialog 没法跳「禅道里看」链接。
    if (res.ok && body === null) {
      const bugId = await fetchLatestBugId(env, token)
      const viewUrl = bugId > 0
        ? `${trimBase(env.baseUrl)}/bug-view-${bugId}.html`
        : `${trimBase(env.baseUrl)}/project-bug-${env.projectId}.html`
      return { ok: true as const, data: { bugId, viewUrl } }
    }
    if (body && (body.result === 'success' || body.result === true)) {
      const bugId = parseBugIdFromLoad(body.load) ?? (await fetchLatestBugId(env, token))
      const viewUrl = bugId > 0
        ? `${trimBase(env.baseUrl)}/bug-view-${bugId}.html`
        : trimBase(env.baseUrl) + (body.load ?? '')
      return { ok: true as const, data: { bugId, viewUrl } }
    }
    // 401 的另一种表现：禅道返 {result:false, load:'login'} —— 也走 retry
    if (body && (body.load === 'login' || /登录|未登录|登入/.test(formatMessage(body.message)))) {
      return { _retry: true as const }
    }
    return { ok: false as const, error: formatMessage(body?.message) || `HTTP ${res.status}` }
  })
}

/**
 * Token header 路径下 submitBug 拿不到 bugId（响应空 body），所以紧接着查 list
 * 拿最新一条 id。99% 用户场景是「我提一条，立刻看回执」，list[0] 就是这条。
 * 极少数并发提交场景下可能拿错 id（仍是有效 bug，链接也能打开），不过度工程化。
 */
async function fetchLatestBugId(env: ZentaoEnv, token: string): Promise<number> {
  try {
    const url = `${trimBase(env.baseUrl)}/api.php/v1/projects/${env.projectId}/bugs?limit=1`
    const res = await fetch(url, { credentials: 'omit', headers: buildHeaders({ 'Token': token }) })
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
