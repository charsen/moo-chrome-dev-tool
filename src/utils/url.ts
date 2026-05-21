/**
 * 把用户 fetch / xhr 传入的 url 补成完整 URL（带 origin）。
 *
 * 修复 v0.2.0 的坑：用户写 `fetch('/api/foo')` / `xhr.open('GET', '/api/foo')` 时
 * captured-request 的 url 是相对路径 `/api/foo`，导致 SubmitDialog 显示的 curl + 提
 * 到禅道的 curl 都缺 origin，复制粘到终端不能直接跑。
 *
 * 用 URL 构造器 base=location.href 让浏览器内置算法 normalize：
 *   - 绝对 URL（'https://...'）：原样
 *   - 相对路径（'/foo' / 'foo' / '../foo'）：补 location.origin + path resolve
 *   - protocol-relative（'//host/path'）：补 location.protocol
 *   - 空串 / 非法 URL：返回原值兜底，保证 hook 不抛
 *
 * 注意：main-world.ts 已经在调用前用 shouldSkip 把 chrome-extension: / data: /
 * blob: 等 scheme 跳掉，这里 URL 构造不会撞这些（不用额外白名单）。
 *
 * @param url 入参，可能是相对或绝对
 * @param base 给单测注入用（vitest node env 没 location）；运行时落到 location.href
 */
export function absolutize(url: string, base?: string): string {
  if (!url) return url
  // 已含 scheme（包括 https / http / ws / wss / file 等任意 `xxx:`）—— 不动
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return url
  const baseHref = base ?? (typeof location !== 'undefined' ? location.href : undefined)
  if (!baseHref) return url
  try {
    return new URL(url, baseHref).toString()
  } catch {
    return url
  }
}
