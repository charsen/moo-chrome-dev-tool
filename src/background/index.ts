import type { MooMessage } from '@/types/messages'

chrome.runtime.onInstalled.addListener(({ reason }) => {
  console.log('[Moo] installed:', reason)
})

// Central message router. Devtools/popup/content/injected all funnel through here.
chrome.runtime.onMessage.addListener((message: MooMessage, sender, sendResponse) => {
  console.log('[Moo:bg] msg', message, 'from', sender.id)
  // TODO: route by message.type to handlers
  sendResponse({ ok: true })
  return true
})

// Long-lived port for devtools <-> background streaming
chrome.runtime.onConnect.addListener((port) => {
  console.log('[Moo:bg] port connected:', port.name)
  port.onMessage.addListener((msg) => {
    console.log('[Moo:bg] port msg', msg)
  })
})
