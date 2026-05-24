import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// chrome.storage.local 用内存 Map + 可控错误模拟。
// 风格参考 tests/history.test.ts —— retryQueue 直接读 globalThis.chrome.storage.local，
// 这里 stub 同一个对象即可。
interface MockStorage {
  data: Record<string, unknown>
  /** 下一次 set 抛 QUOTA 错的次数（>0 就抛一次然后递减） */
  failSetNext: number
}

function makeChrome(): MockStorage {
  const state: MockStorage = { data: {}, failSetNext: 0 }
  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: state.data[key] }
        },
        async set(obj: Record<string, unknown>) {
          if (state.failSetNext > 0) {
            state.failSetNext--
            throw new Error('QUOTA_BYTES exceeded')
          }
          Object.assign(state.data, obj)
        }
      }
    }
  }
  return state
}

// 动态 import：保证 makeChrome 跑在 import 之前，模块内若有顶层副作用也能看到 stub。
// 但 retryQueue.ts 只 export 函数 + 模块级 let flushPromise，无顶层 chrome 调用，
// 所以静态 import 也行；这里仍按 useAutoSave.test.ts 的习惯放到先 stub 后 import。
const {
  enqueueRetry,
  enqueueZentaoRetry,
  flushRetryQueue,
  getQueueItems,
  removeQueueItem,
  __resetForTest
} = await import('@/background/retryQueue')

// client.ts 模块级 tokenCache / productCache 跨 test 会残留 ——
// 让 case 之间互不污染必须每次 reset
const { _clearZentaoCaches } = await import('@/background/zentao/client')

// 给 zentao 路径准备 mock：chrome.runtime.getManifest 在 submit.ts 里被 retryZentao 调
function stubChromeRuntime() {
  ;(globalThis as any).chrome.runtime = {
    getManifest: () => ({ version: '0.2.0-test' })
  }
}

function makeZentaoConfig(projectId = 'proj-zentao', baseUrl = 'https://z.example.com') {
  return {
    mooConfig: {
      globalEnabled: true,
      projects: [{
        id: projectId,
        name: '禅道测试',
        matchPatterns: [],
        kind: 'zentao',
        servers: [],
        defaultServerId: '',
        capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
        redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: true },
        enabled: true,
        zentao: {
          baseUrl,
          account: 'alice',
          password: 'secret',
          projectId: 26,
          moduleId: 0,
          defaultSeverity: 3,
          defaultPri: 3,
          defaultType: 'codeerror'
        }
      }]
    }
  }
}

function makeZentaoReq(overrides: Record<string, unknown> = {}) {
  return {
    serverId: '',
    projectId: 'proj-zentao',
    title: '测试 bug',
    description: '描述',
    image: '',
    url: 'https://app.example.com/page',
    userAgent: 'test',
    viewport: '1024x768',
    timestamp: '2026-05-21T00:00:00Z',
    requests: [],
    errors: [],
    ...overrides
  }
}

describe('retryQueue', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = makeChrome()
    __resetForTest()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    __resetForTest()
  })

  it('并发 flushRetryQueue 共享 inflight：只发一次 fetch', async () => {
    // 队列里一条，两个 caller 同帧并发。无锁的话会读到同一份队列各自 fetch 一次。
    storage.data.mooRetryQueue = [
      { enqueuedAt: 0, attempts: 0, endpoint: 'http://x/a', method: 'POST', headers: {}, bodyString: '{}' }
    ]
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const [n1, n2] = await Promise.all([flushRetryQueue(), flushRetryQueue()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(n1).toBe(1)
    expect(n2).toBe(1) // 共享同一个 promise，结果一致
    expect(storage.data.mooRetryQueue).toEqual([])
  })

  it('4xx 响应：条目直接丢，不再重试（不写回 remaining）', async () => {
    storage.data.mooRetryQueue = [
      { enqueuedAt: 0, attempts: 0, endpoint: 'http://x/a', method: 'POST', headers: {}, bodyString: '{}' }
    ]
    const fetchMock = vi.fn(async () => new Response('bad', { status: 422 }))
    vi.stubGlobal('fetch', fetchMock)

    const n = await flushRetryQueue()
    expect(n).toBe(0) // 4xx 不算 processed（不是 ok 成功）
    expect(storage.data.mooRetryQueue).toEqual([]) // 已丢
  })

  it('5xx 响应：attempts++ 后回写队列', async () => {
    storage.data.mooRetryQueue = [
      { enqueuedAt: 0, attempts: 1, endpoint: 'http://x/a', method: 'POST', headers: {}, bodyString: '{}' }
    ]
    const fetchMock = vi.fn(async () => new Response('boom', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    const n = await flushRetryQueue()
    expect(n).toBe(0)
    const list = storage.data.mooRetryQueue as Array<{ attempts: number }>
    expect(list).toHaveLength(1)
    expect(list[0]?.attempts).toBe(2)
  })

  it('attempts >= 5：跳过 fetch 直接丢弃', async () => {
    storage.data.mooRetryQueue = [
      { enqueuedAt: 0, attempts: 5, endpoint: 'http://x/a', method: 'POST', headers: {}, bodyString: '{}' }
    ]
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const n = await flushRetryQueue()
    expect(fetchMock).not.toHaveBeenCalled() // 上限后不再发请求
    expect(n).toBe(0)
    expect(storage.data.mooRetryQueue).toEqual([])
  })

  it('enqueueRetry：单条 body > 1MB 不入队', async () => {
    const huge = 'x'.repeat(1_000_001)
    const queued = await enqueueRetry('http://x', 'POST', {}, huge)
    expect(queued).toBe(false)
    expect(storage.data.mooRetryQueue).toBeUndefined()
  })

  it('enqueueRetry：multipart（非字符串 body）不入队', async () => {
    const form = new FormData()
    form.append('a', 'b')
    const queued = await enqueueRetry('http://x', 'POST', {}, form)
    expect(queued).toBe(false)
    expect(storage.data.mooRetryQueue).toBeUndefined()
  })

  it('enqueueRetry：队列已有 50 条，新加一条会 FIFO 裁掉最旧的', async () => {
    const old = Array.from({ length: 50 }, (_, i) => ({
      enqueuedAt: i,
      attempts: 0,
      endpoint: 'http://x',
      method: 'POST',
      headers: {},
      bodyString: `{"i":${i}}`
    }))
    storage.data.mooRetryQueue = old
    const queued = await enqueueRetry('http://x', 'POST', {}, '{"i":"new"}')
    expect(queued).toBe(true)
    const list = storage.data.mooRetryQueue as Array<{ enqueuedAt: number; bodyString: string }>
    expect(list).toHaveLength(50)
    // 最旧（enqueuedAt=0）被 shift 掉，新的接在末尾
    expect(list[0]?.enqueuedAt).toBe(1)
    expect(list[list.length - 1]?.bodyString).toBe('{"i":"new"}')
  })

  it('enqueueRetry：storage.set 抛 QUOTA 错走降级，不崩溃，返 false', async () => {
    storage.failSetNext = 1
    const queued = await enqueueRetry('http://x', 'POST', {}, '{}')
    expect(queued).toBe(false) // caller toast 据此不会撒谎说"已加入重试"
  })

  it('5xx 响应：lastStatus + lastError 落到条目上，给 UI 显示「上次失败原因」用', async () => {
    storage.data.mooRetryQueue = [
      { enqueuedAt: 0, attempts: 0, endpoint: 'http://x/a', method: 'POST', headers: {}, bodyString: '{}' }
    ]
    const fetchMock = vi.fn(async () => new Response('boom', { status: 503, statusText: 'Service Unavailable' }))
    vi.stubGlobal('fetch', fetchMock)

    await flushRetryQueue()
    const list = storage.data.mooRetryQueue as Array<{ lastStatus?: number; lastError?: string; attempts: number }>
    expect(list[0]?.lastStatus).toBe(503)
    expect(list[0]?.lastError).toBe('Service Unavailable')
    expect(list[0]?.attempts).toBe(1)
  })

  it('5xx 但 statusText 空：lastError 兜底成 "HTTP {code}"', async () => {
    // fetch + HTTP/2 下 statusText 常为空串；不能把空文案写进队列让 UI 显示「上次：」后面空白
    storage.data.mooRetryQueue = [
      { enqueuedAt: 0, attempts: 0, endpoint: 'http://x/a', method: 'POST', headers: {}, bodyString: '{}' }
    ]
    const fetchMock = vi.fn(async () => new Response('boom', { status: 502, statusText: '' }))
    vi.stubGlobal('fetch', fetchMock)

    await flushRetryQueue()
    const list = storage.data.mooRetryQueue as Array<{ lastError?: string }>
    expect(list[0]?.lastError).toBe('HTTP 502')
  })

  it('网络错（fetch reject）：lastError = error.message，lastStatus 保持 undefined', async () => {
    storage.data.mooRetryQueue = [
      { enqueuedAt: 0, attempts: 0, endpoint: 'http://x/a', method: 'POST', headers: {}, bodyString: '{}' }
    ]
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Failed to fetch') }))

    await flushRetryQueue()
    const list = storage.data.mooRetryQueue as Array<{ lastStatus?: number; lastError?: string; attempts: number }>
    expect(list[0]?.lastStatus).toBeUndefined()
    expect(list[0]?.lastError).toBe('Failed to fetch')
    expect(list[0]?.attempts).toBe(1)
  })

  it('网络错且 message 为空：lastError 兜底成「网络错误」', async () => {
    storage.data.mooRetryQueue = [
      { enqueuedAt: 0, attempts: 0, endpoint: 'http://x/a', method: 'POST', headers: {}, bodyString: '{}' }
    ]
    // 模拟一个没有 message 的异常（虽然实际中少见）
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('') }))

    await flushRetryQueue()
    const list = storage.data.mooRetryQueue as Array<{ lastError?: string }>
    expect(list[0]?.lastError).toBe('网络错误')
  })

  it('getQueueItems：返回完整 QueuedRequest 列表（含 bodyString）', async () => {
    storage.data.mooRetryQueue = [
      { kind: 'webhook', enqueuedAt: 100, attempts: 1, endpoint: 'http://x/a', method: 'POST', headers: { 'x-y': '1' }, bodyString: '{"a":1}' },
      { kind: 'webhook', enqueuedAt: 200, attempts: 2, endpoint: 'http://x/b', method: 'PUT', headers: {}, bodyString: '{"b":2}' }
    ]
    const items = await getQueueItems()
    expect(items).toHaveLength(2)
    const first = items[0]
    const second = items[1]
    expect(first?.kind).toBe('webhook')
    if (first?.kind === 'webhook') {
      expect(first.endpoint).toBe('http://x/a')
      expect(first.bodyString).toBe('{"a":1}')
    }
    if (second?.kind === 'webhook') {
      expect(second.method).toBe('PUT')
    }
  })

  it('getQueueItems：storage 空 / 读失败返空数组（只读统计不能让 UI 崩）', async () => {
    expect(await getQueueItems()).toEqual([])
    ;(globalThis as any).chrome.storage.local.get = async () => { throw new Error('boom') }
    expect(await getQueueItems()).toEqual([])
  })

  it('removeQueueItem：按 enqueuedAt 删单条；其他条目不动', async () => {
    storage.data.mooRetryQueue = [
      { enqueuedAt: 100, attempts: 0, endpoint: 'http://x/a', method: 'POST', headers: {}, bodyString: '{}' },
      { enqueuedAt: 200, attempts: 0, endpoint: 'http://x/b', method: 'POST', headers: {}, bodyString: '{}' },
      { enqueuedAt: 300, attempts: 0, endpoint: 'http://x/c', method: 'POST', headers: {}, bodyString: '{}' }
    ]
    const ok = await removeQueueItem(200)
    expect(ok).toBe(true)
    const list = storage.data.mooRetryQueue as Array<{ enqueuedAt: number }>
    expect(list.map((q) => q.enqueuedAt)).toEqual([100, 300])
  })

  it('removeQueueItem：找不到对应 enqueuedAt 返 false 不动队列', async () => {
    storage.data.mooRetryQueue = [
      { enqueuedAt: 100, attempts: 0, endpoint: 'http://x/a', method: 'POST', headers: {}, bodyString: '{}' }
    ]
    const ok = await removeQueueItem(999)
    expect(ok).toBe(false)
    const list = storage.data.mooRetryQueue as Array<{ enqueuedAt: number }>
    expect(list).toHaveLength(1)
  })

  it('老数据（无 lastStatus / lastError 字段）flush 一次后不崩 + 写入新字段', async () => {
    // v0.1.13 之前入队的条目没有 lastError 字段——v0.1.14 升级后第一次 flush 不能炸
    storage.data.mooRetryQueue = [
      { enqueuedAt: 0, attempts: 0, endpoint: 'http://x/a', method: 'POST', headers: {}, bodyString: '{}' }
      // 故意不带 lastStatus / lastError
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))

    await expect(flushRetryQueue()).resolves.toBe(0)
    const list = storage.data.mooRetryQueue as Array<{ lastStatus?: number; lastError?: string }>
    expect(list[0]?.lastStatus).toBe(500)
    expect(list[0]?.lastError).toBeTruthy()
  })

  it('inflight 锁在 throw 后被释放：下一次 flush 仍能跑', async () => {
    // 第一次 flush：storage.get 抛错 → flushPromise 应该被 finally 清掉。
    // 然后修复 storage、再 flush 一次，必须能正常处理新队列。
    const originalGet = (globalThis as any).chrome.storage.local.get
    let failOnce = true
    ;(globalThis as any).chrome.storage.local.get = async (key: string) => {
      if (failOnce) {
        failOnce = false
        throw new Error('transient storage error')
      }
      return originalGet(key)
    }

    await expect(flushRetryQueue()).rejects.toThrow('transient storage error')

    // 锁已释放，下一次能继续。塞一条进队列验证真的能跑完。
    storage.data.mooRetryQueue = [
      { enqueuedAt: 0, attempts: 0, endpoint: 'http://x', method: 'POST', headers: {}, bodyString: '{}' }
    ]
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const n = await flushRetryQueue()
    expect(n).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('retryQueue — v0.2.0 zentao 路径', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = makeChrome()
    stubChromeRuntime()
    __resetForTest()
    _clearZentaoCaches()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    __resetForTest()
    _clearZentaoCaches()
  })

  it('enqueueZentaoRetry：合法 req 入队 + kind=zentao 标记', async () => {
    const ok = await enqueueZentaoRetry('proj-zentao', makeZentaoReq() as any)
    expect(ok).toBe(true)
    const list = storage.data.mooRetryQueue as any[]
    expect(list).toHaveLength(1)
    expect(list[0].kind).toBe('zentao')
    expect(list[0].projectId).toBe('proj-zentao')
    expect(list[0].req?.title).toBe('测试 bug')
  })

  it('enqueueZentaoRetry：带巨型 image base64（> 1MB）拒入队', async () => {
    const bigImage = 'data:image/png;base64,' + 'a'.repeat(1_200_000)
    const ok = await enqueueZentaoRetry('proj-zentao', makeZentaoReq({ image: bigImage }) as any)
    expect(ok).toBe(false)
    expect(storage.data.mooRetryQueue).toBeUndefined()
  })

  it('enqueueZentaoRetry：带 video（必然超 1MB）拒入队', async () => {
    const bigVideo = { dataUrl: 'data:video/webm;base64,' + 'b'.repeat(2_000_000), bytes: 2_000_000, duration: 5000, mime: 'video/webm' }
    const ok = await enqueueZentaoRetry('proj-zentao', makeZentaoReq({ video: bigVideo }) as any)
    expect(ok).toBe(false)
  })

  it('flush zentao：调 submitToZentao + project=zentao kind → 成功后从队列移除', async () => {
    Object.assign(storage.data, makeZentaoConfig())
    storage.data.mooRetryQueue = [{
      kind: 'zentao', enqueuedAt: 0, attempts: 0,
      projectId: 'proj-zentao', req: makeZentaoReq()
    }]
    const fetchMock = vi.fn(async (url: string) => {
      // v0.4.0：login 响应里带 user 对象（id/account/realname）写入 userCache
      if (url.includes('/users/login')) return new Response(JSON.stringify({ status: 'success', token: 't', user: { id: 99, account: 'alice', realname: '张三' } }), { status: 200, headers: { 'content-type': 'application/json' } })
      // v0.4.0：probeCookieSession 改走 /api.php/v2/users/{cachedUserId}
      if (url.includes('/api.php/v2/users/99')) return new Response(JSON.stringify({ id: 99, account: 'alice', realname: '张三' }), { status: 200, headers: { 'content-type': 'application/json' } })
      // v0.4.0：discoverProduct 改走 /api.php/v2/projects/{projectId} 拿 products 字段
      if (url.includes('/api.php/v2/projects/26')) return new Response(JSON.stringify({ id: 26, products: [14] }), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.includes('/file-ajaxUpload')) return new Response(JSON.stringify({ error: 0, url: '/file-read-1.png' }), { status: 200, headers: { 'content-type': 'application/json' } })
      // v0.2.3：bug 创建走 v2 REST API JSON POST
      if (url.includes('/api.php/v2/bugs')) return new Response(JSON.stringify({ status: 'success', id: 9999, message: '保存成功' }), { status: 200, headers: { 'content-type': 'application/json' } })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const n = await flushRetryQueue()
    expect(n).toBe(1)
    expect(storage.data.mooRetryQueue).toEqual([])
  })

  it('flush zentao：project 已被删 → drop（不留 attempts++）', async () => {
    // 不放 mooConfig，loadConfig 返空 projects
    storage.data.mooRetryQueue = [{
      kind: 'zentao', enqueuedAt: 0, attempts: 0,
      projectId: 'proj-gone', req: makeZentaoReq()
    }]
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const n = await flushRetryQueue()
    expect(n).toBe(0)
    expect(storage.data.mooRetryQueue).toEqual([])  // drop
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('flush zentao：project kind 已被切回 webhook → drop', async () => {
    storage.data.mooConfig = {
      globalEnabled: true,
      projects: [{ id: 'p1', name: 'x', matchPatterns: [], kind: 'webhook', servers: [], defaultServerId: '', capture: {}, redact: {}, enabled: true }]
    }
    storage.data.mooRetryQueue = [{
      kind: 'zentao', enqueuedAt: 0, attempts: 0, projectId: 'p1', req: makeZentaoReq()
    }]
    vi.stubGlobal('fetch', vi.fn())

    const n = await flushRetryQueue()
    expect(n).toBe(0)
    expect(storage.data.mooRetryQueue).toEqual([])  // drop
  })

  it('flush zentao：登录失败 error 含「登录失败」→ drop（认证持久失败重试也救不了）', async () => {
    Object.assign(storage.data, makeZentaoConfig())
    storage.data.mooRetryQueue = [{
      kind: 'zentao', enqueuedAt: 0, attempts: 0,
      projectId: 'proj-zentao', req: makeZentaoReq()
    }]
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ status: 'failed', reason: '登录失败，请检查您的用户名或密码。' }), { status: 200, headers: { 'content-type': 'application/json' } })
    ))

    const n = await flushRetryQueue()
    expect(n).toBe(0)
    expect(storage.data.mooRetryQueue).toEqual([])  // drop
  })

  it('flush zentao：网络错 → keep + attempts++', async () => {
    Object.assign(storage.data, makeZentaoConfig())
    storage.data.mooRetryQueue = [{
      kind: 'zentao', enqueuedAt: 0, attempts: 1,
      projectId: 'proj-zentao', req: makeZentaoReq()
    }]
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))

    const n = await flushRetryQueue()
    expect(n).toBe(0)
    const list = storage.data.mooRetryQueue as any[]
    expect(list).toHaveLength(1)
    expect(list[0].attempts).toBe(2)
    expect(list[0].lastError).toMatch(/network|网络/)
  })

  it('v0.1.x 老条目无 kind 字段 → normalize 成 webhook + 老 flush 路径仍跑', async () => {
    storage.data.mooRetryQueue = [
      // 无 kind 字段（v0.1.x 形态）
      { enqueuedAt: 100, attempts: 0, endpoint: 'http://x/a', method: 'POST', headers: { 'Content-Type': 'application/json' }, bodyString: '{"t":1}' }
    ]
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const n = await flushRetryQueue()
    expect(n).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(storage.data.mooRetryQueue).toEqual([])
  })

  it('getQueueItems 同时返 webhook + zentao 两种条目', async () => {
    storage.data.mooRetryQueue = [
      { kind: 'webhook', enqueuedAt: 100, attempts: 0, endpoint: 'http://x', method: 'POST', headers: {}, bodyString: '{}' },
      { kind: 'zentao', enqueuedAt: 200, attempts: 0, projectId: 'p', req: makeZentaoReq() }
    ]
    const items = await getQueueItems()
    expect(items).toHaveLength(2)
    expect(items[0]?.kind).toBe('webhook')
    expect(items[1]?.kind).toBe('zentao')
  })

  it('removeQueueItem 按 enqueuedAt 删 zentao 条目', async () => {
    storage.data.mooRetryQueue = [
      { kind: 'webhook', enqueuedAt: 100, attempts: 0, endpoint: 'http://x', method: 'POST', headers: {}, bodyString: '{}' },
      { kind: 'zentao', enqueuedAt: 200, attempts: 0, projectId: 'p', req: makeZentaoReq() }
    ]
    const removed = await removeQueueItem(200)
    expect(removed).toBe(true)
    const list = storage.data.mooRetryQueue as any[]
    expect(list).toHaveLength(1)
    expect(list[0].kind).toBe('webhook')
  })
})
