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
chrome.runtime.onMessage.addListener((msg: MooMessage, sender, sendResponse) => {
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
})

// v0.7.6 backfill P0：reload extension 时 chrome 销毁所有 content script 实例 +
// Vue app，但 page DOM 里的 host div 留着（host 是 page DOM 不是 chrome 内部）。
// backfill executeScript 再次注入本文件时 getElementById(HOST_ID) 命中 → if 跳过
// → Vue 永远不 mount → host 是空壳用户看不到悬浮球。
// 修：检测到孤儿 host（shadow root 空 / 不存在）就清掉重建，让 Vue 重新 mount。
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

  createApp(ContentApp).mount(mount)

  // v0.4.5：DEV 才打 log，避免污染所有宿主 page 的 console（每个 tab 每个 frame 都打一行）
  if (import.meta.env.DEV) console.log('[Moo:content] mounted')
}
