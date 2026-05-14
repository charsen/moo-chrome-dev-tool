export type RequestKind = 'fetch' | 'xhr'

export interface CapturedRequest {
  id: string
  kind: RequestKind
  method: string
  url: string
  requestHeaders: Record<string, string>
  requestBody: string | null      // 仅保留 string 形态；FormData/Blob 等记为 '[非字符串体]'
  status: number
  ok: boolean
  responseHeaders: Record<string, string>
  responseBody: string | null     // 截断到 maxBodySize
  responseSizeBytes: number
  startTime: number               // performance.now()
  duration: number                // ms
  startedAt: string               // ISO timestamp
  error?: string
}

export const MAX_BODY_SIZE = 20 * 1024 // 20 KB
