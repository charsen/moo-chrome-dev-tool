/**
 * adapter 注册表入口。SW 启动时 import 所有 adapter，按 project.kind 查表 dispatch。
 *
 * 加新 adapter 时只动这里：① import ② 加进 registry 字面量 ③ AdapterKind 加值。
 * handlers/submit / handlers/historyStatus / retryQueue 不需要碰。
 */

import type { AdapterKind, AdapterRegistry, IssueAdapter } from './IssueAdapter'
import { webhookAdapter } from './webhookAdapter'
import { zentaoAdapter } from './zentaoAdapter'

export const adapterRegistry: AdapterRegistry = {
  webhook: webhookAdapter,
  zentao: zentaoAdapter
}

/**
 * 按 kind 查 adapter；找不到时返 undefined（router 兜底返「不支持的 kind」错）。
 */
export function getAdapter(kind: AdapterKind | string): IssueAdapter | undefined {
  return adapterRegistry[kind as AdapterKind]
}

export type { IssueAdapter, AdapterKind, AdapterSubmitOutcome, AdapterSubmitCtx, AdapterRetryPayload, AdapterRetryOutcome, AdapterStatus } from './IssueAdapter'
