import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================
// P1 回归：normalizeHistoryEntry 之前漏了 5 个禅道快照字段，
// 导致 read()（listHistory → list.map(normalizeHistoryEntry)）每次把它们剥光：
//   zentaoType / zentaoSeverity / zentaoPri / zentaoAssignedTo / zentaoModuleId
//
// 这组测试**必须走公共 API**（addHistoryEntry / listHistory / updateHistoryEntry），
// 不直接读裸 storageData.mooHistory —— 因为「裸读绕过 normalize」正是当初漏测的根因。
// ============================================================

// thumbnailize 用 OffscreenCanvas（浏览器 only），node 里 mock 成 pass-through。
// 注意：addHistoryEntry 会对 image 走 thumbnailize，所以下面 entry 给了 image 也不影响断言。
vi.mock('@/utils/image', () => ({
  thumbnailize: vi.fn(async (s: string) => s)
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
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn()
      }
    }
  }
  return state
}

import { addHistoryEntry, listHistory, updateHistoryEntry } from '@/storage/history'
import type { BugHistoryEntry } from '@/types/history'

/** 一条「禅道项目」history entry，带齐 5 个快照字段（合法值）。 */
function zentaoEntry(id: string, overrides: Partial<BugHistoryEntry> = {}): BugHistoryEntry {
  return {
    id,
    timestamp: Date.now(),
    projectId: 'pz',
    projectName: '禅道项目',
    serverId: 'sz',
    serverName: '禅道服务器',
    title: '禅道 bug ' + id,
    description: '',
    image: 'data:image/png;base64,x',
    url: 'http://x',
    userAgent: 'UA',
    viewport: '1920x1080',
    requests: [],
    errors: [],
    result: { ok: true },
    zentaoType: 'codeerror',
    zentaoSeverity: 2,
    zentaoPri: 1,
    zentaoAssignedTo: 'dev-bob',
    zentaoModuleId: 42,
    ...overrides
  }
}

/** webhook 项目 entry：没有任何禅道快照字段（这 5 个全 undefined）。 */
function webhookEntry(id: string): BugHistoryEntry {
  return {
    id,
    timestamp: Date.now(),
    projectId: 'pw',
    projectName: 'webhook 项目',
    serverId: 'sw',
    serverName: 'webhook 服务器',
    title: 'webhook bug ' + id,
    description: '',
    image: '',
    url: 'http://x',
    userAgent: 'UA',
    viewport: '1920x1080',
    requests: [],
    errors: [],
    result: { ok: true }
  }
}

describe('history.ts — 禅道快照 5 字段 round-trip（P1 回归）', () => {
  beforeEach(() => { makeChrome() })

  it('add(带 5 禅道字段) → listHistory 读回原值不被剥光', async () => {
    await addHistoryEntry(zentaoEntry('a'))
    const list = await listHistory()
    expect(list).toHaveLength(1)
    const e = list[0]!
    expect(e.zentaoType).toBe('codeerror')
    expect(e.zentaoSeverity).toBe(2)
    expect(e.zentaoPri).toBe(1)
    expect(e.zentaoAssignedTo).toBe('dev-bob')
    expect(e.zentaoModuleId).toBe(42)
  })

  it('updateHistoryEntry 写回（状态回查路径）后 5 字段仍在 — 防「读→剥→写回→磁盘永久丢」', async () => {
    await addHistoryEntry(zentaoEntry('a'))

    // 模拟状态回查：read 一条出来，改个无关字段（remoteStatus），再 update 写回。
    // 修复前 read() 已把 5 字段剥成 undefined，update 把 undefined 写回磁盘 → 永久丢。
    const read1 = (await listHistory())[0]!
    read1.remoteStatus = 'in_progress'
    await updateHistoryEntry('a', read1)

    const after = (await listHistory())[0]!
    expect(after.remoteStatus).toBe('in_progress')
    // 关键：5 字段经历了一次完整的 read→update 写回循环后必须仍在
    expect(after.zentaoType).toBe('codeerror')
    expect(after.zentaoSeverity).toBe(2)
    expect(after.zentaoPri).toBe(1)
    expect(after.zentaoAssignedTo).toBe('dev-bob')
    expect(after.zentaoModuleId).toBe(42)
  })

  it('severity/pri 非法值（5 / "high" / 0）→ normalize 成 undefined（不原样塞进去）', async () => {
    await addHistoryEntry(zentaoEntry('over', { zentaoSeverity: 5 as unknown as 1 }))
    await addHistoryEntry(zentaoEntry('str', { zentaoPri: 'high' as unknown as 1 }))
    await addHistoryEntry(zentaoEntry('zero', { zentaoSeverity: 0 as unknown as 1, zentaoPri: 0 as unknown as 1 }))

    const list = await listHistory()
    const byId = Object.fromEntries(list.map((e) => [e.id, e]))

    expect(byId.over!.zentaoSeverity).toBeUndefined()
    expect(byId.str!.zentaoPri).toBeUndefined()
    expect(byId.zero!.zentaoSeverity).toBeUndefined()
    expect(byId.zero!.zentaoPri).toBeUndefined()
  })

  it('合法枚举边界 1 和 4 保留；moduleId 非数字 → undefined', async () => {
    await addHistoryEntry(zentaoEntry('lo', { zentaoSeverity: 1, zentaoPri: 4 }))
    await addHistoryEntry(zentaoEntry('badmod', { zentaoModuleId: 'x' as unknown as number }))

    const list = await listHistory()
    const byId = Object.fromEntries(list.map((e) => [e.id, e]))
    expect(byId.lo!.zentaoSeverity).toBe(1)
    expect(byId.lo!.zentaoPri).toBe(4)
    expect(byId.badmod!.zentaoModuleId).toBeUndefined()
  })

  it('webhook entry（无这些字段）→ listHistory 读回 5 字段为 undefined，不崩', async () => {
    await addHistoryEntry(webhookEntry('w'))
    const list = await listHistory()
    expect(list).toHaveLength(1)
    const e = list[0]!
    expect(e.zentaoType).toBeUndefined()
    expect(e.zentaoSeverity).toBeUndefined()
    expect(e.zentaoPri).toBeUndefined()
    expect(e.zentaoAssignedTo).toBeUndefined()
    expect(e.zentaoModuleId).toBeUndefined()
  })
})
