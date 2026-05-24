import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BugHistoryEntry } from '@/types/history'

/**
 * v0.6.1 hotfix：utils/badge.ts 优先 check upgrade flag 测试。
 * 修复 mv3-pro v0.6.0 review 报告 1：onInstalled 设的 '!' 被 SW spin-up refreshBadge
 * 立即覆盖回空字符串（24h 内无失败时），用户感知不到升级提示。
 */

interface BadgeState {
  storageData: Record<string, unknown>
  lastText?: string
  lastColor?: string
}

let state: BadgeState

beforeEach(() => {
  state = { storageData: {} }
  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        async get(key: string) { return { [key]: state.storageData[key] } }
      }
    },
    action: {
      async setBadgeText(opts: { text: string }) { state.lastText = opts.text },
      async setBadgeBackgroundColor(opts: { color: string }) { state.lastColor = opts.color }
    }
  }
})

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
})

const makeHistory = (failureCount: number): BugHistoryEntry[] =>
  Array.from({ length: failureCount }, (_, i) => ({
    id: `h${i}`,
    timestamp: Date.now() - 60_000,
    projectId: 'p1', projectName: 'p',
    serverId: 's1', serverName: 'svr',
    title: 't', description: '',
    url: '', userAgent: '', viewport: { w: 0, h: 0 },
    result: { ok: false, error: 'boom' }
  } as BugHistoryEntry))

describe('updateActionBadge — upgrade flag 优先级', () => {
  it('flag=true → 显 \'!\' amber，不读 failure 计数', async () => {
    state.storageData.mooNeedsHostPermUpgrade = true
    const { updateActionBadge } = await import('@/utils/badge')
    await updateActionBadge(makeHistory(5))
    expect(state.lastText).toBe('!')
    expect(state.lastColor).toBe('#d97706')
  })

  it('flag=false + 5 个 failure → 显 \'5\' red', async () => {
    state.storageData.mooNeedsHostPermUpgrade = false
    const { updateActionBadge } = await import('@/utils/badge')
    await updateActionBadge(makeHistory(5))
    expect(state.lastText).toBe('5')
    expect(state.lastColor).toBe('#dc2626')
  })

  it('flag 缺失（undefined）+ 0 failure → 空 badge', async () => {
    const { updateActionBadge } = await import('@/utils/badge')
    await updateActionBadge([])
    expect(state.lastText).toBe('')
  })

  it('flag=true + 0 failure → 仍显 \'!\'（关键修复：v0.6.0 这里被覆盖回空）', async () => {
    state.storageData.mooNeedsHostPermUpgrade = true
    const { updateActionBadge } = await import('@/utils/badge')
    await updateActionBadge([])
    expect(state.lastText).toBe('!')
  })

  it('storage.get throw → 兜底走 failure 计数', async () => {
    ;(globalThis as { chrome: { storage: { local: { get: () => Promise<unknown> } } } })
      .chrome.storage.local.get = async () => { throw new Error('storage err') }
    const { updateActionBadge } = await import('@/utils/badge')
    await updateActionBadge(makeHistory(3))
    expect(state.lastText).toBe('3')
  })
})
