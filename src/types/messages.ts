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
  project: Project | null
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
}

export interface PreviewPayloadReq {
  server: BugServer
  context: Record<string, unknown>
}
export interface PreviewPayloadRes {
  rendered: string
}

export interface GetRequestsRes {
  requests: CapturedRequest[]
}

export interface GetErrorsRes {
  errors: ConsoleError[]
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
