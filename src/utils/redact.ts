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
  // v0.4.9：除 query 外也处理 hash fragment（OAuth implicit flow `#access_token=...&id_token=...`
  // 整条原文之前进 history/webhook/禅道。SPA 也常 `#!/route?token=` 形式放敏感参数）
  const qIdx = url.indexOf('?')
  const hIdx = url.indexOf('#')
  if (qIdx < 0 && hIdx < 0) return url
  const lowered = new Set(keys.map((k) => k.toLowerCase()))
  try {
    const u = new URL(url)
    let touched = false
    // Query 部分
    if (u.search) {
      const next = new URLSearchParams()
      u.searchParams.forEach((v, k) => {
        if (lowered.has(k.toLowerCase())) { next.append(k, MASK); touched = true }
        else next.append(k, v)
      })
      if (touched) u.search = next.toString()
    }
    // Hash fragment 部分（OAuth implicit flow）— 形如 `#k1=v1&k2=v2` 或 `#!/route?k=v`
    if (u.hash) {
      const newHash = redactFragmentString(u.hash.startsWith('#') ? u.hash.slice(1) : u.hash, lowered)
      if (newHash !== (u.hash.startsWith('#') ? u.hash.slice(1) : u.hash)) {
        u.hash = newHash ? '#' + newHash : ''
        touched = true
      }
    }
    return touched ? u.toString() : url
  } catch {
    // 退回到字符串替换（处理相对 URL / 不合法但有 ?key=val 的字符串）
    if (qIdx < 0) return url
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

/** v0.4.9 helper：脱敏 fragment 字符串里的 key=value 对（hash 段不走 URLSearchParams 因为 #!/ 路由前缀） */
function redactFragmentString(frag: string, lowered: Set<string>): string {
  // 找第一个 `?` 或 直接当 query-like 处理
  const qInFrag = frag.indexOf('?')
  if (qInFrag >= 0) {
    // `#!/route?k=v&k2=v2` 形式 — 只动 ? 之后
    const pathPart = frag.slice(0, qInFrag)
    const queryPart = frag.slice(qInFrag + 1)
    return pathPart + '?' + redactKvSegment(queryPart, lowered)
  }
  // 整段当 k=v&k=v（OAuth implicit flow）
  if (frag.includes('=')) {
    return redactKvSegment(frag, lowered)
  }
  return frag
}

function redactKvSegment(seg: string, lowered: Set<string>): string {
  return seg.split('&').map(p => {
    const eq = p.indexOf('=')
    if (eq < 0) return p
    const k = p.slice(0, eq)
    try {
      return lowered.has(decodeURIComponent(k).toLowerCase()) ? `${k}=${MASK}` : p
    } catch {
      return lowered.has(k.toLowerCase()) ? `${k}=${MASK}` : p
    }
  }).join('&')
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
