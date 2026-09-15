/**
 * 远端回查状态（`BugHistoryEntry['remoteStatus']`）→ 中文文案的**单一来源**。
 *
 * 抽出来的原因：popup 的「最近提交」行和 devtools → Moo → History 列表各写了一份映射，
 * 一开始两份确实一致，后来悄悄漂了 —— 同一个 `done` 在 popup 是「完成」、在 History 是
 * 「已完成」；`deleted` 是「已删」/「已删除」。HANDOFF 的 Backlog 里当初判断「两处文案一致
 * 所以不主动收口」，那个前提已经过期，现在同一状态在不同入口看起来不是一回事。
 *
 * 口径：取 History 那份更完整的中文（「已完成」/「已删除」）为准 —— popup 的 badge 窄一点
 * 但多一个字不影响布局，而「已删」这种缩写在列表里容易和「已删除」以外的语义混。
 *
 * 注意这里**只管语义文案**，不管配色 / CSS class：popup 的 `rh-done` / `rh-prog` / `rh-del`
 * 是它自己的视觉契约（它还要区分失败 / 重试中两种非远端状态），留在组件里。
 */
import type { BugHistoryEntry } from '@/types/history'

/** 单个标签文案。`undefined`（后端未回查 / 不支持状态）→「已提交」。 */
export function remoteStatusLabel(s: BugHistoryEntry['remoteStatus']): string {
  switch (s) {
    case 'open':        return '待处理'
    case 'in_progress': return '处理中'
    case 'done':        return '已完成'
    case 'deleted':     return '已删除'
    default:            return '已提交'
  }
}

/** hover 提示。跟 label 同源，避免"标签改了 tooltip 没改"。 */
export function remoteStatusTitle(s: BugHistoryEntry['remoteStatus']): string {
  switch (s) {
    case 'open':        return '后端 open（待处理）'
    case 'in_progress': return '后端处理中'
    case 'done':        return '后端已标记完成'
    case 'deleted':     return '后端已删除'
    default:            return '已提交（后端尚未回查或不支持状态回查）'
  }
}
