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

// v0.8.9 放宽自动同步（webhook 也进 Tab 自动回查）后的负载保护，防「用的人多」时
// 对后端打请求风暴（一次全量扫 = 最多 30 条 × 每条一个 POST）：
// ① inflight 锁：双窗口（DevTools panel + 工作区浮窗）同时进 History 双发 → 共享一次扫描；
// ② 60s 扫描冷却：快速来回切 Tab 不重扫。手动点「同步远端状态」带 force 绕过冷却
//   （用户明示要刷就给刷），但仍吃 inflight 锁。
// 冷却只在「真有可扫条目」时武装 —— 空扫不武装，防刚提交的第一条被白等 60s
// （v0.8.8 retryQueue 空 flush 武装 cooldown 挡掉手动重试的同款教训）。
// SW 内存态：SW 回收后冷却归零 —— 可接受，连续切 Tab 场景 SW 一直活着，正好覆盖风暴窗口。
let inflight: Promise<{ ok: true; updated: number }> | null = null
let lastSweepAt = 0
const SWEEP_COOLDOWN_MS = 60_000

export async function handleRefreshHistoryStatus(force = false): Promise<{ ok: true; updated: number }> {
  if (inflight) return inflight
  if (!force && Date.now() - lastSweepAt < SWEEP_COOLDOWN_MS) {
    return { ok: true, updated: 0 }
  }
  inflight = doRefreshHistoryStatus().finally(() => { inflight = null })
  return inflight
}

// 测试用：重置 inflight 锁 + 冷却（生产代码不要 import）
export function __resetHistoryStatusForTest(): void {
  inflight = null
  lastSweepAt = 0
}

async function doRefreshHistoryStatus(): Promise<{ ok: true; updated: number }> {
  // v0.5.3 #128：host_permission 未授权 → 静默 skip（fetchStatus 是后台 refresh，
  // 没权限就当不刷，不弹错给用户 — popup 已有显式开关引导）。不武装冷却。
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
    const entryIsZentao = entry.serverId === 'zentao'
    const projectIsZentao = project.kind === 'zentao'
    if (entryIsZentao !== projectIsZentao) continue
    const adapter = getAdapter(project.kind)
    if (!adapter?.fetchStatus) continue
    // 第一次**真要发请求**前才武装冷却 —— 按构造与发网条件对齐。早先在 `some(remoteId)`
    // 时武装比这里的循环条件松：孤儿条目（项目已删 / kind 切换不匹配）会一个请求没发
    // 却白武装 60s，把「刚向新项目提交后 60s 内进 Tab 的首次自动同步」静默挡掉
    lastSweepAt = Date.now()
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
