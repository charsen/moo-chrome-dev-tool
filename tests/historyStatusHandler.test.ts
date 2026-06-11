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
    },
    // v0.5.3 #128：fetchStatus 入口 check host permission，默认 mock 已授权
    permissions: {
      async contains() { return true }
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
  const mod = await import('@/background/handlers/historyStatus')
  // v0.8.9：handler 加了 inflight 锁 + 60s 扫描冷却（模块态）—— 跨 case 必须重置，
  // 否则前一个 case 的扫描武装冷却让后续 case 静默返 0
  mod.__resetHistoryStatusForTest()
  return mod
}

describe('handleRefreshHistoryStatus — host permission 未授权', () => {
  it('contains 返 false → 静默 skip 返 updated:0', async () => {
    ;(globalThis as { chrome: { permissions: { contains: () => Promise<boolean> } } })
      .chrome.permissions.contains = async () => false
    // 即使 history 里有可刷新的 entry 也不调 fetch
    state.storageData.mooHistory = [{
      id: 'h1', timestamp: Date.now(),
      projectId: 'p1', projectName: 'x',
      serverId: 's1', serverName: 'svr',
      title: 't', description: '', url: '', userAgent: '',
      viewport: { w: 0, h: 0 }, result: { ok: true },
      remoteId: '100'
    }]
    const { handleRefreshHistoryStatus } = await importHandler()
    const r = await handleRefreshHistoryStatus()
    expect(r.ok).toBe(true)
    expect(r.updated).toBe(0)
  })
})

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

/**
 * v0.8.9 负载保护 — 60s 扫描冷却 / inflight 锁 / 冷却武装条件。
 *
 * 覆盖（SW 内存态逻辑，mock chrome + fetch）：
 *   ① auto 二连扫吃冷却（fetch 0 新增）
 *   ② force=true 绕过冷却真扫
 *   ③ 并发双发共享一次扫描（inflight 锁，force 也吃锁）
 *   ④ 空扫（无 remoteId 条目）不武装冷却 —— 刚提交第一条不被白等 60s
 *   ⑤ host permission 未授权 skip 不武装冷却 —— 授权后立即可扫
 * 不覆盖：page→SW 消息链路（e2e panel-history-autosync.spec.ts）、真实 60s 时间流逝。
 */
describe('v0.8.9 负载保护 — 冷却 / inflight / 武装条件', () => {
  function entryWithRemote(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'h1', timestamp: Date.now(),
      projectId: 'p1', projectName: 'x',
      serverId: 's1', serverName: 'svr',
      title: 't', description: '', url: '', userAgent: '',
      viewport: { w: 0, h: 0 }, result: { ok: true },
      remoteId: '100', remoteBase: 'http://api.example.com/scaffold/todos',
      remoteStatus: 'active',
      ...over
    }
  }

  function seedWebhook(entries: Record<string, unknown>[]): void {
    state.storageData.mooConfig = {
      globalEnabled: true,
      projects: [{
        id: 'p1', name: 'x', matchPatterns: [],
        kind: 'webhook',
        servers: [], defaultServerId: '',
        capture: {}, redact: {}, enabled: true
      }]
    }
    state.storageData.mooHistory = entries
  }

  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void
    const promise = new Promise<void>((res) => { resolve = res })
    return { promise, resolve }
  }

  it('冷却：auto 真扫后 60s 内再 auto → fetch 0 新增、返 updated:0', async () => {
    seedWebhook([entryWithRemote()])
    const fetchMock = vi.fn(async () => jsonRes({ ok: true, status: 'resolved' }))
    vi.stubGlobal('fetch', fetchMock)
    const { handleRefreshHistoryStatus } = await importHandler()

    const r1 = await handleRefreshHistoryStatus()
    expect(r1.updated).toBe(1)
    const callsAfterFirst = fetchMock.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThanOrEqual(1)

    const r2 = await handleRefreshHistoryStatus()
    expect(r2).toEqual({ ok: true, updated: 0 })
    // 关键断言：第二次没发任何网络（updated:0 本身区分不了「扫了没变」和「没扫」）
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst)
  })

  it('force=true 绕过冷却：冷却内手动同步仍真扫（fetch 有新增）', async () => {
    seedWebhook([entryWithRemote()])
    const fetchMock = vi.fn(async () => jsonRes({ ok: true, status: 'resolved' }))
    vi.stubGlobal('fetch', fetchMock)
    const { handleRefreshHistoryStatus } = await importHandler()

    await handleRefreshHistoryStatus() // auto 真扫，武装冷却
    const callsAfterFirst = fetchMock.mock.calls.length

    const r2 = await handleRefreshHistoryStatus(true) // 手动按钮
    expect(r2.ok).toBe(true)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  it('inflight 去重：并发两次（含 force）共享一次扫描 — fetch 只一轮、同一结果', async () => {
    seedWebhook([entryWithRemote()])
    const gate = deferred()
    const fetchMock = vi.fn(async () => {
      await gate.promise
      return jsonRes({ ok: true, status: 'resolved' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { handleRefreshHistoryStatus } = await importHandler()

    const p1 = handleRefreshHistoryStatus()
    const p2 = handleRefreshHistoryStatus(true) // force 绕冷却但仍吃 inflight 锁
    // 推进到 fetch 挂起点再放行（保证两个调用都已进入 handler）
    await new Promise((r) => setTimeout(r, 0))
    gate.resolve()
    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1).toBe(r2) // 同一 inflight promise → 同一结果对象
    expect(r1.updated).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1) // 1 条 entry × 1 轮扫描
  })

  it('空扫不武装冷却：无 remoteId 扫完后，新增带单号条目的 auto 扫立即真扫', async () => {
    seedWebhook([entryWithRemote({ remoteId: undefined, remoteBase: undefined, remoteStatus: undefined })])
    const fetchMock = vi.fn(async () => jsonRes({ ok: true, status: 'resolved' }))
    vi.stubGlobal('fetch', fetchMock)
    const { handleRefreshHistoryStatus } = await importHandler()

    const r1 = await handleRefreshHistoryStatus()
    expect(r1.updated).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled() // 空扫：没发网络

    // 模拟「刚提交成功拿到单号」—— 新条目入库后切回 History tab 的 auto 扫
    state.storageData.mooHistory = [entryWithRemote()]
    const r2 = await handleRefreshHistoryStatus()
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1) // 不被冷却挡
    expect(r2.updated).toBe(1)
  })

  it('无权限不武装冷却：未授权 skip 后授权 → auto 扫立即真扫', async () => {
    seedWebhook([entryWithRemote()])
    const chromeRef = (globalThis as unknown as {
      chrome: { permissions: { contains: () => Promise<boolean> } }
    }).chrome
    chromeRef.permissions.contains = async () => false
    const fetchMock = vi.fn(async () => jsonRes({ ok: true, status: 'resolved' }))
    vi.stubGlobal('fetch', fetchMock)
    const { handleRefreshHistoryStatus } = await importHandler()

    const r1 = await handleRefreshHistoryStatus()
    expect(r1.updated).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled() // 未授权静默 skip

    chromeRef.permissions.contains = async () => true
    const r2 = await handleRefreshHistoryStatus()
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1) // skip 不应武装冷却
    expect(r2.updated).toBe(1)
  })
})

describe('v0.8.9 审计修：冷却武装条件与真实发网条件对齐', () => {
  it('孤儿 remoteId 条目（项目已删）→ 0 请求且不武装冷却；随后有效条目的 auto 扫不被挡', async () => {
    // 第一阶段：只有孤儿条目（projectId 在 config 里不存在）→ 循环全 continue，0 fetch
    state.storageData.mooConfig = { globalEnabled: true, projects: [] }
    state.storageData.mooHistory = [{
      id: 'orphan', timestamp: Date.now(),
      projectId: 'deleted-project', projectName: 'x',
      serverId: 's1', serverName: 'svr',
      title: 't', description: '', url: '', userAgent: '',
      viewport: { w: 0, h: 0 }, result: { ok: true },
      remoteId: '100'
    }]
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return jsonRes({ status: 'success', token: 'tok-1', user: { id: 9, account: 'a', realname: 'A' } })
      }
      if (url.includes('/100/status-public')) return jsonRes({ ok: true, status: 'resolved' })
      return jsonRes({})
    })
    vi.stubGlobal('fetch', fetchMock)
    const { handleRefreshHistoryStatus } = await importHandler()
    const r1 = await handleRefreshHistoryStatus()  // auto（非 force）
    expect(r1.updated).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()

    // 第二阶段：补一个有效 webhook 项目 + 带 remoteId 的条目 → 紧接着的 auto 扫必须真发
    // （旧实现 some(remoteId) 在第一阶段就武装了 60s 冷却 → 这里会被静默挡掉 = 红）
    state.storageData.mooConfig = {
      globalEnabled: true,
      projects: [{
        id: 'p1', name: 'x', matchPatterns: [], kind: 'webhook',
        servers: [], defaultServerId: '', token: 'tk',
        capture: {}, redact: {}, enabled: true
      }]
    }
    ;(state.storageData.mooHistory as Array<Record<string, unknown>>).push({
      id: 'h2', timestamp: Date.now(),
      projectId: 'p1', projectName: 'x',
      serverId: 's1', serverName: 'svr',
      title: 't', description: '', url: '', userAgent: '',
      viewport: { w: 0, h: 0 }, result: { ok: true },
      remoteId: '100',
      remoteBase: 'http://api.example.com/scaffold/todos',
      remoteStatus: 'active'
    })
    const r2 = await handleRefreshHistoryStatus()  // 仍是 auto，不靠 force 逃生
    expect(r2.updated).toBe(1)
    expect(fetchMock).toHaveBeenCalled()
  })
})

