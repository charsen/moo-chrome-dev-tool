import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MSG } from '@/types/messages'

/**
 * useRecorder stop() 重入闸回归测试（第四轮 fix 1）。
 *
 * Bug 场景：elapsed >= maxSec 后计时 interval 每 250ms tick 都调 stop()，而首发
 * RECORD_STOP 在 offscreen 编码大视频期间（秒级）不返回 —— 没有 stopping 闸 +
 * 入口 clearInterval 的话：
 *   - 二发 RECORD_STOP 被 offscreen 状态机拒 → 其 error 响应抢先 resolve(null)
 *     把整段视频丢掉
 *   - SW 端 stop 路径还会把编码中的 offscreen document 关掉
 *
 * 覆盖（vitest fake timers + chrome.runtime.sendMessage mock）：
 *   1. 核心：maxSec 自动停后 STOP 在飞期间继续 tick → RECORD_STOP 只发 1 次，
 *      且首发响应回来后 start Promise 仍能拿到视频（非 null）
 *   2. stop 在飞期间调 cancel() → RECORD_CANCEL 不发（防 offscreen 丢编码中数据）
 *   3. 正常单次 stop 行为不回归（成功返 dataUrl / 失败返 null + error）
 *
 * 不覆盖（属 e2e / 手测）：真 offscreen 编码、SW closeOffscreenDocument 链路。
 */

// node 环境没有 window；useRecorder 用 window.setInterval（要 number 返回类型）。
// 箭头函数在调用时才取 globalThis 的 timer API —— fake timers 装好后自然被接管。
vi.stubGlobal('window', {
  setInterval: (fn: () => void, ms: number) => setInterval(fn, ms) as unknown as number,
  clearInterval: (id: number) => clearInterval(id as unknown as NodeJS.Timeout)
})

const { useRecorder } = await import('@/content/useRecorder')

type SentMsg = { type?: string }

/** 每个测试自己装配：记录发出的消息 + 可手动控制 RECORD_STOP 响应时机的 deferred */
function installSendMessageMock(opts: {
  /** RECORD_STOP 响应：'hang' = 挂起（手动 resolve）；否则立即返回该对象 */
  stopResponse: 'hang' | Record<string, unknown>
}) {
  const sent: SentMsg[] = []
  const stopResolvers: Array<(v: unknown) => void> = []
  const sendMessage = vi.fn(async (msg: SentMsg) => {
    sent.push(msg)
    if (msg?.type === MSG.RECORD_STOP) {
      if (opts.stopResponse === 'hang') {
        return await new Promise((resolve) => { stopResolvers.push(resolve) })
      }
      return opts.stopResponse
    }
    return { ok: true }
  })
  vi.stubGlobal('chrome', { runtime: { sendMessage, id: 'test-ext-id' } })
  return { sent, stopResolvers, sendMessage }
}

function countByType(sent: SentMsg[], type: string): number {
  return sent.filter((m) => m?.type === type).length
}

describe('useRecorder · stop() 重入闸（第四轮 fix 1）', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    // window stub 是 module 级依赖，unstubAllGlobals 会拆掉 —— 重新装上供后续测试用
    vi.stubGlobal('window', {
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms) as unknown as number,
      clearInterval: (id: number) => clearInterval(id as unknown as NodeJS.Timeout)
    })
  })

  it('核心：maxSec 自动停 + STOP 响应挂起 + 继续 tick → RECORD_STOP 只发 1 次，视频不丢', async () => {
    const { sent, stopResolvers } = installSendMessageMock({ stopResponse: 'hang' })
    const recorder = useRecorder({ maxSeconds: 1 })

    const p = recorder.startExternally()

    // 推到 1000ms：tick 在 250/500/750/1000；1000ms 时 elapsed=1 >= maxSec → 自动 stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(countByType(sent, MSG.RECORD_STOP)).toBe(1)

    // STOP 在飞（offscreen 编码中，响应没回来）。再推 1000ms = 4 个 250ms tick 的机会。
    // 没有闸的话每个 tick 都会再发一次 RECORD_STOP。
    await vi.advanceTimersByTimeAsync(1000)
    expect(countByType(sent, MSG.RECORD_STOP)).toBe(1)

    // offscreen 编码完成，首发响应带视频回来 → start Promise 必须拿到视频（非 null）
    expect(stopResolvers).toHaveLength(1)
    stopResolvers[0]!({ ok: true, dataUrl: 'data:video/webm;base64,AAAA', bytes: 4, mime: 'video/webm' })
    const result = await p
    expect(result).not.toBeNull()
    expect(result?.dataUrl).toBe('data:video/webm;base64,AAAA')
    expect(result?.mime).toBe('video/webm')
    expect(recorder.recording.value).toBe(false)
  })

  it('stop 在飞期间调 cancel() → RECORD_CANCEL 不发，视频仍由 stop 响应交付', async () => {
    const { sent, stopResolvers } = installSendMessageMock({ stopResponse: 'hang' })
    const recorder = useRecorder({ maxSeconds: 30 })

    const p = recorder.startExternally()
    await vi.advanceTimersByTimeAsync(500)

    // 用户手动停（STOP 挂起在编码中）
    const stopPromise = recorder.stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(countByType(sent, MSG.RECORD_STOP)).toBe(1)

    // STOP 在飞时再点取消 —— 必须被闸住，否则 offscreen 丢弃编码中数据
    await recorder.cancel()
    expect(countByType(sent, MSG.RECORD_CANCEL)).toBe(0)

    stopResolvers[0]!({ ok: true, dataUrl: 'data:video/webm;base64,BBBB', bytes: 4, mime: 'video/webm' })
    await stopPromise
    const result = await p
    expect(result?.dataUrl).toBe('data:video/webm;base64,BBBB')
  })

  it('正常单次 stop：成功响应 → 返 dataUrl + duration + 状态复位', async () => {
    const { sent } = installSendMessageMock({
      stopResponse: { ok: true, dataUrl: 'data:video/webm;base64,CCCC', bytes: 9, mime: 'video/webm' }
    })
    const recorder = useRecorder({ maxSeconds: 30 })

    const p = recorder.startExternally()
    await vi.advanceTimersByTimeAsync(2000)  // 录 2 秒
    await recorder.stop()

    const result = await p
    expect(result).not.toBeNull()
    expect(result?.dataUrl).toBe('data:video/webm;base64,CCCC')
    expect(result?.bytes).toBe(9)
    expect(result?.duration).toBe(2)
    expect(countByType(sent, MSG.RECORD_STOP)).toBe(1)
    expect(recorder.recording.value).toBe(false)

    // 复位后再 stop 是 no-op（recording=false 挡住），不再发消息
    await recorder.stop()
    expect(countByType(sent, MSG.RECORD_STOP)).toBe(1)
  })

  it('正常单次 stop：错误响应 → 返 null + error 文案 + 状态复位', async () => {
    installSendMessageMock({ stopResponse: { ok: false, error: '编码失败' } })
    const recorder = useRecorder({ maxSeconds: 30 })

    const p = recorder.startExternally()
    await vi.advanceTimersByTimeAsync(500)
    await recorder.stop()

    const result = await p
    expect(result).toBeNull()
    expect(recorder.error.value).toBe('编码失败')
    expect(recorder.recording.value).toBe(false)
  })
})
