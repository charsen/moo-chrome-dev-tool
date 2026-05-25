import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toChromeMatchPatterns } from '@/background/dynamicScripts'

/**
 * v0.7.0 content_scripts 动态注册 — translator 单测。
 * syncContentScripts / installDynamicScriptsListeners 需要 mock chrome.scripting + storage
 * （工作量大），先覆盖 translator 这条 pure function 边界。
 */

describe('toChromeMatchPatterns', () => {
  it('标准 chrome match pattern → valid', () => {
    const r = toChromeMatchPatterns(['https://example.com/*'])
    expect(r.valid).toEqual(['https://example.com/*'])
    expect(r.dropped).toEqual([])
  })

  it('subdomain wildcard → valid', () => {
    const r = toChromeMatchPatterns(['https://*.example.com/*'])
    expect(r.valid).toEqual(['https://*.example.com/*'])
  })

  it('http + https 都接受', () => {
    const r = toChromeMatchPatterns(['http://example.com/*', 'https://example.com/*'])
    expect(r.valid).toHaveLength(2)
  })

  it('file:// + ftp:// → drop（只接 http/https，CWS 评审更友好）', () => {
    const r = toChromeMatchPatterns(['file:///path/*', 'ftp://example.com/*'])
    expect(r.valid).toEqual([])
    expect(r.dropped).toEqual(['file:///path/*', 'ftp://example.com/*'])
  })

  it('单 `*` 全宇宙 → drop（chrome 不接受 + 安全风险）', () => {
    const r = toChromeMatchPatterns(['*'])
    expect(r.valid).toEqual([])
    expect(r.dropped).toEqual(['*'])
  })

  it('无 scheme → drop', () => {
    const r = toChromeMatchPatterns(['example.com/*', '*.example.com/*'])
    expect(r.valid).toEqual([])
    expect(r.dropped).toEqual(['example.com/*', '*.example.com/*'])
  })

  it('无 path → drop（chrome MV3 要 path）', () => {
    const r = toChromeMatchPatterns(['https://example.com'])
    expect(r.valid).toEqual([])
    expect(r.dropped).toEqual(['https://example.com'])
  })

  it('chrome-extension:// → drop（非允许 scheme）', () => {
    const r = toChromeMatchPatterns(['chrome-extension://abc/*'])
    expect(r.valid).toEqual([])
  })

  it('长度 > 256 → drop', () => {
    const long = 'https://example.com/' + 'a'.repeat(300)
    const r = toChromeMatchPatterns([long])
    expect(r.valid).toEqual([])
    expect(r.dropped).toEqual([long])
  })

  it('空串 / 仅空白 → skip 不计 dropped', () => {
    const r = toChromeMatchPatterns(['', '  ', '\t\n'])
    expect(r.valid).toEqual([])
    expect(r.dropped).toEqual([])
  })

  it('去重', () => {
    const r = toChromeMatchPatterns([
      'https://example.com/*',
      'https://example.com/*',
      'https://other.com/*'
    ])
    expect(r.valid).toEqual(['https://example.com/*', 'https://other.com/*'])
  })

  it('trim 前后空格', () => {
    const r = toChromeMatchPatterns(['  https://example.com/*  '])
    expect(r.valid).toEqual(['https://example.com/*'])
  })

  it('混合输入 → valid + dropped 分流', () => {
    const r = toChromeMatchPatterns([
      'https://example.com/*',  // valid
      '*',                       // drop
      'example.com',             // drop（无 scheme + 无 path）
      'https://other.com/api/*', // valid
      ''                         // skip
    ])
    expect(r.valid).toEqual(['https://example.com/*', 'https://other.com/api/*'])
    expect(r.dropped).toEqual(['*', 'example.com'])
  })
})

describe('syncContentScripts integration', () => {
  /**
   * syncContentScripts 调用 chrome.scripting.* + chrome.storage + chrome.runtime.getManifest，
   * 边界丰富。这里只 smoke test「manifest 解析失败 → 静默 skip 不 throw」。
   * 完整 register / update / unregister 行为放 e2e 覆盖（lab-tester v0.7.x 跟进）。
   */
  let originalChrome: unknown

  beforeEach(() => {
    originalChrome = (globalThis as { chrome?: unknown }).chrome
  })

  afterEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = originalChrome
    vi.clearAllMocks()
  })

  it('manifest 无 content_scripts → 静默不 throw', async () => {
    ;(globalThis as { chrome?: unknown }).chrome = {
      runtime: { getManifest: () => ({}) },
      storage: {
        local: { async get() { return { mooConfig: { projects: [], globalEnabled: true } } } },
        onChanged: { addListener() {} }
      },
      scripting: {
        async getRegisteredContentScripts() { return [] }
      },
      permissions: {
        onAdded: { addListener() {} },
        onRemoved: { addListener() {} }
      }
    }
    const { syncContentScripts } = await import('@/background/dynamicScripts')
    await expect(syncContentScripts()).resolves.not.toThrow()
  })
})
