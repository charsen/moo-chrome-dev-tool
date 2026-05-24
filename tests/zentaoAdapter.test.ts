import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '@/types/config'
import type { SubmitBugReq } from '@/types/messages'

/**
 * zentaoAdapter 单测 — 实装 IssueAdapter<'zentao'> 的核心路径。
 *
 * 跟 webhookAdapter 不同，zentao 主要委托给 src/background/zentao/submit.ts 的 submitToZentao，
 * 这里 mock fetch 让 login 早 fail 即可验证 adapter 形态正确（业务全链路在 zentao submit/client
 * 自己的单测里 — zentaoSubmitBuilders / zentaoClientV2）。
 *
 * 覆盖：
 *   - submit: login 失败兜底
 *   - fetchStatus: 禅道配置缺失 / remoteId 不合法 / happy path
 *   - serializeForRetry: payload 形态 + 超 1MB 拒
 *   - retryFromPayload: 永久失败 drop / keep
 *   - isPermanentFailure: keyword 命中
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
      },
      onChanged: { addListener() {}, removeListener() {} }
    },
    runtime: {
      getManifest: () => ({ version: '0.5.2-test' })
    }
  }
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
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
  const { _clearZentaoCaches } = await import('@/background/zentao/client')
  _clearZentaoCaches()
  return await import('@/adapters/zentaoAdapter')
}

const baseReq = (): SubmitBugReq => ({
  projectId: 'p1', serverId: 'zentao',
  title: 'bug', description: 'desc',
  image: '', url: '', userAgent: '', viewport: { w: 0, h: 0 },
  timestamp: '2026-05-24T08:00:00Z',
  requests: [], errors: [], elements: []
})

const zentaoProject = (overrides: Partial<Project['zentao']> = {}): Project => ({
  id: 'p1', name: 'zentao', matchPatterns: [],
  kind: 'zentao',
  servers: [], defaultServerId: '',
  zentao: {
    baseUrl: 'https://z.example.com',
    account: 'a', password: 'b',
    projectId: 1, moduleId: 0,
    ...overrides
  },
  capture: { storageKeys: [], requestBufferSize: 50 },
  redact: { bodyKeys: [], cookies: [], headers: [] },
  enabled: true
} as Project)

describe('zentaoAdapter.submit', () => {
  it('login 失败 → submitToZentao 早返 error，adapter 透传', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonRes({ status: 'failed', reason: '账号或密码错误' })
    ))
    const { zentaoAdapter } = await importAdapter()
    const r = await zentaoAdapter.submit(baseReq(), zentaoProject(), { mooVersion: 'test' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('账号或密码错误')
  })
})

describe('zentaoAdapter.fetchStatus', () => {
  it('禅道配置缺 baseUrl → undefined', async () => {
    const project = zentaoProject({ baseUrl: '' })
    const { zentaoAdapter } = await importAdapter()
    const s = await zentaoAdapter.fetchStatus?.(project, '42')
    expect(s).toBeUndefined()
  })

  it('remoteId 不是数字 → undefined', async () => {
    const { zentaoAdapter } = await importAdapter()
    const s = await zentaoAdapter.fetchStatus?.(zentaoProject(), 'not-a-number')
    expect(s).toBeUndefined()
  })

  it('happy path：禅道 resolved 映射成 Moo in_progress（待验证）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return jsonRes({ status: 'success', token: 'tok-1', user: { id: 9, account: 'a', realname: 'A' } })
      }
      if (url.includes('/v1/bugs/42')) {
        return jsonRes({ id: 42, status: 'resolved', resolution: 'fixed', deleted: '0' })
      }
      return jsonRes({})
    }))
    const { zentaoAdapter } = await importAdapter()
    const s = await zentaoAdapter.fetchStatus?.(zentaoProject(), '42')
    expect(s).toBe('in_progress')
  })
})

describe('zentaoAdapter.serializeForRetry', () => {
  it('正常 req → 返 ZentaoRetryPayload', async () => {
    const { zentaoAdapter } = await importAdapter()
    const p = zentaoAdapter.serializeForRetry(baseReq(), zentaoProject())
    expect(p).not.toBeNull()
    if (p) {
      const z = p as { kind: string; projectId: string }
      expect(z.kind).toBe('zentao')
      expect(z.projectId).toBe('p1')
    }
  })

  it('带 1.5MB image 的 req → 返 null（estimateZentaoSize 超 1MB）', async () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(1_500_000)
    const req = baseReq()
    req.image = huge
    const { zentaoAdapter } = await importAdapter()
    const p = zentaoAdapter.serializeForRetry(req, zentaoProject())
    expect(p).toBeNull()
  })
})

describe('zentaoAdapter.retryFromPayload', () => {
  const payload = () => ({ kind: 'zentao' as const, projectId: 'p1', req: baseReq() })

  it('收到非 zentao payload → kind:drop', async () => {
    const { zentaoAdapter } = await importAdapter()
    const r = await zentaoAdapter.retryFromPayload(
      { kind: 'webhook', endpoint: 'http://x', method: 'POST', headers: {}, bodyString: '{}' } as unknown,
      zentaoProject()
    )
    expect(r.kind).toBe('drop')
  })

  it('project kind 切回 webhook → kind:drop', async () => {
    const project = { ...zentaoProject(), kind: 'webhook' } as Project
    const { zentaoAdapter } = await importAdapter()
    const r = await zentaoAdapter.retryFromPayload(payload(), project)
    expect(r.kind).toBe('drop')
  })

  it('login 永久失败 → kind:drop', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonRes({ status: 'failed', reason: '登录失败' })
    ))
    const { zentaoAdapter } = await importAdapter()
    const r = await zentaoAdapter.retryFromPayload(payload(), zentaoProject())
    expect(r.kind).toBe('drop')
  })

  it('网络错（非 keyword）→ kind:keep', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('网络抖动') }))
    const { zentaoAdapter } = await importAdapter()
    const r = await zentaoAdapter.retryFromPayload(payload(), zentaoProject())
    expect(r.kind).toBe('keep')
  })
})

describe('isPermanentFailure', () => {
  it('「登录失败」keyword → true', async () => {
    const { isPermanentFailure } = await importAdapter()
    expect(isPermanentFailure('登录失败：密码错')).toBe(true)
  })

  it('「项目不存在」keyword → true', async () => {
    const { isPermanentFailure } = await importAdapter()
    expect(isPermanentFailure('项目 26 不存在')).toBe(true)
  })

  it('「网络错」非 keyword → false', async () => {
    const { isPermanentFailure } = await importAdapter()
    expect(isPermanentFailure('网络中断')).toBe(false)
  })

  it('「Unauthorized」keyword → true', async () => {
    const { isPermanentFailure } = await importAdapter()
    expect(isPermanentFailure('HTTP 401 Unauthorized')).toBe(true)
  })
})
