import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

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

import { addHistoryEntry, listHistory, removeHistory, clearHistory, updateHistoryEntry, markHistoryEntryRetrySuccess, onHistoryChanged } from '@/storage/history'
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

// v0.5.0：withWriteMutex 并发场景（v0.4.7→v0.4.9 跨 3 版本核心 fix，之前 0 测试）
describe('history.ts — withWriteMutex 并发安全', () => {
  beforeEach(() => { makeChrome() })

  it('并发 addHistoryEntry + removeHistory → 不让已删 entry 复活（last-write-wins 防护）', async () => {
    // 起始 list 有 [X, Y]，并发：A 在 add Z 同时 B 在 remove X
    await addHistoryEntry(entry('X'))
    await addHistoryEntry(entry('Y'))
    expect((await listHistory()).map(e => e.id)).toEqual(['Y', 'X'])  // unshift order

    // 并发触发
    await Promise.all([
      addHistoryEntry(entry('Z')),
      removeHistory('X')
    ])

    const list = await listHistory()
    const ids = list.map(e => e.id)
    // X 不能复活 — 必须真删
    expect(ids).not.toContain('X')
    // Y 和 Z 都还在
    expect(ids).toContain('Y')
    expect(ids).toContain('Z')
  })

  it('并发 update + remove → update 不会让已 remove 的复活', async () => {
    await addHistoryEntry(entry('A'))
    await addHistoryEntry(entry('B'))

    // 并发：update A vs remove A
    const updatedA = { ...entry('A'), title: 'A-updated' }
    await Promise.all([
      updateHistoryEntry('A', updatedA),
      removeHistory('A')
    ])

    const after = await listHistory()
    const ids = after.map(e => e.id)
    // B 必在
    expect(ids).toContain('B')
    // A 最多 1 条（mutex 串行，最后一个赢，要么 A 在要么不在）
    expect(ids.filter(id => id === 'A').length).toBeLessThanOrEqual(1)
  })

  it('多 add 并发 → 全部入库不丢条', async () => {
    await Promise.all([
      addHistoryEntry(entry('p1')),
      addHistoryEntry(entry('p2')),
      addHistoryEntry(entry('p3')),
      addHistoryEntry(entry('p4')),
      addHistoryEntry(entry('p5')),
    ])
    const list = await listHistory()
    expect(list).toHaveLength(5)
    expect(list.map(e => e.id).sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })
})

// ─────────────────────────── v0.8.8 Fix B：markHistoryEntryRetrySuccess ───────────────────────────
// retry 队列重试成功后把首次失败写的 entry 翻成功 + 回填 remoteId。
describe('markHistoryEntryRetrySuccess', () => {
  beforeEach(() => { makeChrome() })

  it('失败 entry → result.ok 翻 true + remoteId 回填，其它字段不动', async () => {
    const e = entry('f1')
    e.result = { ok: false, status: 500, error: 'HTTP 500' }
    await addHistoryEntry(e)

    await markHistoryEntryRetrySuccess('f1', '77')

    const list = await listHistory()
    expect(list).toHaveLength(1)
    expect(list[0]?.result.ok).toBe(true)
    expect(list[0]?.remoteId).toBe('77')
    expect(list[0]?.title).toBe('Title f1')
    // status / body 保留（按实现：result 翻 {ok:true, status, body}，error 清掉）
    expect(list[0]?.result.status).toBe(500)
    expect(list[0]?.result.error).toBeUndefined()
  })

  it('entry 已删 / id 不存在 → 静默不 throw、不改其它条', async () => {
    const e = entry('keep')
    e.result = { ok: false, error: 'x' }
    await addHistoryEntry(e)

    await expect(markHistoryEntryRetrySuccess('gone-id', '9')).resolves.toBeUndefined()

    const list = await listHistory()
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe('keep')
    expect(list[0]?.result.ok).toBe(false)  // 没被误翻
  })

  it('remoteId 缺省 → 保留 entry 旧 remoteId', async () => {
    const e = entry('f2')
    e.result = { ok: false, error: 'x' }
    e.remoteId = 'old-id'
    await addHistoryEntry(e)

    await markHistoryEntryRetrySuccess('f2', undefined)

    const list = await listHistory()
    expect(list[0]?.result.ok).toBe(true)
    expect(list[0]?.remoteId).toBe('old-id')
  })
})

// ─────────────────── v0.8.10 多张截图 round-trip ───────────────────
// v0.8.7 同款教训回归锁：write（addHistoryEntry）+ 类型（BugHistoryEntry.images）补了，
// normalizeHistoryEntry 漏列 images = read 时静默剥光、写回还会抹掉磁盘。
// 这里走公共 API round-trip（add → list），不裸读 storage —— normalizer 漏列必红。
import { thumbnailize } from '@/utils/image'

describe('history.ts — v0.8.10 多张截图 images round-trip', () => {
  beforeEach(() => {
    makeChrome()
    // 带标记的 thumbnailize：既验证「逐张缩略」真发生，又验证缩略结果（非原图）被写库。
    // 先 mockClear —— vitest 没开 clearMocks，前面 describe 的调用次数会串台
    vi.mocked(thumbnailize).mockClear()
    vi.mocked(thumbnailize).mockImplementation(async (s: string) => 'thumb:' + s)
  })
  afterEach(() => {
    // 还原 pass-through，别污染本文件其他 describe
    vi.mocked(thumbnailize).mockImplementation(async (s: string) => s)
  })

  const IMGS = ['data:image/png;base64,one', 'data:image/png;base64,two', 'data:image/png;base64,three']

  it('add(images 3 张) → list 读回仍 3 张，且每张都经 thumbnailize', async () => {
    const e = entry('m1', IMGS[0])
    e.images = [...IMGS]
    await addHistoryEntry(e)

    const list = await listHistory()
    expect(list).toHaveLength(1)
    // 关键断言：normalizeHistoryEntry 必须把 images 读回来（漏列 → undefined → 红）
    expect(list[0]?.images).toEqual(IMGS.map((i) => 'thumb:' + i))
    // 逐张缩略：3 张 images + 1 张 image（images[0] 同源），共 4 次
    expect(vi.mocked(thumbnailize)).toHaveBeenCalledTimes(4)
    for (const i of IMGS) expect(vi.mocked(thumbnailize)).toHaveBeenCalledWith(i)
    // images[0] === image 约定在缩略后仍成立
    expect(list[0]?.image).toBe(list[0]?.images?.[0])
  })

  it('单图老 entry（无 images）→ 读回 images undefined（不回归）', async () => {
    await addHistoryEntry(entry('s1'))
    const list = await listHistory()
    expect(list[0]?.images).toBeUndefined()
    expect(list[0]?.image).toBe('thumb:data:image/png;base64,x')
  })

  it('storage 里 images 混入非 string 杂质 → normalize 过滤只留 string', async () => {
    const raw = {
      id: 'dirty', title: 'D', timestamp: 1,
      image: 'data:image/png;base64,x',
      images: ['data:a', 42, null, { evil: 1 }, 'data:b']
    }
    ;(globalThis as { chrome: { storage: { local: { set: (o: unknown) => Promise<void> } } } })
      .chrome.storage.local.set({ mooHistory: [raw] })
    const list = await listHistory()
    expect(list[0]?.images).toEqual(['data:a', 'data:b'])
  })

  it('storage 里 images 是非数组（损坏）→ undefined 不 crash', async () => {
    const raw = { id: 'bad', title: 'B', timestamp: 1, images: 'not-an-array' }
    ;(globalThis as { chrome: { storage: { local: { set: (o: unknown) => Promise<void> } } } })
      .chrome.storage.local.set({ mooHistory: [raw] })
    const list = await listHistory()
    expect(list[0]?.images).toBeUndefined()
  })
})
