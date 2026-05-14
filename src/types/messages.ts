export type MooSource = 'popup' | 'devtools' | 'content' | 'background' | 'injected'

export interface MooMessage<T = unknown> {
  type: string
  source: MooSource
  tabId?: number
  payload?: T
}
