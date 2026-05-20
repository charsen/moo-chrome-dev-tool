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
  flushRetryQueue,
  getQueueItems,
  removeQueueItem,
  __resetForTest
} = await import('@/background/retryQueue')

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
      { enqueuedAt: 100, attempts: 1, endpoint: 'http://x/a', method: 'POST', headers: { 'x-y': '1' }, bodyString: '{"a":1}' },
      { enqueuedAt: 200, attempts: 2, endpoint: 'http://x/b', method: 'PUT', headers: {}, bodyString: '{"b":2}' }
    ]
    const items = await getQueueItems()
    expect(items).toHaveLength(2)
    expect(items[0]?.endpoint).toBe('http://x/a')
    expect(items[0]?.bodyString).toBe('{"a":1}')
    expect(items[1]?.method).toBe('PUT')
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
