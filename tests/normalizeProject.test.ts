import { describe, it, expect } from 'vitest'
import { normalizeProject, stripSensitiveProjectFields, DEFAULT_PAYLOAD_TEMPLATE, DEFAULT_REDACT, DEFAULT_ZENTAO } from '@/types/config'

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

describe('normalizeProject — kind 字段（v0.2.0）', () => {
  it('无 kind 字段时默认 webhook（兼容 v0.1.x 老数据）', () => {
    expect(normalizeProject({}).kind).toBe('webhook')
  })

  it('kind=zentao 时保留', () => {
    expect(normalizeProject({ kind: 'zentao' }).kind).toBe('zentao')
  })

  it('kind 异常值（unknown / null / 数字 / 对象）一律兜成 webhook', () => {
    expect(normalizeProject({ kind: 'unknown' }).kind).toBe('webhook')
    expect(normalizeProject({ kind: null }).kind).toBe('webhook')
    expect(normalizeProject({ kind: 123 }).kind).toBe('webhook')
    expect(normalizeProject({ kind: {} }).kind).toBe('webhook')
  })
})

describe('normalizeProject — zentao 字段（v0.2.0）', () => {
  it('无 raw.zentao → undefined（避免空对象误导后续 if (p.zentao) 判定）', () => {
    expect(normalizeProject({}).zentao).toBeUndefined()
  })

  it('raw.zentao 非对象（null / string / 数字）→ undefined', () => {
    expect(normalizeProject({ zentao: null }).zentao).toBeUndefined()
    expect(normalizeProject({ zentao: 'x' }).zentao).toBeUndefined()
    expect(normalizeProject({ zentao: 42 }).zentao).toBeUndefined()
  })

  it('raw.zentao={} 时返完整 default 对象（不是 undefined）', () => {
    const z = normalizeProject({ zentao: {} }).zentao
    expect(z).toEqual(DEFAULT_ZENTAO)
  })

  it('合法 zentao 全字段保留', () => {
    const z = normalizeProject({
      zentao: {
        baseUrl: 'https://z.example.com',
        account: '13800000000',
        password: 'fcs9909',
        projectId: 26,
        moduleId: 0,
        defaultSeverity: 2,
        defaultPri: 4,
        defaultType: 'designdefect',
        defaultKeywords: 'Moo,前端bug'
      }
    }).zentao!
    expect(z.baseUrl).toBe('https://z.example.com')
    expect(z.account).toBe('13800000000')
    expect(z.password).toBe('fcs9909')
    expect(z.projectId).toBe(26)
    expect(z.moduleId).toBe(0)
    expect(z.defaultSeverity).toBe(2)
    expect(z.defaultPri).toBe(4)
    expect(z.defaultType).toBe('designdefect')
    expect(z.defaultKeywords).toBe('Moo,前端bug')
  })
})

describe('normalizeProject — zentao.baseUrl sanitize', () => {
  it('http/https 都接受', () => {
    expect(normalizeProject({ zentao: { baseUrl: 'http://x.com' } }).zentao?.baseUrl).toBe('http://x.com')
    expect(normalizeProject({ zentao: { baseUrl: 'https://x.com' } }).zentao?.baseUrl).toBe('https://x.com')
  })

  it('trailing slash 自动剥（client 拼路径时依赖这点）', () => {
    expect(normalizeProject({ zentao: { baseUrl: 'https://x.com/' } }).zentao?.baseUrl).toBe('https://x.com')
    expect(normalizeProject({ zentao: { baseUrl: 'https://x.com//' } }).zentao?.baseUrl).toBe('https://x.com')
  })

  it('非 http(s) 协议（javascript:/data:/file:/ftp:）→ 空串', () => {
    expect(normalizeProject({ zentao: { baseUrl: 'javascript:alert(1)' } }).zentao?.baseUrl).toBe('')
    expect(normalizeProject({ zentao: { baseUrl: 'file:///etc/passwd' } }).zentao?.baseUrl).toBe('')
    expect(normalizeProject({ zentao: { baseUrl: 'data:text/plain,xxx' } }).zentao?.baseUrl).toBe('')
    expect(normalizeProject({ zentao: { baseUrl: 'ftp://x.com' } }).zentao?.baseUrl).toBe('')
  })

  it('裸字符串（无协议）→ 空串（强校验，导入时立即让用户看见格式错误）', () => {
    expect(normalizeProject({ zentao: { baseUrl: 'z.example.com' } }).zentao?.baseUrl).toBe('')
  })

  it('长度 >256 → 空串', () => {
    const big = 'https://' + 'a'.repeat(260) + '.com'
    expect(normalizeProject({ zentao: { baseUrl: big } }).zentao?.baseUrl).toBe('')
  })

  it('空串 / 非字符串 → 空串', () => {
    expect(normalizeProject({ zentao: { baseUrl: '' } }).zentao?.baseUrl).toBe('')
    expect(normalizeProject({ zentao: { baseUrl: null } }).zentao?.baseUrl).toBe('')
    expect(normalizeProject({ zentao: { baseUrl: 123 } }).zentao?.baseUrl).toBe('')
  })
})

describe('normalizeProject — zentao.account sanitize', () => {
  it('手机号 / 邮箱 / 字母数字账号都保留', () => {
    expect(normalizeProject({ zentao: { account: '13800000000' } }).zentao?.account).toBe('13800000000')
    expect(normalizeProject({ zentao: { account: 'alice@example.com' } }).zentao?.account).toBe('alice@example.com')
    expect(normalizeProject({ zentao: { account: 'colorfulhome' } }).zentao?.account).toBe('colorfulhome')
  })

  it('trim 前后空格', () => {
    expect(normalizeProject({ zentao: { account: '  alice  ' } }).zentao?.account).toBe('alice')
  })

  it('含 CRLF / 控制符 / 中文 → 空串（中文账号当前不支持）', () => {
    expect(normalizeProject({ zentao: { account: 'alice\r\nX-Inject: evil' } }).zentao?.account).toBe('')
    expect(normalizeProject({ zentao: { account: 'a\x00b' } }).zentao?.account).toBe('')
    expect(normalizeProject({ zentao: { account: '张三' } }).zentao?.account).toBe('')
  })

  it('长度 >64 → 空串', () => {
    expect(normalizeProject({ zentao: { account: 'a'.repeat(65) } }).zentao?.account).toBe('')
  })
})

describe('normalizeProject — zentao.password sanitize', () => {
  it('合法 password 原样保留（包括前后空格 —— 真实密码可能含空格）', () => {
    expect(normalizeProject({ zentao: { password: 'fcs9909' } }).zentao?.password).toBe('fcs9909')
    expect(normalizeProject({ zentao: { password: '  has space  ' } }).zentao?.password).toBe('  has space  ')
  })

  it('特殊字符密码（含 !@#$ / Unicode）允许', () => {
    expect(normalizeProject({ zentao: { password: 'P@ss!#$%^&*()' } }).zentao?.password).toBe('P@ss!#$%^&*()')
    expect(normalizeProject({ zentao: { password: '密码123' } }).zentao?.password).toBe('密码123')
  })

  it('CRLF 拒绝（防 header injection 即使密码进 body）', () => {
    expect(normalizeProject({ zentao: { password: 'abc\r\nX-Inject: evil' } }).zentao?.password).toBe('')
    expect(normalizeProject({ zentao: { password: 'abc\nx' } }).zentao?.password).toBe('')
  })

  it('长度 >512 → 空串', () => {
    expect(normalizeProject({ zentao: { password: 'p'.repeat(513) } }).zentao?.password).toBe('')
    expect(normalizeProject({ zentao: { password: 'p'.repeat(512) } }).zentao?.password.length).toBe(512)
  })

  it('非字符串 → 空串', () => {
    expect(normalizeProject({ zentao: { password: 123 } }).zentao?.password).toBe('')
    expect(normalizeProject({ zentao: { password: null } }).zentao?.password).toBe('')
  })
})

describe('normalizeProject — zentao.projectId / moduleId', () => {
  it('projectId 正整数保留', () => {
    expect(normalizeProject({ zentao: { projectId: 26 } }).zentao?.projectId).toBe(26)
  })

  it('projectId 字符串数字自动解析（用户从 URL 复制可能带 string）', () => {
    expect(normalizeProject({ zentao: { projectId: '26' } }).zentao?.projectId).toBe(26)
  })

  it('projectId <=0 / 负数 / NaN / 浮点 → 0', () => {
    expect(normalizeProject({ zentao: { projectId: 0 } }).zentao?.projectId).toBe(0)
    expect(normalizeProject({ zentao: { projectId: -5 } }).zentao?.projectId).toBe(0)
    expect(normalizeProject({ zentao: { projectId: 1.5 } }).zentao?.projectId).toBe(0)
    expect(normalizeProject({ zentao: { projectId: 'abc' } }).zentao?.projectId).toBe(0)
  })

  it('moduleId 默认 0（无字段 / 非法都兜默认）', () => {
    expect(normalizeProject({ zentao: {} }).zentao?.moduleId).toBe(0)
    expect(normalizeProject({ zentao: { moduleId: 'x' } }).zentao?.moduleId).toBe(0)
  })

  it('moduleId=0 合法（与 projectId 不同，0 是有效模块 ID）', () => {
    expect(normalizeProject({ zentao: { moduleId: 0 } }).zentao?.moduleId).toBe(0)
    expect(normalizeProject({ zentao: { moduleId: 7 } }).zentao?.moduleId).toBe(7)
  })

  it('moduleId 负数 → fallback 默认 0', () => {
    expect(normalizeProject({ zentao: { moduleId: -3 } }).zentao?.moduleId).toBe(0)
  })
})

describe('normalizeProject — zentao.severity / pri', () => {
  it('1-4 范围内整数保留', () => {
    for (const n of [1, 2, 3, 4]) {
      expect(normalizeProject({ zentao: { defaultSeverity: n } }).zentao?.defaultSeverity).toBe(n)
      expect(normalizeProject({ zentao: { defaultPri: n } }).zentao?.defaultPri).toBe(n)
    }
  })

  it('范围外 / 0 / 5 / 字符串 / 浮点 → 兜底 3', () => {
    expect(normalizeProject({ zentao: { defaultSeverity: 0 } }).zentao?.defaultSeverity).toBe(3)
    expect(normalizeProject({ zentao: { defaultSeverity: 5 } }).zentao?.defaultSeverity).toBe(3)
    expect(normalizeProject({ zentao: { defaultSeverity: 'high' } }).zentao?.defaultSeverity).toBe(3)
    expect(normalizeProject({ zentao: { defaultPri: 2.5 } }).zentao?.defaultPri).toBe(3)
  })

  it("字符串数字 '2' 也接受（数字 ID 一致行为）", () => {
    expect(normalizeProject({ zentao: { defaultSeverity: '2' } }).zentao?.defaultSeverity).toBe(2)
  })
})

describe('normalizeProject — zentao.defaultType', () => {
  it('合法 type 保留', () => {
    expect(normalizeProject({ zentao: { defaultType: 'codeerror' } }).zentao?.defaultType).toBe('codeerror')
    expect(normalizeProject({ zentao: { defaultType: 'designdefect' } }).zentao?.defaultType).toBe('designdefect')
  })

  it('含空格 / 特殊字符 → 兜底 codeerror', () => {
    expect(normalizeProject({ zentao: { defaultType: 'code error' } }).zentao?.defaultType).toBe('codeerror')
    expect(normalizeProject({ zentao: { defaultType: 'a/b' } }).zentao?.defaultType).toBe('codeerror')
  })

  it('原型污染关键字 → 兜底 codeerror', () => {
    expect(normalizeProject({ zentao: { defaultType: '__proto__' } }).zentao?.defaultType).toBe('codeerror')
    expect(normalizeProject({ zentao: { defaultType: 'constructor' } }).zentao?.defaultType).toBe('codeerror')
    expect(normalizeProject({ zentao: { defaultType: 'prototype' } }).zentao?.defaultType).toBe('codeerror')
  })

  it('长度 >64 → 截断后兜底（防巨型字符串）', () => {
    const big = 'a'.repeat(80)
    expect(normalizeProject({ zentao: { defaultType: big } }).zentao?.defaultType.length).toBeLessThanOrEqual(64)
  })

  it('空串 / 非字符串 → 兜底 codeerror', () => {
    expect(normalizeProject({ zentao: { defaultType: '' } }).zentao?.defaultType).toBe('codeerror')
    expect(normalizeProject({ zentao: { defaultType: 123 } }).zentao?.defaultType).toBe('codeerror')
  })
})

describe('normalizeProject — zentao.defaultKeywords', () => {
  it('合法字符串保留', () => {
    expect(normalizeProject({ zentao: { defaultKeywords: 'Moo,前端bug' } }).zentao?.defaultKeywords).toBe('Moo,前端bug')
  })

  it('空 / 缺字段 / 非字符串 → 兜底 "Moo"', () => {
    expect(normalizeProject({ zentao: {} }).zentao?.defaultKeywords).toBe('Moo')
    expect(normalizeProject({ zentao: { defaultKeywords: '' } }).zentao?.defaultKeywords).toBe('Moo')
    expect(normalizeProject({ zentao: { defaultKeywords: '   ' } }).zentao?.defaultKeywords).toBe('Moo')
    expect(normalizeProject({ zentao: { defaultKeywords: 123 } }).zentao?.defaultKeywords).toBe('Moo')
  })

  it('含 CRLF / 控制符 → 兜底 "Moo"（防 multipart 字段注入）', () => {
    expect(normalizeProject({ zentao: { defaultKeywords: 'a\r\nb' } }).zentao?.defaultKeywords).toBe('Moo')
    expect(normalizeProject({ zentao: { defaultKeywords: 'a\x00b' } }).zentao?.defaultKeywords).toBe('Moo')
  })

  it('长度 >200 截断到 200', () => {
    const big = 'x'.repeat(300)
    expect(normalizeProject({ zentao: { defaultKeywords: big } }).zentao?.defaultKeywords.length).toBe(200)
  })

  it('中文 / 标点 / 数字混合都保留', () => {
    expect(normalizeProject({ zentao: { defaultKeywords: 'Moo, 前端 bug, 紧急' } }).zentao?.defaultKeywords).toBe('Moo, 前端 bug, 紧急')
  })
})

describe('stripSensitiveProjectFields', () => {
  it('有 zentao 时清空 password 字段', () => {
    const p = normalizeProject({
      zentao: { baseUrl: 'https://x.com', account: 'a', password: 'secret', projectId: 1 }
    })
    const stripped = stripSensitiveProjectFields(p)
    expect(stripped.zentao?.password).toBe('')
    expect(stripped.zentao?.account).toBe('a')  // 其他字段保留
    expect(stripped.zentao?.baseUrl).toBe('https://x.com')
  })

  it('无 zentao 字段时内容相等（v0.4.7 起总是返新对象，不再保引用）', () => {
    const p = normalizeProject({})
    const stripped = stripSensitiveProjectFields(p)
    expect(stripped).toEqual(p)
    expect(stripped.zentao).toBeUndefined()
    expect(stripped.token).toBeFalsy()  // 无 token / token=''
  })

  it('返回新对象（不 mutate 原 project）', () => {
    const p = normalizeProject({ zentao: { password: 'secret' } })
    const stripped = stripSensitiveProjectFields(p)
    expect(stripped).not.toBe(p)
    expect(p.zentao?.password).toBe('secret')  // 原对象不变
  })
})
