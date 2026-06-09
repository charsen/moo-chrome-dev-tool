import { createApp } from 'vue'
import ContentApp from './ContentApp.vue'
import { HOST_ID, SHADOW_CSS } from './styles'
import { clearRequests, getCurrentRequests } from './useRequests'
import { clearErrors, getCurrentErrors } from './useErrors'
import { MSG, type GetErrorsRes, type GetRequestsRes, type MooMessage } from '@/types/messages'

// 处理来自 devtools / popup 的查询。即使 Vue 还未挂载也要能响应。
// 严格校验消息来源（v0.4.5 复盘加固，跟 background + offscreen 拉齐）：
// 同扩展发的 sender.id 必须 === runtime.id，外部 / 未知来源直接拒。
// GET_REQUESTS 暴露脱敏前的 URL/headers/body 等敏感数据，必须挡住第三方扩展。
// backfill 重注入（非 reload）会让本文件重跑 → onMessage listener + Vue app 会重复累积：每次
// SW spin-up 一份，各自闭包引用旧 module 状态泄漏；且旧 onMessage listener 仍会用自己（已停更）
// 的 buffer 抢答 GET_REQUESTS。把句柄存 ISO world window，重注入时先清旧再建新。reload 时 ISO
// world 被销毁、句柄随之没（或已死）→ removeListener/unmount 走 try/catch 兜底，仍正常重建，
// 不破坏下方 v0.7.6 孤儿 host 重建。
const isoWin = window as typeof window & {
  __mooContentMsgListener?: Parameters<typeof chrome.runtime.onMessage.addListener>[0]
  __mooContentApp?: { unmount: () => void }
}
if (isoWin.__mooContentMsgListener) {
  try { chrome.runtime.onMessage.removeListener(isoWin.__mooContentMsgListener) } catch { /* 旧 listener 已死 */ }
}
const onContentMessage = (
  msg: MooMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): boolean => {
  if (sender.id !== chrome.runtime.id) return false
  if (msg.type === MSG.GET_REQUESTS) {
    sendResponse({ requests: getCurrentRequests() } satisfies GetRequestsRes)
    return true
  }
  if (msg.type === MSG.CLEAR_REQUESTS) {
    clearRequests()
    sendResponse({ ok: true })
    return true
  }
  if (msg.type === MSG.GET_ERRORS) {
    sendResponse({ errors: getCurrentErrors() } satisfies GetErrorsRes)
    return true
  }
  if (msg.type === MSG.CLEAR_ERRORS) {
    clearErrors()
    sendResponse({ ok: true })
    return true
  }
  return false
}
chrome.runtime.onMessage.addListener(onContentMessage)
isoWin.__mooContentMsgListener = onContentMessage

// v0.7.6 backfill P0：reload extension 时 chrome 销毁所有 content script 实例 +
// Vue app，但 page DOM 里的 host div 留着（host 是 page DOM 不是 chrome 内部）。
// backfill executeScript 再次注入本文件时 getElementById(HOST_ID) 命中 → if 跳过
// → Vue 永远不 mount → host 是空壳用户看不到悬浮球。
// 修：检测到孤儿 host（shadow root 空 / 不存在）就清掉重建，让 Vue 重新 mount。
// v0.8.x：重建前先干净 unmount 旧 Vue app（跑 onBeforeUnmount 清它的 window message / runtime /
// timer listener）。否则 backfill 重注入只 remove host、旧 app 没 unmount → 僵尸 app 监听泄漏，
// 每次 SW spin-up 累积一份。reload 时旧句柄已死 → unmount 走 try/catch 兜底仍重建。
if (isoWin.__mooContentApp) {
  try { isoWin.__mooContentApp.unmount() } catch { /* 旧 app 已随 reload 死亡 */ }
  isoWin.__mooContentApp = undefined
}
const existing = document.getElementById(HOST_ID)
if (existing) {
  // closed shadow root 外部读不到 host.shadowRoot（永远 null）— 但 `attachShadow` 已
  // attached 的 host 二次调用会 throw 'Shadow root cannot be created on a host which
  // already hosts a shadow tree'。所以最稳：reload 时直接 remove 旧 host 重建。
  existing.remove()
}
{
  const host = document.createElement('div')
  host.id = HOST_ID
  host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483600;'
  document.documentElement.appendChild(host)

  // mode: 'closed' 阻止宿主页脚本通过 host.shadowRoot 读到扩展 UI 内容
  //（用户在 SubmitDialog 输入的标题/描述、截图 dataUrl 等敏感内容）
  const shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = SHADOW_CSS
  shadow.appendChild(style)

  const mount = document.createElement('div')
  mount.style.cssText = 'pointer-events: auto;'
  shadow.appendChild(mount)

  const app = createApp(ContentApp)
  app.mount(mount)
  isoWin.__mooContentApp = app  // 存句柄供下次重注入时干净卸载

  // v0.4.5：DEV 才打 log，避免污染所有宿主 page 的 console（每个 tab 每个 frame 都打一行）
  if (import.meta.env.DEV) console.log('[Moo:content] mounted')
}
