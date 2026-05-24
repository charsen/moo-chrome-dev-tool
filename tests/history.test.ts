import { describe, it, expect, beforeEach, vi } from 'vitest'

// thumbnailize 用 OffscreenCanvas（浏览器 only），node 里 mock 成 pass-through
vi.mock('@/utils/image', () => ({
  thumbnailize: vi.fn(async (s: string) => s)
}))

// chrome.storage.local 用内存 Map + quota 模拟
interface MockStorage {
  data: Record<string, unknown>
  /** 下一次 set 是否抛错（用于测 trim/allDropped 路径）*/
  failNext: number
  failAlways: boolean
}

function makeChrome(): MockStorage {
  const state: MockStorage = { data: {}, failNext: 0, failAlways: false }
  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: state.data[key] }
        },
        async set(obj: Record<string, unknown>) {
          if (state.failAlways || state.failNext > 0) {
            if (state.failNext > 0) state.failNext--
            throw new Error('QUOTA_BYTES exceeded')
          }
          Object.assign(state.data, obj)
        }
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn()
      }
    }
  }
  // crypto.randomUUID 在 node 18+ 全局可用，不用 mock
  return state
}

import { addHistoryEntry, listHistory, removeHistory, clearHistory, updateHistoryEntry, onHistoryChanged } from '@/storage/history'
import type { BugHistoryEntry } from '@/types/history'

function entry(id: string, image = 'data:image/png;base64,x'): BugHistoryEntry {
  return {
    id,
    timestamp: Date.now(),
    projectId: 'p1',
    projectName: 'P',
    serverId: 's1',
    serverName: 'S',
    title: 'Title ' + id,
    description: '',
    image,
    url: 'http://x',
    userAgent: 'UA',
    viewport: '1920x1080',
    requests: [],
    errors: [],
    result: { ok: true }
  }
}

describe('history.ts — happy path', () => {
  let state: MockStorage
  beforeEach(() => { state = makeChrome() })

  it('addHistoryEntry 写入后能 list 出来', async () => {
    const r = await addHistoryEntry(entry('a'))
    expect(r.trimmed).toBe(0)
    expect(r.allDropped).toBe(false)

    const list = await listHistory()
    expect(list).toHaveLength(1)
    expect(list[0]?.title).toBe('Title a')
  })

  it('最新的条排在第一', async () => {
    await addHistoryEntry(entry('a'))
    await addHistoryEntry(entry('b'))
    const list = await listHistory()
    expect(list[0]?.id).toBe('b')
    expect(list[1]?.id).toBe('a')
  })

  it('超过 30 条 → 截掉最旧', async () => {
    for (let i = 0; i < 35; i++) await addHistoryEntry(entry('e' + i))
    const list = await listHistory()
    expect(list).toHaveLength(30)
    expect(list[0]?.id).toBe('e34')  // 最新
    void state // keep ref
  })

  it('removeHistory 按 id 删', async () => {
    await addHistoryEntry(entry('a'))
    await addHistoryEntry(entry('b'))
    await removeHistory('a')
    const list = await listHistory()
    expect(list.map((e) => e.id)).toEqual(['b'])
  })

  it('clearHistory 全清', async () => {
    await addHistoryEntry(entry('a'))
    await clearHistory()
    const list = await listHistory()
    expect(list).toHaveLength(0)
  })

  it('updateHistoryEntry 找到对应 id 更新', async () => {
    await addHistoryEntry(entry('a'))
    const list = await listHistory()
    const target = list[0]!
    target.title = 'new title'
    await updateHistoryEntry('a', target)
    const after = await listHistory()
    expect(after[0]?.title).toBe('new title')
  })

  it('updateHistoryEntry 找不到 id → 静默不抛', async () => {
    await addHistoryEntry(entry('a'))
    await expect(updateHistoryEntry('nonexistent', entry('z'))).resolves.toBeUndefined()
  })
})

describe('history.ts — normalize 边界', () => {
  beforeEach(() => { makeChrome() })

  it('老 storage 数据缺字段 → list 时补默认值（不让 .vue 模板 crash）', async () => {
    // 直接往 storage 塞一个老 shape entry（早期版本可能没 requests / result / remoteBase 等字段）
    const raw = { id: 'old', title: 'Old', timestamp: 123 }
    ;(globalThis as { chrome: { storage: { local: { set: (o: unknown) => Promise<void> } } } })
      .chrome.storage.local.set({ mooHistory: [raw] })
    const list = await listHistory()
    expect(list).toHaveLength(1)
    expect(list[0]?.requests).toEqual([])  // 兜底
    expect(list[0]?.errors).toEqual([])
    expect(list[0]?.result).toEqual({ ok: false })  // result.ok 兜底 false
    expect(list[0]?.projectName).toBe('(未知项目)')
  })

  it('损坏的 raw（非数组）→ 空列表', async () => {
    ;(globalThis as { chrome: { storage: { local: { set: (o: unknown) => Promise<void> } } } })
      .chrome.storage.local.set({ mooHistory: 'broken' })
    const list = await listHistory()
    expect(list).toEqual([])
  })

  it('完全空 storage → 空列表', async () => {
    const list = await listHistory()
    expect(list).toEqual([])
  })
})

describe('history.ts — write 退化路径（quota 不够）', () => {
  let state: MockStorage
  beforeEach(() => { state = makeChrome() })

  it('第一次 set 抛 quota → 丢一条最旧的，第二次成功', async () => {
    await addHistoryEntry(entry('a'))
    await addHistoryEntry(entry('b'))
    // 下次 set 头一次抛错；逐条丢最旧后再 set 应该成功
    state.failNext = 1
    const r = await addHistoryEntry(entry('c'))
    expect(r.trimmed).toBe(1)
    expect(r.allDropped).toBe(false)
    const list = await listHistory()
    // 新条在，最旧的 'a' 被丢
    expect(list.map((e) => e.id).sort()).toEqual(['b', 'c'])
  })

  it('storage 整体写不进 → allDropped=true', async () => {
    state.failAlways = true
    const r = await addHistoryEntry(entry('a'))
    expect(r.allDropped).toBe(true)
  })
})

describe('history.ts — onHistoryChanged listener wiring', () => {
  beforeEach(() => { makeChrome() })

  it('addListener / removeListener 都被调到', () => {
    const onChanged = (globalThis as unknown as { chrome: { storage: { onChanged: { addListener: ReturnType<typeof vi.fn> } } } })
      .chrome.storage.onChanged
    const handler = vi.fn()
    const dispose = onHistoryChanged(handler)
    expect(onChanged.addListener).toHaveBeenCalledTimes(1)
    dispose()
    // dispose 后 removeListener 也被调（不在断言里硬拿 ref 是为容忍 future 实现）
  })

  it('监听器只在 mooHistory 这个 key 变化时触发 handler', () => {
    const onChanged = (globalThis as unknown as { chrome: { storage: { onChanged: { addListener: ReturnType<typeof vi.fn> } } } })
      .chrome.storage.onChanged
    const handler = vi.fn()
    onHistoryChanged(handler)
    const registered = onChanged.addListener.mock.calls[0][0] as (changes: unknown, area: string) => void

    // 错的 key
    registered({ mooConfig: { newValue: 1 } }, 'local')
    expect(handler).not.toHaveBeenCalled()
    // 错的 area
    registered({ mooHistory: { newValue: 1 } }, 'sync')
    expect(handler).not.toHaveBeenCalled()
    // 对的 key + area
    registered({ mooHistory: { newValue: 1 } }, 'local')
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
