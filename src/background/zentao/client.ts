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
  /** 可选：从 UA 解析的 OS（windows/win10/osx/linux/ios/android/...）— 禅道 enum */
  os?: string
  /** 可选：从 UA 解析的浏览器（chrome/safari/firefox/edge/...）— 禅道 enum */
  browser?: string
  /** 可选：默认填 'Moo' 让团队能按关键词搜出所有 Moo 上报的 bug */
  keywords?: string
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

export interface ZentaoUserSummary {
  id: number
  account: string
  realname: string
  role?: string
}

export interface ZentaoModuleSummary {
  id: number
  name: string
  /** 模块路径如 "/前端/列表页"，根模块路径是 "/" */
  path?: string
  /** 父模块 id，0 表示根 */
  parent?: number
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
    // v0.2.3 改：credentials:'include' 让 Chrome 接收 Set-Cookie 写入 jar，一次 login
    // 拿两样：返 token（API 写操作用 Token header）+ 写 cookie（附件上传用 /file-ajaxUpload.html
    // 必须 cookie session，那个端点 token 路径权限 deny）。
    // 实测：用户已签退状态下，纯 token 路径 v2 login 同时 set cookie，后续 fetch
    // credentials:'include' 完全工作。
    res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
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

// ──────────────────────────── ensureCookieSession ────────────────────────────

/**
 * 确保 cookie session 在。先 ping `/api.php/v1/user`，未登录就调 login 自动登录。
 *
 * 设计动机（v0.2.3）：v0.2.0-0.2.2 要求用户「先在浏览器手动登录禅道页面」才能用 Moo。
 * 实测发现 v2 API `POST /api.php/v2/users/login` 用账号密码登录时**同时也 set cookie**
 * （v0.2.x 一直用了 credentials:'omit' 把 cookie 扔了 → 浪费）。改成 credentials:'include'
 * 即可让 Chrome 接收 Set-Cookie 写入 jar，后续 SW 跨 origin fetch credentials:'include' 自带 cookie，
 * 附件上传 + bug 提交都工作。
 *
 * 副作用提示：login 成功后**用户在禅道页面也是登录态**（共享 cookie jar），跟用户手动登录效果一样。
 *
 * caller（submitToZentao / SubmitDialog cookie 预检）都调它，让用户完全无感 ——
 * 没登录就自动登录，登录态在就直接用，cookie 失效也自动恢复。
 */
export async function ensureCookieSession(env: ZentaoEnv): Promise<ZentaoResult<{ realname: string }>> {
  const probe = await probeCookieSession(env.baseUrl)
  if (probe.ok) return probe
  // cookie 不在 —— 用账号密码自动 login（同时拿 token 进 cache + 写 cookie 进 jar）
  const loginRes = await login(env.baseUrl, env.account, env.password)
  if (!loginRes.ok) return { ok: false, error: loginRes.error }
  tokenCache.set(envKey(env), loginRes.data)
  // 再 probe 确认 cookie 真的写入了
  const reprobe = await probeCookieSession(env.baseUrl)
  if (reprobe.ok) return reprobe
  return { ok: false, error: 'login 成功但 cookie 未写入 jar（请检查 host_permissions 或浏览器 cookie 设置）' }
}

async function probeCookieSession(baseUrl: string): Promise<ZentaoResult<{ realname: string }>> {
  try {
    const res = await fetch(`${trimBase(baseUrl)}/api.php/v1/user`, {
      credentials: 'include',
      headers: new Headers({ 'X-Requested-With': 'XMLHttpRequest' })
    })
    if (!res.ok) return { ok: false, error: `cookie 未登录（HTTP ${res.status}）` }
    const text = await res.text()
    try {
      const body = JSON.parse(text) as { profile?: { realname?: string } }
      if (body.profile?.realname) return { ok: true, data: { realname: body.profile.realname } }
    } catch { /* HTML 错误页 */ }
    return { ok: false, error: 'cookie 未登录（profile 缺失）' }
  } catch (e) {
    return { ok: false, error: `网络错误：${(e as Error).message}` }
  }
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

// ────────────────────────── listUsers ──────────────────────────

/**
 * 拉禅道全公司用户列表。SubmitDialog「指派给」下拉用 —— 实测 v1 项目成员 endpoint 404，
 * 列全公司用户是 next-best：前端搜索过滤即可。
 *
 * limit 默认 200 —— 中小公司一般 < 200 人单页拉完。total > 200 时分页留给将来。
 */
export async function listUsers(env: ZentaoEnv, limit = 200): Promise<ZentaoResult<ZentaoUserSummary[]>> {
  return withAuth(env, async (token) => {
    const url = `${trimBase(env.baseUrl)}/api.php/v1/users?limit=${limit}`
    const res = await fetch(url, {
      credentials: 'omit',
      headers: buildHeaders({ 'Token': token })
    })
    if (res.status === 401) return { _retry: true as const }
    const body = await readJson(res) as { users?: ZentaoUserSummary[] } | null
    if (res.ok && Array.isArray(body?.users)) {
      return { ok: true as const, data: body.users.map(u => ({ id: u.id, account: u.account, realname: u.realname, role: u.role })) }
    }
    return { ok: false as const, error: `HTTP ${res.status}` }
  })
}

// ────────────────────────── getBug ──────────────────────────

export interface ZentaoBugDetail {
  id: number
  status: string             // 'active' / 'resolved' / 'closed'
  subStatus?: string
  deleted: boolean
  assignedTo?: string        // account
  assignedToName?: string    // realname（v1 返 {id, account, realname} 对象）
  resolution?: string        // 'fixed' / 'wontfix' / 'duplicate' / ...
  resolvedBy?: string
  closedBy?: string
  lastEditedDate?: string
}

/**
 * 拉单条 bug 详情 —— 历史 Tab 状态回查用。v0.3 新增。
 * 走 v1 端点（v2 嵌套一层 `{status, bug}` 没必要多绕，v1 直接平铺所有字段）。
 */
export async function getBug(env: ZentaoEnv, bugId: number): Promise<ZentaoResult<ZentaoBugDetail>> {
  return withAuth(env, async (token) => {
    const url = `${trimBase(env.baseUrl)}/api.php/v1/bugs/${bugId}`
    const res = await fetch(url, {
      credentials: 'omit',
      headers: buildHeaders({ 'Token': token })
    })
    if (res.status === 401) return { _retry: true as const }
    if (res.status === 404) return { ok: false as const, error: 'bug 不存在或已彻底删除' }
    if (!res.ok) return { ok: false as const, error: `HTTP ${res.status}` }
    const body = await readJson(res) as {
      id?: number; status?: string; subStatus?: string; deleted?: boolean | string
      assignedTo?: string | { account?: string; realname?: string }
      resolution?: string; resolvedBy?: string; closedBy?: string; lastEditedDate?: string
    } | null
    if (!body || typeof body.id !== 'number') return { ok: false as const, error: 'bug 详情响应格式不对' }
    const assignedToObj = typeof body.assignedTo === 'object' ? body.assignedTo : null
    return {
      ok: true as const,
      data: {
        id: body.id,
        status: body.status ?? 'unknown',
        subStatus: body.subStatus || undefined,
        deleted: body.deleted === true || body.deleted === '1' || body.deleted === 'true',
        assignedTo: assignedToObj?.account || (typeof body.assignedTo === 'string' ? body.assignedTo : undefined),
        assignedToName: assignedToObj?.realname,
        resolution: body.resolution || undefined,
        resolvedBy: body.resolvedBy || undefined,
        closedBy: body.closedBy || undefined,
        lastEditedDate: body.lastEditedDate || undefined
      }
    }
  })
}

// ────────────────────────── listModules ──────────────────────────

/**
 * 拉 product 的 bug 模块列表。SubmitDialog「所属模块」下拉用。
 * 实测端点：GET /api.php/v1/modules?id={productId}&type=bug
 *   - 返回 {modules:[{id, name, path, parent, ...}]}
 *   - 没建过模块的 product 返 {modules:[]}（此时下拉只显示「根模块（/）」）
 */
export async function listModules(env: ZentaoEnv, productId: number): Promise<ZentaoResult<ZentaoModuleSummary[]>> {
  return withAuth(env, async (token) => {
    const url = `${trimBase(env.baseUrl)}/api.php/v1/modules?id=${productId}&type=bug`
    const res = await fetch(url, {
      credentials: 'omit',
      headers: buildHeaders({ 'Token': token })
    })
    if (res.status === 401) return { _retry: true as const }
    const body = await readJson(res) as { modules?: ZentaoModuleSummary[] } | null
    if (res.ok && Array.isArray(body?.modules)) {
      return { ok: true as const, data: body.modules.map(m => ({ id: m.id, name: m.name, path: m.path, parent: m.parent })) }
    }
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
 * 创建禅道 bug —— v2 REST API JSON POST + Token header（v0.2.3 改）。
 *
 * v0.2.0-0.2.2 用 form 端点 `POST /bug-create-...html` + cookie session。
 * dogfood 时本以为 v2 token 路径下 bug.openedBy 会落 system，
 * 但其实是 form 端点的 quirk，**v2 REST `/api.php/v2/bugs` 用 Token header 时
 * openedBy 自动绑到 token 对应用户**（实测 9340/9342：openedBy="13800000000"）。
 *
 * 字段：JSON body 一次传全部 — productID（用 discoverProduct 反查）/ title /
 * openedBuild=['trunk'] / project / module / severity / pri / type / steps /
 * assignedTo / os / browser / keywords。文档没列的字段（os/browser/keywords/
 * assignedTo/module）实测全部生效。
 *
 * 注意 v2 端点**仍走禅道 WAF**：steps 含 3 段域名 URL 也 566，所以 ZWS 绕 WAF
 * 在 submit.ts buildResponseBlock / buildRequestCurlBlock 保留。
 *
 * files[] 参数（v2 API 没这字段）已不传 — 附件改在 submit.ts uploadZentaoAttachments
 * 里通过 /file-ajaxUpload.html 走 cookie 路径（v2 /files 端点账号权限 deny）。
 */
export async function submitBug(
  env: ZentaoEnv,
  fields: ZentaoSubmitFields,
  _files: ZentaoFile[] = []  // 保留参数兼容老调用方，v2 API 用不到
): Promise<ZentaoResult<SubmitSuccess>> {
  const prod = await discoverProduct(env)
  if (!prod.ok) return prod
  const t = await ensureToken(env)
  if (!t.ok) return t

  const body = {
    productID: prod.data,
    title: fields.title,
    openedBuild: ['trunk'],
    project: env.projectId,
    module: env.moduleId,
    severity: fields.severity,
    pri: fields.pri,
    type: fields.type,
    steps: fields.steps,
    // 可选字段（文档没列但实测生效）
    ...(fields.assignedTo ? { assignedTo: fields.assignedTo } : {}),
    ...(fields.os ? { os: fields.os } : {}),
    ...(fields.browser ? { browser: fields.browser } : {}),
    ...(fields.keywords ? { keywords: fields.keywords } : {})
  }

  const url = `${trimBase(env.baseUrl)}/api.php/v2/bugs`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: buildHeaders({ 'Content-Type': 'application/json', 'token': t.data }),
      body: JSON.stringify(body)
    })
  } catch (e) {
    return { ok: false, error: `网络错误：${(e as Error).message}` }
  }

  if (res.status === 401) {
    // token 失效，清缓存重试一次
    _clearToken(env)
    const t2 = await ensureToken(env)
    if (!t2.ok) return t2
    const retryRes = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: buildHeaders({ 'Content-Type': 'application/json', 'token': t2.data }),
      body: JSON.stringify(body)
    })
    return interpretV2BugResponse(env, retryRes)
  }
  // 566 是禅道 WAF 拦截（含 3 段以上 https URL 等违规字串）；上层应该已经做 ZWS 绕开
  if (res.status === 566) {
    return { ok: false, error: '禅道服务端 WAF 拦截（HTTP 566）。可能 steps 含违规 URL；Moo 已经做 ZWS 绕开，若仍触发说明该禅道实例 WAF 规则更严格' }
  }
  return interpretV2BugResponse(env, res)
}

async function interpretV2BugResponse(env: ZentaoEnv, res: Response): Promise<ZentaoResult<SubmitSuccess>> {
  const body = await readJson(res) as { status?: string; id?: number; message?: unknown; error?: unknown; reason?: string } | null
  if (body?.status === 'success' && typeof body.id === 'number') {
    return {
      ok: true,
      data: { bugId: body.id, viewUrl: `${trimBase(env.baseUrl)}/bug-view-${body.id}.html` }
    }
  }
  const errMsg = body?.reason
    || formatMessage(body?.error)
    || formatMessage(body?.message)
    || `HTTP ${res.status}`
  return { ok: false, error: errMsg }
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
