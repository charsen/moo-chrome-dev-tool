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
import { hasHostPermission } from '@/utils/hostPermission'

export async function handleRefreshHistoryStatus(): Promise<{ ok: true; updated: number }> {
  // v0.5.3 #128：host_permission 未授权 → 静默 skip（fetchStatus 是后台 refresh，
  // 没权限就当不刷，不弹错给用户 — popup 已有显式开关引导）
  if (!await hasHostPermission()) {
    return { ok: true, updated: 0 }
  }
  const list = await listHistory()
  const config = await loadConfig()
  let updated = 0
  for (const entry of list) {
    if (!entry.remoteId) continue
    const project = config.projects.find((p) => p.id === entry.projectId)
    if (!project) continue
    // v0.7.6 P1-2：entry.serverId 跟 project.kind 不一致时跳过 — 用户 kind 切换后
    // 老 webhook entry 在 zentao 项目下 fetchStatus 会拿 NaN bugId silent fail 404
    if (entry.serverId === 'zentao' ? project.kind !== 'zentao' : project.kind === 'zentao') continue
    const adapter = getAdapter(project.kind)
    if (!adapter?.fetchStatus) continue
    try {
      const newStatus = await adapter.fetchStatus(project, entry.remoteId, {
        remoteBase: entry.remoteBase,
        serverId: entry.serverId  // v0.7.6 P1-4：让 webhookAdapter 反查正确 server
      })
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
