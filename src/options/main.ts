/**
 * v0.7.4：options page 入口。chrome.windows.create({type:'popup'}) 浮窗弹出
 * 显示，复用 DevTools 的 Environment / Settings / History 三个 Tab 组件。
 *
 * 为啥不直接复用 Panel.vue：
 * - Panel.vue 顶层 `chrome.devtools.inspectedWindow.tabId` 在 options 上下文
 *   throw（没 chrome.devtools API），且 Overview Tab 依赖 inspected tab 拿
 *   实时请求/错误，options 浮窗里没「当前调试的 tab」语义，跳过。
 * - Environment / Settings / History 都不依赖 chrome.devtools.*（Environment
 *   v0.7.1 已加 optional chain），开箱在 options 里 work。
 */
import { createApp } from 'vue'
import App from './App.vue'
import '@/styles/tokens.css'

createApp(App).mount('#app')
