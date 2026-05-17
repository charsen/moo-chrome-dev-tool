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

export interface CaptureScreenshotReq {}
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

/** background → content 通过 chrome.runtime.sendMessage 广播，告诉所有 tab
 *  录屏快捷键已被触发 + 是否真正进入录制（getMediaStreamId 可能被用户拒）。 */
export interface RecordExternalStartedMsg {
  type: 'RECORD_EXTERNAL_STARTED'
  ok: boolean
  error?: string
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
  RECORD_EXTERNAL_STARTED: 'RECORD_EXTERNAL_STARTED'
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

/** type → response 类型映射。background handler 返回对应类型，caller 侧
 *  可以用 `MessageResponse<typeof MSG.X>` 拿到精确返回 shape。 */
export interface MessageResponseMap {
  [MSG.CAPTURE_SCREENSHOT]: CaptureScreenshotRes
  [MSG.MATCH_PROJECT]: MatchProjectRes
  [MSG.SUBMIT_BUG]: SubmitBugRes
  [MSG.PREVIEW_PAYLOAD]: PreviewPayloadRes
  [MSG.REFRESH_HISTORY_STATUS]: RefreshHistoryStatusRes
  [MSG.RETRY_QUEUE_FLUSH]: RetryQueueFlushRes
  [MSG.RECORD_START]: RecordStartRes
  [MSG.RECORD_STOP]: RecordStopRes
  [MSG.RECORD_CANCEL]: RecordCancelRes
}
export type MessageResponse<K extends keyof MessageResponseMap> = MessageResponseMap[K]
