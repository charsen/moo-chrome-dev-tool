import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vitest 环境是 'node'（vitest.config.ts），useAutoSave 用了 onBeforeUnmount
// 在 setup 外调用会 Vue warn——这里 mock 成 no-op，专注测时序 + 状态机逻辑
vi.mock('vue', async (importActual) => {
  const actual = await importActual<typeof import('vue')>()
  return { ...actual, onBeforeUnmount: vi.fn() }
})

// node 环境没有 window，但 useAutoSave 用 window.setTimeout（拿 number 返回类型）
// stub 一个最小 window 转发到 globalThis 的 setTimeout / clearTimeout
vi.stubGlobal('window', {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => clearTimeout(id as unknown as NodeJS.Timeout)
})

const { useAutoSave } = await import('@/composables/useAutoSave')

// fake timers 不影响微任务，但 vi.advanceTimersByTimeAsync 也只推进 timer 而不 flush
// 继发的微任务。手动反复 yield 直到所有 pending microtask 跑完。
async function flushMicrotasks(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
  }
}

describe('useAutoSave', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('初态 saveState === "idle"', () => {
    const r = useAutoSave({ save: vi.fn() })
    expect(r.saveState.value).toBe('idle')
  })

  it('scheduleSave 防抖：多次连续触发只执行一次 save', async () => {
    const save = vi.fn(async () => {})
    const r = useAutoSave({ save, debounceMs: 800 })

    r.scheduleSave()
    r.scheduleSave()
    r.scheduleSave()
    // 防抖窗口内：还没真 save，但状态先显示 saving 给用户即时反馈
    expect(save).not.toHaveBeenCalled()
    expect(r.saveState.value).toBe('saving')

    await vi.advanceTimersByTimeAsync(800)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('保存成功后：saving → saved → idle（默认 1500ms 后衰减）', async () => {
    const save = vi.fn(async () => {})
    const r = useAutoSave({ save, debounceMs: 0 })

    r.scheduleSave()
    // debounceMs: 0 路径直接走 doSave；await 让微任务 flush
    await Promise.resolve()
    await flushMicrotasks()
    expect(save).toHaveBeenCalledTimes(1)
    expect(r.saveState.value).toBe('saved')

    await vi.advanceTimersByTimeAsync(1500)
    expect(r.saveState.value).toBe('idle')
  })

  it('savedDisplayMs 可配置：用 500 ms 后立刻 idle', async () => {
    const save = vi.fn(async () => {})
    const r = useAutoSave({ save, debounceMs: 0, savedDisplayMs: 500 })

    r.scheduleSave()
    await flushMicrotasks()
    expect(r.saveState.value).toBe('saved')
    await vi.advanceTimersByTimeAsync(500)
    expect(r.saveState.value).toBe('idle')
  })

  it('保存中又 schedule：inflight 计数防止 saving↔saved 来回闪', async () => {
    // 两次 save 都用手动 resolve 控制，才能模拟「第一次完成时第二次还在路上」
    const resolvers: Array<() => void> = []
    const save = vi.fn(() => new Promise<void>((res) => { resolvers.push(res) }))
    const r = useAutoSave({ save, debounceMs: 100 })

    r.scheduleSave()
    await vi.advanceTimersByTimeAsync(100)
    expect(save).toHaveBeenCalledTimes(1)
    expect(r.saveState.value).toBe('saving')

    r.scheduleSave()
    await vi.advanceTimersByTimeAsync(100)
    expect(save).toHaveBeenCalledTimes(2)

    // resolve 第一次（第二次还挂着）
    resolvers[0]!()
    await flushMicrotasks()
    // 第一次完成时 inflight 还有 1 → 不应切到 saved
    expect(r.saveState.value).toBe('saving')

    // resolve 第二次
    resolvers[1]!()
    await flushMicrotasks()
    expect(r.saveState.value).toBe('saved')
  })

  it('save throws：状态进 error + onError 收到错误', async () => {
    const err = new Error('boom')
    const onError = vi.fn()
    const save = vi.fn(async () => { throw err })
    const r = useAutoSave({ save, debounceMs: 0, onError })

    r.scheduleSave()
    await flushMicrotasks()
    expect(r.saveState.value).toBe('error')
    expect(onError).toHaveBeenCalledWith(err)
  })

  it('error 不带 onError 也不崩', async () => {
    const save = vi.fn(async () => { throw new Error('x') })
    const r = useAutoSave({ save, debounceMs: 0 })
    r.scheduleSave()
    await flushMicrotasks()
    expect(r.saveState.value).toBe('error')
  })

  it('flush 跳过 pending 防抖立即触发 save', async () => {
    const save = vi.fn(async () => {})
    const r = useAutoSave({ save, debounceMs: 800 })

    r.scheduleSave()
    expect(save).not.toHaveBeenCalled()

    void r.flush()
    await flushMicrotasks()
    expect(save).toHaveBeenCalledTimes(1)

    // 原 debounce 推进也不再触发（timer 已 clear）
    await vi.advanceTimersByTimeAsync(800)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('debounceMs: 0 → scheduleSave 立刻走 doSave，不开 setTimeout', async () => {
    const save = vi.fn(async () => {})
    const r = useAutoSave({ save, debounceMs: 0 })

    r.scheduleSave()
    await flushMicrotasks()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('防抖窗口内连击多次 → 最终一次 save + 切 saved', async () => {
    const save = vi.fn(async () => {})
    const r = useAutoSave({ save, debounceMs: 300 })

    r.scheduleSave()
    await vi.advanceTimersByTimeAsync(100)
    r.scheduleSave()  // 重置防抖
    await vi.advanceTimersByTimeAsync(100)
    r.scheduleSave()
    expect(save).not.toHaveBeenCalled()
    expect(r.saveState.value).toBe('saving')

    await vi.advanceTimersByTimeAsync(300)
    await flushMicrotasks()
    expect(save).toHaveBeenCalledTimes(1)
    expect(r.saveState.value).toBe('saved')
  })
})
