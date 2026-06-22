import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@/types/config'
import type { SubmitBugReq } from '@/types/messages'

/**
 * webhookAdapter 单测 — 实装 IssueAdapter<'webhook'> 的核心路径。
 *
 * 覆盖：
 *   - submit 4 分支（无 server / 无 endpoint / 2xx / 5xx）
 *   - fetchStatus 2 分支（200 + status / 失败）
 *   - serializeForRetry 3 分支（webhook OK / multipart 拒 / 超 1MB 拒）
 *   - retryFromPayload 3 分支（200 ok / 4xx drop / 网络错 keep）
 */

interface MockState {
  storageData: Record<string, unknown>
}
let state: MockState

function makeChrome(): void {
  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        async get(key: string) { return { [key]: state.storageData[key] } },
        async set(obj: Record<string, unknown>) { Object.assign(state.storageData, obj) }
      }
    },
    scripting: {
      async executeScript() { return [{ result: {} }] }
    }
  }
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
function textRes(body: string, status = 200): Response {
  return new Response(body, { status })
}

beforeEach(() => {
  state = { storageData: {} }
  makeChrome()
  vi.unstubAllGlobals()
})

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
  vi.unstubAllGlobals()
})

async function importAdapter() {
  return await import('@/adapters/webhookAdapter')
}

const baseReq = (overrides: Partial<SubmitBugReq> = {}): SubmitBugReq => ({
  projectId: 'p1',
  serverId: 's1',
  title: 'bug',
  description: 'desc',
  image: '',
  url: 'https://example.com',
  userAgent: 'UA',
  viewport: { w: 1280, h: 800 },
  timestamp: '2026-05-24T08:00:00Z',
  requests: [],
  errors: [],
  elements: [],
  ...overrides
})

const baseProject = (): Project => ({
  id: 'p1', name: 'webhook', matchPatterns: [],
  kind: 'webhook',
  servers: [{
    id: 's1', name: 'svr', endpoint: 'http://api.example.com/intake',
    method: 'POST', headers: {},
    payloadTemplate: '{"title":"{{title}}"}',
    imageFormat: 'inline', imageField: 'image'
  }],
  defaultServerId: 's1',
  capture: { storageKeys: [], requestBufferSize: 50 },
  redact: { bodyKeys: [], cookies: [], headers: [] },
  enabled: true
} as Project)

describe('webhookAdapter.submit', () => {
  it('server 找不到 → error', async () => {
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.submit(baseReq({ serverId: 'wrong' }), baseProject(), {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('上报服务器')
  })

  it('server.endpoint 空 → error', async () => {
    const project = baseProject()
    project.servers[0]!.endpoint = ''
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.submit(baseReq(), project, {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('请求 URL')
  })

  it('happy path fetch 200 → ok + remoteId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ id: 'bug-7' })))
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.submit(baseReq(), baseProject(), {})
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.remoteId).toBe('bug-7')
  })

  it('fetch 500 → retryable=true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textRes('boom', 500)))
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.submit(baseReq(), baseProject(), {})
    expect(r.ok).toBe(false)
    expect(r.retryable).toBe(true)
  })

  it('fetch 400 → retryable=false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textRes('bad', 400)))
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.submit(baseReq(), baseProject(), {})
    expect(r.ok).toBe(false)
    expect(r.retryable).toBe(false)
  })

  it('fetch throw 网络错 → retryable=true', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network down') }))
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.submit(baseReq(), baseProject(), {})
    expect(r.ok).toBe(false)
    expect(r.retryable).toBe(true)
    if (!r.ok) expect(r.error).toContain('Network down')
  })
})

describe('webhookAdapter.fetchStatus', () => {
  it('200 + {ok:true,status:resolved} → 返 resolved', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ ok: true, status: 'resolved' })))
    const { webhookAdapter } = await importAdapter()
    const s = await webhookAdapter.fetchStatus?.(baseProject(), '100')
    expect(s).toBe('resolved')
  })

  it('fetch 404 → undefined', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textRes('nope', 404)))
    const { webhookAdapter } = await importAdapter()
    const s = await webhookAdapter.fetchStatus?.(baseProject(), '100')
    expect(s).toBeUndefined()
  })

  it('fetch throw → undefined（不传播错误）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    const { webhookAdapter } = await importAdapter()
    const s = await webhookAdapter.fetchStatus?.(baseProject(), '100')
    expect(s).toBeUndefined()
  })

  // v0.7.6 P1-4 regression guard：多 server 项目下，entry.serverId 应优先匹配
  // 对应 server.endpoint 算 remoteBase。之前 fallback 只取 first endpoint —
  // 多 server 时永远走 first server 的 status-public，错指 base url。
  it('多 server fallback：ctx.serverId 命中第二个 server → remoteBase 用第二个 endpoint', async () => {
    const project = baseProject()
    project.servers = [
      { ...project.servers[0]!, id: 's1', endpoint: 'http://api1.example.com/intake' },
      { ...project.servers[0]!, id: 's2', endpoint: 'http://api2.example.com/intake' }
    ]
    const fetchMock = vi.fn(async () => jsonRes({ ok: true, status: 'resolved' }))
    vi.stubGlobal('fetch', fetchMock)
    const { webhookAdapter } = await importAdapter()
    const s = await webhookAdapter.fetchStatus?.(project, '100', { serverId: 's2' })
    expect(s).toBe('resolved')
    // 关键：fetch URL 必须基于 s2 的 endpoint (api2.example.com)，不是 first server
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api2.example.com/100/status-public',
      expect.anything()
    )
  })

  it('多 server fallback：ctx.serverId 不命中 → fallback first endpoint（v0.5.x 老 entry 容忍）', async () => {
    const project = baseProject()
    project.servers = [
      { ...project.servers[0]!, id: 's1', endpoint: 'http://api1.example.com/intake' },
      { ...project.servers[0]!, id: 's2', endpoint: 'http://api2.example.com/intake' }
    ]
    const fetchMock = vi.fn(async () => jsonRes({ ok: true, status: 'resolved' }))
    vi.stubGlobal('fetch', fetchMock)
    const { webhookAdapter } = await importAdapter()
    const s = await webhookAdapter.fetchStatus?.(project, '100', { serverId: 'unknown-server' })
    expect(s).toBe('resolved')
    // ctx.serverId 不命中 → 退回 first endpoint（api1）
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api1.example.com/100/status-public',
      expect.anything()
    )
  })

  it('多 server fallback：完全不传 ctx → fallback first endpoint（v0.5.x 老 entry 无 serverId）', async () => {
    const project = baseProject()
    project.servers = [
      { ...project.servers[0]!, id: 's1', endpoint: 'http://api1.example.com/intake' },
      { ...project.servers[0]!, id: 's2', endpoint: 'http://api2.example.com/intake' }
    ]
    const fetchMock = vi.fn(async () => jsonRes({ ok: true, status: 'resolved' }))
    vi.stubGlobal('fetch', fetchMock)
    const { webhookAdapter } = await importAdapter()
    const s = await webhookAdapter.fetchStatus?.(project, '100')
    expect(s).toBe('resolved')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api1.example.com/100/status-public',
      expect.anything()
    )
  })

  it('ctx.remoteBase 优先级最高（用户改 server.endpoint 后仍指向原 base）', async () => {
    const project = baseProject()
    project.servers[0]!.endpoint = 'http://new-endpoint.example.com/intake'
    const fetchMock = vi.fn(async () => jsonRes({ ok: true, status: 'resolved' }))
    vi.stubGlobal('fetch', fetchMock)
    const { webhookAdapter } = await importAdapter()
    const s = await webhookAdapter.fetchStatus?.(project, '100', { remoteBase: 'http://original.example.com/path' })
    expect(s).toBe('resolved')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://original.example.com/path/100/status-public',
      expect.anything()
    )
  })
})

describe('webhookAdapter.serializeForRetry', () => {
  it('inline body → 拼出 WebhookRetryPayload', async () => {
    const { webhookAdapter } = await importAdapter()
    const p = webhookAdapter.serializeForRetry(baseReq(), baseProject())
    expect(p).not.toBeNull()
    if (p) {
      const w = p as { kind: string; endpoint: string }
      expect(w.kind).toBe('webhook')
      expect(w.endpoint).toBe('http://api.example.com/intake')
    }
  })

  it('multipart imageFormat → 返 null（不入队）', async () => {
    const project = baseProject()
    project.servers[0]!.imageFormat = 'multipart'
    const { webhookAdapter } = await importAdapter()
    const p = webhookAdapter.serializeForRetry(baseReq(), project)
    expect(p).toBeNull()
  })

  it('server 找不到 → 返 null', async () => {
    const { webhookAdapter } = await importAdapter()
    const p = webhookAdapter.serializeForRetry(baseReq({ serverId: 'wrong' }), baseProject())
    expect(p).toBeNull()
  })

  // 回归守卫：serializeForRetry 的 renderCtx 曾漏 images 键，默认模板含 {{imagesJson}}，
  // 缺变量被 renderTemplate 原样保留成字面量 {{imagesJson}} → 重试 body 非法 JSON、多图全丢。
  // 锁住「能进 1MB 队列的小体积多图」重试时渲染出合法 JSON 且 screenshots 含全部图。
  it('★ 真实默认模板 + 多图 → 重试 body 合法 JSON 且 screenshots 含全部图', async () => {
    const { DEFAULT_PAYLOAD_TEMPLATE } = await import('@/types/config')
    const project = baseProject()
    project.servers[0]!.payloadTemplate = DEFAULT_PAYLOAD_TEMPLATE
    const SHOT_1 = 'data:image/png;base64,QQ=='
    const SHOT_2 = 'data:image/png;base64,QUE='
    const { webhookAdapter } = await importAdapter()
    const p = webhookAdapter.serializeForRetry(
      baseReq({ image: SHOT_1, images: [SHOT_1, SHOT_2] }), project
    )
    expect(p).not.toBeNull()
    const w = p as { bodyString: string }
    // 漏 images 时这里 bodyString 含字面量 {{imagesJson}} → JSON.parse 抛
    expect(() => JSON.parse(w.bodyString)).not.toThrow()
    const parsed = JSON.parse(w.bodyString) as { screenshots: string[] }
    expect(parsed.screenshots).toEqual([SHOT_1, SHOT_2])
    expect(parsed.screenshots).toHaveLength(2)
  })
})

// v0.8.9 Fix A 回归：multipart 路径删除 Content-Type 必须大小写无关。
// 旧实现精确删 'Content-Type' / 'content-type' 两键 —— 用户手敲 `Content-type` /
// `CONTENT-TYPE` 变体存活，fetch 不再给 FormData 注入 boundary，服务端 multipart
// 解析直接失败（附件/字段全收不到）。
describe('webhookAdapter.submit — multipart Content-Type 大小写无关删除（v0.8.9 Fix A）', () => {
  const multipartProject = (headers: Record<string, string>): Project => {
    const p = baseProject()
    p.servers[0]!.imageFormat = 'multipart'
    p.servers[0]!.headers = headers
    return p
  }

  /** 跑一次 multipart submit，返回 fetch 实际收到的 headers */
  async function submittedHeaders(headers: Record<string, string>): Promise<Record<string, string>> {
    let captured: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      captured = (init?.headers ?? {}) as Record<string, string>
      return jsonRes({ id: 'bug-1' })
    }))
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.submit(baseReq(), multipartProject(headers), {})
    expect(r.ok).toBe(true)
    return captured
  }

  function hasContentTypeVariant(h: Record<string, string>): boolean {
    return Object.keys(h).some((k) => k.toLowerCase() === 'content-type')
  }

  it('用户手敲 `Content-type` 变体 → multipart 提交 headers 不含任何 content-type 变体', async () => {
    const h = await submittedHeaders({ 'Content-type': 'application/json', 'X-Trace': 'keep-me' })
    expect(hasContentTypeVariant(h)).toBe(false)
    expect(h['X-Trace']).toBe('keep-me')   // 只删 content-type，别的 header 不许误伤
  })

  it('全大写 `CONTENT-TYPE` 变体 → 同样被删', async () => {
    const h = await submittedHeaders({ 'CONTENT-TYPE': 'text/plain' })
    expect(hasContentTypeVariant(h)).toBe(false)
  })

  it('标准两键 Content-Type / content-type 同时存在 → 删除不回归', async () => {
    const h = await submittedHeaders({ 'Content-Type': 'a/b', 'content-type': 'c/d', 'X-Keep': '1' })
    expect(hasContentTypeVariant(h)).toBe(false)
    expect(h['X-Keep']).toBe('1')
  })

  it('JSON inline 路径不受影响：用户配置的 Content-Type 原样保留', async () => {
    let captured: Record<string, string> = {}
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      captured = (init?.headers ?? {}) as Record<string, string>
      return jsonRes({ id: 'bug-2' })
    }))
    const project = baseProject()   // imageFormat: 'inline'
    project.servers[0]!.headers = { 'Content-Type': 'application/json', 'X-Trace': 't1' }
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.submit(baseReq(), project, {})
    expect(r.ok).toBe(true)
    expect(captured['Content-Type']).toBe('application/json')
    expect(captured['X-Trace']).toBe('t1')
  })
})

// ─────────────────── v0.8.10 多张截图 ───────────────────
// 契约：
//   ① multipart：第 1 张仍是 `imageField`（screenshot.png）；第 2 张起追加
//     `${imageField}_N`（screenshot_N.png，N 从 2 起）。老服务端语义不变（不认识的
//     字段被忽略）—— 无 images 时只有 imageField，一个多余字段都不能出现。
//   ② renderCtx 暴露 images → 模板 {{imagesJson}} 免费可用（inline JSON 数组）。
describe('webhookAdapter.submit — v0.8.10 多图', () => {
  // 各 tag 长度不同，便于按 blob.size 区分三张图：'QQ=='→1字节 'QUE='→2 'QUFB'→3
  const SHOT_A = 'data:image/png;base64,QQ=='
  const SHOT_B = 'data:image/png;base64,QUE='
  const SHOT_C = 'data:image/png;base64,QUFB'

  const multipartProject = (): Project => {
    const p = baseProject()
    p.servers[0]!.imageFormat = 'multipart'
    p.servers[0]!.imageField = 'image'
    return p
  }

  /** 跑一次 submit，把 fetch 收到的 FormData body 抓出来 */
  async function submittedForm(req: SubmitBugReq): Promise<FormData> {
    let captured: FormData | null = null
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      captured = init?.body as FormData
      return jsonRes({ id: 'bug-1' })
    }))
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.submit(req, multipartProject(), {})
    expect(r.ok).toBe(true)
    if (!captured) throw new Error('fetch body not captured')
    return captured
  }

  it('ctx.images 3 张 → FormData 含 image + image_2 + image_3（文件名 screenshot_2/3.png）', async () => {
    const form = await submittedForm(baseReq({ image: SHOT_A, images: [SHOT_A, SHOT_B, SHOT_C] }))
    const f1 = form.get('image') as File
    const f2 = form.get('image_2') as File
    const f3 = form.get('image_3') as File
    expect(f1?.name).toBe('screenshot.png')
    expect(f2?.name).toBe('screenshot_2.png')
    expect(f3?.name).toBe('screenshot_3.png')
    // 内容对得上张序（按 base64 解码后字节数区分：A=1 B=2 C=3）
    expect(f1.size).toBe(1)
    expect(f2.size).toBe(2)
    expect(f3.size).toBe(3)
    // 没有越界字段
    expect(form.get('image_4')).toBeNull()
    expect(form.get('image_1')).toBeNull()
  })

  it('老服务端语义：无 images（单图老调用方）→ 只有 imageField，无任何 _N 字段', async () => {
    const form = await submittedForm(baseReq({ image: SHOT_A }))
    expect((form.get('image') as File)?.name).toBe('screenshot.png')
    const extraKeys = [...form.keys()].filter((k) => /^image_\d+$/.test(k))
    expect(extraKeys).toEqual([])
  })

  it('images 恰 1 张 → 同单图：只有 imageField', async () => {
    const form = await submittedForm(baseReq({ image: SHOT_A, images: [SHOT_A] }))
    expect((form.get('image') as File)?.name).toBe('screenshot.png')
    expect(form.get('image_2')).toBeNull()
  })

  it('inline 模板 {{imagesJson}} → 渲染出合法 JSON 数组（renderCtx.images 接通）', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '')
      return jsonRes({ id: 'bug-2' })
    }))
    const project = baseProject()  // imageFormat: 'inline'
    project.servers[0]!.payloadTemplate = '{"title":"{{title}}","shots":{{imagesJson}}}'
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.submit(
      baseReq({ image: SHOT_A, images: [SHOT_A, SHOT_B] }), project, {}
    )
    expect(r.ok).toBe(true)
    const parsed = JSON.parse(capturedBody) as { shots: string[] }
    expect(parsed.shots).toEqual([SHOT_A, SHOT_B])
  })

  it('inline {{imagesJson}} + 无 images → 单图归一成 [image]（老调用方模板也能用）', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '')
      return jsonRes({ id: 'bug-3' })
    }))
    const project = baseProject()
    project.servers[0]!.payloadTemplate = '{"shots":{{imagesJson}}}'
    const { webhookAdapter } = await importAdapter()
    await webhookAdapter.submit(baseReq({ image: SHOT_A }), project, {})
    expect((JSON.parse(capturedBody) as { shots: string[] }).shots).toEqual([SHOT_A])
  })

  it('inline {{imagesJson}} + 无图 → 空数组 []', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '')
      return jsonRes({ id: 'bug-4' })
    }))
    const project = baseProject()
    project.servers[0]!.payloadTemplate = '{"shots":{{imagesJson}}}'
    const { webhookAdapter } = await importAdapter()
    await webhookAdapter.submit(baseReq(), project, {})
    expect((JSON.parse(capturedBody) as { shots: string[] }).shots).toEqual([])
  })

  // ★ v0.8.11 核心回归守卫：用**真实 DEFAULT_PAYLOAD_TEMPLATE**（不是手写特制模板）提交多图。
  //   v0.8.10 的 bug 就是默认模板只有 {{image}}、漏了 {{imagesJson}}，开箱用户多图只发首图，
  //   而当时多图测试全用手写模板掩盖了它。这条锁住「开箱默认配置真发全部图」。
  it('★ 真实默认模板 DEFAULT_PAYLOAD_TEMPLATE → screenshots 字段含全部多图（开箱即多图）', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '')
      return jsonRes({ id: 'bug-default' })
    }))
    const { DEFAULT_PAYLOAD_TEMPLATE } = await import('@/types/config')
    const project = baseProject()
    project.servers[0]!.payloadTemplate = DEFAULT_PAYLOAD_TEMPLATE
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.submit(
      baseReq({ image: SHOT_A, images: [SHOT_A, SHOT_B] }), project, {}
    )
    expect(r.ok).toBe(true)
    const parsed = JSON.parse(capturedBody) as { screenshot: string; screenshots: string[] }
    expect(parsed.screenshots).toEqual([SHOT_A, SHOT_B])   // 全部图
    expect(parsed.screenshot).toBe(SHOT_A)                 // 首图兼容字段不变
  })

  it('★ 真实默认模板 + 单图老调用方 → screenshots 归一成 [image]（不回归）', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = String(init?.body ?? '')
      return jsonRes({ id: 'bug-default-1' })
    }))
    const { DEFAULT_PAYLOAD_TEMPLATE } = await import('@/types/config')
    const project = baseProject()
    project.servers[0]!.payloadTemplate = DEFAULT_PAYLOAD_TEMPLATE
    const { webhookAdapter } = await importAdapter()
    await webhookAdapter.submit(baseReq({ image: SHOT_A }), project, {})
    expect((JSON.parse(capturedBody) as { screenshots: string[] }).screenshots).toEqual([SHOT_A])
  })
})

// ─────────────────── v0.8.14 截图上传前重编码 WebP ───────────────────
// 契约：webhook/cloud 路径把要发出去的截图有损重编码成 WebP（q0.9）压体积，治
//   「2560px PNG 仍 >8MB 被云端 extractBinary 静默丢」。只动「要发出去的副本」，
//   不碰 req.image/req.images（history 走原 req 保 PNG）。
//   inline：renderCtx.image / images 是 WebP → {{image}}/{{imagesJson}} 渲染出 WebP。
//   multipart：dataUrlToBlob 前的图是 WebP（blob.type=image/webp）。
describe('webhookAdapter.submit — v0.8.14 重编码 WebP', () => {
  const PNG_A = 'data:image/png;base64,QQ=='
  const PNG_B = 'data:image/png;base64,QUE='

  /**
   * stub 一套能让 reencodeImage 成功的 canvas 链路：
   *   - fetch(dataUrl) → 返回带 .blob() 的对象（reencodeImage 解码用）
   *   - fetch(endpoint, init) → 返回上报响应，并把 body 捕获回 cap
   *   - OffscreenCanvas.convertToBlob 出 image/webp blob
   * blobToDataUrl 会把 outBlob.type 写进 data URL 前缀 → 输出 data:image/webp;base64,...
   */
  function stubWebpPipeline() {
    const cap = { body: null as unknown, bodyString: '' }
    const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer // 'RIFF'（webp 头特征）
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      // reencodeImage 内部 fetch(dataUrl) —— 返回可 .blob() 的轻量对象
      if (typeof url === 'string' && url.startsWith('data:')) {
        return { blob: async () => ({ type: 'image/png', arrayBuffer: async () => webpBytes }) } as unknown as Response
      }
      // 上报 fetch —— 捕获 body 后返回 200
      cap.body = init?.body
      cap.bodyString = typeof init?.body === 'string' ? init.body : ''
      return jsonRes({ id: 'bug-webp' })
    }))
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2560, height: 1440, close: () => {} })))
    vi.stubGlobal('OffscreenCanvas', class {
      width: number; height: number
      constructor(w: number, h: number) { this.width = w; this.height = h }
      getContext() { return { set fillStyle(_v: string) {}, fillRect: () => {}, drawImage: () => {} } }
      async convertToBlob(opts: { type: string }) { return { type: opts.type, arrayBuffer: async () => webpBytes } }
    })
    return cap
  }

  it('inline {{image}} → 提交 body 里的图是 data:image/webp（不是原 PNG）', async () => {
    const cap = stubWebpPipeline()
    const project = baseProject()
    project.servers[0]!.payloadTemplate = '{"img":"{{image}}"}'
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.submit(baseReq({ image: PNG_A }), project, {})
    expect(r.ok).toBe(true)
    const parsed = JSON.parse(cap.bodyString) as { img: string }
    expect(parsed.img.startsWith('data:image/webp;base64,')).toBe(true)
  })

  it('inline {{imagesJson}} 多图 → 每张都是 data:image/webp', async () => {
    const cap = stubWebpPipeline()
    const project = baseProject()
    project.servers[0]!.payloadTemplate = '{"shots":{{imagesJson}}}'
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.submit(baseReq({ image: PNG_A, images: [PNG_A, PNG_B] }), project, {})
    expect(r.ok).toBe(true)
    const parsed = JSON.parse(cap.bodyString) as { shots: string[] }
    expect(parsed.shots).toHaveLength(2)
    expect(parsed.shots.every((s) => s.startsWith('data:image/webp;base64,'))).toBe(true)
  })

  it('multipart → 上传的 Blob.type 是 image/webp（dataUrlToBlob 前已重编码）', async () => {
    const cap = stubWebpPipeline()
    const project = baseProject()
    project.servers[0]!.imageFormat = 'multipart'
    project.servers[0]!.imageField = 'image'
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.submit(baseReq({ image: PNG_A, images: [PNG_A, PNG_B] }), project, {})
    expect(r.ok).toBe(true)
    const form = cap.body as FormData
    expect((form.get('image') as File).type).toBe('image/webp')
    expect((form.get('image_2') as File).type).toBe('image/webp')
  })

  it('不污染 req：req.image/req.images 提交后仍是原 PNG（history 走原 req）', async () => {
    stubWebpPipeline()
    const project = baseProject()
    project.servers[0]!.payloadTemplate = '{"img":"{{image}}"}'
    const req = baseReq({ image: PNG_A, images: [PNG_A, PNG_B] })
    const { webhookAdapter } = await importAdapter()
    await webhookAdapter.submit(req, project, {})
    // req 本体未被改写 —— 仍是原 PNG dataUrl
    expect(req.image).toBe(PNG_A)
    expect(req.images).toEqual([PNG_A, PNG_B])
  })

  it('reencode 失败兜底 → 发原图（不丢图，跟 downscale 同款兜底）', async () => {
    // 不 stub canvas → node 无 createImageBitmap → reencodeImage catch 返原 dataUrl
    let bodyString = ''
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      if (typeof url === 'string' && url.startsWith('data:')) {
        return { blob: async () => ({ type: 'image/png', arrayBuffer: async () => new ArrayBuffer(4) }) } as unknown as Response
      }
      bodyString = typeof init?.body === 'string' ? init.body : ''
      return jsonRes({ id: 'bug-fallback' })
    }))
    const project = baseProject()
    project.servers[0]!.payloadTemplate = '{"img":"{{image}}"}'
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.submit(baseReq({ image: PNG_A }), project, {})
    expect(r.ok).toBe(true)
    expect((JSON.parse(bodyString) as { img: string }).img).toBe(PNG_A) // 原 PNG 透传
  })
})

describe('webhookAdapter.retryFromPayload', () => {
  const payload = () => ({
    kind: 'webhook' as const,
    endpoint: 'http://api.example.com/intake',
    method: 'POST',
    headers: {},
    bodyString: '{}'
  })

  it('200 → kind:ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textRes('', 200)))
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.retryFromPayload(payload(), baseProject())
    expect(r.kind).toBe('ok')
  })

  // v0.8.8 Fix B：重试成功要回带 remoteId（doFlush 据此回填 history entry）
  it('200 + body {"id":"abc"} → kind:ok + remoteId 回带', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textRes('{"id":"abc"}', 200)))
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.retryFromPayload(payload(), baseProject())
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.remoteId).toBe('abc')
  })

  it('200 + body 非 JSON → remoteId undefined 但仍 kind:ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textRes('<html>ok</html>', 200)))
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.retryFromPayload(payload(), baseProject())
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(r.remoteId).toBeUndefined()
  })

  it('400 → kind:drop（认证错，不重试）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textRes('bad token', 400)))
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.retryFromPayload(payload(), baseProject())
    expect(r.kind).toBe('drop')
  })

  it('500 → kind:keep', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textRes('boom', 500)))
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.retryFromPayload(payload(), baseProject())
    expect(r.kind).toBe('keep')
  })

  it('fetch throw → kind:keep', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.retryFromPayload(payload(), baseProject())
    expect(r.kind).toBe('keep')
  })

  it('收到非 webhook payload → kind:drop', async () => {
    const { webhookAdapter } = await importAdapter()
    const r = await webhookAdapter.retryFromPayload(
      { kind: 'zentao', projectId: 'p1', req: {} } as unknown,
      baseProject()
    )
    expect(r.kind).toBe('drop')
  })
})
