/**
 * v0.7.7：扩展 overlay（Annotator / SubmitDialog 等）进入键盘交互时偷走宿主页焦点。
 *
 * Why（v0.7.6→v0.7.7 hotfix dogfood 真撞）：
 * - 用户在 page input focus 状态触发 Moo overlay（截图 / 提交）
 * - overlay 弹出但**page input 仍 focus**（焦点没自动切走）
 * - 用户键盘输入到 overlay 的 input 时，字符还会泄漏到 page input
 * - 更糟：很多 page modal（element-ui dialog 等）有自己的 focus trap，
 *   会**抢回**焦点不让 overlay input 拿焦点 → 用户根本输不进字
 *
 * 解决：overlay mount 时主动 `document.activeElement.blur()`。closed shadow 内
 * 调 document.activeElement 跨 shadow boundary 拿真 page 焦点，blur() 把 page
 * input 焦点撤掉。
 *
 * stealOnce vs stealRepeatedly：
 * - stealOnce：mount 立刻偷一次，简单 case 足够（如 Annotator 文字工具）
 * - stealRepeatedly：跟 element-ui / Vue page modal 的 focus trap 拼速度 — 多次
 *   延迟 blur + 最后 focus 自己的 input（如 SubmitDialog mount 时撞到 page
 *   dialog 同时 trap）
 */

/** mount 时偷一次 — Annotator 等简单场景 */
export function stealPageFocus(): void {
  try {
    const active = document.activeElement
    if (active instanceof HTMLElement && active.tagName !== 'BODY' && active.tagName !== 'HTML') {
      active.blur()
    }
  } catch {
    // SVG / 跨 origin iframe 边界 silent
  }
}

/**
 * 反复偷 — SubmitDialog 等可能撞 page modal focus trap 的场景。
 * 100/200/400ms 三次延迟 blur 后调 onSettled（一般是 input.focus()）。
 * 返 cleanup 函数让 onBeforeUnmount 清 timer 防泄漏。
 */
export function stealPageFocusRepeatedly(onSettled?: () => void): () => void {
  stealPageFocus()  // 立刻一次
  const timers: number[] = []
  const delays = [50, 100, 200, 400]
  delays.forEach((d, i) => {
    const t = window.setTimeout(() => {
      stealPageFocus()
      if (i === delays.length - 1 && onSettled) onSettled()
    }, d)
    timers.push(t)
  })
  return () => { timers.forEach(t => clearTimeout(t)) }
}
