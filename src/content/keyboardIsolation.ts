/**
 * 宿主页键盘隔离（v0.8.19）。
 *
 * Why：扩展 UI 跑在 closed shadow root 里，键盘事件从 shadow 冒泡到宿主页时，
 * `event.target` 会被**重定向成 host 元素**（一个 `<div id="__moo_dev_tool_host__">`）。
 * 很多后台系统的全局 Backspace 守卫写法是：
 *
 * ```js
 * document.addEventListener('keydown', (e) => {
 *   if (e.key === 'Backspace' && !isEditable(e.target)) e.preventDefault()
 * })
 * ```
 *
 * 于是用户在提交弹窗的标题/描述里按退格，页面看到 target 是 div → 判定「不在输入框」
 * → preventDefault → 原生删除被吞。表现就是「能打字，不能删字」。
 *
 * 两层处理（监听挂在 shadow root 上：closed shadow 外部的 composedPath() 会被裁剪成
 * host 起头，拿不到真正的 input）：
 *   1. stopPropagation：页面挂在 document / window（冒泡）上的键盘快捷键和 Backspace
 *      守卫完全收不到扩展 UI 内的事件。本扩展自己的键盘监听都在 capture 阶段或 shadow
 *      内更靠近 target 的元素上，早于这里执行，不受影响。
 *   2. 页面若在 capture 阶段抢先 preventDefault（这里已经晚于 document capture），
 *      事件派发结束后补一次等价删除 —— 只针对我们的 text input / textarea，且仅在原生
 *      删除确实被取消时执行，避免双重删除。
 *
 * 不做的事：不拦 click / paste / focus；不拦宿主页对扩展 UI 之外的键盘事件。
 */

/** input 里不可编辑的类型（选什么都删不了字） */
const NON_TEXT_INPUT_TYPES = new Set([
  'button', 'checkbox', 'color', 'file', 'hidden', 'image',
  'radio', 'range', 'reset', 'submit', 'number', 'date', 'datetime-local',
  'month', 'time', 'week'
])

type TextControl = HTMLInputElement | HTMLTextAreaElement

function asTextControl(node: EventTarget | null | undefined): TextControl | null {
  if (node instanceof HTMLTextAreaElement) {
    return node.disabled || node.readOnly ? null : node
  }
  if (node instanceof HTMLInputElement) {
    if (node.disabled || node.readOnly) return null
    return NON_TEXT_INPUT_TYPES.has(node.type) ? null : node
  }
  return null
}

/** 事件里真正的编辑元素：composedPath[0] 才是 shadow 内被聚焦的 input（e.target 是 host）
 *  必须在 shadow root 内部监听 —— closed shadow 外部的 composedPath() 会被裁剪成 host 起头 */
function textControlFromEvent(e: KeyboardEvent): TextControl | null {
  return asTextControl(e.composedPath()[0])
}

/** 回退到前一个 code point（emoji / 生僻字是代理对，按 code unit 删会留半个字符） */
function prevCodePointIndex(value: string, index: number): number {
  if (index <= 0) return 0
  const low = value.charCodeAt(index - 1)
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = value.charCodeAt(index - 2)
    if (high >= 0xd800 && high <= 0xdbff) return index - 2
  }
  return index - 1
}

function nextCodePointIndex(value: string, index: number): number {
  if (index >= value.length) return value.length
  const high = value.charCodeAt(index)
  if (high >= 0xd800 && high <= 0xdbff && index + 1 < value.length) {
    const low = value.charCodeAt(index + 1)
    if (low >= 0xdc00 && low <= 0xdfff) return index + 2
  }
  return index + 1
}

/** 原生删除被页面取消时，按 Backspace / Delete 语义手动编辑一次，并派发 input 让 v-model 同步 */
function applyDelete(el: TextControl, backward: boolean): void {
  const start = el.selectionStart
  if (start === null || el.selectionEnd === null) return
  let from = start
  let to = el.selectionEnd
  if (from === to) {
    if (backward) from = prevCodePointIndex(el.value, start)
    else to = nextCodePointIndex(el.value, start)
  }
  if (from === to) return
  el.setRangeText('', from, to, 'end')
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
}

export function installKeyboardIsolation(shadow: ShadowRoot): void {
  function onKeyDown(e: KeyboardEvent) {
    // 页面侧冒泡监听（快捷键 / Backspace 守卫）一律不再收到扩展 UI 内的按键
    e.stopPropagation()

    if (e.key !== 'Backspace' && e.key !== 'Delete') return
    if (e.isComposing) return // 组字中的退格归输入法，不能代劳
    const el = textControlFromEvent(e)
    if (!el) return

    // 页面在 capture 阶段已 preventDefault：原生删除不会发生，派发结束后补一次
    window.setTimeout(() => {
      if (!e.defaultPrevented) return
      if (!el.isConnected || shadow.activeElement !== el) return
      applyDelete(el, e.key === 'Backspace')
    }, 0)
  }

  function stopPropagation(e: Event) {
    e.stopPropagation()
  }

  // ShadowRoot 没有 keydown 之类的具体事件重载，只能按 EventListener 传入
  shadow.addEventListener('keydown', onKeyDown as EventListener)
  shadow.addEventListener('keyup', stopPropagation)
  shadow.addEventListener('keypress', stopPropagation)
}
