import type { ZentaoBugDetail } from '@/background/zentao/client'
import type { BugHistoryEntry } from '@/types/history'

/**
 * 禅道 bug 状态字段 → Moo 的统一枚举（兼容 webhook 路径的 v0.1.x 老 remoteStatus 值）。
 *
 * v0.3.0 新增：DevTools 历史 Tab 状态回查闭环用。
 * deleted=true 优先级最高（被彻底删的 bug 即便 status 是 active 也算 deleted）；
 * 未知 status 返 undefined，让 refreshHistoryStatus 跳过写库不覆盖原值。
 */
export function mapZentaoStatus(bug: ZentaoBugDetail): BugHistoryEntry['remoteStatus'] {
  if (bug.deleted) return 'deleted'
  switch (bug.status) {
    case 'active': return 'open'
    case 'resolved': return 'in_progress'
    case 'closed': return 'done'
    default: return undefined
  }
}
