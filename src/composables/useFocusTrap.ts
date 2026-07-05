import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'

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
  /**
   * 暂停开关（可选，响应式）。true 期间 trap 释放：摘掉 keydown 监听，Tab / Esc 全部
   * 还给宿主页 —— 场景是 MooDialog 缩小成 pill 时页面必须完全可交互。复位 false 时
   * 重挂监听并按 initialFocus 策略把焦点送回容器。不影响 unmount 时「还原原焦点」语义。
   */
  paused?: Ref<boolean>
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
  const { onEscape, initialFocus = 'first', paused } = opts
  // 当前已激活的 root（已挂 listener / 已记录原焦点的那个）。
  // 用 watch 跟踪 rootRef 变化以支持 v-if 切换的 dialog（Annotator cancel-guard）。
  let activeRoot: HTMLElement | null = null
  let previouslyFocused: HTMLElement | null = null

  function onKeydown(e: KeyboardEvent) {
    // 输入法组字中的 Esc（取消候选）/ Tab 不是对 dialog 的命令 ——
    // 否则中文用户在标题/描述框打字按 Esc 会直接关弹窗丢内容
    if (e.isComposing) return
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

  /** 按 initialFocus 策略给焦点（activate 初次 + paused 复位两处共用） */
  function focusInitial(root: HTMLElement) {
    if (initialFocus === 'container') {
      root.focus()
    } else {
      const focusable = getFocusable(root)
      if (focusable.length) focusable[0]!.focus()
      else root.focus()
    }
  }

  function activate(root: HTMLElement) {
    // 记录原焦点（沿 shadow 下钻拿真实活跃元素）
    previouslyFocused = getActiveInShadowOrDoc(root)
    activeRoot = root

    // 暂停期激活（罕见：挂载瞬间就是 paused）：只记录 root / 原焦点，
    // 不抢焦点不挂监听，等 paused 复位 false 再补
    if (paused?.value) return

    focusInitial(root)

    // listener 挂 root 自身（不挂 document）—— 事件 path 里能拿到，
    // 不污染宿主页其他键盘监听
    root.addEventListener('keydown', onKeydown)
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

  // paused 切换：true → 摘监听（页面键盘交互全放行）；false → 重挂监听 + 焦点回容器。
  // removeEventListener 重复调无害，跟 deactivate 不冲突。焦点恢复另走 nextTick
  // （见下方注释 —— flush:'post' 不够，v-show 的 display 更新同在 post 队列且更晚）。
  if (paused) {
    watch(
      paused,
      (p) => {
        const root = activeRoot
        if (!root) return
        if (p) {
          root.removeEventListener('keydown', onKeydown)
        } else {
          root.addEventListener('keydown', onKeydown)
          // ⚠ 不能在本 watcher 里同步 focusInitial：v-show 的 display 恢复走
          // queuePostRenderEffect（也是 post 队列），而本 watcher 在 setup 期创建、
          // effect id 更小 → 排在 v-show 更新**前面**跑。此刻容器子树还是
          // display:none，focus() 对 hidden 元素是静默 no-op（e2e dialog-ux UX7
          // 实测焦点留在 body）。推迟到 nextTick —— 本轮 flush 的全部 post cb
          // （含 v-show display 翻转）跑完后再给焦点。
          // 防御：tick 间隙内又被 pause / root 已换（卸载/重挂）则放弃这次焦点。
          void nextTick(() => {
            if (!paused.value && activeRoot === root) focusInitial(root)
          })
        }
      },
      { flush: 'post' }
    )
  }

  onBeforeUnmount(() => {
    deactivate()
  })
}
