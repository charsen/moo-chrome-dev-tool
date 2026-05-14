import { createApp } from 'vue'
import Panel from './Panel.vue'

// 开发环境下 CRXJS 每次 HMR 都会重载扩展，导致当前面板的 chrome.* 上下文失效。
// 用一个 keepalive 端口监听扩展重载，触发后自动刷新面板。
try {
  const port = chrome.runtime.connect({ name: '__panel_keepalive__' })
  port.onDisconnect.addListener(() => {
    setTimeout(() => location.reload(), 150)
  })
} catch {
  location.reload()
}

function showError(label: string, detail: string) {
  let box = document.getElementById('__moo_err__')
  if (!box) {
    box = document.createElement('div')
    box.id = '__moo_err__'
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

const app = createApp(Panel)
app.config.errorHandler = (err, _instance, info) => {
  const e = err as Error
  showError(`vue:${info}`, `${e?.message ?? err}\n${e?.stack ?? ''}`)
  console.error('[Moo:panel]', err, info)
}
app.mount('#app')
