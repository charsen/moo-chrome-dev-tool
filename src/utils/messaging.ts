import type { MooMessage, MooSource } from '@/types/messages'

export function sendToBackground<T = unknown>(
  type: string,
  source: MooSource,
  payload?: T
): Promise<unknown> {
  const msg: MooMessage<T> = { type, source, payload }
  return chrome.runtime.sendMessage(msg)
}

export function onMessage(handler: (msg: MooMessage) => void): () => void {
  const listener = (msg: MooMessage) => handler(msg)
  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}
