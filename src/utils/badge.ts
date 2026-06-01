import type { BugHistoryEntry } from '@/types/history'
import { UPGRADE_FLAG_KEY } from './upgradeFlag'

// 把"最近 24h 内提交失败的条目数"显示成扩展图标右下角的红色 badge。
// 目的：用户不开 popup 也能在 toolbar 看到「有失败的 bug 提交没处理」。
//
// 范围只取 24h 是为了让 badge 自然衰减——老失败如果还想看，去 History tab 看
// 完整列表；toolbar badge 只服务"近期需要我处理"的语义。

const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000
// tailwind red-600，色弱也清晰。chrome.action.setBadgeBackgroundColor API 只接受 hex 字符串/ColorArray，
// 无法注入 CSS var()；也不在任何 CSSOM 上下文里——故意硬编码（这里跟 --moo-c-danger 同色）
const BADGE_COLOR = '#dc2626'
// v0.6.1：升级提示用 amber-600，区分 failure red — banner 已经够醒目，badge 仅辅助
const UPGRADE_BADGE_COLOR = '#d97706'

// v0.7.9：缓存上次设置的颜色 — chrome 130+ 同色重设会 per-session warn。
// SW spin-up 时 module 重载会重置缓存，spin-up 后第一次 set 仍调 API（chrome 内部
// 也是 spin-up 时 reset 颜色，所以这里跟 SW 生命周期对齐刚好）。
let lastBadgeColor: string | undefined

/**
 * 把 history 折算成 badge 文本并写到扩展图标。
 * - 失败 = entry.result.ok === false（含网络错 + 4xx/5xx）
 * - >99 显示 "99+" 避免位数太多挤
 * - 0 清空 badge
 *
 * v0.6.1：升级 flag 优先于 failure 计数 —— 用户没启用 host_permission 时 failure 也提不上去，
 * 让 badge 「!」固定显示直到启用或 dismiss。修复 v0.6.0 mv3-pro review 找出的 SW spin-up
 * refreshBadge 把 '!' 立即覆盖回空的 bug（onInstalled 设 '!' 仅 30s 寿命）。
 */
async function setBadgeColorOnce(color: string): Promise<void> {
  // v0.7.9：同色 skip，避免 chrome 130+ per-session warn 噪音
  if (lastBadgeColor === color) return
  await chrome.action.setBadgeBackgroundColor({ color })
  lastBadgeColor = color
}

export async function updateActionBadge(history: BugHistoryEntry[]): Promise<void> {
  // 优先 check 升级 flag — 用户未启用 host_permission 时 host 受限，failure 计数本就不可靠
  try {
    const { [UPGRADE_FLAG_KEY]: needsUpgrade } = await chrome.storage.local.get(UPGRADE_FLAG_KEY)
    if (needsUpgrade) {
      await setBadgeColorOnce(UPGRADE_BADGE_COLOR)
      await chrome.action.setBadgeText({ text: '!' })
      return
    }
  } catch {
    // storage 读失败 → 兜底走 failure 计数（保持原行为）
  }

  const cutoff = Date.now() - FAILURE_WINDOW_MS
  let n = 0
  for (const e of history) {
    if (e.timestamp < cutoff) continue
    if (!e.result?.ok) n++
  }
  let text = ''
  if (n > 99) text = '99+'
  else if (n > 0) text = String(n)
  try {
    await setBadgeColorOnce(BADGE_COLOR)
    await chrome.action.setBadgeText({ text })
  } catch {
    // 极少数 Chrome 版本 / 非 standalone 上下文可能没 chrome.action——静默
  }
}
