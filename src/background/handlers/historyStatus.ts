/**
 * REFRESH_HISTORY_STATUS 入口 —— 遍历 history 调 adapter.fetchStatus 更新远程状态。
 *
 * v0.5.2 P0 重构第 3 阶段：抽出 fetchZentaoBugStatus + fetchWebhookBugStatus。
 * v0.5.3 IssueAdapter 接入：双路径合并成 `getAdapter(project.kind).fetchStatus(...)` —
 * 加新 adapter（github / jira）只需要 adapter 实现 fetchStatus，本文件不动。
 */

import type { BugHistoryEntry } from '@/types/history'
import { listHistory, updateHistoryEntry } from '@/storage/history'
import { loadConfig } from '@/storage/config'
import { getAdapter } from '@/adapters'

export async function handleRefreshHistoryStatus(): Promise<{ ok: true; updated: number }> {
  const list = await listHistory()
  const config = await loadConfig()
  let updated = 0
  for (const entry of list) {
    if (!entry.remoteId) continue
    const project = config.projects.find((p) => p.id === entry.projectId)
    if (!project) continue
    const adapter = getAdapter(project.kind)
    if (!adapter?.fetchStatus) continue
    try {
      const newStatus = await adapter.fetchStatus(project, entry.remoteId, { remoteBase: entry.remoteBase })
      if (newStatus && newStatus !== entry.remoteStatus) {
        entry.remoteStatus = newStatus
        entry.remoteStatusUpdatedAt = new Date().toISOString()
        await updateHistoryEntry(entry.id, entry)
        updated++
      }
    } catch {
      // ignore single failure；继续下一条
    }
  }
  return { ok: true, updated }
}
