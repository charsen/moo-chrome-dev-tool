import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * v0.8.8 Fix A 回归：offscreen 35s tripwire 计时器必须在 cleanup 里清掉。
 *
 * 回归背景：track-ended 自停（SW 端 handleOffscreenAutoStopped 不关 offscreen 文档）
 * 后 35s 内重新开录会复用同一文档；旧版 handleStart 的 setTimeout 句柄没存、cleanup
 * 不清 —— 上一段的残留 timer 到点见 state==='recording' 判真（分不清是哪段录屏）就
 * 强制 recorder.stop()，把新录屏掐死；此刻 stopResolver===null，blob 在 onstop 里
 * 直接丢弃，整段静默丢失。
 *
 * 断面说明（单测层）：node 环境 stub 全套 chrome / document / navigator / MediaRecorder，
 * 经模块真实的 onMessage listener 驱动完整 handleStart → track-ended → cleanup → 重录
 * 流程（不 mock 模块内部函数），fake timers 推进 35s 窗口。
 * 不覆盖：真实 tabCapture 流 / MediaRecorder 编码 / offscreen↔SW IPC —— 那些归
 * E2E（reload-during-recording.spec.ts）+ 发版前手测（RELEASE_TEST_CHECKLIST 录屏段）。
 */

type Listener = (
  msg: unknown,
  sender: { id?: string },
  sendResponse: (r?: unknown) => void
) => boolean

let listener: Listener | null = null
let appendedVideos: FakeVideo[] = []
let streams: FakeStream[] = []
let recorders: FakeRecorder[] = []
let sentMessages: unknown[] = []
let storageSets: Array<Record<string, unknown>> = []

class FakeVideo {
  attrs: Record<string, string> = {}
  style: Record<string, string> = {}
  muted = false
  playsInline = false
  srcObject: unknown = null
  setAttribute(k: string, v: string) { this.attrs[k] = v }
  play() { return Promise.resolve() }
  remove() {
    const i = appendedVideos.indexOf(this)
    if (i >= 0) appendedVideos.splice(i, 1)
  }
}

class FakeTrack {
  private listeners: Record<string, Array<() => void>> = {}
  stop = vi.fn()
  addEventListener(ev: string, cb: () => void) { (this.listeners[ev] ||= []).push(cb) }
  /** 模拟 chrome 自带「停止共享」UI → MediaStreamTrack ended */
  fireEnded() { for (const cb of this.listeners['ended'] ?? []) cb() }
}

class FakeStream {
  track = new FakeTrack()
  getTracks() { return [this.track] }
  getVideoTracks() { return [this.track] }
}

class FakeRecorder {
  static isTypeSupported() { return true }
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'video/webm'
  ondataavailable: ((e: unknown) => void) | null = null
  onstop: (() => Promise<void> | void) | null = null
  start = vi.fn(() => { this.state = 'recording' })
  stop = vi.fn(() => {
    this.state = 'inactive'
    // 真 MediaRecorder 的 onstop 是异步事件；这里同步触发即可 —— 本测试 chunks 恒空，
    // onstop 的 size=0 路径没有 await，整个 cleanup 同步走完。
    void this.onstop?.()
  })
  constructor(_stream: unknown, _opts?: unknown) { recorders.push(this) }
}

function stubEnv() {
  listener = null
  appendedVideos = []
  streams = []
  recorders = []
  sentMessages = []
  storageSets = []
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'ext-self',
      onMessage: { addListener: (fn: Listener) => { listener = fn } },
      sendMessage: vi.fn(async (msg: unknown) => { sentMessages.push(msg) })
    },
    storage: {
      local: {
        set: vi.fn(async (kv: Record<string, unknown>) => { storageSets.push(kv) })
      }
    }
  })
  vi.stubGlobal('document', {
    createElement: (_tag: string) => new FakeVideo(),
    body: { appendChild: (v: FakeVideo) => { appendedVideos.push(v) } },
    querySelectorAll: (_sel: string) => appendedVideos.filter((v) => v.attrs['data-moo-sink'] != null)
  })
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        const s = new FakeStream()
        streams.push(s)
        return s
      })
    }
  })
  vi.stubGlobal('MediaRecorder', FakeRecorder)
}

/** 走真实 onMessage listener 投递消息（sender.id 须 === runtime.id，否则被来源校验拒） */
function send(msg: unknown): Promise<any> {
  return new Promise((resolve) => {
    listener!(msg, { id: 'ext-self' }, resolve)
  })
}

describe('offscreen 35s tripwire 残留计时器（v0.8.8 Fix A）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    stubEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('核心回归：录制#1 track-ended 自停后复用文档开录#2 → 跨过旧 timer 35s 到点位 #2 仍在 recording', async () => {
    await import('@/offscreen/index')
    expect(listener).toBeTruthy()

    // 录制 #1
    const r1 = await send({ target: 'offscreen', type: 'START', streamId: 's1', tabId: 1 })
    expect(r1.ok).toBe(true)
    expect(recorders).toHaveLength(1)

    // 用户点 chrome「停止共享」→ track ended → 自停路径走到 cleanup（state 回 idle，
    // SW 端 handleOffscreenAutoStopped 不关文档 → 文档继续复用）
    streams[0]!.track.fireEnded()
    expect(recorders[0]!.stop).toHaveBeenCalledTimes(1)
    const q1 = await send({ target: 'offscreen', type: 'QUERY_STATE' })
    expect(q1.state).toBe('idle')

    // 5s 后重录 #2（同模块复用）
    await vi.advanceTimersByTimeAsync(5_000)
    const r2 = await send({ target: 'offscreen', type: 'START', streamId: 's2', tabId: 1 })
    expect(r2.ok).toBe(true)
    expect(recorders).toHaveLength(2)

    // 再推 34s：总时长 39s，跨过「#1 起点 + 35s」旧 timer 到点位，
    // 但还没到「#2 起点 + 35s」—— #2 必须还活着
    await vi.advanceTimersByTimeAsync(34_000)
    const q2 = await send({ target: 'offscreen', type: 'QUERY_STATE' })
    expect(q2.state).toBe('recording')                 // 修前：#1 残留 timer 在此前已把 #2 掐成 idle
    expect(recorders[1]!.stop).not.toHaveBeenCalled()  // 修前：recorder#2.stop 被旧 timer 调到（blob 静默丢）
  })

  it('正常路径不回归：单段录制满 35s 无 content stop → tripwire 仍强停 + 广播 AUTO_STOPPED', async () => {
    await import('@/offscreen/index')
    const r1 = await send({ target: 'offscreen', type: 'START', streamId: 's1', tabId: 1 })
    expect(r1.ok).toBe(true)

    await vi.advanceTimersByTimeAsync(35_000)
    expect(recorders[0]!.stop).toHaveBeenCalledTimes(1)
    const q = await send({ target: 'offscreen', type: 'QUERY_STATE' })
    expect(q.state).toBe('idle')
    // 三路保险里 offscreen 端发的两路必须出去（rec-bar 收回链路）
    expect(sentMessages).toContainEqual({ type: 'OFFSCREEN_AUTO_STOPPED' })
    expect(storageSets.some((kv) => 'mooOffscreenAutoStopped' in kv)).toBe(true)
  })

  it('防过度清理：复用文档开录#2 后，#2 自己的 tripwire 满 35s 仍会强停', async () => {
    await import('@/offscreen/index')
    await send({ target: 'offscreen', type: 'START', streamId: 's1', tabId: 1 })
    streams[0]!.track.fireEnded()
    await vi.advanceTimersByTimeAsync(5_000)
    const r2 = await send({ target: 'offscreen', type: 'START', streamId: 's2', tabId: 1 })
    expect(r2.ok).toBe(true)

    // #2 满 35s（总 40s）→ #2 自己的 tripwire 必须触发（fix 只清旧 timer，不能伤新 timer）
    await vi.advanceTimersByTimeAsync(35_000)
    expect(recorders[1]!.stop).toHaveBeenCalledTimes(1)
    const q = await send({ target: 'offscreen', type: 'QUERY_STATE' })
    expect(q.state).toBe('idle')
  })
})
