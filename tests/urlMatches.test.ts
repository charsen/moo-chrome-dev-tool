import { describe, it, expect } from 'vitest'
import { urlMatches, matchProjects } from '@/storage/config'
import type { MooConfig } from '@/types/config'

/**
 * v0.8.9 Fix F 回归：urlMatches「scheme://host/path」结构化形态按 Chrome
 * match-pattern 语义对齐。这是行为变更核心，从严覆盖：
 *   - `*.example.com` 命中裸域本身 + 任意层子域（旧译法 `.*\.` 不命中裸域）
 *   - pattern 不写端口 → URL 任意端口命中（旧译法 `:8443` 直接挂）；`:*` 同
 *   - 显式端口精确匹配；scheme `*` → http/https；非结构化 pattern 旧规则兜底
 *
 * 同一份 pattern 既交给 chrome.scripting 注册内容脚本（Chrome 语义）又在这里做
 * 悬浮球/采集匹配 —— 语义分叉 = 「内容脚本注入了但球永远不出」。
 */

describe('urlMatches — v0.8.9 Chrome match-pattern 语义对齐（Fix F）', () => {
  describe('① *.host 命中裸域 + 任意层子域 + 任意端口', () => {
    const pat = 'https://*.example.com/*'
    it('裸域 example.com 本身命中', () => {
      expect(urlMatches('https://example.com/', pat)).toBe(true)
    })
    it('多层子域 a.b.example.com 命中', () => {
      expect(urlMatches('https://a.b.example.com/x', pat)).toBe(true)
    })
    it('裸域带端口 :8443 命中（pattern 无端口 → 任意端口）', () => {
      expect(urlMatches('https://example.com:8443/', pat)).toBe(true)
    })
    it('子域带端口 + 深路径命中', () => {
      expect(urlMatches('https://api.example.com:8443/users/1', pat)).toBe(true)
    })
  })

  describe('② 不许过宽：后缀串域 / query 里的域名不得命中', () => {
    const pat = 'https://*.example.com/*'
    it('notexample.com（无点边界）不命中', () => {
      expect(urlMatches('https://notexample.com/', pat)).toBe(false)
    })
    it('evil.com/?x=example.com（域名只出现在 query）不命中', () => {
      expect(urlMatches('https://evil.com/?x=example.com', pat)).toBe(false)
    })
    it('example.com.evil.com（前缀伪装）不命中', () => {
      expect(urlMatches('https://example.com.evil.com/', pat)).toBe(false)
    })
  })

  describe('③ :* 端口通配', () => {
    const pat = 'http://localhost:*/*'
    it('任意端口 localhost 命中', () => {
      expect(urlMatches('http://localhost:3000/x', pat)).toBe(true)
      expect(urlMatches('http://localhost:8080/', pat)).toBe(true)
    })
    it('无端口 localhost 同样命中（:* 语义含缺省端口）', () => {
      expect(urlMatches('http://localhost/', pat)).toBe(true)
    })
    it('别的 host 不命中', () => {
      expect(urlMatches('http://localhost.evil.com:3000/', pat)).toBe(false)
    })
  })

  describe('④ pattern 无端口 → 带端口 / 带 query 的 URL 命中', () => {
    const pat = 'https://example.com/api/*'
    it('带端口命中', () => {
      expect(urlMatches('https://example.com:9443/api/x', pat)).toBe(true)
    })
    it('带 query 命中', () => {
      expect(urlMatches('https://example.com/api/users?id=1', pat)).toBe(true)
    })
    it('路径前缀不符不命中', () => {
      expect(urlMatches('https://example.com/v2/api/x', pat)).toBe(false)
    })
  })

  describe('⑤ 显式端口精确匹配', () => {
    const pat = 'http://internal.example.com:8787/*'
    it(':8787 命中', () => {
      expect(urlMatches('http://internal.example.com:8787/dash', pat)).toBe(true)
    })
    it(':9999 不命中', () => {
      expect(urlMatches('http://internal.example.com:9999/dash', pat)).toBe(false)
    })
    it('无端口不命中（显式端口是精确语义）', () => {
      expect(urlMatches('http://internal.example.com/dash', pat)).toBe(false)
    })
  })

  describe('⑥ scheme `*` → https?', () => {
    const pat = '*://example.com/*'
    it('http / https 都命中', () => {
      expect(urlMatches('http://example.com/a', pat)).toBe(true)
      expect(urlMatches('https://example.com/a', pat)).toBe(true)
    })
    it('ftp 不命中', () => {
      expect(urlMatches('ftp://example.com/a', pat)).toBe(false)
    })
  })

  describe('⑦ 非结构化 pattern 旧规则兜底不回归', () => {
    it('纯 `*` 命中任意 URL', () => {
      expect(urlMatches('https://anything.example.com/x?y=1', '*')).toBe(true)
      expect(urlMatches('chrome-extension://abc/page.html', '*')).toBe(true)
    })
    it('无 scheme 的老配置片段按整串通配（* 匹配任意字符含 /）', () => {
      expect(urlMatches('https://example.com/app/index', '*example.com/app*')).toBe(true)
      expect(urlMatches('https://example.com/other', '*example.com/app*')).toBe(false)
    })
    it('空 pattern 永不命中', () => {
      expect(urlMatches('https://example.com/', '')).toBe(false)
    })
  })

  describe('host 内非前导 * 域内通配（不跨 / 和 :）', () => {
    it('api-*.example.com 命中 api-v2 不跨段', () => {
      expect(urlMatches('https://api-v2.example.com/x', 'https://api-*.example.com/*')).toBe(true)
      expect(urlMatches('https://api-.example.com/x', 'https://api-*.example.com/*')).toBe(true)
      expect(urlMatches('https://api-a/b.example.com/x', 'https://api-*.example.com/*')).toBe(false)
    })
  })

  describe('matchProjects 集成（悬浮球出现判定走同一条路径）', () => {
    const cfg = (patterns: string[]): MooConfig => ({
      globalEnabled: true,
      projects: [{
        id: 'p1', name: 'demo', kind: 'webhook', enabled: true,
        matchPatterns: patterns, servers: [], defaultServerId: '',
        capture: { storageKeys: [], requestBufferSize: 50 },
        redact: { bodyKeys: [], cookies: [], headers: [] }
      } as unknown as MooConfig['projects'][number]]
    })
    it('*.example.com 项目在裸域 + 带端口页面都激活', () => {
      const c = cfg(['https://*.example.com/*'])
      expect(matchProjects(c, 'https://example.com/')).toHaveLength(1)
      expect(matchProjects(c, 'https://example.com:8443/admin')).toHaveLength(1)
      expect(matchProjects(c, 'https://evil.com/?x=example.com')).toHaveLength(0)
    })
  })
})
