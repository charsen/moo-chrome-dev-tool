import type { Project, BugServer } from './config'
import type { CapturedRequest } from './requests'
import type { ConsoleError } from './errors'

export type MooSource = 'popup' | 'devtools' | 'content' | 'background' | 'injected'

export interface MooMessage<T = unknown> {
  type: string
  source: MooSource
  tabId?: number
  payload?: T
}

// ---- 具体消息载荷 ----

// （CaptureScreenshotReq 空 interface 已删 — runtime 不带 payload，type narrow 不需要）
export interface CaptureScreenshotRes {
  ok: boolean
  dataUrl?: string
  error?: string
}

export interface MatchProjectReq {
  url: string
}
export interface MatchProjectRes {
  /** 首个匹配项目（兼容旧调用方）。无匹配 → null */
  project: Project | null
  /** 所有匹配的项目（包含 project）。0 / 1 / 多个，由 UI 决定是否需要让用户选择 */
  matches: Project[]
}

export interface SubmitBugReq {
  serverId: string
  projectId: string
  title: string
  description: string
  image: string            // base64 dataUrl
  url: string
  userAgent: string
  viewport: string
  timestamp: string
  requests: CapturedRequest[]    // 现场请求快照
  errors: ConsoleError[]         // 现场 console 错误
  elements?: unknown[]           // 用户点选的元素信息（ElementPicker 选中的）
  video?: {
    dataUrl: string              // data:video/webm;base64,...
    bytes: number
    duration: number
    mime: string
  }
  /**
   * 仅 kind=zentao 时使用：SubmitDialog 提交时用户选的字段，覆盖 project.zentao 的
   * default 值。这允许「每条 bug 选不同的严重度 / 指派人」。未填则用 project 默认值。
   */
  zentaoType?: string
  zentaoSeverity?: 1 | 2 | 3 | 4
  zentaoPri?: 1 | 2 | 3 | 4
  zentaoAssignedTo?: string
  /** 用户在 SubmitDialog 选的模块 id（0 = 根模块「/」），覆盖 project.zentao.moduleId */
  zentaoModuleId?: number
}
export interface SubmitBugRes {
  ok: boolean
  status?: number
  body?: string
  error?: string
  /** 解析自响应 body 的远端 id（用于状态回查） */
  remoteId?: string
  /** 是否进入了重试队列（网络失败 / 5xx） */
  queued?: boolean
  /** 本地历史因 storage quota 不够被自动丢弃的最旧条数（>0 时 UI 应提示用户） */
  trimmedHistory?: number
  /** storage 整体异常导致连本次新条都没保存到本地（仅服务端收到了）。
   *  UI 必须区别于"丢了几条旧的"——后者新条还在，前者连新条也不在。 */
  historyAllDropped?: boolean
  /** 仅 zentao kind 路径：成功时返禅道 bug 查看 URL，SubmitDialog 用它显示「禅道里看」 */
  viewUrl?: string
}

export interface PreviewPayloadReq {
  server: BugServer
  context: Record<string, unknown>
}
/** 成功 / 失败两条路径明确区分。原来失败路径走 background outer catch
 *  返回 { ok:false, error } 而声明只有 rendered，调用方读 res.rendered 拿到
 *  undefined 但没 throw —— 用户看到空 pre 而非错误信息。 */
export type PreviewPayloadRes =
  | { ok: true; rendered: string }
  | { ok: false; error: string }

export interface GetRequestsRes {
  requests: CapturedRequest[]
}

export interface GetErrorsRes {
  errors: ConsoleError[]
}

// （RecordExternalStartedMsg / RecordAutoStoppedMsg 两个消息 shape interface 已删 —
//  runtime 通过 MSG.RECORD_EXTERNAL_STARTED / MSG.RECORD_AUTO_STOPPED 字符串识别，
//  没有 import 这些 type 的代码点。新增类似消息时 inline 类型即可）

/** content → background：重新挂载时（同 tab navigation）查录屏是否进行中 */
export interface QueryRecordingStateRes {
  recording: boolean
  /** recording=true 时附 Date.now() ms 形式的开始时刻，用于恢复 elapsed 计时 */
  startedAt?: number
}

// 消息 type 常量
export const MSG = {
  CAPTURE_SCREENSHOT: 'CAPTURE_SCREENSHOT',
  MATCH_PROJECT: 'MATCH_PROJECT',
  SUBMIT_BUG: 'SUBMIT_BUG',
  PREVIEW_PAYLOAD: 'PREVIEW_PAYLOAD',
  GET_REQUESTS: 'GET_REQUESTS',
  CLEAR_REQUESTS: 'CLEAR_REQUESTS',
  GET_ERRORS: 'GET_ERRORS',
  CLEAR_ERRORS: 'CLEAR_ERRORS',
  REFRESH_HISTORY_STATUS: 'REFRESH_HISTORY_STATUS',
  RETRY_QUEUE_FLUSH: 'RETRY_QUEUE_FLUSH',
  RECORD_START: 'RECORD_START',
  RECORD_STOP: 'RECORD_STOP',
  RECORD_CANCEL: 'RECORD_CANCEL',
  RECORD_EXTERNAL_STARTED: 'RECORD_EXTERNAL_STARTED',
  /** content 询问当前 tab 是不是正在录屏（用于 navigation 后恢复 UI） */
  QUERY_RECORDING_STATE: 'QUERY_RECORDING_STATE',
  /** background 广播：录屏被外部因素自动停止（如 Chrome 停止共享条） */
  RECORD_AUTO_STOPPED: 'RECORD_AUTO_STOPPED',
  /** offscreen → background 内部通知：track ended 自动 stopped */
  OFFSCREEN_AUTO_STOPPED: 'OFFSCREEN_AUTO_STOPPED',
  /** devtools → background：用 baseUrl+account+password login + ping 验 token */
  ZENTAO_TEST_CONNECTION: 'ZENTAO_TEST_CONNECTION',
  /** devtools → background：login 后拉项目列表给「📋 从禅道拉列表」下拉用 */
  ZENTAO_LIST_PROJECTS: 'ZENTAO_LIST_PROJECTS',
  /** content → background：拉禅道用户列表给 SubmitDialog 「指派给」下拉用 */
  ZENTAO_LIST_USERS: 'ZENTAO_LIST_USERS',
  /** content → background：ping cookie session 是否有效（提交链路依赖 cookie，
   *  没登录禅道时整条链路会失败，提交前预检让用户看见「请先登录禅道」而不是失败一脸懵） */
  ZENTAO_PING_COOKIE: 'ZENTAO_PING_COOKIE',
  /** v0.4.7：清 SW 内存里的 token/product/user cache（Environment 改密码/账号/baseUrl/projectId 后必发，防 envKey 不变导致老 token 被复用） */
  ZENTAO_CLEAR_CACHE: 'ZENTAO_CLEAR_CACHE',
  /** content → background：拉 product 的 bug 模块列表给 SubmitDialog「所属模块」下拉用 */
  ZENTAO_LIST_MODULES: 'ZENTAO_LIST_MODULES'
} as const

// =================================================================
// 强类型 dispatch 用：每个 type 自带 payload + response shape
// =================================================================
//
// 设计动机：原来 background onMessage 处理用 `message.payload as XxxReq`
// 强转，shape 不匹配 TS 编译期发现不了。这个 IncomingMessage union 让
// switch 的每个 case 自动 narrow，多余 / 缺失字段都会被编译器抓出来。
//
// caller 端（content / popup / devtools）继续走 safeSendMessage<T>，
// 因为旧 API 表达力足够；type-safe sender wrapper 留下个 PR。

export interface RefreshHistoryStatusRes { ok: true; updated: number }
export interface RetryQueueFlushRes { ok: true; processed: number }
export interface RecordStartRes { ok: boolean; error?: string }
export interface RecordStopRes { ok: boolean; dataUrl?: string; bytes?: number; mime?: string; error?: string }
export interface RecordCancelRes { ok: boolean }

/** 禅道凭据；devtools「测试连接」+「拉列表」共用。projectId 不在这里 ——
 *  「测试连接」只验账号密码 + token；「拉列表」也是为了帮用户选 projectId。 */
export interface ZentaoCredsReq {
  baseUrl: string
  account: string
  password: string
  /** ZENTAO_LIST_MODULES 用：BG 先 discoverProduct 拿 productId 再 listModules */
  projectId?: number
}
export interface ZentaoTestConnectionRes {
  ok: boolean
  /** 成功时返用户名（"已登录为 张三"显示用） */
  realname?: string
  account?: string
  error?: string
}
export interface ZentaoListProjectsRes {
  ok: boolean
  projects?: Array<{ id: number; name: string; status: string }>
  error?: string
}

/**
 * 列禅道用户 —— SubmitDialog「指派给」下拉用。
 * payload 复用 ZentaoCredsReq（不复用 project，因为 content 拿不到完整 project）：
 * BG handler 用 baseUrl+account+password 拿 token 后调 /api.php/v1/users。
 */
export interface ZentaoListUsersRes {
  ok: boolean
  users?: Array<{ id: number; account: string; realname: string; role?: string }>
  error?: string
}

/** v0.2.3 起 payload 含账号密码 —— BG 调 ensureCookieSession 自动登录禅道（不再要求用户
 *  手动登录禅道页面）。复用 ZentaoCredsReq 类型，projectId 可选不读。 */
export type ZentaoPingCookieReq = ZentaoCredsReq
export interface ZentaoPingCookieRes {
  ok: boolean
  /** 成功时返用户名给「✓ 已登录为 XXX」显示 */
  realname?: string
  error?: string
}

/** 拉 product 的 bug 模块列表。BG 先 discoverProduct 拿 productId 再 listModules。 */
export interface ZentaoListModulesRes {
  ok: boolean
  modules?: Array<{ id: number; name: string; path?: string; parent?: number }>
  error?: string
}

/** background.onMessage 收到的消息。switch (msg.type) 后每条自动 narrow。
 *  注意：source / tabId 是 envelope 字段，未来 caller 侧若加约束可移到这里。 */
export type IncomingMessage =
  | { type: typeof MSG.CAPTURE_SCREENSHOT }
  | { type: typeof MSG.MATCH_PROJECT; payload?: MatchProjectReq }
  | { type: typeof MSG.SUBMIT_BUG; payload: SubmitBugReq }
  | { type: typeof MSG.PREVIEW_PAYLOAD; payload?: PreviewPayloadReq }
  | { type: typeof MSG.REFRESH_HISTORY_STATUS }
  | { type: typeof MSG.RETRY_QUEUE_FLUSH }
  | { type: typeof MSG.RECORD_START }
  | { type: typeof MSG.RECORD_STOP }
  | { type: typeof MSG.RECORD_CANCEL }
  | { type: typeof MSG.QUERY_RECORDING_STATE }
  | { type: typeof MSG.OFFSCREEN_AUTO_STOPPED }
  | { type: typeof MSG.ZENTAO_TEST_CONNECTION; payload: ZentaoCredsReq }
  | { type: typeof MSG.ZENTAO_LIST_PROJECTS; payload: ZentaoCredsReq }
  | { type: typeof MSG.ZENTAO_LIST_USERS; payload: ZentaoCredsReq }
  | { type: typeof MSG.ZENTAO_PING_COOKIE; payload: ZentaoPingCookieReq }
  | { type: typeof MSG.ZENTAO_CLEAR_CACHE }
  | { type: typeof MSG.ZENTAO_LIST_MODULES; payload: ZentaoCredsReq }

// （MessageResponseMap / MessageResponse 已删 — v0.5.0：全仓 0 引用，运行时通过
//  各 case `sendResponse({ ok, ... } satisfies XxxRes)` 直接 satisfies 显式断言，
//  caller 侧用 `safeSendMessage<XxxRes>` 显式标注泛型。这个映射 type 是冗余抽象层）
