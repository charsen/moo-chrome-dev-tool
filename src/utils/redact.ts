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

/**
 * URL 里 query 参数的脱敏。形如 `?api_key=sk_xxx&user=foo` 时，
 * 把 keys 命中的参数值替换为 ***，避免完整 URL 被原样上报。
 * 复用 bodyKeys 配置（用户常用的 `token`/`password`/`api_key` 之类）。
 */
export function redactUrl(url: string, keys: string[]): string {
  if (!url || !keys.length) return url
  // 没有 query 的 URL 不需要处理
  const qIdx = url.indexOf('?')
  if (qIdx < 0) return url
  const lowered = new Set(keys.map((k) => k.toLowerCase()))
  try {
    // URL 构造器对协议必备；相对路径会抛错，那时退回正则路径
    const u = new URL(url)
    let touched = false
    const next = new URLSearchParams()
    u.searchParams.forEach((v, k) => {
      if (lowered.has(k.toLowerCase())) { next.append(k, MASK); touched = true }
      else next.append(k, v)
    })
    if (!touched) return url
    u.search = next.toString()
    return u.toString()
  } catch {
    // 退回到字符串替换（处理相对 URL / 不合法但有 ?key=val 的字符串）
    const [head, tail] = [url.slice(0, qIdx), url.slice(qIdx + 1)]
    const parts = tail.split('&').map((p) => {
      const eq = p.indexOf('=')
      if (eq < 0) return p
      const k = p.slice(0, eq)
      return lowered.has(decodeURIComponent(k).toLowerCase()) ? `${k}=${MASK}` : p
    })
    return `${head}?${parts.join('&')}`
  }
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
    // URL query 也走 bodyKeys 脱敏（用户常配的 token/password 等会同时出现在 URL 上）
    url: redactUrl(req.url, cfg.bodyKeys),
    requestHeaders: redactHeaders(req.requestHeaders, cfg.headerKeys),
    responseHeaders: redactHeaders(req.responseHeaders, cfg.headerKeys),
    requestBody: redactBody(req.requestBody, cfg.bodyKeys),
    responseBody: redactBody(req.responseBody, cfg.bodyKeys)
  }
}
