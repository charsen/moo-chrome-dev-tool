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

/**
 * v0.7.8：persistent focus guard — 防 page 富文本编辑器 / element-ui dialog 等
 * **持续抢回**焦点的 trap。setTimeout 反复 blur 只在 mount 后 400ms 内有效，
 * 用户实际点 input 时已超时 → trap 抢回。
 *
 * 修法：page document 上 focusin / focusout capture phase listener，检测焦点
 * 切到 Moo host element 时 `stopImmediatePropagation` 让 page modal trap
 * 收不到 event 不会触发抢回逻辑。
 *
 * 副作用：会阻所有 page focusin/out listener（capture phase），不只 modal trap。
 * 但 Moo overlay 期间这是值得的（用户 dogfood 反馈输入不了字比 page 其它
 * focus 副作用严重）。unmount 时拆除恢复。
 *
 * 用法：
 * ```ts
 * let cleanup: (() => void) | null = null
 * onMounted(() => { cleanup = guardFocusForHost(HOST_ID) })
 * onBeforeUnmount(() => cleanup?.())
 * ```
 */
export function guardFocusForHost(hostId: string): () => void {
  function onFocusEvent(e: FocusEvent) {
    // composedPath 跨 closed shadow boundary，能看到事件源到 page document 的完整链
    // 如果链上有 Moo host element → 焦点是 Moo 内的，page modal trap 不该响应
    const path = e.composedPath()
    for (const n of path) {
      if (n instanceof Element && n.id === hostId) {
        e.stopImmediatePropagation()
        return
      }
    }
  }
  document.addEventListener('focusin', onFocusEvent, true)
  document.addEventListener('focusout', onFocusEvent, true)
  return () => {
    document.removeEventListener('focusin', onFocusEvent, true)
    document.removeEventListener('focusout', onFocusEvent, true)
  }
}
