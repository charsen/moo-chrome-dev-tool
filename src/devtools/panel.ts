import { createApp } from 'vue'
import Panel from './Panel.vue'
import '@/styles/tokens.css'

// 开发环境下 CRXJS 每次 HMR 都会重载扩展，导致当前面板的 chrome.* 上下文失效。
// 用一个 keepalive 端口监听扩展重载，触发后自动刷新面板。
// 生产环境必须关掉：MV3 service worker 空闲 ~30s 就被卸载，这个 port 也会跟着 disconnect，
// 触发 reload；新 panel 重连后又会再次 disconnect → 反复刷新，表现为面板空白/挂死。
if (import.meta.env.DEV) {
  try {
    const port = chrome.runtime.connect({ name: '__panel_keepalive__' })
    port.onDisconnect.addListener(() => {
      setTimeout(() => location.reload(), 150)
    })
  } catch {
    location.reload()
  }
}

function showError(label: string, detail: string) {
  let box = document.getElementById('__moo_err__')
  if (!box) {
    box = document.createElement('div')
    box.id = '__moo_err__'
    // 兜底错误条：必须独立于任何样式系统——它要在 tokens.css 加载失败 / Vue 挂载失败
    // 这种最坏情况下也能渲染。inline cssText 字面 hex，跟主题无关
    box.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;max-height:50vh;overflow:auto;' +
      'background:#fee2e2;color:#991b1b;font:12px ui-monospace,Menlo,monospace;' +
      'padding:8px 12px;border-top:2px solid #dc2626;white-space:pre-wrap;' +
      'z-index:2147483647;'
    document.body.appendChild(box)
  }
  box.textContent += `[${label}] ${detail}\n\n`
}

window.addEventListener('error', (e) => {
  showError('window.error', `${e.message}\n${e.error?.stack ?? ''}`)
})
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason
  showError('unhandledrejection', r?.stack ?? String(r))
})

// panel.html 正常通过 chrome.devtools.panels.create() 注入到 DevTools 里，
// chrome.devtools.* 才存在。但 manifest 把它的 URL 暴露为 chrome-extension://EXT/.../panel.html，
// 任意页面能 iframe 它，或者用户手动访问该 URL —— 这两种场景下 chrome.devtools 是
// undefined，Panel.vue setup 顶层访问 inspectedWindow.tabId 会直接 throw 让面板白屏。
// 挡一道：非 DevTools 上下文显示静态说明页，不挂 Vue。
if (typeof chrome === 'undefined' || typeof chrome.devtools === 'undefined') {
  const el = document.getElementById('app')
  if (el) {
    // 兜底说明页：非 DevTools 上下文（用户直接访问 panel.html），裸 DOM 没挂 Vue 也没用 tokens.css class
    // → inline 字面色（gray-700），跟主题无关
    el.style.cssText = 'font:14px ui-sans-serif,system-ui;padding:32px;max-width:560px;margin:0 auto;color:#374151;line-height:1.6;'
    el.textContent = '此页面需要通过 DevTools 打开。请打开任意网页 → 调出开发者工具（F12 / ⌥⌘I）→ 切到「Moo」面板使用。'
  }
} else {
  const app = createApp(Panel)
  app.config.errorHandler = (err, _instance, info) => {
    const e = err as Error
    showError(`vue:${info}`, `${e?.message ?? err}\n${e?.stack ?? ''}`)
    console.error('[Moo:panel]', err, info)
  }
  app.mount('#app')
}
