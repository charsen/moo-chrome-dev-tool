/**
 * v0.7.4 → v0.7.5：options 浮窗「工作区」入口，4 Tab（概览/历史/环境/设置）覆盖
 * DevTools panel 全功能。
 *
 * 关键实现：Overview.vue 顶层 hardcode `chrome.devtools.inspectedWindow.tabId`，
 * options 上下文 chrome.devtools 是 undefined。pre-mount 注入 shim 让 Overview.vue
 * 0 改动复用：
 * - `chrome.windows.getLastFocused({windowTypes:['normal']})` 拿主 chrome 窗口
 *   active tab（排除浮窗自身 type='popup'）
 * - 填 chrome.devtools.inspectedWindow.tabId 真 tab id
 * - mock chrome.devtools.network.onNavigated 成 no-op
 *
 * 「打开瞬间锁定 tab」语义 — 跟 DevTools panel 一致（inspect 固定 tab）。切其它 tab
 * 后想看新 tab 数据 → 关浮窗重开（无监听复杂度）。
 */
import { createApp } from 'vue'
import App from './App.vue'
import '@/styles/tokens.css'

async function lookupInspectedTab(): Promise<{ id: number; host: string } | null> {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] })
    if (!win?.id) return null
    const tabs = await chrome.tabs.query({ active: true, windowId: win.id })
    const tab = tabs[0]
    if (!tab?.id || !tab.url) return null
    if (tab.url.startsWith('chrome-extension://') || tab.url.startsWith('chrome://')) return null
    return { id: tab.id, host: new URL(tab.url).hostname }
  } catch {
    return null
  }
}

async function main() {
  if (!chrome.devtools) {
    const inspected = await lookupInspectedTab()
    // -1 是兜底：Overview send<T>() 会 chrome.runtime.lastError 后显示 error，
    // 不至于让整个浮窗 setup throw。其它 Tab（环境/历史/设置）不依赖 tabId 正常 work。
    ;(chrome as { devtools?: unknown }).devtools = {
      inspectedWindow: { tabId: inspected?.id ?? -1 },
      network: {
        onNavigated: { addListener: () => {}, removeListener: () => {} }
      }
    }
    // App.vue 通过 window 全局拿 host 显示给用户（vue prop 也行，全局更简）
    ;(window as { __mooInspectedHost?: string }).__mooInspectedHost = inspected?.host ?? ''
  }
  createApp(App).mount('#app')
}

void main()
