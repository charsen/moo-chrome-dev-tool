/**
 * 禅道相关 onMessage handler — 6 个 ZENTAO_* MSG case 的逻辑搬出来。
 *
 * v0.5.2 P0 重构第一阶段：把 background/index.ts onMessage 大 switch 内的禅道 6 case
 * 抽成 standalone handler function，目的：
 *   1. **打开单测大门** — 之前 case 在 listener 内联无法单测，现在 import 就能跑
 *   2. **抽 withZentaoSession 共性 helper** — code-simplifier review 提的 6 case 重复的
 *      login+env+ok 检查模板（约 5 行 × 6 = 30 行重复）
 *   3. **未来加新 zentao MSG 不动主 switch** — 加一个 handleZentaoX 函数 + dispatch 表
 *
 * 5 个 zentao API handler 共享一个 pattern：
 *   1. zentaoLogin(creds) 拿 token + 写 cookie
 *   2. login 失败 → 返 error
 *   3. makeZentaoEnv(creds) 拼 env
 *   4. 调 zentao client 函数（listProjects / listUsers / ping / etc）
 *   5. 函数失败 → 返 error；成功 → 返 data
 *
 * withZentaoSession 把 1-3 收口，handler 只写「调什么 + 返什么 shape」。
 *
 * ZENTAO_PING_COOKIE 走 ensureCookieSession（不只 login，还要 verify cookie），
 * ZENTAO_CLEAR_CACHE 不 login（直接清缓存），所以这俩单独写不进 withZentaoSession。
 */

import {
  login as zentaoLogin,
  ping as zentaoPing,
  listProjects as zentaoListProjects,
  listUsers as zentaoListUsers,
  listModules as zentaoListModules,
  discoverProduct as zentaoDiscoverProduct,
  ensureCookieSession as zentaoEnsureCookie,
  _clearZentaoCaches,
  type ZentaoEnv
} from '@/background/zentao/client'
import type {
  ZentaoCredsReq,
  ZentaoTestConnectionRes,
  ZentaoListProjectsRes,
  ZentaoListUsersRes,
  ZentaoListModulesRes,
  ZentaoPingCookieReq,
  ZentaoPingCookieRes
} from '@/types/messages'
import { t } from '@/i18n'
import { hasHostPermission } from '@/utils/hostPermission'

function makeZentaoEnv(creds: { baseUrl: string; account: string; password: string }): ZentaoEnv {
  return { ...creds, projectId: 0, moduleId: 0 }
}

/**
 * 共性 helper：login + makeZentaoEnv + ok 检查收口。handler body 只写「调什么 / 返什么」。
 * 失败时统一返 { ok: false, error }；成功时调 fn(env) 拿业务 data。
 *
 * code-simplifier review (v0.5.0 第 7 波) 提的复制粘贴问题在这里收口。
 */
async function withZentaoSession<T extends { ok: boolean; error?: string }>(
  creds: { baseUrl: string; account: string; password: string },
  fn: (env: ZentaoEnv) => Promise<T>
): Promise<T> {
  // v0.5.3 #128：禅道 handler 走的也是 fetch 用户禅道域，optional <all_urls> 未授权 → CORS / net err
  // 必须在调 zentaoLogin 之前拦，否则用户看到「网络错误」摸不着头脑（mv3-pro review 报告 A）
  if (!await hasHostPermission()) {
    return { ok: false, error: t('host-permission.required') } as T
  }
  const loginRes = await zentaoLogin(creds.baseUrl, creds.account, creds.password)
  if (!loginRes.ok) return { ok: false, error: loginRes.error } as T
  const env = makeZentaoEnv(creds)
  return await fn(env)
}

// ───────────────────────── 6 个 handler ─────────────────────────

export async function handleZentaoTestConnection(payload: ZentaoCredsReq): Promise<ZentaoTestConnectionRes> {
  return withZentaoSession(payload, async (env) => {
    const ping = await zentaoPing(env)
    if (!ping.ok) return { ok: false, error: ping.error }
    return { ok: true, realname: ping.data.realname, account: ping.data.account }
  })
}

export async function handleZentaoListProjects(payload: ZentaoCredsReq): Promise<ZentaoListProjectsRes> {
  return withZentaoSession(payload, async (env) => {
    const list = await zentaoListProjects(env)
    if (!list.ok) return { ok: false, error: list.error }
    return { ok: true, projects: list.data.map(p => ({ id: p.id, name: p.name, status: p.status })) }
  })
}

export async function handleZentaoListUsers(payload: ZentaoCredsReq): Promise<ZentaoListUsersRes> {
  return withZentaoSession(payload, async (env) => {
    const list = await zentaoListUsers(env)
    if (!list.ok) return { ok: false, error: list.error }
    return { ok: true, users: list.data }
  })
}

export async function handleZentaoListModules(payload: ZentaoCredsReq): Promise<ZentaoListModulesRes> {
  const projectId = payload.projectId
  if (!projectId) return { ok: false, error: t('zentao.modules.no-project-id') }
  // v0.8.2：复用 withZentaoSession（hostPerm + login + env 收口语义完全一致）。
  // 唯一差异是本 handler 需要真 projectId（makeZentaoEnv 默认 0）—— 在 callback 内覆盖。
  // 顺序与旧版逐字一致：hostPerm → login → env(projectId) → discoverProduct → listModules。
  return withZentaoSession(payload, async (env) => {
    env.projectId = projectId
    const prod = await zentaoDiscoverProduct(env)
    if (!prod.ok) return { ok: false, error: prod.error }
    const modules = await zentaoListModules(env, prod.data)
    if (!modules.ok) return { ok: false, error: modules.error }
    return { ok: true, modules: modules.data }
  })
}

export async function handleZentaoPingCookie(payload: ZentaoPingCookieReq): Promise<ZentaoPingCookieRes> {
  // v0.2.3 改：payload 含账号密码 → 调 ensureCookieSession 自动登录（cookie 没在
  // 就用账号密码 login 同时拿 token+写 cookie）。用户不再需要手动登录禅道。
  // v0.5.3 #128：ensureCookieSession 内调用 fetch 禅道域，需 host permission check
  if (!await hasHostPermission()) {
    return { ok: false, error: t('host-permission.required') }
  }
  const env = makeZentaoEnv(payload)
  const ensured = await zentaoEnsureCookie(env)
  if (ensured.ok) return { ok: true, realname: ensured.data.realname }
  return { ok: false, error: ensured.error }
}

export function handleZentaoClearCache(): { ok: true } {
  // v0.4.7：Environment 改密码/账号/baseUrl/projectId 后必发，防 envKey 不变导致老 token 复用
  _clearZentaoCaches()
  return { ok: true }
}
