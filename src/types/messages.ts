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
