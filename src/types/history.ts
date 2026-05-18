import type { CapturedRequest } from './requests'
import type { ConsoleError } from './errors'

export interface BugHistoryEntry {
  id: string
  timestamp: number          // Date.now()
  projectId: string
  projectName: string
  serverId: string
  serverName: string
  title: string
  description: string
  image: string              // base64 dataURL
  hasVideo?: boolean         // 仅记录是否带视频，不存 webm dataURL（storage.local 10MB 限制）
  videoDuration?: number     // 秒
  url: string
  userAgent: string
  viewport: string
  requests: CapturedRequest[]
  errors: ConsoleError[]
  result: {
    ok: boolean
    status?: number
    body?: string
    error?: string
    /** 进入了重试队列（仅 5xx / 网络失败时为 true） */
    queued?: boolean
  }
  /** 服务端返回的 id（intake 响应里的 id），用于后续状态回查 */
  remoteId?: string
  /** 上次同步到的远端状态 */
  remoteStatus?: 'open' | 'in_progress' | 'done' | 'deleted'
  /** 上次同步时间（ISO） */
  remoteStatusUpdatedAt?: string
  /** 服务端基地址，用于状态回查（取 server.endpoint 去掉 /intake 后缀） */
  remoteBase?: string
}
