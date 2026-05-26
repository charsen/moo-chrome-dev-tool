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
