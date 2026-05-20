import type { MooMessage, MooSource } from '@/types/messages'

/**
 * 几种典型的 MV3 消息错误：
 * - no-receiver: 接收端不存在 (content script 没注入 / SW 没起 / port name 错)
 * - context-invalidated: 扩展刚 reload，旧上下文已废
 * - port-closed: SW 在 sendResponse 前被卸载
 * 调用方一般只需要"失败了 → 提示用户"，所以归一化成一个 Error 子类够用了。
 */
export type MessagingErrorKind = 'no-receiver' | 'context-invalidated' | 'port-closed' | 'unknown'

export class MessagingError extends Error {
  readonly kind: MessagingErrorKind
  readonly raw: string
  constructor(raw: string) {
    super(friendly(raw))
    this.name = 'MessagingError'
    this.raw = raw
    this.kind = classify(raw)
  }
}

/**
 * 纯字符串映射，不依赖 chrome.runtime.sendMessage——devtools 用 chrome.tabs.sendMessage
 * 的地方也能直接复用（见 Overview.vue）。新加复用方时不要再本地复制一份。
 * 文案以更具操作性的版本为准（带「⌘R / F5」/「刷新当前页面」提示）。
 */
export function classify(raw: string): MessagingErrorKind {
  if (/Could not establish connection|Receiving end does not exist/.test(raw)) return 'no-receiver'
  if (/Extension context invalidated/.test(raw)) return 'context-invalidated'
  if (/message port closed/i.test(raw)) return 'port-closed'
  return 'unknown'
}

export function friendly(raw: string): string {
  if (!raw) return ''
  const kind = classify(raw)
  if (kind === 'no-receiver') return '扩展刚重载过，当前页面的内容脚本还没注入——刷新一下当前页面（⌘R / F5）就好。'
  if (kind === 'context-invalidated') return '扩展已重新加载，请刷新当前页面（⌘R / F5）。'
  if (kind === 'port-closed') return '消息超时（内容脚本可能崩了 / 页面切走了）。刷新当前页面后重试。'
  return raw
}

type SendOptions<T> =
  | { /** 不传：失败时抛 MessagingError */ }
  | { /** 传了：失败时静默返回 fallback，不抛 */ fallback: T }

/**
 * chrome.runtime.sendMessage 的安全包装：把"Could not establish connection"等乱七八糟的
 * 错误归一化成 MessagingError；调用方传 fallback 则不抛、返回 fallback。
 */
export async function safeSendMessage<T = unknown>(
  msg: unknown,
  opts: SendOptions<T> = {}
): Promise<T | undefined> {
  try {
    return (await chrome.runtime.sendMessage(msg)) as T
  } catch (e) {
    const raw = (e as Error)?.message ?? String(e)
    if ('fallback' in opts) return (opts as { fallback: T }).fallback
    throw new MessagingError(raw)
  }
}

export function sendToBackground<T = unknown>(
  type: string,
  source: MooSource,
  payload?: T
): Promise<unknown> {
  const msg: MooMessage<T> = { type, source, payload }
  return safeSendMessage(msg)
}

export function onMessage(handler: (msg: MooMessage) => void): () => void {
  const listener = (msg: MooMessage) => handler(msg)
  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}
