import type { BugHistoryEntry } from '@/types/history'

// 把"最近 24h 内提交失败的条目数"显示成扩展图标右下角的红色 badge。
// 目的：用户不开 popup 也能在 toolbar 看到「有失败的 bug 提交没处理」。
//
// 范围只取 24h 是为了让 badge 自然衰减——老失败如果还想看，去 History tab 看
// 完整列表；toolbar badge 只服务"近期需要我处理"的语义。

const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000
const BADGE_COLOR = '#dc2626' // tailwind red-600，色弱也清晰

/**
 * 把 history 折算成 badge 文本并写到扩展图标。
 * - 失败 = entry.result.ok === false（含网络错 + 4xx/5xx）
 * - >99 显示 "99+" 避免位数太多挤
 * - 0 清空 badge
 */
export async function updateActionBadge(history: BugHistoryEntry[]): Promise<void> {
  const cutoff = Date.now() - FAILURE_WINDOW_MS
  let n = 0
  for (const e of history) {
    if (e.timestamp < cutoff) continue
    if (!e.result?.ok) n++
  }
  const text = n === 0 ? '' : n > 99 ? '99+' : String(n)
  try {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR })
    await chrome.action.setBadgeText({ text })
  } catch {
    // 极少数 Chrome 版本 / 非 standalone 上下文可能没 chrome.action——静默
  }
}
