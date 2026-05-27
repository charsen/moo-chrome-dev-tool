/**
 * 录屏相关 onMessage handler + 全部录屏控制函数 + currentRecording state。
 *
 * v0.5.2 P0 第 2 阶段：把 background/index.ts 内的录屏完整子系统搬过来。包括：
 *   - currentRecording state（私有，不暴露给 background）
 *   - broadcastAutoStopped helper
 *   - startTabRecording / stopTabRecording / cancelTabRecording
 *   - ensureOffscreenDocument / closeOffscreenDocument
 *   - rehydrateRecordingFromOffscreen / checkOffscreenAutoStoppedFlag（SW spin-up 用）
 *   - tripwire alarm 注册
 *   - 5 个 onMessage handler
 *
 * background/index.ts 通过 install() 注册 listener + 公开 API（startFromCommand / emergencyStopForWindow / spinUpHooks）使用。
 */

import { MSG } from '@/types/messages'
import type {
  QueryRecordingStateRes,
  RecordCancelRes,
  RecordStartRes,
  RecordStopRes
} from '@/types/messages'
import { t } from '@/i18n'

// ─────────────────────────── module-level state ───────────────────────────

/** 当前录屏中的 tab 与开始时刻。content script 重挂时通过 QUERY_RECORDING_STATE
 *  查这个状态恢复 UI；offscreen 自动 stop 时清空并广播给原 tab。 */
let currentRecording: { tabId: number; startedAt: number } | null = null

/** v0.5.0：tripwire alarm 名（跟 offscreen 端 setTimeout 双保险）。
 *  chrome.alarms 是 OS 级 cron，不受 SW/offscreen 节流影响 */
const OFFSCREEN_TRIPWIRE_ALARM = 'mooOffscreenTripwire'

const OFFSCREEN_URL = 'src/offscreen/index.html'

// ─────────────────────────── 公开 API（给 background/index.ts 用）───────────────────────────

export function getCurrentRecording(): typeof currentRecording {
  return currentRecording
}

/** chrome.commands.onCommand 'start-recording' 调用路径（v0.5.2 抽出来给 background.ts onCommand 用） */
export async function startRecordingFromCommand(tabId: number): Promise<{ ok: boolean; error?: string }> {
  const res = await startTabRecording(tabId)
  if (res.ok) currentRecording = { tabId, startedAt: Date.now() }
  return res
}

/** v0.4.8：windows.onRemoved 紧急 STOP（关 window 时 best-effort 清掉录屏 + offscreen） */
export async function emergencyStopForWindow(windowId: number): Promise<void> {
  if (!currentRecording) return
  try {
    const tab = await chrome.tabs.get(currentRecording.tabId).catch(() => null)
    if (!tab || tab.windowId === windowId) {
      console.log('[Moo] window closed during recording, emergency stop')
      await cancelTabRecording().catch(() => {})
      currentRecording = null
    }
  } catch { /* SW 可能已被销毁 */ }
}

/** v0.4.4：SW spin-up 时调 — 从 offscreen 恢复 currentRecording */
export async function rehydrateRecordingFromOffscreen(): Promise<void> {
  try {
    const getCtx = (chrome.runtime as unknown as { getContexts?: (opts: { contextTypes: string[] }) => Promise<unknown[]> }).getContexts
    if (typeof getCtx !== 'function') return
    const contexts = await getCtx({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
    // v0.7.9 breadcrumb：chrome.runtime.getContexts 对错参（typo 如 'OFFSCREEN_DOCUMENTS'）
    // 不 throw 而返空数组 — 静默拿不到 offscreen 用户无感。返空时 log 一行帮未来 debug。
    if (!Array.isArray(contexts) || contexts.length === 0) {
      console.debug('[Moo] rehydrate: getContexts returned empty — verify contextTypes spelling')
      return
    }
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'QUERY_STATE' })
    if (!res || typeof res !== 'object') return
    const { state, meta } = res as { state?: string; meta?: { tabId?: number; startedAt?: number } | null }
    if ((state === 'recording' || state === 'starting') && meta && meta.startedAt) {
      currentRecording = {
        tabId: meta.tabId ?? -1,
        startedAt: meta.startedAt
      }
      console.log('[Moo] SW boot: 从 offscreen 恢复 currentRecording', currentRecording)
    }
  } catch (e) {
    console.warn('[Moo] rehydrateRecordingFromOffscreen failed:', (e as Error).message)
  }
}

/** v0.4.5：offscreen track-ended 时如果 SW 刚回收，sendMessage 会丢。spin-up 时读 storage flag 兜底 */
export async function checkOffscreenAutoStoppedFlag(): Promise<void> {
  try {
    const { mooOffscreenAutoStopped } = await chrome.storage.local.get('mooOffscreenAutoStopped')
    if (!mooOffscreenAutoStopped?.at) return
    if (Date.now() - mooOffscreenAutoStopped.at > 5 * 60_000) {
      await chrome.storage.local.remove('mooOffscreenAutoStopped')
      return
    }
    if (currentRecording) {
      console.log('[Moo] SW boot: 从 storage flag 感知到 offscreen auto-stopped，广播给 tabs')
      currentRecording = null
      await broadcastAutoStopped('chrome-ui')
    }
    await chrome.storage.local.remove('mooOffscreenAutoStopped')
  } catch (e) {
    console.warn('[Moo] checkOffscreenAutoStoppedFlag failed:', (e as Error).message)
  }
}

/** 注册 alarm + windows listener。background/index.ts 启动时调一次即可 */
export function installRecordingListeners(): void {
  // v0.5.0 tripwire alarm
  chrome.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name === OFFSCREEN_TRIPWIRE_ALARM) {
      void chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP' }).catch(() => {})
    }
  })
  // v0.4.8 windows.onRemoved 紧急 STOP
  chrome.windows?.onRemoved?.addListener((windowId) => {
    void emergencyStopForWindow(windowId)
  })
  // v0.7.9：SW 已 alive 时 offscreen 落 storage flag 也能立即被处理
  // 不再依赖 SW spin-up 兜底 checkOffscreenAutoStoppedFlag（旧版只在 SW 冷启动跑）。
  // offscreen → SW 三路保险：① runtime.sendMessage（同步通道）② alarms tripwire ③ storage flag。
  chrome.storage?.onChanged?.addListener?.((changes, area) => {
    if (area !== 'local' || !('mooOffscreenAutoStopped' in changes)) return
    const next = changes.mooOffscreenAutoStopped?.newValue as { at?: number } | undefined
    if (!next?.at) return  // 被 clear 不处理
    void checkOffscreenAutoStoppedFlag()
  })
}

// ─────────────────────────── 5 个 onMessage handler ───────────────────────────

export async function handleRecordStart(sender: chrome.runtime.MessageSender): Promise<RecordStartRes> {
  const tabId = sender.tab?.id
  const res = await startTabRecording(tabId)
  if (res.ok && tabId) currentRecording = { tabId, startedAt: Date.now() }
  return res
}

export async function handleRecordStop(sender: chrome.runtime.MessageSender): Promise<RecordStopRes> {
  const res = await stopTabRecording()
  currentRecording = null
  // 操作发起者拿到 dataUrl 走 SubmitDialog；其它 tab 上的远程 rec-bar 必须被通知退掉
  await broadcastAutoStopped('user-stop', sender.tab?.id)
  return res
}

export async function handleRecordCancel(sender: chrome.runtime.MessageSender): Promise<RecordCancelRes> {
  await cancelTabRecording()
  currentRecording = null
  await broadcastAutoStopped('user-cancel', sender.tab?.id)
  return { ok: true }
}

export function handleQueryRecordingState(): QueryRecordingStateRes {
  // content script 挂载（任意 tab）查全局录屏状态；命中就回 startedAt
  return currentRecording
    ? { recording: true, startedAt: currentRecording.startedAt }
    : { recording: false }
}

export async function handleOffscreenAutoStopped(): Promise<{ ok: true }> {
  // offscreen 报告 track 'ended'（最常见：用户点了 Chrome 顶部"停止共享"条）
  // 广播给所有 tab —— 任意 tab 都可能挂着远程 rec-bar
  if (currentRecording) {
    currentRecording = null
    await broadcastAutoStopped('chrome-ui')
  }
  return { ok: true }
}

// ─────────────────────────── 内部：录屏控制 + offscreen 管理 ───────────────────────────

/**
 * 把"录屏已结束"广播给所有 tab 的 content script。
 * - excludeTabId：通常是触发 STOP/CANCEL 的 sender tab
 * - v0.7.9：先读 chrome.scripting 当前注册的 matches，只播给真正注入了 content 的 tab。
 *   旧版 chrome.tabs.query({}) fan-out 给所有 tab，80+ tab 时大量 sendMessage reject
 *   触发 chrome 130+ per-tab warn。拿不到 matches 时降级回 fan-out 不影响功能。
 * - 删 void chrome.runtime.lastError — 这是 callback API 残留，promise 版 sendMessage
 *   reject 已被 catch 吸收，再 read lastError 反而让 chrome runtime 多一次 IPC。
 */
async function broadcastAutoStopped(reason: string, excludeTabId?: number): Promise<void> {
  let tabs: chrome.tabs.Tab[] = []
  try {
    // v0.7.9：scripting API 整体 try/catch — mock 测试 / 极老 chrome 没这个 API 时降级
    let matches: string[] = []
    try {
      const registered = await chrome.scripting.getRegisteredContentScripts()
      matches = registered.flatMap((s) => s.matches ?? [])
    } catch { /* scripting 不可用 → 降级 fan-out */ }
    tabs = matches.length > 0
      ? await chrome.tabs.query({ url: matches })
      : await chrome.tabs.query({})
  } catch {
    return
  }
  await Promise.all(tabs.map(async (t) => {
    if (!t.id || t.id === excludeTabId) return
    try {
      await chrome.tabs.sendMessage(t.id, { type: MSG.RECORD_AUTO_STOPPED, reason })
    } catch { /* tab 已关 / 注入 race — promise reject 已被 catch 吸收 */ }
  }))
}

async function ensureOffscreenDocument(): Promise<void> {
  const hasApi = !!(chrome as unknown as { offscreen?: unknown }).offscreen
  if (!hasApi) throw new Error(t('record.start.offscreen-unsupported'))

  let exists = false
  try {
    const getCtx = (chrome.runtime as unknown as { getContexts?: (opts: { contextTypes: string[] }) => Promise<unknown[]> }).getContexts
    if (typeof getCtx === 'function') {
      const contexts = await getCtx({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
      exists = Array.isArray(contexts) && contexts.length > 0
    }
  } catch {
    // ignore
  }
  if (exists) return

  await (chrome as unknown as { offscreen: { createDocument: (opts: unknown) => Promise<void> } }).offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: '录制当前标签页画面以附在 bug 提交中'
  })
}

async function closeOffscreenDocument(): Promise<void> {
  try {
    await (chrome as unknown as { offscreen: { closeDocument: () => Promise<void> } }).offscreen.closeDocument()
  } catch {
    // ignore
  }
}

async function startTabRecording(tabId?: number): Promise<{ ok: boolean; error?: string }> {
  if (!tabId) return { ok: false, error: t('record.start.no-tab') }

  // tabCapture 是 optional_permission，用户需要先在 popup 主动启用
  const hasPerm = await chrome.permissions.contains({ permissions: ['tabCapture'] })
  if (!hasPerm) {
    return { ok: false, error: t('record.start.permission') }
  }

  // 关键：getMediaStreamId 必须在 user activation 还有效时立即 invoke
  let streamId: string
  try {
    streamId = await new Promise<string>((resolve, reject) => {
      ;(chrome.tabCapture as unknown as { getMediaStreamId: (opts: { targetTabId: number }, cb: (id: string) => void) => void })
        .getMediaStreamId({ targetTabId: tabId }, (id: string) => {
          const err = chrome.runtime.lastError
          if (err || !id) reject(new Error(err?.message || t('record.start.stream-fail')))
          else resolve(id)
        })
    })
  } catch (e) {
    return { ok: false, error: t('record.start.gesture', { reason: (e as Error).message }) }
  }

  try {
    await ensureOffscreenDocument()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  // v0.4.4：tabId 一并传给 offscreen，SW 30s 闲置回收后能从 QUERY_STATE 拿回原录屏 tab
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'START', streamId, tabId })
  if (!res?.ok) {
    await closeOffscreenDocument()
    return { ok: false, error: res?.error || t('record.start.offscreen-fail') }
  }
  // v0.5.0：tripwire alarm 双保险（chrome.alarms 不受 SW/offscreen 节流影响）
  try {
    await chrome.alarms.create(OFFSCREEN_TRIPWIRE_ALARM, { when: Date.now() + 35_000 })
  } catch { /* alarms API 边缘失败，offscreen 端 setTimeout 仍兜底 */ }
  return { ok: true }
}

async function stopTabRecording(): Promise<RecordStopRes> {
  // v0.5.0：先清 tripwire alarm 防误触发
  try { await chrome.alarms.clear(OFFSCREEN_TRIPWIRE_ALARM) } catch { /* ignore */ }
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP' })
  await closeOffscreenDocument()
  return res ?? { ok: false, error: t('record.stop.no-response') }
}

async function cancelTabRecording(): Promise<void> {
  try { await chrome.alarms.clear(OFFSCREEN_TRIPWIRE_ALARM) } catch { /* ignore */ }
  try { await chrome.runtime.sendMessage({ target: 'offscreen', type: 'CANCEL' }) } catch { /* ignore */ }
  await closeOffscreenDocument()
}
