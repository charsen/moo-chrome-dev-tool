/**
 * 把毫秒时间戳格式化成「刚刚 / N 分钟前 / N 小时前 / N 天前 / 月-日」。
 *
 * 多处展示「这条 N 时间前发生」需要同一份口径：popup 最近列表、Settings 重试队列
 * 列表。各自写一份容易在阈值 / 中文文案上漂移，统一抽到这里。
 *
 * 设计选择：
 * - 阈值梯度对齐用户习惯（< 1min / < 1h / < 24h / < 1w / 其余绝对日期）
 * - 超 7 天回退绝对日期：相对时间过长（「3 周前」「2 月前」）就不如直接给日期
 * - 不依赖 Intl.RelativeTimeFormat：扩展跑在 Chrome，但保持纯函数无环境依赖更稳
 */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
