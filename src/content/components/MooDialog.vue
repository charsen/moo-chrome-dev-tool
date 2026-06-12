<template>
  <!-- shell：display:contents 透明包装（CSS 在 styles.ts）。多根（mask + 缩小态 pill）会让
       组件变 fragment 根，SubmitDialog 写在组件上的 v-show="!picking" 就没地方落（v-show
       只支持单元素根）。contents 不参与布局，对内部 fixed 定位的 mask / pill 零影响；
       v-show 注入的 inline display:none 优先于 contents，照常整体隐藏。 -->
  <div class="moo-dialog-shell">
    <div
      v-show="!minimized"
      :class="['moo-dialog-mask', { 'moo-dialog-mask--light': variant === 'light' }]"
      @click.self="onMaskClick"
    >
      <div
        ref="dialogEl"
        :class="['moo-dialog', { 'moo-dialog--moved': pos !== null, 'moo-dialog--dragging': dragging }]"
        :style="dialogStyle"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="labelledBy"
        :aria-label="labelledBy ? undefined : title"
        tabindex="-1"
      >
        <slot name="head">
          <header v-if="title" ref="headEl" class="moo-dialog-head" @pointerdown="onHeadDown">
            <h3 :id="labelledBy">{{ title }}</h3>
            <div class="moo-dialog-head-actions">
              <button
                v-if="minimizable"
                type="button"
                class="moo-dialog-min-btn"
                aria-label="缩小，稍后继续填写"
                title="缩小，稍后继续填写"
                @click="minimized = true"
              ><span aria-hidden="true">—</span></button>
              <MooCloseBtn @click="emit('close')" />
            </div>
          </header>
        </slot>
        <slot />
      </div>
    </div>

    <!-- 缩小态 pill：mask/dialog 整体 v-show 隐藏（表单状态保留，同 ElementPicker picking
         先例），页面完全可交互可滚动；点 pill / 按 Esc 恢复 -->
    <button
      v-if="minimized"
      type="button"
      class="moo-dialog-restore-pill"
      @click="minimized = false"
    ><span aria-hidden="true">▢</span> {{ minimizedLabel }}</button>
  </div>
</template>

<script setup lang="ts">
// content 世界通用 dialog 壳：mask + container + role=dialog + aria + focus-trap + ESC + 点 mask 关。
// 不接管「open/close 状态」——consumer 用 v-if / v-show 自己控；这样 SubmitDialog 那种
// 「打开 ElementPicker 时 v-show 隐藏 dialog 保留 form state」的场景不受影响。
//
// v0.8.11 三个 UX 能力（动机：录 bug 时要对照看页面内容）：
//   1. variant='light'：淡 scrim + 无 blur，看得见底下的页面
//   2. header 拖拽：pointer capture 模式（同 FloatingBall），位移走 transform translate
//      增量叠加在 flex 居中布局上 —— 首帧无 transform = 居中不跳变；pos 通过
//      v-model:pos 暴露给 consumer（SubmitDialog 把它记进 dialogDraft 跨重挂还原）
//   3. minimizable：缩小成右下角 pill，焦点陷阱 paused 释放、Esc 变「恢复」语义
//
// .moo-dialog-mask / .moo-dialog / .moo-dialog-head / pill 等 CSS 在 src/content/styles.ts
// 已定义（shadow DOM 注入），跟 MooCloseBtn 同样模式：组件只出 markup，样式由 host
// 上下文 stylesheet 提供。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import MooCloseBtn from '@/components/MooCloseBtn.vue'
import { useFocusTrap } from '@/composables/useFocusTrap'

const props = withDefaults(defineProps<{
  /** 标题。给了就渲染默认 header；不给走 head slot（slot 模式没有拖拽/缩小按钮）。 */
  title?: string
  /** aria-labelledby 指向的 id。给了就渲染到 h3#id，让屏幕阅读器拿到标题。
   * 不给则用 aria-label=title 作为兜底（同样可达，但 labelledby 更标准）。 */
  labelledBy?: string
  /** 点击 mask 自身是否触发 close。默认 true。
   * 关键操作（如带未保存草稿的 dialog）应传 false 防误关。 */
  maskClosable?: boolean
  /** focus-trap 初始焦点策略，透传 useFocusTrap。
   * 'container'：聚焦 dialog 容器自身（适用于组件 onMounted 后自己 focus 输入框）。
   * 'first'：首个可聚焦元素。 */
  initialFocus?: 'first' | 'container'
  /** 遮罩风格。'modal'（默认）= 半透明 scrim + blur；
   * 'light' = 很淡的 scrim、无 blur —— 用户需要对照看底下页面内容时用。 */
  variant?: 'modal' | 'light'
  /** 是否提供「缩小成右下角 pill」能力。默认 false（其它使用方零行为变化）。 */
  minimizable?: boolean
  /** 缩小态 pill 的文案。 */
  minimizedLabel?: string
}>(), {
  maskClosable: true,
  initialFocus: 'first',
  variant: 'modal',
  minimizable: false,
  minimizedLabel: '继续填写 Bug'
})

const emit = defineEmits<{
  (e: 'close'): void
}>()

/** 拖拽位移（相对 flex 居中基准的 translate 偏移）。null = 没拖过（纯居中）。
 *  defineModel：parent 不绑定时退化为内部 ref，零侵入。 */
const pos = defineModel<{ x: number; y: number } | null>('pos', { default: null })
/** 缩小态。parent 可 v-model:minimized 感知（SubmitDialog 据此放行宿主页键盘）。 */
const minimized = defineModel<boolean>('minimized', { default: false })

const dialogEl = ref<HTMLDivElement>()
const headEl = ref<HTMLElement>()

// ESC（弹窗态）走 useFocusTrap 的 onEscape 钩子（在 dialog 容器上挂监听，不污染宿主页）。
// 缩小态 trap paused 释放 —— Tab / Esc / 一切键盘交互还给宿主页（缩小态的 Esc=恢复
// 由下面的 window 监听单独接管）。
useFocusTrap(dialogEl, {
  initialFocus: props.initialFocus,
  onEscape: () => emit('close'),
  paused: minimized
})

function onMaskClick() {
  if (props.maskClosable) emit('close')
}

// ── header 拖拽（FloatingBall.vue 同款 pointer capture 模式）──────────────────
// 位移叠加方案：mask 仍是 flex 居中，dialog 加 transform translate(x, y) 增量。
// 首帧 pos=null 不出 transform = 原样居中；拖动基于「当前 pos」做增量，无跳变。
const dragging = ref(false)
let dragActive = false
let dragMoved = false
let activePointerId: number | null = null
let downAt = { x: 0, y: 0 }
let originPos = { x: 0, y: 0 }
/** 起手时 dialog 去掉当前 translate 后的「布局基准」rect（即 flex 居中的位置），
 *  clamp 计算用：新视口位置 = baseRect + 新 pos。 */
let baseRect = { left: 0, top: 0, width: 0, height: 0 }

const dialogStyle = computed(() =>
  pos.value ? { transform: `translate(${pos.value.x}px, ${pos.value.y}px)` } : undefined
)

function onHeadDown(e: PointerEvent) {
  if (e.button !== 0) return
  // 排除按钮（缩小 / 关闭）：拖拽只接管标题和空白处
  if ((e.target as HTMLElement | null)?.closest('button')) return
  const el = dialogEl.value
  if (!el) return
  // 防御同 FloatingBall：上次 pointerup 丢了（拖出视口 / alt-tab）时 stale 监听还挂着
  endDrag()

  dragActive = true
  dragMoved = false
  activePointerId = e.pointerId
  downAt = { x: e.clientX, y: e.clientY }
  const cur = pos.value ?? { x: 0, y: 0 }
  originPos = { ...cur }
  const r = el.getBoundingClientRect()
  baseRect = { left: r.left - cur.x, top: r.top - cur.y, width: r.width, height: r.height }
  // 与 FloatingBall 不同：header 空白处没有 click 语义（按钮已排除），不必等 4px
  // 阈值，down 即 capture —— 跨 iframe 页面拖拽也不丢事件
  try { headEl.value?.setPointerCapture(e.pointerId) } catch { /* 某些浏览器对 closed shadow 内 capture 有限制，忽略 */ }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
  window.addEventListener('pointercancel', onDragEnd)
  window.addEventListener('blur', onDragEnd)
  // 防止拖动时选中标题文字 / 触发宿主页焦点变化
  e.preventDefault()
}

function onDragMove(e: PointerEvent) {
  if (!dragActive) return
  const dx = e.clientX - downAt.x
  const dy = e.clientY - downAt.y
  // 4px 阈值：纯点击 header 不产生 1px 抖动位移（也不把 pos 从 null 弄脏）
  if (!dragMoved && Math.hypot(dx, dy) <= 4) return
  if (!dragMoved) {
    dragMoved = true
    dragging.value = true
  }
  // clamp 在视口内：左右至少留 48px 可抓；header 在顶部 —— 顶不许出（出了就抓不回来），
  // 底部同样留 48px（露出 header 高度足够再抓）
  const minLeft = 48 - baseRect.width
  const maxLeft = window.innerWidth - 48
  const minTop = 0
  const maxTop = window.innerHeight - 48
  const newLeft = Math.max(minLeft, Math.min(maxLeft, baseRect.left + originPos.x + dx))
  const newTop = Math.max(minTop, Math.min(maxTop, baseRect.top + originPos.y + dy))
  pos.value = { x: newLeft - baseRect.left, y: newTop - baseRect.top }
}

function onDragEnd() {
  endDrag()
}

/** 拖拽结束统一收口（idempotent，多渠道触发只跑一次）：摘监听 + release capture。 */
function endDrag(): void {
  if (!dragActive) return
  dragActive = false
  dragging.value = false
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointercancel', onDragEnd)
  window.removeEventListener('blur', onDragEnd)
  if (headEl.value && activePointerId !== null) {
    try { headEl.value.releasePointerCapture(activePointerId) } catch {}
  }
  activePointerId = null
}

// ── 缩小态 Esc = 恢复（不是关闭）────────────────────────────────────────────
// trap paused 后 dialog 自己的 keydown 已失效（也确实该失效——页面键盘要正常用），
// 唯一例外是 Esc：用户按 Esc 期待「把弹窗叫回来」。window capture 监听只在缩小态
// 挂载，恢复 / 卸载即摘，不常驻污染宿主页。
function onMinimizedKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopImmediatePropagation()
  minimized.value = false
}

watch(
  minimized,
  (m) => {
    if (m) {
      window.addEventListener('keydown', onMinimizedKeydown, true)
    } else {
      window.removeEventListener('keydown', onMinimizedKeydown, true)
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  endDrag()
  window.removeEventListener('keydown', onMinimizedKeydown, true)
})
</script>
