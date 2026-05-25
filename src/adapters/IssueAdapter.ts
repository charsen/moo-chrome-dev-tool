/**
 * IssueAdapter interface — v0.6.0 起 handler/retryQueue 走的 dispatch 契约。
 *
 * adapter 配置放 Project 字段（zentao 的 baseUrl/account/password / webhook 的 server/endpoint），
 * adapter 通过 `Project & { kind: K }` 泛型 narrow 拿到。
 *
 * retryQueue 入队 payload 形态由 adapter 自决（webhook 存 bodyString，zentao 存完整 SubmitBugReq）。
 * retryQueue 持 unknown，dispatch 时回 adapter — 见 `serializeForRetry` / `retryFromPayload`。
 *
 * 注册 + dispatch：见 `src/adapters/index.ts` 的 `adapterRegistry` + `getAdapter(kind)`。
 */

import type { Project } from '@/types/config'
import type { SubmitBugReq } from '@/types/messages'
import type { BugHistoryEntry } from '@/types/history'

/**
 * adapter 唯一标识。跟 Project.kind / QueuedItem.kind 严格一致。
 *
 * 加新 adapter 时 ① 这里追加 union ② 跟 Project.kind 同步加值 ③ retryQueue.QueuedItem
 * 加新分支 ④ Environment.vue kind 切换器加选项。
 */
export type AdapterKind = 'zentao' | 'webhook' | 'github' // 'github' 是 v1.1 候选

/**
 * adapter.submit 的执行上下文 —— 跨 adapter 通用的 ambient 信息。
 *
 * 不传 chrome.* / fetch（adapter 直接用 globalThis），但 mooVersion / tabId 这类
 * "调用者环境" 信息让 adapter 不用自己去 SW 抓。
 */
export interface AdapterSubmitCtx {
  /** chrome.runtime.getManifest().version —— 拼到 User-Agent / X-Moo-Version 之类 */
  mooVersion?: string
  /** 提交触发的 tab id —— webhook adapter 读 page storage 白名单时要 */
  tabId?: number
}

/**
 * adapter.fetchStatus 的执行上下文 —— 给 webhook adapter 优先用 history entry 当时
 * 记录的 remoteBase（而非项目当前 server.endpoint 推出来的 base，避免用户改 server 后状态回查指向新 base）。
 * zentao adapter 忽略此 ctx。
 */
export interface AdapterFetchStatusCtx {
  /** BugHistoryEntry.remoteBase —— 提交那一刻服务端地址的快照 */
  remoteBase?: string
}

/**
 * adapter.submit 的结果。形态贴合 SubmitBugRes 但收紧字段语义。
 */
export interface AdapterSubmitOutcome {
  ok: boolean
  /** 服务端返的 bug id（zentao: 数字主键；webhook: 服务端约定 ULID/UUID/数字） */
  remoteId?: string
  /** 可点跳详情的 URL（zentao: ${baseUrl}/bug-view-${id}.html / webhook: 服务端给的 viewUrl） */
  viewUrl?: string
  /** 失败原因（用户可见 toast 文案 — adapter 应该走 i18n） */
  error?: string
  /** HTTP 状态码（webhook: resp.status；zentao: 成功 200 / 失败 undefined）— 给 history.result 看 */
  status?: number
  /** 服务端响应 body（webhook: 原始 text；zentao: viewUrl）— 给 history.result.body 存 */
  body?: string
  /**
   * adapter 明确「这条 ok=false 是否值得入队重试」的信号：
   *   - `true` : 适合入队（瞬时网络错 / 5xx）—— retryQueue 仍可能因配额拒
   *   - `false`: 永久失败 / 配置错（404 / 401 / 业务 4xx）—— 不入队
   *   - `undefined`: adapter 没意见，retryQueue 按 HTTP 状态自决（兼容现行行为）
   */
  retryable?: boolean
}

/**
 * 远程状态回查的结果（History tab 刷新状态用）。
 *
 * 走 BugHistoryEntry['remoteStatus'] union（'active' / 'resolved' / 'closed' / ...）
 * 复用现有类型避免漂移。
 */
export type AdapterStatus = BugHistoryEntry['remoteStatus']

/**
 * retryQueue 入队时序列化的 payload。adapter 自决形态：
 *   - zentao: 复用完整 SubmitBugReq（multipart 没法 stringify）+ projectId
 *   - webhook: 序列化后的 bodyString + endpoint + method + headers
 *   - github: 可能是 issue title + body + repo path（未来设计）
 *
 * retryQueue 只持 unknown，发回 adapter 时 adapter 自己 narrow。
 */
export type AdapterRetryPayload = unknown

/**
 * adapter retry 的结果 —— 让 retryQueue 决定 drop / keep / 成功移除。
 */
export type AdapterRetryOutcome =
  | { kind: 'ok' }              // 重试成功，从队列移除
  | { kind: 'drop'; reason: string }  // 永久放弃（认证失败 / 项目已删 / 4xx 等）
  | { kind: 'keep'; status?: number; error: string }  // 仍是瞬时错，attempts++ 后保留

/**
 * 单条 adapter 契约。每个 adapter 一个 module，注册到 registry。
 *
 * K 是 adapter kind 标识，让 submit/fetchStatus 的 project 参数能 narrow 到对应 kind。
 *
 * @example
 *   class ZentaoAdapter implements IssueAdapter<'zentao'> { kind = 'zentao' as const; ... }
 */
export interface IssueAdapter<K extends AdapterKind = AdapterKind> {
  /** 唯一标识，跟 Project.kind 一致 */
  readonly kind: K

  /**
   * 提交 bug —— 唯一必填方法。
   *
   * 失败时 adapter 自己决定要不要 throw —— 但建议捕获在 outcome.error 里返，
   * 让 handleSubmitBug router 不需要 try/catch。
   */
  submit(
    req: SubmitBugReq,
    project: Project,
    ctx: AdapterSubmitCtx
  ): Promise<AdapterSubmitOutcome>

  /**
   * 状态回查 —— History tab 刷新用。
   *
   * adapter 不支持回查时返 undefined（github 早期可能没接 status webhook）。
   * ctx.remoteBase 让 webhook adapter 用 entry 当时的 base，不被项目当前配置覆盖。
   */
  fetchStatus?(
    project: Project,
    remoteId: string,
    ctx?: AdapterFetchStatusCtx
  ): Promise<AdapterStatus | undefined>

  /**
   * retryQueue 入队前调用 —— 把 SubmitBugReq 翻译成 adapter 自己 retry 所需 payload。
   *
   * 返 null = adapter 拒绝入队（payload 太大 / multipart 不可序列化）。
   */
  serializeForRetry(req: SubmitBugReq, project: Project): AdapterRetryPayload | null

  /**
   * retryQueue 触发 flush 时调用 —— payload 是 serializeForRetry 返的那个。
   *
   * project 可能 undefined（用户已删项目 / kind 切换）—— adapter 自决处理。
   * webhook 不依赖 project（payload 自带 endpoint），zentao 必须 project 存在且 kind 匹配。
   */
  retryFromPayload(payload: AdapterRetryPayload, project: Project | undefined): Promise<AdapterRetryOutcome>
}

/**
 * adapter 注册表。SW 启动时 import 所有 adapter 入注册表，运行时按 project.kind 查表。
 *
 * @example
 *   const adapter = adapterRegistry[project.kind]
 *   if (!adapter) return { ok: false, error: `不支持的 adapter kind: ${project.kind}` }
 *   return adapter.submit(req, project, ctx)
 */
export type AdapterRegistry = Partial<Record<AdapterKind, IssueAdapter>>
