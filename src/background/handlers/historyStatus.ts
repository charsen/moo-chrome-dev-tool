/**
 * REFRESH_HISTORY_STATUS 入口 + 后端状态回查（禅道 v1/bugs/{id} + 老 webhook 状态接口）。
 *
 * v0.5.2 P0 重构第 3 阶段：把 background/index.ts 内 refreshHistoryStatus +
 * fetchZentaoBugStatus + fetchWebhookBugStatus 抽出来。
 */

import type { BugHistoryEntry } from '@/types/history'
import type { Project } from '@/types/config'
import { listHistory, updateHistoryEntry } from '@/storage/history'
import { loadConfig } from '@/storage/config'
import { getBug as zentaoGetBug, type ZentaoEnv } from '@/background/zentao/client'
import { mapZentaoStatus } from '@/background/zentaoStatus'

export async function handleRefreshHistoryStatus(): Promise<{ ok: true; updated: number }> {
  const list = await listHistory()
  const config = await loadConfig()
  let updated = 0
  for (const entry of list) {
    if (!entry.remoteId) continue
    const project = config.projects.find((p) => p.id === entry.projectId)
    try {
      let newStatus: BugHistoryEntry['remoteStatus'] | undefined
      // v0.3：禅道路径走 v1/bugs/{id} 详情，按 status 字段映射
      if (project?.kind === 'zentao' && project.zentao?.baseUrl) {
        newStatus = await fetchZentaoBugStatus(project, entry.remoteId)
      } else if (entry.remoteBase) {
        // 老 webhook 路径：POST {remoteBase}/{id}/status-public 走 body.token 鉴权
        newStatus = await fetchWebhookBugStatus(entry, project)
      }
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

async function fetchZentaoBugStatus(project: Project, remoteId: string): Promise<BugHistoryEntry['remoteStatus']> {
  const z = project.zentao
  if (!z?.baseUrl || !z.account || !z.password) return undefined
  const bugId = Number(remoteId)
  if (!Number.isFinite(bugId) || bugId <= 0) return undefined
  const env: ZentaoEnv = {
    baseUrl: z.baseUrl, account: z.account, password: z.password,
    projectId: z.projectId, moduleId: z.moduleId
  }
  const r = await zentaoGetBug(env, bugId)
  if (!r.ok) return undefined
  return mapZentaoStatus(r.data)
}

async function fetchWebhookBugStatus(entry: BugHistoryEntry, project: Project | undefined): Promise<BugHistoryEntry['remoteStatus']> {
  if (!entry.remoteBase) return undefined
  const token = project?.token?.trim() ?? ''
  const url = `${entry.remoteBase}/${entry.remoteId}/status-public`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  })
  if (!resp.ok) return undefined
  const data = await resp.json() as { ok?: boolean; status?: BugHistoryEntry['remoteStatus'] }
  return (data && data.ok && data.status) || undefined
}
