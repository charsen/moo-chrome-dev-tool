import type { RedactConfig } from '@/types/config'
import type { CapturedRequest } from '@/types/requests'

const MASK = '***'

export function redactHeaders(
  headers: Record<string, string>,
  keys: string[]
): Record<string, string> {
  const lowered = new Set(keys.map((k) => k.toLowerCase()))
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k] = lowered.has(k.toLowerCase()) ? MASK : v
  }
  return out
}

export function redactBody(body: string | null, keys: string[]): string | null {
  if (!body) return body
  if (!keys.length) return body
  // 尝试 JSON 处理
  try {
    const parsed = JSON.parse(body)
    return JSON.stringify(redactValue(parsed, keys.map((k) => k.toLowerCase())))
  } catch {
    // 不是 JSON：按 key=value& 形式简单替换
    return body.replace(/([?&]?)([^=&]+)=([^&]*)/g, (full, sep, k: string, v: string) => {
      if (keys.some((kk) => kk.toLowerCase() === k.toLowerCase())) {
        return `${sep}${k}=${MASK}`
      }
      return full
    })
  }
}

function redactValue(val: unknown, lowerKeys: string[]): unknown {
  if (Array.isArray(val)) return val.map((v) => redactValue(v, lowerKeys))
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = lowerKeys.includes(k.toLowerCase()) ? MASK : redactValue(v, lowerKeys)
    }
    return out
  }
  return val
}

export function redactRequest(req: CapturedRequest, cfg: RedactConfig): CapturedRequest {
  return {
    ...req,
    requestHeaders: redactHeaders(req.requestHeaders, cfg.headerKeys),
    responseHeaders: redactHeaders(req.responseHeaders, cfg.headerKeys),
    requestBody: redactBody(req.requestBody, cfg.bodyKeys),
    responseBody: redactBody(req.responseBody, cfg.bodyKeys)
  }
}
