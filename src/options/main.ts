/**
 * v0.7.4 → v0.7.5：options 浮窗升级成「工作区」(同事反馈：浮窗效果不错，比
 * F12 进 DevTools 体验好，希望概览/请求/错误也能在浮窗看)。
 *
 * 现包含 4 Tab：概览 / 环境 / 历史 / 设置 — 完整覆盖 DevTools panel 功能。
 *
 * 实现思路：Overview.vue 顶层 hardcode `chrome.devtools.inspectedWindow.tabId`，
 * options 上下文里 chrome.devtools 是 undefined。这里 pre-mount 注入 shim 让
 * Overview.vue 0 改动：
 *
 * - `chrome.windows.getLastFocused({windowTypes:['normal']})` 拿用户主 chrome
 *   窗口（排除浮窗自身 type='popup' 不算 normal）的 active tab
 * - 给 chrome.devtools.inspectedWindow.tabId 填上真 tab id
 * - mock chrome.devtools.network.onNavigated 成 no-op（Overview 实际没用到）
 *
 * 「打开瞬间锁定 tab」语义 — 跟 DevTools panel 体验一致（inspect 固定 tab）。
 * 用户切其它 tab 后想看新 tab 数据 → 关浮窗重新打开（最简，无监听复杂度）。
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
