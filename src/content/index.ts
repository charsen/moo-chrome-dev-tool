import type { MooMessage } from '@/types/messages'

console.log('[Moo:content] loaded on', location.href)

// Bridge: page (via window.postMessage) <-> background (via chrome.runtime)
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data as MooMessage | undefined
  if (!data || data.source !== 'injected') return
  chrome.runtime.sendMessage(data).catch(() => {})
})

chrome.runtime.onMessage.addListener((msg: MooMessage) => {
  if (msg.source === 'background' || msg.source === 'devtools') {
    window.postMessage({ ...msg, source: 'content' }, '*')
  }
})
