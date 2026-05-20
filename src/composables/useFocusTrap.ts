import { onBeforeUnmount, watch, type Ref } from 'vue'

/**
 * 模态弹层焦点陷阱 + ESC 回调。
 *
 * 适用场景：SubmitDialog / Annotator 取消保护 这类带 role="dialog" / "alertdialog"
 * 的浮层。原本只挂了 aria 角色，键盘用户 Tab 仍能走出 dialog 到宿主页，体验混乱
 * （尤其 cancel-guard 本来就该截住一切操作）。本 composable 补两件事：
 *
 *   1. **焦点循环**：Tab 走到最后一个 focusable → 跳回第一个；Shift+Tab 反之。
 *   2. **ESC 钩子**：调 opts.onEscape?.()，不强制关 dialog——是否真关由组件决定
 *      （比如 Annotator 主画布按 Esc 是「先取消选中，再退出」的语义，不能粗暴关）。
 *
 * mount 时记录之前的活跃元素，unmount 时还原焦点。
 *
 * **shadow DOM 关键点**：扩展 UI 全跑在 closed shadow root 内。
 *   - listener 挂 rootRef.value 自身（不挂 document）—— 避免污染宿主页键盘事件链。
 *   - previouslyFocused 通过 getActiveInShadowOrDoc() 沿 shadowRoot 链找真实
 *     activeElement —— 直接读 document.activeElement 在 shadow 内时会返回 host 元素，
 *     还原焦点等于焦点错位到宿主页根。
 */

export interface UseFocusTrapOptions {
  /** Esc 按下时的回调。不传则 Esc 在 trap 内被静默吞掉。 */
  onEscape?: () => void
  /**
   * 进入 trap 时的初始焦点策略：
   *   - 'first'（默认）：第一个可聚焦元素
   *   - 'container'：聚焦容器自身（需要容器有 tabindex="-1"）。用于
   *     组件已经自管初始焦点（比如 SubmitDialog 在 onMounted 里手动 focus 标题输入框）
   */
  initialFocus?: 'first' | 'container'
}

/**
 * 沿着 shadowRoot 链向下找真正的 activeElement。
 *
 * 为什么不直接用 document.activeElement：在 shadow DOM 内活跃的元素，
 * document.activeElement 返回的是宿主 host，不是真实焦点元素。如果直接拿这个
 * 当 previouslyFocused，unmount 还原焦点时会把焦点扔到 host 上而不是用户原本
 * 在 shadow 内活跃的输入框/按钮。
 *
 * 算法：从 startRoot 所在的 document（或 shadow）开始拿 activeElement，
 * 如果它自带 shadowRoot 且 shadowRoot.activeElement 存在，就下钻一层，
 * 直到 leaf。
 *
 * 抽出来 + 加注释：下次有人复用 focus trap 不会再踩 host vs activeElement 的坑。
 */
export function getActiveInShadowOrDoc(startRoot: Node | null | undefined): HTMLElement | null {
  // 从 startRoot 的 root（可能是 ShadowRoot 或 Document）拿 activeElement
  const root = startRoot?.getRootNode?.() as Document | ShadowRoot | undefined
  let active: Element | null = (root as Document | ShadowRoot | undefined)?.activeElement ?? document.activeElement
  // 下钻嵌套 shadow
  while (active && (active as HTMLElement).shadowRoot && (active as HTMLElement).shadowRoot!.activeElement) {
    active = (active as HTMLElement).shadowRoot!.activeElement
  }
  return (active as HTMLElement | null) ?? null
}

/**
 * 收集 root 内的可聚焦元素，按 tab 顺序返回。
 *
 * selector 是 W3C 通用的「天然 tabbable」清单。过滤：
 *   - disabled（button / input / textarea / select 的）—— 不参与 tab 链
 *   - display:none —— offsetParent 为 null 时不在视觉上可达
 *
 * 不做 tabindex>0 排序：扩展自家 UI 全用 tabindex="0"/"-1"/默认，不靠正整数手动定序。
 */
export function getFocusable(root: HTMLElement): HTMLElement[] {
  const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  const list = Array.from(root.querySelectorAll<HTMLElement>(sel))
  return list.filter((el) => {
    if ((el as HTMLButtonElement | HTMLInputElement).disabled) return false
    // offsetParent 为 null = display:none / 不在渲染树。比读 computed style 快几个数量级
    // 例外：position:fixed 元素 offsetParent 也是 null，但 dialog 内一般用不上
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false
    return true
  })
}

export function useFocusTrap(
  rootRef: Ref<HTMLElement | undefined>,
  opts: UseFocusTrapOptions = {}
): void {
  const { onEscape, initialFocus = 'first' } = opts
  // 当前已激活的 root（已挂 listener / 已记录原焦点的那个）。
  // 用 watch 跟踪 rootRef 变化以支持 v-if 切换的 dialog（Annotator cancel-guard）。
  let activeRoot: HTMLElement | null = null
  let previouslyFocused: HTMLElement | null = null

  function onKeydown(e: KeyboardEvent) {
    const root = activeRoot
    if (!root) return

    if (e.key === 'Escape') {
      // 不阻止冒泡 —— SubmitDialog / Annotator 各自的 keydown 监听仍要能拿到 Esc
      // 来做自己的语义（关闭 / 退出）。本 hook 只提供「想自己接管的话调我」的 onEscape。
      onEscape?.()
      return
    }

    if (e.key !== 'Tab') return

    const focusable = getFocusable(root)
    if (!focusable.length) {
      // 没有可聚焦项 → 焦点留容器自身，吞掉 Tab 防止走出
      e.preventDefault()
      return
    }

    // noUncheckedIndexedAccess: 上面 length>0 保证两端非 undefined，但 TS 看不出，
    // 这里用 ! 而不是 ?? root —— 因为逻辑上不可能是 undefined
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    const active = getActiveInShadowOrDoc(root)

    if (e.shiftKey) {
      if (active === first || !root.contains(active)) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (active === last || !root.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  function activate(root: HTMLElement) {
    // 记录原焦点（沿 shadow 下钻拿真实活跃元素）
    previouslyFocused = getActiveInShadowOrDoc(root)

    // 初始焦点
    if (initialFocus === 'container') {
      root.focus()
    } else {
      const focusable = getFocusable(root)
      if (focusable.length) focusable[0]!.focus()
      else root.focus()
    }

    // listener 挂 root 自身（不挂 document）—— 事件 path 里能拿到，
    // 不污染宿主页其他键盘监听
    root.addEventListener('keydown', onKeydown)
    activeRoot = root
  }

  function deactivate() {
    if (activeRoot) {
      activeRoot.removeEventListener('keydown', onKeydown)
      activeRoot = null
    }
    // 还原焦点：仅当原元素还在 DOM 里。Vue 卸载顺序里 dialog 可能已经从 shadow 移除，
    // 但 previouslyFocused 通常是宿主页元素或 shadow 内的兄弟节点，isConnected 直接判
    if (previouslyFocused && previouslyFocused.isConnected) {
      try { previouslyFocused.focus() } catch { /* 元素可能不再 focusable */ }
    }
    previouslyFocused = null
  }

  // immediate: true 让 onMounted 时机也命中（Vue 此刻 ref 已绑）；后续 v-if 切换
  // 也会同步驱动 activate/deactivate（覆盖 Annotator cancel-guard 这种条件渲染场景）
  watch(
    rootRef,
    (root, prevRoot) => {
      if (prevRoot && prevRoot !== root) deactivate()
      if (root) activate(root)
    },
    { immediate: true, flush: 'post' }
  )

  onBeforeUnmount(() => {
    deactivate()
  })
}
