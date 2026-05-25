import { describe, expect, it } from 'vitest'
import { urlToMatchPattern } from '@/utils/urlToMatchPattern'

/**
 * v0.7.1：addProject 自动填 + suggestPattern banner 内 URL → chrome match pattern 转换的边界 case。
 */

describe('urlToMatchPattern', () => {
  it('https URL → host/*', () => {
    expect(urlToMatchPattern('https://example.com/foo')).toBe('https://example.com/*')
  })

  it('http URL → host/*', () => {
    expect(urlToMatchPattern('http://localhost:8080/api')).toBe('http://localhost:8080/*')
  })

  it('剥 query + hash', () => {
    expect(urlToMatchPattern('https://example.com/foo?q=1&x=2#anchor')).toBe('https://example.com/*')
  })

  it('localhost 带端口', () => {
    expect(urlToMatchPattern('http://localhost:3000')).toBe('http://localhost:3000/*')
  })

  it('subdomain 保留', () => {
    expect(urlToMatchPattern('https://api.example.com/v1/users')).toBe('https://api.example.com/*')
  })

  it('chrome:// → null（非 http(s)）', () => {
    expect(urlToMatchPattern('chrome://extensions')).toBeNull()
  })

  it('chrome-extension:// → null', () => {
    expect(urlToMatchPattern('chrome-extension://abc/popup.html')).toBeNull()
  })

  it('file:// → null', () => {
    expect(urlToMatchPattern('file:///path/to/file.html')).toBeNull()
  })

  it('about:blank → null', () => {
    expect(urlToMatchPattern('about:blank')).toBeNull()
  })

  it('view-source: → null', () => {
    expect(urlToMatchPattern('view-source:https://example.com')).toBeNull()
  })

  it('空串 → null', () => {
    expect(urlToMatchPattern('')).toBeNull()
  })

  it('不合法 URL → null（不 throw）', () => {
    expect(urlToMatchPattern('not-a-url')).toBeNull()
    expect(urlToMatchPattern('://broken')).toBeNull()
  })

  it('host 为空 → null（理论上 https:/// 不该出现但兜底）', () => {
    // URL constructor 对 'https:///' throw，走 catch 返 null
    expect(urlToMatchPattern('https:///')).toBeNull()
  })

  it('IDN 域名（中文）→ punycode 保留', () => {
    // URL.host 自动 punycode 化，符合 chrome 行为
    const r = urlToMatchPattern('https://例子.com/foo')
    expect(r).toMatch(/^https:\/\/xn--/)
  })
})
