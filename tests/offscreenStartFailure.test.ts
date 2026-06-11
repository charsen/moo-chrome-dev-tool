import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * v0.8.9 Fix H 回归：offscreen recorder.start() 抛错路径。
 *
 * 回归背景：getUserMedia 成功到 recorder.start(1000) 之间被捕获 tab 关闭 / track
 * 结束 → stream inactive → start() 抛 InvalidStateError。修前裸抛：START 消息永不
 * sendResponse，SW 端 await sendMessage 永久 pending、state 卡 starting、stream 不
 * 释放（tab「正在被捕获」指示灯常亮），只能 CANCEL 救。修后：
 *   - handleStart 内 try/catch 就近 cleanup('idle') + 返「录制器启动失败」可读错误
 *   - START/STOP listener 加 .catch 兜底（任何未捕获 throw 都必须有响应）
 *
 * 断面说明（单测层）：harness 复用 offscreenTripwire.test.ts —— node 环境 stub 全套
 * chrome / document / navigator / MediaRecorder，经模块真实 onMessage listener 驱动。
 * 不覆盖：真实 tabCapture 流 / 真 InvalidStateError 时序 —— 归 e2e
 * （reload-during-recording.spec.ts）+ 发版前手测（RELEASE_TEST_CHECKLIST 录屏段）。
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
/** 控制 FakeRecorder.start() 是否抛（模拟 stream inactive → InvalidStateError） */
let recorderStartThrows = false
/** 控制 document.createElement 抛一次（驱动 listener .catch 兜底路径） */
let createElementThrowsOnce = false

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
  stop = vi.fn()
  addEventListener() {}
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
  start = vi.fn(() => {
    if (recorderStartThrows) {
      throw new Error("Failed to execute 'start' on 'MediaRecorder': The MediaRecorder's stream is inactive")
    }
    this.state = 'recording'
  })
  stop = vi.fn(() => {
    this.state = 'inactive'
    void this.onstop?.()
  })
  constructor(_stream: unknown, _opts?: unknown) { recorders.push(this) }
}

function stubEnv() {
  listener = null
  appendedVideos = []
  streams = []
  recorders = []
  recorderStartThrows = false
  createElementThrowsOnce = false
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'ext-self',
      onMessage: { addListener: (fn: Listener) => { listener = fn } },
      sendMessage: vi.fn(async () => {})
    },
    storage: { local: { set: vi.fn(async () => {}) } }
  })
  vi.stubGlobal('document', {
    createElement: (_tag: string) => {
      if (createElementThrowsOnce) {
        createElementThrowsOnce = false
        throw new Error('document detached')
      }
      return new FakeVideo()
    },
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

/** 走真实 onMessage listener 投递消息（sender.id 须 === runtime.id） */
function send(msg: unknown): Promise<any> {
  return new Promise((resolve) => {
    listener!(msg, { id: 'ext-self' }, resolve)
  })
}

describe('offscreen recorder.start 抛错（v0.8.9 Fix H）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    stubEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('① start() 抛 → START 有响应 {ok:false, 含「录制器启动失败」} + state 回 idle + stream 释放', async () => {
    await import('@/offscreen/index')
    recorderStartThrows = true

    const r = await send({ target: 'offscreen', type: 'START', streamId: 's1', tabId: 1 })
    // 修前：handleStart 裸抛 + listener 无 .catch → 这里永远不 resolve（测试超时红）
    expect(r.ok).toBe(false)
    expect(String(r.error)).toContain('录制器启动失败')

    const q = await send({ target: 'offscreen', type: 'QUERY_STATE' })
    expect(q.state).toBe('idle')                       // 不卡 starting
    expect(streams[0]!.track.stop).toHaveBeenCalled()  // stream 真释放（捕获指示灯熄）
    expect(appendedVideos).toHaveLength(0)             // keepalive + sink video 全清
  })

  it('② start() 抛后立即重试 START → 能正常开录（状态机没被卡死）', async () => {
    await import('@/offscreen/index')
    recorderStartThrows = true
    await send({ target: 'offscreen', type: 'START', streamId: 's1', tabId: 1 })

    recorderStartThrows = false
    const r2 = await send({ target: 'offscreen', type: 'START', streamId: 's2', tabId: 1 })
    expect(r2.ok).toBe(true)
    const q = await send({ target: 'offscreen', type: 'QUERY_STATE' })
    expect(q.state).toBe('recording')
  })

  it('③ 正常 start 不回归：ok:true + state recording', async () => {
    await import('@/offscreen/index')
    const r = await send({ target: 'offscreen', type: 'START', streamId: 's1', tabId: 1 })
    expect(r.ok).toBe(true)
    const q = await send({ target: 'offscreen', type: 'QUERY_STATE' })
    expect(q.state).toBe('recording')
    expect(recorders[0]!.start).toHaveBeenCalledWith(1000)
  })

  it('④ listener .catch 兜底：handleStart 在 try/catch 覆盖范围外抛 → 仍有 {ok:false} 响应 + 回 idle', async () => {
    await import('@/offscreen/index')
    // createElement 抛（keepalive sink 创建在 handleStart 自己的 try/catch 之外）
    createElementThrowsOnce = true
    const r = await send({ target: 'offscreen', type: 'START', streamId: 's1', tabId: 1 })
    expect(r.ok).toBe(false)
    expect(String(r.error)).toBeTruthy()

    const q = await send({ target: 'offscreen', type: 'QUERY_STATE' })
    expect(q.state).toBe('idle')
    // 状态机没坏：还能正常开录
    const r2 = await send({ target: 'offscreen', type: 'START', streamId: 's2', tabId: 1 })
    expect(r2.ok).toBe(true)
  })
})
