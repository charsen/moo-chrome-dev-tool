import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * v0.5.2 P0 重构第 3 阶段 — handlers/historyStatus.ts 单测。
 * 覆盖 REFRESH_HISTORY_STATUS：禅道路径 + webhook 路径 + 各种 skip 条件。
 */

interface MockState {
  storageData: Record<string, unknown>
}

let state: MockState

function makeChrome(): void {
  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: state.storageData[key] }
        },
        async set(obj: Record<string, unknown>) {
          Object.assign(state.storageData, obj)
        },
        async remove() { /* not used */ }
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

async function importHandler() {
  // 清禅道 client cache 避免跨 test 残留
  const { _clearZentaoCaches } = await import('@/background/zentao/client')
  _clearZentaoCaches()
  return await import('@/background/handlers/historyStatus')
}

describe('handleRefreshHistoryStatus', () => {
  it('空 history → 返 {ok:true, updated:0}', async () => {
    const { handleRefreshHistoryStatus } = await importHandler()
    const r = await handleRefreshHistoryStatus()
    expect(r.ok).toBe(true)
    expect(r.updated).toBe(0)
  })

  it('entry 无 remoteId → skip', async () => {
    state.storageData.mooHistory = [
      {
        id: 'h1',
        timestamp: Date.now(),
        projectId: 'p1',
        projectName: 'x',
        serverId: 's1',
        serverName: 'svr',
        title: 't',
        description: '',
        url: '',
        userAgent: '',
        viewport: { w: 0, h: 0 },
        result: { ok: true }
      }
    ]
    const { handleRefreshHistoryStatus } = await importHandler()
    const r = await handleRefreshHistoryStatus()
    expect(r.updated).toBe(0)
  })

  it('zentao 路径：拉详情 + status 变了 → updated++', async () => {
    state.storageData.mooConfig = {
      globalEnabled: true,
      projects: [{
        id: 'p1', name: 'x', matchPatterns: [],
        kind: 'zentao',
        servers: [], defaultServerId: '',
        zentao: { baseUrl: 'https://z.example.com', account: 'a', password: 'b', projectId: 1, moduleId: 0 },
        capture: {}, redact: {}, enabled: true
      }]
    }
    state.storageData.mooHistory = [{
      id: 'h1',
      timestamp: Date.now(),
      projectId: 'p1', projectName: 'x',
      serverId: 'zentao', serverName: 'z',
      title: 't', description: '',
      url: '', userAgent: '', viewport: { w: 0, h: 0 },
      result: { ok: true },
      remoteId: '42',
      remoteStatus: 'active'
    }]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return jsonRes({ status: 'success', token: 'tok-1', user: { id: 9, account: 'a', realname: 'A' } })
      }
      if (url.match(/\/v1\/bugs\/42\b/) || url.includes('/v1/bugs/42')) {
        return jsonRes({ id: 42, status: 'resolved', resolution: 'fixed', deleted: '0' })
      }
      return jsonRes({})
    }))
    const { handleRefreshHistoryStatus } = await importHandler()
    const r = await handleRefreshHistoryStatus()
    expect(r.updated).toBe(1)
  })

  it('zentao：getBug 失败 → 不更新（updated=0）', async () => {
    state.storageData.mooConfig = {
      globalEnabled: true,
      projects: [{
        id: 'p1', name: 'x', matchPatterns: [],
        kind: 'zentao',
        servers: [], defaultServerId: '',
        zentao: { baseUrl: 'https://z.example.com', account: 'a', password: 'b', projectId: 1, moduleId: 0 },
        capture: {}, redact: {}, enabled: true
      }]
    }
    state.storageData.mooHistory = [{
      id: 'h1',
      timestamp: Date.now(),
      projectId: 'p1', projectName: 'x',
      serverId: 'zentao', serverName: 'z',
      title: 't', description: '',
      url: '', userAgent: '', viewport: { w: 0, h: 0 },
      result: { ok: true },
      remoteId: '99'
    }]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return jsonRes({ status: 'success', token: 'tok-1', user: { id: 9, account: 'a', realname: 'A' } })
      }
      return jsonRes({ error: 'not found' }, 404)
    }))
    const { handleRefreshHistoryStatus } = await importHandler()
    const r = await handleRefreshHistoryStatus()
    expect(r.updated).toBe(0)
  })

  it('webhook：status-public 返新状态 → updated++', async () => {
    state.storageData.mooConfig = {
      globalEnabled: true,
      projects: [{
        id: 'p1', name: 'x', matchPatterns: [],
        kind: 'webhook',
        servers: [], defaultServerId: '',
        token: 'tk',
        capture: {}, redact: {}, enabled: true
      }]
    }
    state.storageData.mooHistory = [{
      id: 'h1',
      timestamp: Date.now(),
      projectId: 'p1', projectName: 'x',
      serverId: 's1', serverName: 'svr',
      title: 't', description: '',
      url: '', userAgent: '', viewport: { w: 0, h: 0 },
      result: { ok: true },
      remoteId: '100',
      remoteBase: 'http://api.example.com/scaffold/todos',
      remoteStatus: 'active'
    }]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/100/status-public')) {
        return jsonRes({ ok: true, status: 'resolved' })
      }
      return jsonRes({})
    }))
    const { handleRefreshHistoryStatus } = await importHandler()
    const r = await handleRefreshHistoryStatus()
    expect(r.updated).toBe(1)
  })

  it('webhook：返 {ok:false} → 不更新', async () => {
    state.storageData.mooConfig = {
      globalEnabled: true,
      projects: [{
        id: 'p1', name: 'x', matchPatterns: [],
        kind: 'webhook',
        servers: [], defaultServerId: '',
        capture: {}, redact: {}, enabled: true
      }]
    }
    state.storageData.mooHistory = [{
      id: 'h1',
      timestamp: Date.now(),
      projectId: 'p1', projectName: 'x',
      serverId: 's1', serverName: 'svr',
      title: 't', description: '',
      url: '', userAgent: '', viewport: { w: 0, h: 0 },
      result: { ok: true },
      remoteId: '100',
      remoteBase: 'http://api.example.com/scaffold/todos'
    }]
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonRes({ ok: false }, 200)
    ))
    const { handleRefreshHistoryStatus } = await importHandler()
    const r = await handleRefreshHistoryStatus()
    expect(r.updated).toBe(0)
  })

  it('entry remoteStatus 已经是新值 → 不算 update（idempotent）', async () => {
    state.storageData.mooConfig = {
      globalEnabled: true,
      projects: [{
        id: 'p1', name: 'x', matchPatterns: [],
        kind: 'webhook',
        servers: [], defaultServerId: '',
        capture: {}, redact: {}, enabled: true
      }]
    }
    state.storageData.mooHistory = [{
      id: 'h1',
      timestamp: Date.now(),
      projectId: 'p1', projectName: 'x',
      serverId: 's1', serverName: 'svr',
      title: 't', description: '',
      url: '', userAgent: '', viewport: { w: 0, h: 0 },
      result: { ok: true },
      remoteId: '100',
      remoteBase: 'http://api.example.com/scaffold/todos',
      remoteStatus: 'resolved'
    }]
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonRes({ ok: true, status: 'resolved' })
    ))
    const { handleRefreshHistoryStatus } = await importHandler()
    const r = await handleRefreshHistoryStatus()
    expect(r.updated).toBe(0)
  })

  it('单条 fetch throw → ignore，继续下条', async () => {
    state.storageData.mooConfig = {
      globalEnabled: true,
      projects: [{
        id: 'p1', name: 'x', matchPatterns: [],
        kind: 'webhook',
        servers: [], defaultServerId: '',
        capture: {}, redact: {}, enabled: true
      }]
    }
    state.storageData.mooHistory = [
      {
        id: 'h1', timestamp: Date.now(),
        projectId: 'p1', projectName: 'x',
        serverId: 's1', serverName: 'svr',
        title: 't', description: '', url: '', userAgent: '',
        viewport: { w: 0, h: 0 }, result: { ok: true },
        remoteId: '100', remoteBase: 'http://a/scaffold/todos'
      },
      {
        id: 'h2', timestamp: Date.now(),
        projectId: 'p1', projectName: 'x',
        serverId: 's1', serverName: 'svr',
        title: 't', description: '', url: '', userAgent: '',
        viewport: { w: 0, h: 0 }, result: { ok: true },
        remoteId: '101', remoteBase: 'http://a/scaffold/todos',
        remoteStatus: 'active'
      }
    ]
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      n++
      if (n === 1) throw new Error('network')
      return jsonRes({ ok: true, status: 'resolved' })
    }))
    const { handleRefreshHistoryStatus } = await importHandler()
    const r = await handleRefreshHistoryStatus()
    expect(r.updated).toBe(1) // h1 throw 算 skip，h2 成功
  })
})
