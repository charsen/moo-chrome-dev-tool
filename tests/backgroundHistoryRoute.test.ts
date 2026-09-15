import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * history 写路径改走消息路由的回归（v0.8.17 后那次复盘 F1）。
 *
 * 背景：`storage/history.ts` 的 `withWriteMutex` 是**模块内存锁**，devtools / popup / options
 * 与 SW 各持一把互不相干的锁。而 History.vue / Settings.vue 原先直接 import
 * `removeHistory` / `clearHistory`，跟 SW 的 addHistoryEntry / updateHistoryEntry /
 * markHistoryEntryRetrySuccess 并发写同一份 `mooHistory` 数组 → 整份 read-modify-write
 * 后写覆盖前写 → 用户删掉的条目复活、或刚提交的条目被吞。
 *
 * v0.8.9 给 retryQueue 修过同款（MSG.RETRY_QUEUE_REMOVE/CLEAR，见
 * tests/backgroundRetryQueueRoute.test.ts），history 当时漏了 —— 本文件同时守两条：
 *   A. SW dispatch：两个新 case 真调到 storage/history 的写函数，响应 shape 正确
 *   B. UI 侧源码守卫：devtools 不再 import 写函数（防止以后"顺手"改回去）
 */

type Listener = (
  raw: unknown,
  sender: { id?: string; tab?: { id?: number } },
  sendResponse: (r?: unknown) => void
) => boolean

// 形参要照真实签名声明：零参 vi.fn 的调用签名是 () => Promise<boolean>，
// 下面 `removeHistoryMock(id)` 会 TS2554。
const removeHistoryMock = vi.fn(async (_id: string) => true)
const clearHistoryMock = vi.fn(async () => {})

vi.mock('@/storage/history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/storage/history')>()
  return {
    ...actual,
    // 显式形参而不是 `(...args: unknown[]) => mock(...args)`：后者在 TS 下是
    // TS2556（spread 需要 tuple 或 rest 形参），且会顺手抹掉真实签名的检查。
    removeHistory: (id: string) => removeHistoryMock(id),
    clearHistory: () => clearHistoryMock()
  }
})

let messageListeners: Listener[]

function stubChrome() {
  messageListeners = []
  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        async get(key: string) { return { [key]: undefined } },
        async set() {},
        async remove() {}
      },
      onChanged: { addListener() {}, removeListener() {} },
      session: { setAccessLevel: async () => {} }
    },
    permissions: {
      onAdded: { addListener() {} },
      onRemoved: { addListener() {} },
      async contains() { return true }
    },
    alarms: {
      onAlarm: { addListener() {} },
      async get() { return undefined },
      async create() {}
    },
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener: (fn: Listener) => { messageListeners.push(fn) } },
      onConnect: { addListener() {} },
      id: 'test-ext',
      getManifest: () => ({ version: '0.8.17', content_scripts: [] })
    },
    commands: { onCommand: { addListener() {} } },
    scripting: {
      async getRegisteredContentScripts() { return [] },
      async unregisterContentScripts() {},
      async registerContentScripts() {}
    },
    windows: { onRemoved: { addListener() {} } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} }
  }
}

/** 经真实 listener 派发消息；listener 返回 true（异步响应）时等 sendResponse */
function dispatch(msg: unknown, sender: { id?: string } = { id: 'test-ext' }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const l = messageListeners[0]
    if (!l) return reject(new Error('background/index 没注册 onMessage listener'))
    const handled = l(msg, sender, resolve)
    if (!handled) resolve(undefined)
  })
}

beforeEach(() => {
  vi.resetModules()
  removeHistoryMock.mockClear()
  clearHistoryMock.mockClear()
  removeHistoryMock.mockResolvedValue(true)
  stubChrome()
})

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
  vi.clearAllMocks()
})

describe('A. SW dispatch — HISTORY_REMOVE / HISTORY_CLEAR', () => {
  it('HISTORY_REMOVE：合法 sender → removeHistory(id) 在 SW 内被调，响应 {ok:true, removed:true}', async () => {
    await import('@/background/index')
    expect(messageListeners.length).toBeGreaterThan(0)

    const res = await dispatch({ type: 'HISTORY_REMOVE', payload: { id: 'h-1' } })
    expect(res).toEqual({ ok: true, removed: true })
    expect(removeHistoryMock).toHaveBeenCalledTimes(1)
    expect(removeHistoryMock).toHaveBeenCalledWith('h-1')
  })

  it('HISTORY_REMOVE：条目已不在（removed=false）→ 透传给 UI，不算错', async () => {
    await import('@/background/index')
    removeHistoryMock.mockResolvedValueOnce(false)

    const res = await dispatch({ type: 'HISTORY_REMOVE', payload: { id: 'gone' } })
    expect(res).toEqual({ ok: true, removed: false })
  })

  it('HISTORY_REMOVE：payload 缺 id / id 为空 → 拦在 runtime 校验，不碰 storage', async () => {
    await import('@/background/index')

    const r1 = await dispatch({ type: 'HISTORY_REMOVE' })
    const r2 = await dispatch({ type: 'HISTORY_REMOVE', payload: { id: '' } })
    expect(r1).toMatchObject({ ok: false, removed: false })
    expect(r2).toMatchObject({ ok: false, removed: false })
    expect(removeHistoryMock).not.toHaveBeenCalled()
  })

  it('HISTORY_REMOVE：storage 写失败 → ok:false + error（不能谎报删掉了）', async () => {
    await import('@/background/index')
    removeHistoryMock.mockRejectedValueOnce(new Error('QUOTA_BYTES exceeded'))

    const res = await dispatch({ type: 'HISTORY_REMOVE', payload: { id: 'h-1' } })
    expect(res).toMatchObject({ ok: false, removed: false })
    expect((res as { error: string }).error).toContain('QUOTA_BYTES')
  })

  it('HISTORY_CLEAR：合法 sender → clearHistory 在 SW 内被调，响应 {ok:true}', async () => {
    await import('@/background/index')

    const res = await dispatch({ type: 'HISTORY_CLEAR' })
    expect(res).toEqual({ ok: true })
    expect(clearHistoryMock).toHaveBeenCalledTimes(1)
  })

  it('HISTORY_CLEAR：storage 写失败 → ok:false + error', async () => {
    await import('@/background/index')
    clearHistoryMock.mockRejectedValueOnce(new Error('storage dead'))

    const res = await dispatch({ type: 'HISTORY_CLEAR' })
    expect(res).toMatchObject({ ok: false })
    expect((res as { error: string }).error).toContain('storage dead')
  })

  it('sender.id 不匹配（外部扩展 / undefined）→ 拒绝，写函数不被调', async () => {
    await import('@/background/index')

    const r1 = await dispatch({ type: 'HISTORY_CLEAR' }, { id: 'evil-ext' })
    const r2 = await dispatch({ type: 'HISTORY_REMOVE', payload: { id: 'x' } }, { id: undefined })
    expect(r1).toBeUndefined()
    expect(r2).toBeUndefined()
    expect(clearHistoryMock).not.toHaveBeenCalled()
    expect(removeHistoryMock).not.toHaveBeenCalled()
  })
})

/**
 * B. UI 侧源码守卫 —— 这条是本次修的核心：devtools 不许再直调 history 写路径。
 * 单测不便挂 devtools 组件（chrome.devtools 上下文、KeepAlive 生命周期），所以用读源码
 * 的方式锁住「谁 import 了什么」这个契约，跟 bodyGate / check-version-consistency 同套路子。
 */
describe('B. devtools UI 不得直调 history 写路径（源码守卫）', () => {
  const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8')

  const uiFiles = ['src/devtools/tabs/History.vue', 'src/devtools/tabs/Settings.vue']

  it.each(uiFiles)('%s 不从 @/storage/history 引入写函数', (file) => {
    const src = read(file)
    const importLines = src.split('\n').filter(l => l.includes("from '@/storage/history'"))
    expect(importLines.length, `${file} 里找不到 @/storage/history 的 import，断言失效`).toBeGreaterThan(0)
    for (const line of importLines) {
      expect(line, '写路径必须走 SW 消息（withWriteMutex 是各上下文一把锁）').not.toMatch(/\b(removeHistory|clearHistory)\b/)
    }
  })

  it.each(uiFiles)('%s 改成发 HISTORY_REMOVE / HISTORY_CLEAR 消息', (file) => {
    const src = read(file)
    expect(src).toMatch(/MSG\.HISTORY_(REMOVE|CLEAR)/)
  })

  it('Settings.vue 的 clearHistoryAll 走 HISTORY_CLEAR 且失败会给用户提示', () => {
    const src = read('src/devtools/tabs/Settings.vue')
    const fn = src.slice(src.indexOf('async function clearHistoryAll'))
    expect(fn).toMatch(/MSG\.HISTORY_CLEAR/)
    expect(fn).toMatch(/没能清空/)
  })
})
