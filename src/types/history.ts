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
  /** v0.7.6 P1-1：禅道项目专属 — 提交时用户选的 type/severity/pri/assignedTo/moduleId 快照。
   *  原 schema 没存这 5 字段，导致 History 重提时 SubmitBugReq 拼不出来 → 禅道侧落 project
   *  默认值（dogfood 撞「我选了严重 2 + 指派同事 X，重提后变回默认」）。entry 自包含这些
   *  字段，重提走同款 submit-bug 链路保持一致。webhook 项目 entry 这些字段 undefined OK。 */
  zentaoType?: string
  zentaoSeverity?: 1 | 2 | 3 | 4
  zentaoPri?: 1 | 2 | 3 | 4
  zentaoAssignedTo?: string
  zentaoModuleId?: number
}
