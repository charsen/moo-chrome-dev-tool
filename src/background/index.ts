/**
 * Service Worker 入口：路由 onMessage 到各 handler，注册 alarm / commands / windows / 启动 spin-up。
 *
 * v0.5.2 P0 重构：业务逻辑下放到 src/background/handlers/*.ts，本文件只剩 router + boot。
 *   - handlers/zentao.ts   ZENTAO_* 6 case
 *   - handlers/record.ts   录屏 5 case + tripwire + windows.onRemoved
 *   - handlers/submit.ts   SUBMIT_BUG（webhook + zentao 双路径）
 *   - handlers/historyStatus.ts  REFRESH_HISTORY_STATUS
 *   - handlers/simple.ts   CAPTURE / MATCH / PREVIEW
 *   - handlers/badge.ts    refreshBadge
 *
 * 自身职责：onInstalled / onStartup / SW spin-up 副作用、commands listener、消息 dispatcher。
 */

import type { IncomingMessage, SubmitBugReq, SubmitBugRes } from '@/types/messages'
import { MSG } from '@/types/messages'
import { onHistoryChanged } from '@/storage/history'
import { flushRetryQueue, getQueueLength } from '@/background/retryQueue'
import { refreshBadge } from '@/background/handlers/badge'
import {
  handleZentaoTestConnection,
  handleZentaoListProjects,
  handleZentaoListUsers,
  handleZentaoListModules,
  handleZentaoPingCookie,
  handleZentaoClearCache
} from '@/background/handlers/zentao'
import {
  startRecordingFromCommand,
  installRecordingListeners,
  rehydrateRecordingFromOffscreen,
  checkOffscreenAutoStoppedFlag,
  handleRecordStart,
  handleRecordStop,
  handleRecordCancel,
  handleQueryRecordingState,
  handleOffscreenAutoStopped
} from '@/background/handlers/record'
import { handleCaptureScreenshot, handleMatchProject, handlePreviewPayload } from '@/background/handlers/simple'
import { handleSubmitBug } from '@/background/handlers/submit'
import { handleRefreshHistoryStatus } from '@/background/handlers/historyStatus'
import { t } from '@/i18n'

const RETRY_ALARM = 'mooRetry'

// v0.4.5：onInstalled + onStartup 都 create 同名 alarm，chrome 行为是同名覆盖会重置计时。
// 用户首次失败入队后再过 4:59 被 onStartup 重置成 0，等于「重试周期最长能拖到 ~10min」。
// 改成 alarms.get 先判断再 create —— 已存在就 noop，避免重置。
async function ensureRetryAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(RETRY_ALARM)
  if (!existing) {
    chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 5 })
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  console.log('[Moo] installed:', reason)
  void ensureRetryAlarm()
  void refreshBadge()
  // v0.6.0 BREAKING：host_permissions 从 mandatory <all_urls> 改 optional。老用户升级后
  // 没有自动授权 → 写一个 storage flag，popup 启动时显示 prominent 升级 banner 引导一键启用。
  if (reason === 'update') {
    try {
      const hasPerm = await chrome.permissions.contains({ origins: ['<all_urls>'] })
      if (!hasPerm) {
        await chrome.storage.local.set({ mooNeedsHostPermUpgrade: true })
        // 同时打个 badge "!" 让没开 popup 的用户也注意到（24h failure 计数会自然覆盖，
        // 但首次安装后 24h 内通常 history 空 → 这个 "!" 不会被盖）
        await chrome.action.setBadgeText({ text: '!' }).catch(() => {})
        await chrome.action.setBadgeBackgroundColor({ color: '#d97706' }).catch(() => {})
      }
    } catch (e) {
      console.warn('[Moo] onInstalled host-perm check failed:', (e as Error).message)
    }
  }
})

chrome.runtime.onStartup?.addListener(() => {
  void ensureRetryAlarm()
  void flushRetryQueue()
  void refreshBadge()
})

// History tab 里的删除 / 清空也要让 badge 同步缩水。submit handler 自己已经显式调
// refreshBadge，所以这里事件回调被自身写入触发是无害的——只是多读一次 storage
onHistoryChanged(() => { void refreshBadge() })

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM) void flushRetryQueue()
})

// v0.5.2：tripwire alarm + windows.onRemoved 紧急停录 — 都已搬到 handlers/record.ts
installRecordingListeners()

// SW 每次 spin-up（不止 onStartup）都立刻 flush 一次：MV3 SW 空闲 ~30s 被回收，
// 中途任何消息/alarm 唤醒都走这条路径。之前只 onStartup 主动 flush，意味着
// 用户在浏览器中途的失败 submit 要干等 alarm 周期（5min）才会重试。
;(async () => {
  try {
    const n = await getQueueLength()
    if (n > 0) {
      console.log('[Moo] SW boot: 立即 flush', n, '条重试队列')
      await flushRetryQueue()
    }
  } catch (e) {
    console.warn('[Moo] SW boot flush 失败', e)
  }
  // SW 每次 spin-up 都同步一次 badge：onStartup 只触发于浏览器启动，
  // SW 30s 闲置回收后再次唤醒时 onStartup 不会再触发，badge 状态会过期
  void refreshBadge()
  // v0.4.4：从 offscreen 恢复录屏状态（SW 内存丢但 offscreen 还在录的边缘场景）
  void rehydrateRecordingFromOffscreen()
  // v0.4.5：offscreen track-ended 时如果 SW 刚回收，sendMessage 会丢。spin-up 时读 storage flag 兜底
  void checkOffscreenAutoStoppedFlag()
})()

// 录屏入口必须由用户手势触发：chrome.commands 命中算手势，并直接把当前 tab 传进来。
// 悬浮球的 click 经 content script → message 转一道后手势就丢了，tabCapture.getMediaStreamId
// 会拒绝。所以 onCommand 内务必尽快（避免多余 await）调到 startRecordingFromCommand，让
// getMediaStreamId 在 user activation 还在的瞬间被 invoke。
chrome.commands?.onCommand.addListener((command, tab) => {
  console.log('[Moo cmd]', command, 'tab:', tab?.id, tab?.url)

  if (command === 'open-popup') {
    // chrome.action.openPopup() 在 MV3 SW 里可用（Chrome 99+），不需要 tab 上下文
    // 失败常见原因：浏览器窗口非焦点 / popup 已经打开。失败时只 log，不弹通知（噪音）
    chrome.action.openPopup().catch((err) => {
      console.warn('[Moo cmd] openPopup failed:', (err as Error).message)
    })
    return
  }

  if (command !== 'start-recording') return
  const tabId = tab?.id
  if (!tabId) {
    console.warn('[Moo cmd] 无 tabId（可能焦点不在 tab 内容上）')
    return
  }
  // 不 await：让 startRecordingFromCommand 内的 getMediaStreamId 在当前同步栈完成调用，
  // 拿到 streamId 后再把后续编排（offscreen + 通知 content）丢给 microtask。
  void startRecordingFromCommand(tabId).then(async (res) => {
    console.log('[Moo cmd] startRecordingFromCommand →', res)
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: MSG.RECORD_EXTERNAL_STARTED,
        ok: res.ok,
        error: res.error
      })
    } catch (e) {
      console.warn('[Moo cmd] 通知 content script 失败：', (e as Error).message)
    }
  })
})

// 接住 devtools 面板的 keepalive 端口（仅 dev：HMR 重载扩展时面板靠它感知 disconnect 后自刷新）。
// 生产 panel.ts 已不连这个 port，这里也对称屏蔽掉，避免被外部随意 connect 撑活 SW。
if (import.meta.env.DEV) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === '__panel_keepalive__') {
      port.onDisconnect.addListener(() => {})
    }
  })
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  // 严格校验消息来源（v0.4.4 复盘加固，旧代码 `sender.id &&` 短路放过 undefined）：
  // 我们 manifest 没声明 externally_connectable，所以同扩展发的 sender.id 必须 === runtime.id。
  // 任何不匹配（含 undefined / 不同 ext id）直接拒。
  if (sender.id !== chrome.runtime.id) {
    return false
  }
  // raw 来自跨进程 IPC，TS 编译期保证不了；先做最基本 shape 校验再 narrow 为 IncomingMessage。
  if (!raw || typeof raw !== 'object' || typeof (raw as { type?: unknown }).type !== 'string') {
    return false
  }
  const message = raw as IncomingMessage
  ;(async () => {
    try {
      switch (message.type) {
        case MSG.CAPTURE_SCREENSHOT: {
          sendResponse(await handleCaptureScreenshot(sender.tab?.windowId))
          break
        }
        case MSG.MATCH_PROJECT: {
          sendResponse(await handleMatchProject(message.payload?.url ?? ''))
          break
        }
        case MSG.PREVIEW_PAYLOAD: {
          sendResponse(handlePreviewPayload(message.payload))
          break
        }
        case MSG.SUBMIT_BUG: {
          // payload 是 IncomingMessage 里的 required 字段，TS 已 narrow，无需 as 强转。
          // 但仍要防 caller 端漏传：runtime 一道 shape 校验。
          if (!message.payload || typeof message.payload !== 'object') {
            sendResponse({ ok: false, error: t('submit.payload.missing') } satisfies SubmitBugRes)
            break
          }
          sendResponse(await handleSubmitBug(message.payload as SubmitBugReq, sender.tab?.id))
          break
        }
        case MSG.REFRESH_HISTORY_STATUS: {
          sendResponse(await handleRefreshHistoryStatus())
          break
        }
        case MSG.RETRY_QUEUE_FLUSH: {
          const n = await flushRetryQueue()
          sendResponse({ ok: true, processed: n })
          break
        }
        // v0.5.2 P0 重构第 2 阶段：5 个录屏 case 抽到 src/background/handlers/record.ts
        case MSG.RECORD_START: {
          sendResponse(await handleRecordStart(sender))
          break
        }
        case MSG.RECORD_STOP: {
          sendResponse(await handleRecordStop(sender))
          break
        }
        case MSG.RECORD_CANCEL: {
          sendResponse(await handleRecordCancel(sender))
          break
        }
        case MSG.QUERY_RECORDING_STATE: {
          sendResponse(handleQueryRecordingState())
          break
        }
        case MSG.OFFSCREEN_AUTO_STOPPED: {
          sendResponse(await handleOffscreenAutoStopped())
          break
        }
        // v0.5.2 P0 重构第 1 阶段：6 个 ZENTAO_* case 抽到 src/background/handlers/zentao.ts
        // 单测可独立调用；未来加 zentao MSG 不动主 switch
        case MSG.ZENTAO_TEST_CONNECTION: {
          sendResponse(await handleZentaoTestConnection(message.payload))
          break
        }
        case MSG.ZENTAO_LIST_PROJECTS: {
          sendResponse(await handleZentaoListProjects(message.payload))
          break
        }
        case MSG.ZENTAO_LIST_USERS: {
          sendResponse(await handleZentaoListUsers(message.payload))
          break
        }
        case MSG.ZENTAO_LIST_MODULES: {
          sendResponse(await handleZentaoListModules(message.payload))
          break
        }
        case MSG.ZENTAO_PING_COOKIE: {
          sendResponse(await handleZentaoPingCookie(message.payload))
          break
        }
        case MSG.ZENTAO_CLEAR_CACHE: {
          sendResponse(handleZentaoClearCache())
          break
        }
        default: {
          // 编译期 narrow：如果 IncomingMessage 里漏了某个 case，下面的 `never`
          // 赋值会 TS 错误。这是 discriminated union 的关键保护点。
          const _exhaustive: never = message
          sendResponse({ ok: false, error: `unknown message type` })
          void _exhaustive
        }
      }
    } catch (err) {
      sendResponse({ ok: false, error: (err as Error).message })
    }
  })()
  return true
})
