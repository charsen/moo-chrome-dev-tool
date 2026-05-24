import { describe, it, expect } from 'vitest'
import {
  buildZentaoEnv,
  buildZentaoStepsHtml
} from '@/background/zentao/submit'
import type { Project } from '@/types/config'
import type { SubmitBugReq } from '@/types/messages'
import type { CapturedRequest } from '@/types/requests'

/**
 * submit.ts 纯函数单测（v0.4.4 加固）。
 *
 * 之前 client.ts 三层护栏，submit.ts 编排层裸奔（mv3-pro 复盘指出）。这里聚焦两个 export
 * 纯函数 — buildZentaoEnv（配置校验）+ buildZentaoStepsHtml（HTML 拼装）。
 *
 * 间接覆盖关键 helpers：obfuscateUrlsForWaf（ZWS 绕 WAF）+ escapeHtml（XSS 防御）+
 * buildResponseBlock + buildRequestCurlBlock。
 */

const baseProject: Project = {
  id: 'p1',
  name: 'test',
  matchPatterns: ['https://*.example.com/*'],
  kind: 'zentao',
  servers: [],
  defaultServerId: '',
  zentao: {
    baseUrl: 'https://z.example.com',
    account: 'alice',
    password: 'secret',
    projectId: 26,
    moduleId: 0,
    defaultSeverity: 3,
    defaultPri: 3,
    defaultType: 'codeerror',
    defaultKeywords: 'Moo'
  },
  capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
  redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: false },
  enabled: true
}

const baseReq: SubmitBugReq = {
  serverId: '',
  projectId: 'p1',
  title: 'test title',
  description: '',
  image: '',
  url: 'https://www.example.com/page',
  userAgent: 'Mozilla/5.0',
  viewport: '1920x1080',
  timestamp: '2026-05-24 10:00:00',
  requests: [],
  errors: []
}

describe('buildZentaoEnv · 禅道配置校验', () => {
  it('完整配置 → ok + env', () => {
    const r = buildZentaoEnv(baseProject)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.env.baseUrl).toBe('https://z.example.com')
      expect(r.env.account).toBe('alice')
      expect(r.env.projectId).toBe(26)
    }
  })

  it('project.zentao 整体缺失 → 引导文案', () => {
    const r = buildZentaoEnv({ ...baseProject, zentao: undefined })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('DevTools')
  })

  it('缺 baseUrl → error 列出缺哪个', () => {
    const r = buildZentaoEnv({
      ...baseProject,
      zentao: { ...baseProject.zentao!, baseUrl: '' }
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('禅道地址')
  })

  it('缺账号 + 密码 → error 列出全部缺项', () => {
    const r = buildZentaoEnv({
      ...baseProject,
      zentao: { ...baseProject.zentao!, account: '', password: '' }
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('账号')
      expect(r.error).toContain('密码')
    }
  })

  it('projectId 为 0 → 视为缺失', () => {
    const r = buildZentaoEnv({
      ...baseProject,
      zentao: { ...baseProject.zentao!, projectId: 0 }
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('项目 ID')
  })
})

describe('buildZentaoStepsHtml · steps HTML 拼装', () => {
  it('仅描述 → 只生成描述段 + 环境段', () => {
    const html = buildZentaoStepsHtml(
      { ...baseReq, description: '这是描述' },
      baseProject,
      [],
      []
    )
    expect(html).toContain('<h3>📝 描述</h3>')
    expect(html).toContain('这是描述')
    expect(html).toContain('<h3>🌐 环境</h3>')
    expect(html).not.toContain('<h3>📸 截图</h3>')
    expect(html).not.toContain('<h3>🎥 录像</h3>')
  })

  it('描述含 HTML 标签 → escape（XSS 防御）', () => {
    const html = buildZentaoStepsHtml(
      { ...baseReq, description: '<script>alert(1)</script>' },
      baseProject,
      [],
      []
    )
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('截图上传成功 → inline img tag', () => {
    const html = buildZentaoStepsHtml(
      { ...baseReq, image: 'data:image/png;base64,iVBOR...' },
      baseProject,
      [{ kind: 'screenshot', displayName: 'moo-screenshot.png', url: '/file-read-99.png', bytes: 12000 }],
      []
    )
    expect(html).toContain('<h3>📸 截图</h3>')
    expect(html).toContain('src="/file-read-99.png"')
    expect(html).toContain('alt="moo-screenshot.png"')
  })

  it('录像上传成功 → 下载链接 + 字节大小', () => {
    const html = buildZentaoStepsHtml(
      { ...baseReq },
      baseProject,
      [{ kind: 'recording', displayName: 'moo-recording.webm', url: '/file-read-100.txt', bytes: 5_500_000 }],
      []
    )
    expect(html).toContain('<h3>🎥 录像</h3>')
    expect(html).toContain('moo-recording.webm')
    expect(html).toContain('5.25 MB')
  })

  it('请求里 URL 含 https:// → 必须被 ZWS obfuscate（绕禅道 WAF）', () => {
    const req: CapturedRequest = {
      id: '1',
      kind: 'fetch',
      method: 'GET',
      url: 'https://api.example.com/data',
      requestHeaders: {},
      requestBody: null,
      status: 200,
      ok: true,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: '{"ok":true}',
      responseSizeBytes: 11,
      startTime: 0,
      duration: 50,
      startedAt: '2026-05-24T10:00:00Z'
    }
    const html = buildZentaoStepsHtml(
      { ...baseReq, requests: [req] },
      baseProject,
      [],
      []
    )
    expect(html).toContain('<h3>🌐 网络请求</h3>')
    // ZWS = ​；URL 里每个 https:// 都被插入 ZWS
    expect(html).toContain('https:​//')
    expect(html).not.toMatch(/https:\/\/api\.example\.com/)  // 裸的 https:// 应该不存在
  })

  it('响应是二进制 (image/png) → 不 inline body，仅显示「二进制响应」', () => {
    const req: CapturedRequest = {
      id: '1',
      kind: 'fetch',
      method: 'GET',
      url: 'https://api.example.com/img',
      requestHeaders: {},
      requestBody: null,
      status: 200,
      ok: true,
      responseHeaders: { 'content-type': 'image/png' },
      responseBody: null,
      responseSizeBytes: 50000,
      startTime: 0,
      duration: 30,
      startedAt: '2026-05-24T10:00:00Z'
    }
    const html = buildZentaoStepsHtml(
      { ...baseReq, requests: [req] },
      baseProject,
      [],
      []
    )
    expect(html).toContain('二进制响应')
  })

  it('响应 body 超过 1.5KB → 显示「已截断」', () => {
    const longBody = '{"data":"' + 'x'.repeat(2000) + '"}'
    const req: CapturedRequest = {
      id: '1',
      kind: 'fetch',
      method: 'GET',
      url: 'https://api.example.com/big',
      requestHeaders: {},
      requestBody: null,
      status: 200,
      ok: true,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: longBody,
      responseSizeBytes: longBody.length,
      startTime: 0,
      duration: 80,
      startedAt: '2026-05-24T10:00:00Z'
    }
    const html = buildZentaoStepsHtml(
      { ...baseReq, requests: [req] },
      baseProject,
      [],
      []
    )
    expect(html).toContain('已截断')
  })

  it('附件上传失败含「cookie」错 → 加 cookie 提示', () => {
    const html = buildZentaoStepsHtml(
      { ...baseReq },
      baseProject,
      [],
      [{ kind: 'screenshot', displayName: 'moo-screenshot.png', error: '需要先登录禅道（cookie 缺失）' }]
    )
    expect(html).toContain('<h3>⚠️ 附件上传失败</h3>')
    expect(html).toContain('💡')
    expect(html).toContain('cookie')
  })

  it('附件上传失败不含 cookie 关键词 → 不加 cookie 提示', () => {
    const html = buildZentaoStepsHtml(
      { ...baseReq },
      baseProject,
      [],
      [{ kind: 'screenshot', displayName: 'moo-screenshot.png', error: '网络错误 503' }]
    )
    expect(html).toContain('<h3>⚠️ 附件上传失败</h3>')
    expect(html).not.toContain('💡')
  })

  it('环境段：URL / UA / 视口 / 时间都 escape 防 XSS', () => {
    const html = buildZentaoStepsHtml(
      {
        ...baseReq,
        url: 'https://x.com/<script>',
        userAgent: '<img src=x>',
        viewport: '<svg>',
        timestamp: '<b>2026</b>'
      },
      baseProject,
      [],
      []
    )
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img src=x&gt;')
    expect(html).toContain('&lt;svg&gt;')
    expect(html).toContain('&lt;b&gt;2026&lt;/b&gt;')
  })

  it('录像有 dataUrl + bytes/duration → 环境段显示录像时长', () => {
    const html = buildZentaoStepsHtml(
      {
        ...baseReq,
        video: { dataUrl: 'data:video/webm;base64,...', bytes: 2_500_000, duration: 12_000, mime: 'video/webm' }
      },
      baseProject,
      [],
      []
    )
    expect(html).toContain('录像时长')
    expect(html).toContain('12s')
  })

  it('多请求 + 多错误 → 环境段显示「抓到请求 N 条」+「console 错误 M 条」', () => {
    const mkReq = (i: number): CapturedRequest => ({
      id: String(i), kind: 'fetch', method: 'GET',
      url: `https://api.example.com/${i}`, requestHeaders: {}, requestBody: null,
      status: 200, ok: true, responseHeaders: {}, responseBody: null,
      responseSizeBytes: 0, startTime: 0, duration: 10, startedAt: '2026-05-24T10:00:00Z'
    })
    const html = buildZentaoStepsHtml(
      {
        ...baseReq,
        requests: [mkReq(1), mkReq(2), mkReq(3)],
        errors: [
          { id: 'e1', level: 'error', message: 'TypeError: foo', startedAt: '2026-05-24T10:00:00Z', startTime: 0 },
          { id: 'e2', level: 'error', message: 'ReferenceError: bar', startedAt: '2026-05-24T10:00:00Z', startTime: 0 }
        ]
      },
      baseProject,
      [],
      []
    )
    expect(html).toContain('抓到请求</b>：3 条')
    expect(html).toContain('console 错误</b>：2 条')
  })
})
