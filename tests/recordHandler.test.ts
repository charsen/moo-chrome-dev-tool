import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * v0.5.2 P0 重构第 2 阶段 — handlers/record.ts 单测。
 *
 * 比 simple/submit 难，因为：
 *   - module-level 私有 state（currentRecording），跨 test 会残留 → 用 vi.resetModules 重 import
 *   - 一坨 chrome.* API（tabCapture / offscreen / alarms / tabs.query/sendMessage / runtime.getContexts）要 mock
 *   - startTabRecording 内 getMediaStreamId 是 callback 风格不是 promise
 *
 * 覆盖核心 handler + spin-up helper：
 *   - handleQueryRecordingState（最简单：初始 false）
 *   - state 流转：start → query=true → cancel → query=false
 *   - handleOffscreenAutoStopped 清 state + broadcast
 *   - rehydrateRecordingFromOffscreen 从 offscreen 拉 state
 *   - emergencyStopForWindow（窗口关闭紧急停录）
 *   - checkOffscreenAutoStoppedFlag（SW spin-up 兜底）
 */

import { MSG } from '@/types/messages'

interface MockState {
  storageData: Record<string, unknown>
  contexts: unknown[]  // chrome.runtime.getContexts 返这个
  /** offscreen QUERY_STATE 响应 */
  offscreenState: { state?: string; meta?: { tabId?: number; startedAt?: number } | null } | null
  /** chrome.runtime.sendMessage 通用响应（offscreen target） */
  offscreenStartRes: { ok: boolean; error?: string }
  offscreenStopRes: { ok: boolean; dataUrl?: string; bytes?: number; mime?: string; error?: string }
  hasTabCapturePerm: boolean
  streamIdResult: { id?: string; err?: string }
  tabs: Array<{ id: number; windowId?: number }>
  /** chrome.tabs.sendMessage 收到的消息（用于断言 broadcast） */
  sentToTabs: Array<{ tabId: number; msg: unknown }>
  /** chrome.alarms.create / clear 调用记录 */
  alarmsCreated: Array<{ name: string; opts: unknown }>
  alarmsCleared: string[]
  /** v0.8.8 双 START 守卫断言用：offscreen.closeDocument 调用次数 */
  closeDocCalls: number
  /** v0.8.8：getMediaStreamId 调用次数（守卫应在它之前拦截） */
  streamIdCalls: number
  /** v0.8.8：让 QUERY_STATE 抛错（模拟 offscreen 不在 / 查询失败） */
  queryStateThrows: boolean
}

let state: MockState

function makeChrome(): void {
  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        async get(key: string) { return { [key]: state.storageData[key] } },
        async set(obj: Record<string, unknown>) { Object.assign(state.storageData, obj) },
        async remove(key: string) { delete state.storageData[key] }
      },
      onChanged: { addListener() {}, removeListener() {} }
    },
    runtime: {
      id: 'ext-test',
      lastError: undefined,
      async sendMessage(msg: { target?: string; type?: string }) {
        // 只处理 target=offscreen；test 用例针对 START/STOP/QUERY_STATE/CANCEL
        if (msg.target !== 'offscreen') return undefined
        if (msg.type === 'START') return state.offscreenStartRes
        if (msg.type === 'STOP') return state.offscreenStopRes
        if (msg.type === 'CANCEL') return { ok: true }
        if (msg.type === 'QUERY_STATE') {
          if (state.queryStateThrows) throw new Error('offscreen gone')
          return state.offscreenState
        }
        return undefined
      },
      async getContexts(_opts: { contextTypes: string[] }) {
        return state.contexts
      }
    },
    permissions: {
      async contains() { return state.hasTabCapturePerm }
    },
    tabCapture: {
      getMediaStreamId(
        _opts: { targetTabId: number },
        cb: (id: string) => void
      ) {
        state.streamIdCalls++
        if (state.streamIdResult.err) {
          ;(globalThis as { chrome: { runtime: { lastError?: { message: string } } } })
            .chrome.runtime.lastError = { message: state.streamIdResult.err }
          cb('')
          // 立即清掉 lastError 模拟单次访问语义
          ;(globalThis as { chrome: { runtime: { lastError?: unknown } } })
            .chrome.runtime.lastError = undefined
          return
        }
        cb(state.streamIdResult.id ?? 'stream-test')
      }
    },
    tabs: {
      async query() {
        return state.tabs
      },
      async get(tabId: number) {
        const t = state.tabs.find(x => x.id === tabId)
        if (!t) throw new Error('No tab with id ' + tabId)
        return t
      },
      async sendMessage(tabId: number, msg: unknown) {
        state.sentToTabs.push({ tabId, msg })
      }
    },
    windows: {
      onRemoved: { addListener() {} }
    },
    alarms: {
      onAlarm: { addListener() {} },
      async create(name: string, opts: unknown) { state.alarmsCreated.push({ name, opts }) },
      async clear(name: string) { state.alarmsCleared.push(name); return true }
    },
    offscreen: {
      async createDocument() {},
      async closeDocument() { state.closeDocCalls++ }
    }
  }
}

beforeEach(() => {
  state = {
    storageData: {},
    contexts: [],
    offscreenState: null,
    offscreenStartRes: { ok: true },
    offscreenStopRes: { ok: true, dataUrl: 'data:video/webm;base64,XX', bytes: 100, mime: 'video/webm' },
    hasTabCapturePerm: true,
    streamIdResult: { id: 'stream-test' },
    tabs: [],
    sentToTabs: [],
    alarmsCreated: [],
    alarmsCleared: [],
    closeDocCalls: 0,
    streamIdCalls: 0,
    queryStateThrows: false
  }
  makeChrome()
  vi.resetModules()
})

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
  vi.resetModules()
})

async function importRecord() {
  // 每个 test 拿全新 module（state currentRecording 重置成 null）
  return await import('@/background/handlers/record')
}

const fakeSender = (tabId?: number): chrome.runtime.MessageSender => ({
  tab: tabId ? ({ id: tabId, windowId: 1 } as chrome.tabs.Tab) : undefined
} as chrome.runtime.MessageSender)

describe('handleQueryRecordingState', () => {
  it('初始 state → recording=false', async () => {
    const { handleQueryRecordingState } = await importRecord()
    const r = await handleQueryRecordingState()
    expect(r.recording).toBe(false)
  })

  it('handleRecordStart 后 → recording=true + startedAt 接近 now', async () => {
    state.tabs = [{ id: 7, windowId: 1 }]
    const { handleRecordStart, handleQueryRecordingState } = await importRecord()
    const t0 = Date.now()
    const res = await handleRecordStart(fakeSender(7))
    expect(res.ok).toBe(true)
    const q = await handleQueryRecordingState()
    expect(q.recording).toBe(true)
    if (q.recording) {
      expect(q.startedAt).toBeGreaterThanOrEqual(t0)
      expect(q.startedAt).toBeLessThanOrEqual(Date.now() + 100)
    }
  })
})

describe('handleRecordStart', () => {
  it('sender.tab.id 缺省 → error', async () => {
    const { handleRecordStart } = await importRecord()
    const res = await handleRecordStart(fakeSender(undefined))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('没找到要录的标签页')
  })

  it('tabCapture 权限未授 → 引导文案', async () => {
    state.hasTabCapturePerm = false
    const { handleRecordStart } = await importRecord()
    const res = await handleRecordStart(fakeSender(7))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('启用录屏')
  })

  it('getMediaStreamId 失败 → 引导按 ⌥⇧R', async () => {
    state.streamIdResult = { err: '用户取消' }
    const { handleRecordStart } = await importRecord()
    const res = await handleRecordStart(fakeSender(7))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('浏览器拒绝')
  })

  it('offscreen START 失败 → 返 offscreen.error', async () => {
    state.offscreenStartRes = { ok: false, error: '某个内部错误' }
    const { handleRecordStart } = await importRecord()
    const res = await handleRecordStart(fakeSender(7))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('某个内部错误')
  })

  it('happy path → 创 tripwire alarm', async () => {
    const { handleRecordStart } = await importRecord()
    const res = await handleRecordStart(fakeSender(7))
    expect(res.ok).toBe(true)
    expect(state.alarmsCreated.map(a => a.name)).toContain('mooOffscreenTripwire')
  })
})

describe('handleRecordCancel', () => {
  it('清空 state + 清 alarm + broadcast 给其它 tab', async () => {
    state.tabs = [
      { id: 7, windowId: 1 },
      { id: 8, windowId: 1 },
      { id: 9, windowId: 1 }
    ]
    const { handleRecordStart, handleRecordCancel, handleQueryRecordingState } = await importRecord()
    await handleRecordStart(fakeSender(7))
    state.sentToTabs.length = 0
    const res = await handleRecordCancel(fakeSender(7))
    expect(res.ok).toBe(true)
    // sender tab 不收 broadcast
    const broadcastTabs = state.sentToTabs.filter(s => {
      const msg = s.msg as { type?: string }
      return msg.type === MSG.RECORD_AUTO_STOPPED
    }).map(s => s.tabId)
    expect(broadcastTabs).not.toContain(7)
    expect(broadcastTabs).toContain(8)
    expect(broadcastTabs).toContain(9)
    expect(state.alarmsCleared).toContain('mooOffscreenTripwire')
    // state 已清
    expect((await handleQueryRecordingState()).recording).toBe(false)
  })
})

describe('handleRecordStop', () => {
  it('happy path → 拿 dataUrl + 清 state + broadcast', async () => {
    state.tabs = [{ id: 7, windowId: 1 }, { id: 8, windowId: 1 }]
    const { handleRecordStart, handleRecordStop, handleQueryRecordingState } = await importRecord()
    await handleRecordStart(fakeSender(7))
    const stopRes = await handleRecordStop(fakeSender(7))
    expect(stopRes.ok).toBe(true)
    if (stopRes.ok) expect(stopRes.dataUrl).toContain('data:video')
    expect((await handleQueryRecordingState()).recording).toBe(false)
  })
})

describe('handleOffscreenAutoStopped', () => {
  it('录屏中 → 清 state + broadcast', async () => {
    state.tabs = [{ id: 7, windowId: 1 }, { id: 8, windowId: 1 }]
    const { handleRecordStart, handleOffscreenAutoStopped, handleQueryRecordingState } = await importRecord()
    await handleRecordStart(fakeSender(7))
    state.sentToTabs.length = 0
    const r = await handleOffscreenAutoStopped()
    expect(r.ok).toBe(true)
    expect((await handleQueryRecordingState()).recording).toBe(false)
    // tab 7 没被 exclude（chrome-ui 触发的，没有 sender tab 概念）
    const broadcastTabs = state.sentToTabs.filter(s => {
      const msg = s.msg as { type?: string }
      return msg.type === MSG.RECORD_AUTO_STOPPED
    }).map(s => s.tabId)
    expect(broadcastTabs).toEqual(expect.arrayContaining([7, 8]))
  })

  it('未录屏 → noop（不 broadcast）', async () => {
    state.tabs = [{ id: 7 }, { id: 8 }]
    const { handleOffscreenAutoStopped } = await importRecord()
    const r = await handleOffscreenAutoStopped()
    expect(r.ok).toBe(true)
    expect(state.sentToTabs).toEqual([])
  })
})

describe('rehydrateRecordingFromOffscreen', () => {
  it('无 offscreen context → noop', async () => {
    state.contexts = []
    const { rehydrateRecordingFromOffscreen, handleQueryRecordingState } = await importRecord()
    await rehydrateRecordingFromOffscreen()
    expect((await handleQueryRecordingState()).recording).toBe(false)
  })

  it('offscreen 在录中 → 回填 state', async () => {
    state.contexts = [{ contextType: 'OFFSCREEN_DOCUMENT' }]
    state.offscreenState = { state: 'recording', meta: { tabId: 42, startedAt: 1700000000000 } }
    const { rehydrateRecordingFromOffscreen, handleQueryRecordingState } = await importRecord()
    await rehydrateRecordingFromOffscreen()
    const q = await handleQueryRecordingState()
    expect(q.recording).toBe(true)
    if (q.recording) expect(q.startedAt).toBe(1700000000000)
  })

  it('offscreen state=idle → 不回填', async () => {
    state.contexts = [{ contextType: 'OFFSCREEN_DOCUMENT' }]
    state.offscreenState = { state: 'idle', meta: null }
    const { rehydrateRecordingFromOffscreen, handleQueryRecordingState } = await importRecord()
    await rehydrateRecordingFromOffscreen()
    expect((await handleQueryRecordingState()).recording).toBe(false)
  })
})

// ─────────────────────────── v0.8.8 Fix A：双 START 不得销毁进行中录屏 ───────────────────────────
// 回归背景：第二次 START（另一 tab 点录制 / 再按 ⌥⇧R）被 offscreen 状态机拒后，
// 旧代码无条件 closeOffscreenDocument() → 把正在录的 offscreen 文档销毁 = 整段录屏丢失。
// 修法两层：① startTabRecording 入口查 currentRecording 直接拒；
//          ② START 被拒时先 QUERY_STATE，state 非 idle 不关文档。
describe('双 START 守卫（v0.8.8）', () => {
  it('守卫①：已有 currentRecording → 二次 start 返 already-recording，不发 getMediaStreamId、不关 offscreen', async () => {
    state.tabs = [{ id: 7, windowId: 1 }, { id: 8, windowId: 1 }]
    const { handleRecordStart } = await importRecord()
    const first = await handleRecordStart(fakeSender(7))
    expect(first.ok).toBe(true)
    expect(state.streamIdCalls).toBe(1)

    const second = await handleRecordStart(fakeSender(8))
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toContain('已有标签页在录制中')
    // 守卫必须在 getMediaStreamId 之前拦（user-activation 不该被白白消耗）
    expect(state.streamIdCalls).toBe(1)
    // 关键资产保护：正在录的 offscreen 文档绝不能被关
    expect(state.closeDocCalls).toBe(0)
  })

  it('守卫②：currentRecording=null（守卫①被 race 绕过）但 offscreen 在录 → START 被拒 + QUERY_STATE=recording → 不关文档', async () => {
    state.offscreenStartRes = { ok: false, error: '当前状态 recording，无法 START' }
    state.offscreenState = { state: 'recording', meta: { tabId: 9, startedAt: Date.now() } }
    const { handleRecordStart } = await importRecord()
    const res = await handleRecordStart(fakeSender(7))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('当前状态 recording')
    expect(state.closeDocCalls).toBe(0)
  })

  it('原行为不回归：START 失败 + QUERY_STATE=idle → closeDocument 正常被调', async () => {
    state.offscreenStartRes = { ok: false, error: '内部错误' }
    state.offscreenState = { state: 'idle', meta: null }
    const { handleRecordStart } = await importRecord()
    const res = await handleRecordStart(fakeSender(7))
    expect(res.ok).toBe(false)
    expect(state.closeDocCalls).toBe(1)
  })

  it('原行为不回归：START 失败 + QUERY_STATE 抛错（offscreen 不在）→ closeDocument 正常被调', async () => {
    state.offscreenStartRes = { ok: false, error: '内部错误' }
    state.queryStateThrows = true
    const { handleRecordStart } = await importRecord()
    const res = await handleRecordStart(fakeSender(7))
    expect(res.ok).toBe(false)
    expect(state.closeDocCalls).toBe(1)
  })
})

describe('checkOffscreenAutoStoppedFlag', () => {
  it('storage 无 flag → noop', async () => {
    const { checkOffscreenAutoStoppedFlag, handleQueryRecordingState } = await importRecord()
    await checkOffscreenAutoStoppedFlag()
    expect((await handleQueryRecordingState()).recording).toBe(false)
  })

  it('flag > 5min → 清除不广播', async () => {
    state.storageData.mooOffscreenAutoStopped = { at: Date.now() - 6 * 60_000 }
    const { checkOffscreenAutoStoppedFlag } = await importRecord()
    await checkOffscreenAutoStoppedFlag()
    expect(state.storageData.mooOffscreenAutoStopped).toBeUndefined()
    expect(state.sentToTabs).toEqual([])
  })

  it('flag 新鲜 + 当前 recording=true → 清 state + 广播', async () => {
    state.tabs = [{ id: 7, windowId: 1 }, { id: 8, windowId: 1 }]
    state.storageData.mooOffscreenAutoStopped = { at: Date.now() - 1000 }
    const { handleRecordStart, checkOffscreenAutoStoppedFlag, handleQueryRecordingState } = await importRecord()
    await handleRecordStart(fakeSender(7))
    state.sentToTabs.length = 0
    await checkOffscreenAutoStoppedFlag()
    expect((await handleQueryRecordingState()).recording).toBe(false)
    expect(state.sentToTabs.length).toBeGreaterThan(0)
    expect(state.storageData.mooOffscreenAutoStopped).toBeUndefined()
  })
})
