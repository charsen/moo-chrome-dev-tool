import { describe, it, expect } from 'vitest'
import { normalizeProject, DEFAULT_PAYLOAD_TEMPLATE, DEFAULT_REDACT } from '@/types/config'

// normalizeProject 是导入 / loadConfig 路径的薄冰带 —— 任何用户 / v0.0.x storage
// 喂进来的脏数据都要在这里收尾。这一组测试覆盖各类 sanitize 路径。

describe('normalizeProject — 基本字段', () => {
  it('完全空对象走 default', () => {
    const p = normalizeProject({})
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(p.name).toBe('新项目')
    expect(p.matchPatterns).toEqual([])
    expect(p.servers).toEqual([])
    expect(p.enabled).toBe(true)
    expect(p.capture.requests).toBe(true)
    expect(p.capture.requestBufferSize).toBe(50)
    expect(p.redact).toEqual({ ...DEFAULT_REDACT, headerKeys: [...DEFAULT_REDACT.headerKeys], bodyKeys: [...DEFAULT_REDACT.bodyKeys] })
  })

  it('非对象 raw 不抛', () => {
    expect(() => normalizeProject(null)).not.toThrow()
    expect(() => normalizeProject(undefined)).not.toThrow()
    expect(() => normalizeProject('string')).not.toThrow()
    expect(() => normalizeProject(42)).not.toThrow()
  })

  it('matchPatterns 过滤非字符串', () => {
    const p = normalizeProject({ matchPatterns: ['https://*.x.com/*', 123, null, 'https://y.com/'] })
    expect(p.matchPatterns).toEqual(['https://*.x.com/*', 'https://y.com/'])
  })
})

describe('normalizeProject — capture.storageKeys 白名单', () => {
  it('过滤含特殊字符的 key（防原型污染 + RTL）', () => {
    const p = normalizeProject({
      capture: { storageKeys: ['ok_key', '__proto__', 'constructor', 'prototype', 'has space', 'rtl‮', 'a-b.c:d', ''] }
    })
    expect(p.capture.storageKeys).toEqual(['ok_key', 'a-b.c:d'])
  })

  it('key 长度 ≤ 128 字符', () => {
    const big = 'a'.repeat(129)
    const ok = 'b'.repeat(128)
    const p = normalizeProject({ capture: { storageKeys: [big, ok] } })
    expect(p.capture.storageKeys).toEqual([ok])
  })

  it('上限 50 个 key', () => {
    const keys = Array.from({ length: 60 }, (_, i) => `k${i}`)
    const p = normalizeProject({ capture: { storageKeys: keys } })
    expect(p.capture.storageKeys.length).toBe(50)
  })
})

describe('normalizeProject — capture.requestBufferSize 边界', () => {
  it('<5 走默认（防设 0 让环形缓冲完全失效）', () => {
    expect(normalizeProject({ capture: { requestBufferSize: 0 } }).capture.requestBufferSize).toBe(50)
    expect(normalizeProject({ capture: { requestBufferSize: 4 } }).capture.requestBufferSize).toBe(50)
  })

  it('>500 截到 500（防设 1e9 撑爆内存）', () => {
    expect(normalizeProject({ capture: { requestBufferSize: 10000 } }).capture.requestBufferSize).toBe(500)
  })

  it('正常值保留', () => {
    expect(normalizeProject({ capture: { requestBufferSize: 100 } }).capture.requestBufferSize).toBe(100)
  })

  it('小数四舍五入', () => {
    expect(normalizeProject({ capture: { requestBufferSize: 99.7 } }).capture.requestBufferSize).toBe(100)
  })
})

describe('normalizeProject — token sanitize', () => {
  it('合法 token 保留', () => {
    expect(normalizeProject({ token: 'abc.def-123_+/=' }).token).toBe('abc.def-123_+/=')
  })

  it('空字符串 / 全空白 → undefined', () => {
    expect(normalizeProject({ token: '' }).token).toBeUndefined()
    expect(normalizeProject({ token: '   ' }).token).toBeUndefined()
  })

  it('含 CRLF（header injection 尝试）→ undefined', () => {
    expect(normalizeProject({ token: 'abc\r\nX-Inject: evil' }).token).toBeUndefined()
  })

  it('含控制字符 → undefined', () => {
    expect(normalizeProject({ token: 'abc\x00def' }).token).toBeUndefined()
  })

  it('长度 >512 → undefined', () => {
    expect(normalizeProject({ token: 'a'.repeat(513) }).token).toBeUndefined()
  })

  it('512 字符正好 → 保留（边界）', () => {
    const token = 'a'.repeat(512)
    expect(normalizeProject({ token }).token).toBe(token)
  })

  it('token 自动 trim', () => {
    expect(normalizeProject({ token: '  abc  ' }).token).toBe('abc')
  })
})

describe('normalizeProject — servers normalize（间接覆盖 normalizeServer）', () => {
  it('servers 数组 + 各 server 走 normalize', () => {
    const p = normalizeProject({
      servers: [
        { name: 'A', endpoint: 'https://x.com/api', method: 'POST' },
        { name: 'B', endpoint: 'javascript:alert(1)' }  // 协议白名单清空
      ]
    })
    expect(p.servers).toHaveLength(2)
    expect(p.servers[0]?.endpoint).toBe('https://x.com/api')
    expect(p.servers[1]?.endpoint).toBe('')  // javascript: 被清
  })

  it('header key 必须是合法 HTTP token（防 4MB 表头爆裂）', () => {
    const p = normalizeProject({
      servers: [{ headers: {
        'X-Good': 'v',
        'X Bad Space': 'v',
        'X:Colon': 'v',
        ['X-' + 'a'.repeat(300)]: 'v'  // 超长 key
      }}]
    })
    expect(p.servers[0]?.headers).toEqual({ 'X-Good': 'v' })
  })

  it('header value 含 CRLF → 丢弃（防 header injection）', () => {
    const p = normalizeProject({
      servers: [{ headers: { 'X-Good': 'v', 'X-Bad': 'a\r\nX-Inject: evil' } }]
    })
    expect(p.servers[0]?.headers).toEqual({ 'X-Good': 'v' })
  })

  it('payloadTemplate >64KB 走 default', () => {
    const big = 'x'.repeat(65 * 1024)
    const p = normalizeProject({ servers: [{ payloadTemplate: big }] })
    expect(p.servers[0]?.payloadTemplate).toBe(DEFAULT_PAYLOAD_TEMPLATE)
  })

  it('imageField 非法字符 → 回退 "image"', () => {
    expect(normalizeProject({ servers: [{ imageField: 'has space' }] }).servers[0]?.imageField).toBe('image')
  })

  it('imageField prototype pollution 关键字 → 回退 "image"', () => {
    expect(normalizeProject({ servers: [{ imageField: '__proto__' }] }).servers[0]?.imageField).toBe('image')
    expect(normalizeProject({ servers: [{ imageField: 'constructor' }] }).servers[0]?.imageField).toBe('image')
    expect(normalizeProject({ servers: [{ imageField: 'prototype' }] }).servers[0]?.imageField).toBe('image')
  })

  it('imageField 合法值保留', () => {
    expect(normalizeProject({ servers: [{ imageField: 'screenshot' }] }).servers[0]?.imageField).toBe('screenshot')
  })

  it('imageField 截到 64 字符', () => {
    const big = 'a'.repeat(80)
    const r = normalizeProject({ servers: [{ imageField: big }] }).servers[0]?.imageField
    expect(r?.length).toBeLessThanOrEqual(64)
  })

  it('method 只接受 POST / PUT / PATCH，其它走 POST 默认', () => {
    expect(normalizeProject({ servers: [{ method: 'GET' }] }).servers[0]?.method).toBe('POST')
    expect(normalizeProject({ servers: [{ method: 'DELETE' }] }).servers[0]?.method).toBe('POST')
    expect(normalizeProject({ servers: [{ method: 'PUT' }] }).servers[0]?.method).toBe('PUT')
  })

  it('imageFormat 只接受 multipart / base64', () => {
    expect(normalizeProject({ servers: [{ imageFormat: 'xxx' }] }).servers[0]?.imageFormat).toBe('base64')
    expect(normalizeProject({ servers: [{ imageFormat: 'multipart' }] }).servers[0]?.imageFormat).toBe('multipart')
  })

  it('endpoint 相对路径 / 主机名形态保留（后端真要 fetch 时再校验）', () => {
    expect(normalizeProject({ servers: [{ endpoint: '/api/bugs' }] }).servers[0]?.endpoint).toBe('/api/bugs')
    expect(normalizeProject({ servers: [{ endpoint: 'example.com' }] }).servers[0]?.endpoint).toBe('example.com')
  })

  it('endpoint data:/file:/ftp: 一律清空（白名单严格）', () => {
    expect(normalizeProject({ servers: [{ endpoint: 'data:text/plain,xxx' }] }).servers[0]?.endpoint).toBe('')
    expect(normalizeProject({ servers: [{ endpoint: 'file:///etc/passwd' }] }).servers[0]?.endpoint).toBe('')
    expect(normalizeProject({ servers: [{ endpoint: 'ftp://x.com' }] }).servers[0]?.endpoint).toBe('')
  })

  it('name 截到 100 字符', () => {
    const big = 'a'.repeat(200)
    expect(normalizeProject({ servers: [{ name: big }] }).servers[0]?.name.length).toBe(100)
  })
})
