import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * v0.8.9 Fix D 回归：Settings 队列写路径（删一条 / 清空）改走消息路由 ——
 * SW 端新增 RETRY_QUEUE_REMOVE / RETRY_QUEUE_CLEAR 两个 case，在 SW 上下文内调
 * removeQueueItem / clearQueue（吃 SW 同一把 withQueueMutex）。
 *
 * 回归背景：devtools 直 import retryQueue 写路径时，withQueueMutex 是各 JS 上下文
 * 各一把内存锁互不相干，会跟 SW flush 的 reconcile 写回交错（用户删的条复活 /
 * flush 已移除的条被旧快照写回 → 重发重复单）。
 *
 * 断面说明（单测层）：stub 全套 chrome 后 import 真实 background/index，捕获
 * onMessage listener，经真实 dispatch 验证两个新 case 调到 retryQueue spy +
 * 响应 shape 正确。Settings.vue UI 端（safeSendMessage 改造）归 e2e
 * （panel-settings-toggle.spec.ts 守护面板可用性）+ 发版前手测。
 */

type Listener = (
  raw: unknown,
  sender: { id?: string; tab?: { id?: number } },
  sendResponse: (r?: unknown) => void
) => boolean

vi.mock('@/background/retryQueue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/background/retryQueue')>()
  return {
    ...actual,
    flushRetryQueue: vi.fn(async () => ({ attempted: 0, succeeded: 0, dropped: 0, skipped: false })),
    getQueueLength: vi.fn(async () => 0),
    removeQueueItem: vi.fn(async () => true),
    clearQueue: vi.fn(async () => {})
  }
})

let messageListeners: Listener[]

function stubChrome() {
  messageListeners = []
  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        async get(key: string) { return { [key]: undefined } },
        async set() {},
        async remove() {}
      },
      onChanged: { addListener() {}, removeListener() {} }
    },
    permissions: {
      onAdded: { addListener() {} },
      onRemoved: { addListener() {} },
      async contains() { return true }
    },
    alarms: {
      onAlarm: { addListener() {} },
      async get() { return undefined },
      async create() {}
    },
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener: (fn: Listener) => { messageListeners.push(fn) } },
      onConnect: { addListener() {} },
      id: 'test-ext',
      getManifest: () => ({ version: '0.8.9', content_scripts: [] })
    },
    commands: { onCommand: { addListener() {} } },
    scripting: {
      async getRegisteredContentScripts() { return [] },
      async unregisterContentScripts() {},
      async registerContentScripts() {}
    },
    windows: { onRemoved: { addListener() {} } }
  }
}

/** 经真实 listener 派发消息；listener 返回 true（异步响应）时等 sendResponse */
function dispatch(msg: unknown, sender: { id?: string } = { id: 'test-ext' }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const l = messageListeners[0]
    if (!l) return reject(new Error('background/index 没注册 onMessage listener'))
    const handled = l(msg, sender, resolve)
    if (!handled) resolve(undefined)   // 同步拒绝（来源校验失败 / shape 不识别）
  })
}

beforeEach(() => {
  vi.resetModules()
  stubChrome()
})

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
  vi.clearAllMocks()
})

describe('SW dispatch — RETRY_QUEUE_REMOVE / RETRY_QUEUE_CLEAR（v0.8.9 Fix D）', () => {
  it('RETRY_QUEUE_REMOVE：合法 sender → removeQueueItem(enqueuedAt) 真被调，响应 {ok:true, removed:true}', async () => {
    await import('@/background/index')
    const rq = await import('@/background/retryQueue')
    expect(messageListeners.length).toBeGreaterThan(0)

    const res = await dispatch({ type: 'RETRY_QUEUE_REMOVE', payload: { enqueuedAt: 1718000000123 } })
    expect(res).toEqual({ ok: true, removed: true })
    expect(rq.removeQueueItem).toHaveBeenCalledTimes(1)
    expect(rq.removeQueueItem).toHaveBeenCalledWith(1718000000123)
  })

  it('RETRY_QUEUE_REMOVE：条目已不在（removeQueueItem 返 false）→ removed:false 透传给 UI', async () => {
    await import('@/background/index')
    const rq = await import('@/background/retryQueue')
    vi.mocked(rq.removeQueueItem).mockResolvedValueOnce(false)

    const res = await dispatch({ type: 'RETRY_QUEUE_REMOVE', payload: { enqueuedAt: 42 } })
    expect(res).toEqual({ ok: true, removed: false })
  })

  it('RETRY_QUEUE_CLEAR：合法 sender → clearQueue 真被调，响应 {ok:true}', async () => {
    await import('@/background/index')
    const rq = await import('@/background/retryQueue')

    const res = await dispatch({ type: 'RETRY_QUEUE_CLEAR' })
    expect(res).toEqual({ ok: true })
    expect(rq.clearQueue).toHaveBeenCalledTimes(1)
  })

  it('sender.id 不匹配（外部扩展/undefined）→ 拒绝，写路径不被调', async () => {
    await import('@/background/index')
    const rq = await import('@/background/retryQueue')

    const r1 = await dispatch({ type: 'RETRY_QUEUE_CLEAR' }, { id: 'evil-ext' })
    expect(r1).toBeUndefined()
    const r2 = await dispatch({ type: 'RETRY_QUEUE_REMOVE', payload: { enqueuedAt: 1 } }, { id: undefined })
    expect(r2).toBeUndefined()
    expect(rq.clearQueue).not.toHaveBeenCalled()
    expect(rq.removeQueueItem).not.toHaveBeenCalled()
  })
})
