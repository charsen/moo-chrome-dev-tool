import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// P2 回归：入队 / flush 无共享写锁的 lost-update race。
//
// doFlush 的网络段（adapter.retryFromPayload）跑几十秒在锁外，期间 pushItem 可能已入队
// 新失败条 / removeQueueItem 可能已删条。修复前 doFlush 直接 set(remaining) 用 flush 开始
// 时的旧快照覆盖 → flush 期间新入队的条被吞 / 已删条复活。
//
// 修法：pushItem/removeQueueItem/clearQueue 都套 withQueueMutex；doFlush 网络段在锁外，
// 写回改成「锁内重读 current + reconcile merge」（保留快照外新条、不复活被删条）。
//
// 测这个 race 的关键：让 adapter.retryFromPayload **可控挂起**（返回手动 resolve 的 promise），
// 趁 A 的重试还在飞时往队列 push B，再 resolve A，断言 B 没被吞。
//
// 用 vi.mock('@/adapters') 把 getAdapter 换成可控 stub，避免真 fetch / 真禅道链路 ——
// 现有 retryQueue.test.ts 走真 adapter + fetch mock，这里互补，分文件互不污染。
// ============================================================

// ---- 可控 adapter：retryFromPayload 返回一个外部能手动 resolve 的 deferred ----
type RetryOutcome = { kind: 'ok' } | { kind: 'drop'; reason: string } | { kind: 'keep'; status?: number; error: string }
interface Deferred {
  promise: Promise<RetryOutcome>
  resolve: (o: RetryOutcome) => void
}
function deferred(): Deferred {
  let resolve!: (o: RetryOutcome) => void
  const promise = new Promise<RetryOutcome>((r) => { resolve = r })
  return { promise, resolve }
}

// 每个 enqueuedAt 对应一个 deferred —— flush 跑到某条时挂在它的 promise 上，
// 测试代码在中途 resolve 它来精确控制时序。
const deferredByAt = new Map<number, Deferred>()
// retryFromPayload 被调用时记录，方便断言「A 的重试确实开始飞了」。
const retryStarted: number[] = []

vi.mock('@/adapters', () => ({
  getAdapter: (kind: string) => {
    if (kind !== 'webhook' && kind !== 'zentao') return undefined
    return {
      kind,
      async retryFromPayload(payload: { enqueuedAt: number }) {
        retryStarted.push(payload.enqueuedAt)
        const d = deferredByAt.get(payload.enqueuedAt)
        if (!d) throw new Error(`test: no deferred for enqueuedAt ${payload.enqueuedAt}`)
        return d.promise
      }
    }
  }
}))

interface MockStorage {
  data: Record<string, unknown>
}

function makeChrome(): MockStorage {
  const state: MockStorage = { data: {} }
  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: state.data[key] }
        },
        async set(obj: Record<string, unknown>) {
          Object.assign(state.data, obj)
        }
      }
    },
    permissions: {
      async contains() { return true }
    }
  }
  return state
}

const {
  enqueueRetry,
  flushRetryQueue,
  removeQueueItem,
  __resetForTest
} = await import('@/background/retryQueue')

/** 直接构造一条 webhook 队列条目（webhook kind 不触发 loadConfig，纯走 adapter mock）。 */
function webhookItem(enqueuedAt: number) {
  return {
    kind: 'webhook',
    enqueuedAt,
    attempts: 0,
    endpoint: 'http://x/' + enqueuedAt,
    method: 'POST',
    headers: {},
    bodyString: `{"at":${enqueuedAt}}`
  }
}

/**
 * 让出 microtask 直到指定 enqueuedAt 的 retryFromPayload 真的被调到（flush 内部有多个 await：
 * cooldown check / hasHostPermission / readQueue / per-item，固定 tick 数太脆，改成轮询 retryStarted）。
 */
async function waitRetryStarted(at: number, maxTicks = 100) {
  for (let i = 0; i < maxTicks; i++) {
    if (retryStarted.includes(at)) return
    await Promise.resolve()
  }
  throw new Error(`test: retryFromPayload(${at}) 未在 ${maxTicks} 个 microtask 内被调用`)
}

function queueAts(storage: MockStorage): number[] {
  const list = (storage.data.mooRetryQueue as Array<{ enqueuedAt: number }> | undefined) ?? []
  return list.map((q) => q.enqueuedAt).sort((a, b) => a - b)
}

describe('retryQueue — flush 期间并发入队 race（P2 回归）', () => {
  let storage: MockStorage

  beforeEach(() => {
    storage = makeChrome()
    __resetForTest()
    deferredByAt.clear()
    retryStarted.length = 0
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    __resetForTest()
  })

  it('核心：A 重试中途入队 B，A 失败留队 → 最终 [A, B]（B 不被吞）', async () => {
    // 队列里先有 A（enqueuedAt=100）。给 A 准备一个挂起的 deferred。
    storage.data.mooRetryQueue = [webhookItem(100)]
    const dA = deferred()
    deferredByAt.set(100, dA)

    // 不 await：启动 flush，它会读队列、跑到 A 的 retryFromPayload 挂在 dA 上。
    const flushP = flushRetryQueue()
    await waitRetryStarted(100) // A 的重试确实开始飞了

    // 趁 A 还在飞，入队 B（enqueuedAt 由 pushItem 现取 Date.now，远大于 100）。
    await enqueueRetry('http://x/b', 'POST', {}, '{"b":1}')
    // B 应该已经落进 storage（pushItem 套了 withQueueMutex，flush 网络段在锁外不挡它）
    const atsAfterPush = queueAts(storage)
    expect(atsAfterPush).toContain(100)
    expect(atsAfterPush.length).toBe(2)
    const bAt = atsAfterPush.find((a) => a !== 100)!

    // 让 A 的重试 resolve 成失败（keep）→ A 留队、attempts++。
    dA.resolve({ kind: 'keep', status: 503, error: 'boom' })
    await flushP

    // 核心断言：最终队列 = [A, B]。修复前 doFlush 用旧快照 set(remaining=[A]) 把 B 吞掉。
    expect(queueAts(storage)).toEqual([100, bAt])
    const list = storage.data.mooRetryQueue as Array<{ enqueuedAt: number; attempts: number }>
    const aItem = list.find((q) => q.enqueuedAt === 100)!
    expect(aItem.attempts).toBe(1) // A 失败一次
  })

  it('变体：A 重试中途入队 B，A 成功 → 最终 [B]（A 移除、B 保留）', async () => {
    storage.data.mooRetryQueue = [webhookItem(100)]
    const dA = deferred()
    deferredByAt.set(100, dA)

    const flushP = flushRetryQueue()
    await waitRetryStarted(100)

    await enqueueRetry('http://x/b', 'POST', {}, '{"b":1}')
    const bAt = queueAts(storage).find((a) => a !== 100)!

    // A 成功 → 从队列移除，但 B（flush 期间新入队、不在快照）必须保留。
    dA.resolve({ kind: 'ok' })
    await flushP

    expect(queueAts(storage)).toEqual([bAt])
  })

  it('变体：flush 期间 removeQueueItem(A) 并发删 → A 不被 reconcile 复活', async () => {
    // 队列里有 A(100) 和 C(200)。flush 跑 A 时挂起，期间把 A 删掉。
    // A resolve 成 keep（若无 reconcile，旧快照 remaining 会把已删的 A 复活）。
    storage.data.mooRetryQueue = [webhookItem(100), webhookItem(200)]
    const dA = deferred()
    const dC = deferred()
    deferredByAt.set(100, dA)
    deferredByAt.set(200, dC)

    const flushP = flushRetryQueue()
    await waitRetryStarted(100)

    // 并发删 A
    const removed = await removeQueueItem(100)
    expect(removed).toBe(true)
    expect(queueAts(storage)).toEqual([200])

    // A resolve 成 keep（瞬时错）；C 也 resolve 成 keep
    dA.resolve({ kind: 'keep', status: 500, error: 'a-fail' })
    dC.resolve({ kind: 'keep', status: 500, error: 'c-fail' })
    await flushP

    // A 已被并发删 → 不复活；C 仍在（重试失败 attempts++ 后保留）
    expect(queueAts(storage)).toEqual([200])
  })
})
