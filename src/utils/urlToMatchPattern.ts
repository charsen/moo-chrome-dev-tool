/**
 * v0.7.1：把 URL 转成 chrome MV3 match pattern（剥 path / query / hash，保留 scheme + host）
 *
 * Environment.vue 的 addProject 自动填 + suggestPattern banner 都用这条转换。抽出来让边界 case
 * 可独立单测（chrome:// / file:// / 空 host / 不合法 URL 等都该返 null fall-through）。
 *
 * 例：
 *   https://example.com/foo/bar?q=1#x → https://example.com/*
 *   http://localhost:8080/api → http://localhost:8080/*
 *   chrome://extensions → null（非 http(s)）
 *   file:///path → null
 */
export function urlToMatchPattern(url: string): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.host) return null
    return `${u.protocol}//${u.host}/*`
  } catch {
    return null
  }
}
