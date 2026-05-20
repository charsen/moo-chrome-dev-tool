import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 仿 useAutoSave.test.ts 的两个 hack：
// 1) vitest 跑 node 环境，setup 外调 onBeforeUnmount 会 Vue warn——mock 成
//    可观察的 vi.fn()，并把注册进去的 callback 留出来手动触发（测 unmount 清 timer 用）
// 2) node 没 window，但 useToast 用 window.setTimeout 拿 number 返回类型——
//    stub 一个最小 window 把调用转发到 globalThis 的 setTimeout / clearTimeout
const onBeforeUnmountMock = vi.fn<(cb: () => void) => void>()
vi.mock('vue', async (importActual) => {
  const actual = await importActual<typeof import('vue')>()
  return { ...actual, onBeforeUnmount: onBeforeUnmountMock }
})

vi.stubGlobal('window', {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id: number) => clearTimeout(id as unknown as NodeJS.Timeout)
})

const { useToast } = await import('@/composables/useToast')

// 从 onBeforeUnmount mock 里取最后一次注册的 callback（每次 useToast 调用都会注册一次）
function lastUnmountCb(): () => void {
  const calls = onBeforeUnmountMock.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1]![0]
}

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    onBeforeUnmountMock.mockClear()
  })
  afterEach(() => { vi.useRealTimers() })

  it('初态：toast 为空、toastKind 默认 info', () => {
    const r = useToast()
    expect(r.toast.value).toBe('')
    expect(r.toastKind.value).toBe('info')
  })

  it('showToast(msg) 把 toast.value 设为 msg', () => {
    const r = useToast()
    r.showToast('hello')
    expect(r.toast.value).toBe('hello')
  })

  it('showToast(msg, "error") 同时设 kind', () => {
    const r = useToast()
    r.showToast('boom', 'error')
    expect(r.toast.value).toBe('boom')
    expect(r.toastKind.value).toBe('error')
  })

  it('默认 2600ms 后自动清空 toast；未传 resetKindOnHide 时 kind 保留', async () => {
    const r = useToast()
    r.showToast('hi', 'success')
    expect(r.toast.value).toBe('hi')

    await vi.advanceTimersByTimeAsync(2600)
    expect(r.toast.value).toBe('')
    // 未传 resetKindOnHide → kind 不还原（实现见 useToast.ts 第 55 行）
    expect(r.toastKind.value).toBe('success')
  })

  it('自定义 durationMs 覆盖默认 2600', async () => {
    const r = useToast()
    r.showToast('hi', 'info', 5000)

    await vi.advanceTimersByTimeAsync(2600)
    expect(r.toast.value).toBe('hi')  // 默认时长过了但自定义 5000 还没到
    await vi.advanceTimersByTimeAsync(2400)
    expect(r.toast.value).toBe('')
  })

  // 4 处泄漏修复点之一的关键证据：第二次 showToast 重置第一次的 timer，
  // 而不是叠加 —— 第一条不会因为先到的 2600ms 提前消失
  it('连续两次 showToast：第二次重置 timer，不叠加', async () => {
    const r = useToast()
    r.showToast('first', 'info', 2600)

    await vi.advanceTimersByTimeAsync(2000)  // 第一条还剩 600ms
    r.showToast('second', 'error', 2600)     // 这里应 clearTimeout 旧 timer
    expect(r.toast.value).toBe('second')

    // 推进 600ms（第一条原本到期点）：如果旧 timer 没清，会把 toast 清空
    await vi.advanceTimersByTimeAsync(600)
    expect(r.toast.value).toBe('second')
    expect(r.toastKind.value).toBe('error')

    // 再推 2000ms（合计 2600，到第二条的真到期点）才清空
    await vi.advanceTimersByTimeAsync(2000)
    expect(r.toast.value).toBe('')
  })

  // 4 处泄漏的根因 case：组件 unmount 后 pending timer 必须被清，
  // 否则 setTimeout 回调会写到已销毁组件的 ref 上
  it('onBeforeUnmount 触发后清掉 pending timer：到点也不再改 toast', async () => {
    const r = useToast()
    r.showToast('willCancel', 'info', 2600)
    expect(r.toast.value).toBe('willCancel')

    // 模拟组件销毁：手动调注册到 onBeforeUnmount 的 callback
    lastUnmountCb()()

    // 把假时钟推到原本到期点之后：toast.value 不应被异步回调改回 ''
    await vi.advanceTimersByTimeAsync(3000)
    expect(r.toast.value).toBe('willCancel')
  })

  // ContentApp 那处用法：显式传 kind union 带空串 + resetKindOnHide: ''
  // → 清空时 kind 回到 ''（清掉 :class="[toastKind]" 里的残留 class）
  it('泛型 kind + resetKindOnHide: "" → 清空时 kind 还原为 ""', async () => {
    const r = useToast<'success' | 'error' | 'info' | ''>({
      initialKind: '',
      resetKindOnHide: ''
    })
    expect(r.toastKind.value).toBe('')

    r.showToast('saved', 'success')
    expect(r.toastKind.value).toBe('success')

    await vi.advanceTimersByTimeAsync(2600)
    expect(r.toast.value).toBe('')
    expect(r.toastKind.value).toBe('')
  })
})
