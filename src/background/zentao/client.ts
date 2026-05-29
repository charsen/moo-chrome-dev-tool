/**
 * 禅道 client（B' 路径）—— SW 跨 origin 提交 bug 的所有禅道 HTTP 调用集中点。
 *
 * 决策见 docs/handoff-archive/PLAN_v0.2.0.md（v0.2.0 实施计划，已归档）：
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
/**
 * v0.4.0 新增：login 时解析响应里的 user 对象写入此缓存。
 * 用途：v2 没有「ping 当前会话用户」无参端点，只有 `GET /v2/users/{userid}`（按 ID 拿详情），
 * 所以必须在 login 成功的同一调用里把 user.id 缓存住，后续 ping / probeCookieSession 才能查。
 * 缓存 key 跟 tokenCache 一致：`${baseUrl}::${account}`。
 */
const userCache = new Map<string, { id: number; account: string; realname: string }>()
const PRODUCT_TTL = 24 * 60 * 60 * 1000

function envKey(env: ZentaoEnv): string {
  // trimBase 必须跟 loginKey 一致 —— login 时写 userCache 用 trimBase(baseUrl)，envKey 不 trim
  // 会导致 ensureCookieSession 内 `userCache.get(envKey(env))` 拿不到 login 存的值（v0.4.0 修）
  return `${trimBase(env.baseUrl)}::${env.account}`
}

function loginKey(baseUrl: string, account: string): string {
  return `${trimBase(baseUrl)}::${account}`
}

function projectKey(env: ZentaoEnv): string {
  return `${trimBase(env.baseUrl)}::${env.projectId}`
}

/** 测试钩子：单测 / 退出时清干净 */
export function _clearZentaoCaches(): void {
  tokenCache.clear()
  productCache.clear()
  userCache.clear()
}

// ─────────────────────────── 底层 fetch helper ───────────────────────────

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function buildHeaders(extra: Record<string, string> = {}): Headers {
  // X-Requested-With 是禅道返 JSON 的开关：不加则一律回 84KB HTML 登录壳。
  return new Headers({ 'X-Requested-With': 'XMLHttpRequest', ...extra })
}

/**
 * v2 GET 请求统一构造：Token-only header + credentials:'omit'（v2 是 Token 协议，cookie 无效，
 * 见 fetchV1WithCookieFallback 注释）。多个 v2 endpoint（listProjects/listUsers/getBug/
 * discoverProduct/getUser）此前各自重复这同一段 fetch 构造。
 *
 * ⚠️ 只收口「怎么发」，**不收 401 / isV2AuthExpired / schema 解析 / v1 fallback** —— 那些因
 * endpoint 而异、且双轨硬规则要求显式可读，必须留在各自函数里。见 [[feedback_zentao_v2_dual_track_rule]]。
 */
function fetchV2(url: string, token: string): Promise<Response> {
  return fetch(url, { credentials: 'omit', headers: buildHeaders({ 'Token': token }) })
}

/**
 * v0.6.2 dogfood 暴露：某些禅道实例的 v1 endpoint（products / modules）对 `credentials:'omit'`
 * + 仅 Token header 的请求返 403（可能 WAF / 自定义中间件要求 cookie 配合 token）。但用户已经
 * 浏览器登录该禅道（cookie 在 jar 内），只要带上 cookie 就 work。
 *
 * 修法：先正常路径（credentials:'omit'）—— 跟过去多月稳定行为对齐；撞 403 时 cascade 再试
 * `credentials:'include'` 带 cookie 重发。SW 内跨域 fetch 不受 CORS 限制（host_permission 已开
 * <all_urls>），cookie 跟 token 共发禅道服务器哪个 work 用哪个。
 *
 * 不在 v2 endpoint 用此 helper —— v2 是 Token-only 协议（cookie 也无效），增加 include 反而扰动。
 */
async function fetchV1WithCookieFallback(url: string, token: string): Promise<Response> {
  const r1 = await fetch(url, {
    credentials: 'omit',
    headers: buildHeaders({ 'Token': token })
  })
  // 401 走 withAuth retry；非 403 直接返（200 / 其它 4xx / 5xx 由 caller 处理）
  if (r1.status !== 403) return r1
  // 403：cookie cascade。失败仍返 r2（让 caller 看到「都没成」状态码，避免 r1 假成功）
  const r2 = await fetch(url, {
    credentials: 'include',
    headers: buildHeaders({ 'Token': token })
  })
  return r2.ok ? r2 : r1
}

/**
 * v0.6.3：v1 endpoint 失败时统一错误文案。caller 不再重复写 if 403 友好文案 / else 技术错。
 * - 403（cookie cascade 都试过仍被拒）：友好文案告诉用户是禅道服务器拒绝，不是 Moo bug
 * - 其它（5xx / 网络错 / schema 不识别）：保留技术化 `HTTP X（v1 X fallback）` 让 dev 看到状态码 + 哪个 endpoint
 */
function zentaoV1ErrorMsg(res: Response, listName: string, fallbackTag: string): string {
  if (res.status === 403) {
    return `禅道服务器拒绝访问${listName}（HTTP 403）— 可能账号无权限或禅道 WAF 拦截。请联系禅道管理员`
  }
  return `HTTP ${res.status}（${fallbackTag}）`
}

/**
 * 检测禅道 v2 endpoint 鉴权失效的非标响应（v0.4.0 实测发现，在某真禅道实例 biz12 上）。
 *
 * 现象：v2 endpoint 未带 token 或 token 失效时，**不返 401**，而是：
 *   - HTTP 200
 *   - content-type: text/html; charset=UTF-8（不是 application/json）
 *   - body: `{"result":false,"message":"登录已超时，请重新登入!"}`
 *
 * 国产 API 应用层错误码风格（不依赖 HTTP 状态码）。Moo 所有 v2 endpoint 解析里
 * 都必须先过这个 helper，命中就让 withAuth 触发 retry login（清 token 重 login 一次）。
 *
 * v1 endpoint 返标准 401 不走这里，原 `if (res.status === 401) return { _retry }` 即可。
 */
function isV2AuthExpired(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const b = body as { result?: unknown; message?: unknown }
  if (b.result !== false) return false
  const msg = typeof b.message === 'string' ? b.message : ''
  // 中英文 token 失效关键词全兜
  return /登录已超时|请重新登入|请重新登录|未登录|未授权|unauthor|token.*(expir|invalid|missing)/i.test(msg)
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try { return JSON.parse(text) }
  catch { return { _rawText: text.slice(0, 500) } }
}

// ─────────────────────────────── login ────────────────────────────────

/**
 * 用 account+password 换 token。
 *
 * 走 v2 端点（2026-05 实测 真禅道实例 biz12）：
 *   POST /api.php/v2/users/login
 *   body: {account, password}
 *   成功（HTTP 200）: {status:'success', token:'...', user:{id, account, realname, ...}}
 *   失败（HTTP 200）: {status:'failed', reason:'登录失败...'}
 *
 * v0.4.0 改：把响应里的 user 对象写入 userCache（key 跟 tokenCache 共用）。
 *   动机：v2 没有「ping 当前会话用户」无参端点，所有 v2 用户查询都要 userid 路径参数。
 *   login 是唯一拿 userid 的地方（响应自带），错过这次就只能再 login。
 *
 * 注意 v2 失败也返 200，必须看 status 字段。
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
  const body = await readJson(res) as {
    status?: string
    token?: string
    user?: { id?: number | string; account?: string; realname?: string }
    reason?: string
    error?: string
  } | null
  if (res.ok && body?.status === 'success' && typeof body.token === 'string' && body.token) {
    // v0.4.0：把 user 对象写 userCache，给 ping / probeCookieSession 用
    const u = body.user
    if (u && (typeof u.id === 'number' || typeof u.id === 'string') && u.account && u.realname) {
      const uid = typeof u.id === 'number' ? u.id : Number(u.id)
      if (Number.isFinite(uid)) {
        userCache.set(loginKey(baseUrl, account), { id: uid, account: u.account, realname: u.realname })
      }
    }
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
 * 确保有可用的 session + 拿到用户真名（给 SubmitDialog 状态条 / 「测试连接」按钮用）。
 *
 * **v0.4.0 dogfood 后重构 — 完全 v2 化「正规路径」**：
 * 删除 probeCookieSession 主动探测路径，因为：
 *   1. v2 RESTful API 设计上**只接受 token header 鉴权**（dogfood 实测：v2 endpoint 即使带 cookie
 *      也只看 token，没 token 就返 200 + result:false 登录已超时）
 *   2. v2 没有「拿当前会话用户」无参 endpoint（只有 /users/{userid} 按 ID 详情）
 *   3. 唯一能探 cookie 的 v1 `/user` 无参魔法端点，跟 v2 RESTful 风格冲突 —— 不走兜底
 *
 * **正规路径**：trust login 一次（v2 login credentials:'include' 实测同时 set cookie 进 jar），
 * 直接从 userCache 拿 realname 返。token cache 命中跳 login（说明上次 login 还在 SW 内存）；
 * 附件上传真挂了让 uploadEditorFile 报具体错（cookie 真没在 jar 时 zui editor 端点返空 body）。
 *
 * 副作用：login 成功后用户在禅道页面也是登录态（共享 cookie jar）。
 */
export async function ensureCookieSession(env: ZentaoEnv): Promise<ZentaoResult<{ realname: string }>> {
  // ensureToken 内部：token cache 命中 → 复用；不命中 → login（同时写 token + userCache + cookie jar）
  const t = await ensureToken(env)
  if (!t.ok) return t
  const cached = userCache.get(envKey(env))
  if (cached?.realname) return { ok: true, data: { realname: cached.realname } }
  // 罕见：token 在但 userCache 空（比如别处单独清了 user cache）—— 强制重 login 拿完整 user
  _clearToken(env)
  const loginRes = await login(env.baseUrl, env.account, env.password)
  if (!loginRes.ok) return { ok: false, error: loginRes.error }
  tokenCache.set(envKey(env), loginRes.data)
  const reCached = userCache.get(envKey(env))
  if (reCached?.realname) return { ok: true, data: { realname: reCached.realname } }
  return { ok: false, error: 'login 成功但响应里缺 user.realname 字段（v2 login 响应 shape 异常）' }
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
    if (!res.ok) {
      // v0.6.3 同款扫描：403 给友好文案（同 v1 endpoint cascade 后的拒绝场景）
      if (res.status === 403) {
        return { ok: false, error: '禅道服务器拒绝附件上传（HTTP 403）— 可能账号无权限或禅道 WAF 拦截。请确认已登录禅道页面' }
      }
      return { ok: false, error: `HTTP ${res.status}` }
    }
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

/**
 * 验 token 有效性 + 拿用户信息。Settings「测试连接」按钮用。
 *
 * v0.4.0 改走 v2 `GET /api.php/v2/users/{userid}`。v1 无参 `/user` 端点 v2 没等价 —— 必须用
 * cached userId 当路径参数。userCache 在 login 成功时写入，ensureToken 内若 token 未缓存会
 * 自动 login → 顺便填 userCache。所以正常路径下 ping 调用前 userCache 必有值。
 */
export async function ping(env: ZentaoEnv): Promise<ZentaoResult<ZentaoProfile>> {
  return withAuth(env, async (token) => {
    const cached = userCache.get(envKey(env))
    if (!cached) {
      // 罕见：ensureToken 复用了已有 token cache 但 userCache 被清（比如别处单独 _clearZentaoCaches）
      // 强制重 login 拿 user
      _clearToken(env)
      return { _retry: true as const }
    }
    const url = `${trimBase(env.baseUrl)}/api.php/v2/users/${cached.id}`
    const res = await fetchV2(url, token)
    if (res.status === 401) return { _retry: true as const }
    if (!res.ok) {
      // v0.6.3 同款扫描：403 友好文案（ping v2 路径，token 有效但实例拒绝详情读）
      if (res.status === 403) {
        return { ok: false as const, error: '禅道服务器拒绝获取当前用户信息（HTTP 403）— 可能 token 权限不足或禅道 WAF 拦截' }
      }
      return { ok: false as const, error: `HTTP ${res.status}` }
    }
    // v2 详情端点平铺响应（实测 + 文档惯例：v2 detail endpoint 直接返对象字段，不嵌套）
    const body = await readJson(res) as {
      result?: boolean; message?: string
      id?: number | string; account?: string; realname?: string
      profile?: { id?: number; account?: string; realname?: string }
    } | null
    if (isV2AuthExpired(body)) return { _retry: true as const }
    // v0.4.2 dogfood 修：v2 /users/{id} 响应非标时 fallback 到 cached（不再 abort）。
    // 起因：某些禅道实例返非标 schema（缺 id / 缺 realname / 字段名不同），但 token 真有效
    //   （res.ok + 非 v2AuthExpired）。cached 来自 login 必齐，用它兜底比报「v2 用户详情响应格式不对」好。
    // 严格 validation 把响应当 fallback「更新 cache」，能解析就更新，不能就保持 cached。
    const idRaw = body?.id ?? body?.profile?.id
    const account = body?.account || body?.profile?.account
    const realname = body?.realname || body?.profile?.realname
    if (idRaw != null && account && realname) {
      const id = typeof idRaw === 'number' ? idRaw : Number(idRaw)
      if (Number.isFinite(id)) {
        // 解析成功 → 更新 cache（万一禅道侧改名）
        userCache.set(envKey(env), { id, account, realname })
        return { ok: true as const, data: { id, account, realname } }
      }
    }
    // 解析失败但 token 有效 → 用 cached（login 拿的，必齐）
    return { ok: true as const, data: { id: cached.id, account: cached.account, realname: cached.realname } }
  })
}

// ─────────────────────────── listProjects ────────────────────────────

/**
 * Settings「从禅道拉列表」用。
 *
 * 双路探测（v0.4.3）：
 *   1. v2 `GET /api.php/v2/projects?browseType=all&recPerPage=N&pageID=1`
 *      - browseType=all 防 v2 默认 undone 陷阱；分页用 recPerPage（v2 不认 limit）
 *   2. v2 拿不到 → fallback v1 `GET /api.php/v1/projects?limit=N`
 *
 * 双轨原因：v0.4.0 hard 切换 v2 后多次踩到「不同禅道实例 v2 响应 schema 不一致」陷阱
 * （ping/discoverProduct/listProjects 同类问题）。v1 endpoint dogfood 多月稳定。
 * 见 [[feedback_zentao_v2_dual_track_rule]]。
 */
export async function listProjects(env: ZentaoEnv, limit = 50): Promise<ZentaoResult<ZentaoProjectSummary[]>> {
  return withAuth(env, async (token) => {
    // ── 路径 1：v2 ──
    const v2Url = `${trimBase(env.baseUrl)}/api.php/v2/projects?browseType=all&recPerPage=${limit}&pageID=1`
    const v2Res = await fetchV2(v2Url, token)
    if (v2Res.status === 401) return { _retry: true as const }
    if (v2Res.ok) {
      const body = await readJson(v2Res) as { projects?: ZentaoProjectSummary[]; status?: string; result?: boolean; message?: string } | null
      if (isV2AuthExpired(body)) return { _retry: true as const }
      if (Array.isArray(body?.projects)) return { ok: true as const, data: body.projects }
    }
    // ── 路径 2：v1 fallback ──
    const v1Url = `${trimBase(env.baseUrl)}/api.php/v1/projects?limit=${limit}`
    // v0.6.2 dogfood：v1 endpoint cookie cascade 兜底
    const v1Res = await fetchV1WithCookieFallback(v1Url, token)
    if (v1Res.status === 401) return { _retry: true as const }
    if (!v1Res.ok) return { ok: false as const, error: zentaoV1ErrorMsg(v1Res, '项目列表', 'v1 projects fallback') }
    const v1Body = await readJson(v1Res) as { projects?: ZentaoProjectSummary[] } | null
    if (Array.isArray(v1Body?.projects)) return { ok: true as const, data: v1Body!.projects! }
    return { ok: false as const, error: 'v2/v1 项目列表响应都不识别' }
  })
}

// ────────────────────────── listUsers ──────────────────────────

/**
 * 拉禅道全公司用户列表。SubmitDialog「指派给」下拉用 —— 实测 v1/v2 都没有「按项目过滤的项目成员」
 * 端点（v1 试过 404），列全公司用户是 next-best：前端搜索过滤即可。
 *
 * 双路探测（v0.4.3）：
 *   1. v2 `GET /api.php/v2/users?recPerPage=N&pageID=1`（recPerPage 上限 1000）
 *   2. v2 拿不到 → fallback v1 `GET /api.php/v1/users?limit=N`
 *
 * 见 [[feedback_zentao_v2_dual_track_rule]]。
 */
export async function listUsers(env: ZentaoEnv, limit = 200): Promise<ZentaoResult<ZentaoUserSummary[]>> {
  return withAuth(env, async (token) => {
    const v2Url = `${trimBase(env.baseUrl)}/api.php/v2/users?recPerPage=${limit}&pageID=1`
    const v2Res = await fetchV2(v2Url, token)
    if (v2Res.status === 401) return { _retry: true as const }
    if (v2Res.ok) {
      const body = await readJson(v2Res) as { users?: ZentaoUserSummary[]; status?: string; result?: boolean; message?: string } | null
      if (isV2AuthExpired(body)) return { _retry: true as const }
      if (Array.isArray(body?.users)) {
        return { ok: true as const, data: body.users.map(u => ({ id: u.id, account: u.account, realname: u.realname, role: u.role })) }
      }
    }
    const v1Url = `${trimBase(env.baseUrl)}/api.php/v1/users?limit=${limit}`
    // v0.6.2 dogfood：v1 endpoint cookie cascade 兜底
    const v1Res = await fetchV1WithCookieFallback(v1Url, token)
    if (v1Res.status === 401) return { _retry: true as const }
    if (!v1Res.ok) return { ok: false as const, error: zentaoV1ErrorMsg(v1Res, '用户列表', 'v1 users fallback') }
    const v1Body = await readJson(v1Res) as { users?: ZentaoUserSummary[] } | null
    if (Array.isArray(v1Body?.users)) {
      return { ok: true as const, data: v1Body!.users!.map(u => ({ id: u.id, account: u.account, realname: u.realname, role: u.role })) }
    }
    return { ok: false as const, error: 'v2/v1 用户列表响应都不识别' }
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

type BugRawFields = {
  id?: number; status?: string; subStatus?: string; deleted?: boolean | string
  assignedTo?: string | { account?: string; realname?: string }
  resolution?: string; resolvedBy?: string; closedBy?: string; lastEditedDate?: string
}

function shapeBugDetail(bug: BugRawFields): ZentaoBugDetail {
  const assignedToObj = typeof bug.assignedTo === 'object' ? bug.assignedTo : null
  return {
    id: bug.id as number,
    status: bug.status ?? 'unknown',
    subStatus: bug.subStatus || undefined,
    deleted: bug.deleted === true || bug.deleted === '1' || bug.deleted === 'true',
    assignedTo: assignedToObj?.account || (typeof bug.assignedTo === 'string' ? bug.assignedTo : undefined),
    assignedToName: assignedToObj?.realname,
    resolution: bug.resolution || undefined,
    resolvedBy: bug.resolvedBy || undefined,
    closedBy: bug.closedBy || undefined,
    lastEditedDate: bug.lastEditedDate || undefined
  }
}

/**
 * 拉单条 bug 详情 —— 历史 Tab 状态回查用。v0.3.0 新增，v0.4.0 改走 v2，v0.4.3 双轨化。
 *
 * 双路探测：
 *   1. v2 `GET /api.php/v2/bugs/{bugid}` — 响应嵌套 `{status, bug:{...}}` 或平铺都兜
 *   2. v2 schema 不识别 → fallback v1 `GET /api.php/v1/bugs/{bugid}`（v1 顶层平铺）
 *
 * 见 [[feedback_zentao_v2_dual_track_rule]]。
 */
export async function getBug(env: ZentaoEnv, bugId: number): Promise<ZentaoResult<ZentaoBugDetail>> {
  return withAuth(env, async (token) => {
    const v2Url = `${trimBase(env.baseUrl)}/api.php/v2/bugs/${bugId}`
    const v2Res = await fetchV2(v2Url, token)
    if (v2Res.status === 401) return { _retry: true as const }
    if (v2Res.status === 404) return { ok: false as const, error: 'bug 不存在或已彻底删除' }
    if (v2Res.ok) {
      const body = await readJson(v2Res) as {
        status?: string; result?: boolean; message?: string
        bug?: BugRawFields
      } & BugRawFields | null
      if (isV2AuthExpired(body)) return { _retry: true as const }
      const bug = body?.bug ?? (body && typeof body.id === 'number' ? body : null)
      if (bug && typeof bug.id === 'number') return { ok: true as const, data: shapeBugDetail(bug) }
    }
    // ── v1 fallback：顶层平铺 ──
    // v0.6.3 同款扫描修：之前漏 cookie cascade（跟 listProjects/listUsers/listModules/discoverProduct 同款）
    const v1Url = `${trimBase(env.baseUrl)}/api.php/v1/bugs/${bugId}`
    const v1Res = await fetchV1WithCookieFallback(v1Url, token)
    if (v1Res.status === 401) return { _retry: true as const }
    if (v1Res.status === 404) return { ok: false as const, error: 'bug 不存在或已彻底删除' }
    if (!v1Res.ok) return { ok: false as const, error: zentaoV1ErrorMsg(v1Res, 'bug 详情', 'v1 bug fallback') }
    const v1Body = await readJson(v1Res) as BugRawFields | null
    if (!v1Body || typeof v1Body.id !== 'number') return { ok: false as const, error: 'v2/v1 bug 详情响应都不识别' }
    return { ok: true as const, data: shapeBugDetail(v1Body) }
  })
}

// ────────────────────────── listModules ──────────────────────────

/**
 * 拉 product 的 bug 模块列表。SubmitDialog「所属模块」下拉用。
 *
 * **此函数保留 v1 端点**（v0.4.0 决策）：禅道 v2 RESTful API 21 个章节里**没有 Module 章节**
 * （2026-05-22 实测查证 + 两次独立 WebFetch 互证），既不在 Product 也不在 Project 子端点下。
 * 全 v2 化在此点 hard-stop —— 强行下线「所属模块」下拉会丢功能，强行从 bug 列表推断又拿不到
 * path/parent 层级。**这是禅道架构层的局限**，不是 Moo 偷懒。等禅道补 v2 module 章节再收口。
 *
 * 实测端点：GET /api.php/v1/modules?id={productId}&type=bug
 *   - 返回 {modules:[{id, name, path, parent, ...}]}
 *   - 没建过模块的 product 返 {modules:[]}（此时下拉只显示「根模块（/）」）
 */
export async function listModules(env: ZentaoEnv, productId: number): Promise<ZentaoResult<ZentaoModuleSummary[]>> {
  return withAuth(env, async (token) => {
    const url = `${trimBase(env.baseUrl)}/api.php/v1/modules?id=${productId}&type=bug`
    // v0.6.2 dogfood：某些禅道实例 v1 endpoint 撞 403，cookie cascade 兜底
    const res = await fetchV1WithCookieFallback(url, token)
    if (res.status === 401) return { _retry: true as const }
    const body = await readJson(res) as { modules?: ZentaoModuleSummary[] } | null
    if (res.ok && Array.isArray(body?.modules)) {
      return { ok: true as const, data: body.modules.map(m => ({ id: m.id, name: m.name, path: m.path, parent: m.parent })) }
    }
    return { ok: false as const, error: zentaoV1ErrorMsg(res, '模块列表', 'v1 modules') }
  })
}

// ────────────────────────── discoverProduct ──────────────────────────

/**
 * 拿 project 关联的 product id。
 *
 * 双路探测：v2 项目详情 → v1 products?project= fallback。
 *
 * 先试 v2 `GET /api.php/v2/projects/{projectid}`：响应里有 `products` 字段就用。
 *
 * v0.4.3 fallback：v2 拿不到（200 但 products 字段缺/空/格式不识别 / HTTP 非 401/404 错误）
 * → 退到 v1 `GET /api.php/v1/products?project={projectid}`（v0.3.x 一直工作）。
 * 原因：dogfood 发现不同禅道实例 v2 项目详情 schema 差异大，有的实例根本不返 products 字段，
 * 跟 v0.4.2 ping 的 v2 /users/{id} 是同类问题。v1 endpoint dogfood 多月实测稳定。
 *
 * 401/404 不 fallback：401 直接走 retry 链；404 是项目本身不存在，v1 也救不了。
 *
 * 结果按 baseUrl+projectId 缓存 24h。
 */
export async function discoverProduct(env: ZentaoEnv): Promise<ZentaoResult<number>> {
  const pk = projectKey(env)
  const cached = productCache.get(pk)
  if (cached && Date.now() - cached.cachedAt < PRODUCT_TTL) {
    return { ok: true, data: cached.productId }
  }
  return withAuth(env, async (token) => {
    // ── 路径 1：v2 项目详情 ──
    const v2Url = `${trimBase(env.baseUrl)}/api.php/v2/projects/${env.projectId}`
    const v2Res = await fetchV2(v2Url, token)
    if (v2Res.status === 401) return { _retry: true as const }
    if (v2Res.status === 404) return { ok: false as const, error: `项目 ${env.projectId} 不存在` }

    if (v2Res.ok) {
      const body = await readJson(v2Res) as {
        status?: string
        result?: boolean; message?: string
        project?: { id?: number; products?: Array<number | { id?: number }> }
        id?: number
        products?: Array<number | { id?: number }>
      } | null
      if (isV2AuthExpired(body)) return { _retry: true as const }
      const proj = body?.project ?? (body && typeof body.id === 'number' ? body : null)
      const products = proj?.products
      if (Array.isArray(products) && products.length > 0) {
        const firstRaw = products[0]
        const productId = typeof firstRaw === 'number'
          ? firstRaw
          : (firstRaw && typeof firstRaw.id === 'number' ? firstRaw.id : NaN)
        if (Number.isFinite(productId)) {
          productCache.set(pk, { productId, cachedAt: Date.now() })
          return { ok: true as const, data: productId }
        }
      }
      // v2 拿不到 → 进 v1 fallback（不直接报错）
    }

    // ── 路径 2：v1 fallback ──
    const v1Url = `${trimBase(env.baseUrl)}/api.php/v1/products?project=${env.projectId}`
    // v0.6.2 dogfood：某些禅道实例 v1 endpoint 撞 403，cookie cascade 兜底
    const v1Res = await fetchV1WithCookieFallback(v1Url, token)
    if (v1Res.status === 401) return { _retry: true as const }
    if (!v1Res.ok) return { ok: false as const, error: zentaoV1ErrorMsg(v1Res, '产品列表', 'v1 product fallback') }
    const v1Body = await readJson(v1Res) as {
      products?: Array<{ id?: number; name?: string }>
    } | null
    const v1First = v1Body?.products?.[0]
    if (!v1First || typeof v1First.id !== 'number') {
      return { ok: false as const, error: '该项目未关联任何 product；请先在禅道里给项目绑定 product' }
    }
    productCache.set(pk, { productId: v1First.id, cachedAt: Date.now() })
    return { ok: true as const, data: v1First.id }
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
 * openedBy 自动绑到 token 对应用户**（实测 9340/9342：openedBy="真账号"）。
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

  // 566 是禅道 WAF 拦截（含 3 段以上 https URL 等违规字串）；上层应该已经做 ZWS 绕开
  if (res.status === 566) {
    return { ok: false, error: '禅道服务端 WAF 拦截（HTTP 566）。可能 steps 含违规 URL；Moo 已经做 ZWS 绕开，若仍触发说明该禅道实例 WAF 规则更严格' }
  }
  // v0.4.0：retry 由 res.status === 401 OR v2 非标 (200 + {result:false, message:'登录已超时'}) 触发
  let parsed = await interpretV2BugResponse(env, res)
  if ('_retry' in parsed && parsed._retry) {
    _clearToken(env)
    const t2 = await ensureToken(env)
    if (!t2.ok) return t2
    const retryRes = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: buildHeaders({ 'Content-Type': 'application/json', 'token': t2.data }),
      body: JSON.stringify(body)
    })
    parsed = await interpretV2BugResponse(env, retryRes)
    if ('_retry' in parsed && parsed._retry) {
      return { ok: false, error: '认证持续失败（submitBug 重 login 后 v2 仍返 token 失效）' }
    }
  }
  return parsed as ZentaoResult<SubmitSuccess>
}

async function interpretV2BugResponse(env: ZentaoEnv, res: Response): Promise<ZentaoResult<SubmitSuccess> | { _retry: true }> {
  if (res.status === 401) return { _retry: true }
  const body = await readJson(res) as { status?: string; id?: number; message?: unknown; error?: unknown; reason?: string; result?: boolean } | null
  if (isV2AuthExpired(body)) return { _retry: true }
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
