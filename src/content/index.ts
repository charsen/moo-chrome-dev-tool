import { createApp } from 'vue'
import ContentApp from './ContentApp.vue'
import { SHADOW_CSS } from './styles'
import { clearRequests, getCurrentRequests } from './useRequests'
import { clearErrors, getCurrentErrors } from './useErrors'
import { MSG, type GetErrorsRes, type GetRequestsRes, type MooMessage } from '@/types/messages'

// 处理来自 devtools / popup 的查询。即使 Vue 还未挂载也要能响应。
chrome.runtime.onMessage.addListener((msg: MooMessage, _sender, sendResponse) => {
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

// 避免重复注入（HMR / SPA 重复执行）
const HOST_ID = '__moo_dev_tool_host__'
if (!document.getElementById(HOST_ID)) {
  const host = document.createElement('div')
  host.id = HOST_ID
  host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483600;'
  document.documentElement.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = SHADOW_CSS
  shadow.appendChild(style)

  const mount = document.createElement('div')
  mount.style.cssText = 'pointer-events: auto;'
  shadow.appendChild(mount)

  createApp(ContentApp).mount(mount)

  console.log('[Moo:content] mounted')
}
