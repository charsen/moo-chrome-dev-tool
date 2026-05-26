<template>
  <div class="moo-annotator">
    <div class="moo-canvas-wrap" ref="wrapEl" :style="wrapStyle">
      <canvas class="moo-canvas-bg" ref="bgEl" :width="canvasW" :height="canvasH" />
      <canvas
        class="moo-canvas-draw"
        ref="drawEl"
        :class="{ 'is-text': mode === 'text', 'is-hover': hoverIdx >= 0 }"
        :width="canvasW"
        :height="canvasH"
        @pointerdown="onDown"
        @pointermove="onCanvasHover"
      />
      <div
        v-if="editing"
        class="moo-text-input-wrap"
        :style="textInputStyle"
        @pointerdown.stop
        @click.stop
      >
        <input
          ref="textInputEl"
          v-model="editing.text"
          class="moo-text-input"
          :style="{ fontSize: textFontPx * displayScale + 'px' }"
          @keydown.enter.prevent="commitText"
          @keydown.escape.prevent="cancelText"
          placeholder="输入文字，回车确认 / Esc 取消"
        />
        <button class="moo-text-btn ok" @click="commitText" title="确认 (Enter)">✓</button>
        <button class="moo-text-btn cancel" @click="cancelText" title="取消 (Esc)">✕</button>
      </div>
    </div>
    <!-- 取消保护：已绘内容时确认丢弃 -->
    <MooAlert
      v-if="cancelGuard"
      title="放弃标注？"
      :message="`已有 ${items.length} 处标注，丢弃后无法恢复。`"
      confirm-text="放弃标注"
      cancel-text="继续编辑"
      @confirm="doCancel"
      @cancel="dismissCancelGuard"
    />

    <div class="moo-toolbar moo-toolbar--stacked">
      <div class="toolbar-row tools-row" role="toolbar" aria-label="标注工具">
        <button :class="['tool', { active: mode === 'rect' }]" :aria-pressed="mode === 'rect'" @click="mode = 'rect'" title="矩形 (1)">▭<span>矩形</span></button>
        <button :class="['tool', { active: mode === 'circle' }]" :aria-pressed="mode === 'circle'" @click="mode = 'circle'" title="圆形 (2)">◯<span>圆形</span></button>
        <button :class="['tool', { active: mode === 'arrow' }]" :aria-pressed="mode === 'arrow'" @click="mode = 'arrow'" title="箭头 (3)">↗<span>箭头</span></button>
        <button :class="['tool', { active: mode === 'pointer' }]" :aria-pressed="mode === 'pointer'" @click="mode = 'pointer'" title="指针 (4)">➤<span>指针</span></button>
        <button :class="['tool', { active: mode === 'text' }]" :aria-pressed="mode === 'text'" @click="mode = 'text'" title="文字 (5)">T<span>文字</span></button>
        <button :class="['tool', { active: mode === 'mosaic' }]" :aria-pressed="mode === 'mosaic'" @click="mode = 'mosaic'" title="马赛克 (6)">▓<span>马赛克</span></button>
        <div class="sep" />
        <button
          v-for="c in COLORS"
          :key="c.value"
          class="swatch"
          :class="{ active: currentColor === c.value }"
          :style="{ background: c.value }"
          :title="c.label"
          :aria-label="`颜色：${c.label}`"
          :aria-pressed="currentColor === c.value"
          @click="currentColor = c.value"
        />
        <div class="sep" />
        <button
          v-for="w in WIDTHS"
          :key="w.value"
          class="width-btn"
          :class="{ active: currentWidth === w.value }"
          :title="`线宽：${w.label}`"
          :aria-label="`线宽：${w.label}`"
          :aria-pressed="currentWidth === w.value"
          @click="currentWidth = w.value"
        >
          <span class="width-dot" :style="{ width: Math.min(16, w.value) + 'px', height: Math.min(16, w.value) + 'px', background: currentColor }" />
        </button>
      </div>
      <div class="toolbar-row action-row">
        <span class="hint">{{ modeHint }}</span>
        <div class="actions-right">
          <button @click="undo" :disabled="!past.length" title="撤销 (⌘Z)">撤销</button>
          <button @click="redo" :disabled="!future.length" title="重做 (⌘⇧Z)">重做</button>
          <button
            @click="deleteSelected"
            :disabled="selectedIdx < 0"
            title="删除选中 (Delete)"
          >删除</button>
          <button class="danger" @click="clearAll" :disabled="!items.length">清空</button>
          <div class="sep" />
          <button @click="cancel">取消</button>
          <button class="primary" @click="finish">下一步</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { clone } from '@/utils/clone'
import { stealPageFocus } from '@/utils/stealPageFocus'
import MooAlert from './components/MooAlert.vue'

const props = defineProps<{ image: string }>()
const emit = defineEmits<{
  (e: 'finish', dataUrl: string): void
  // v0.7.6 mv3-pro P2：cancel reason — 'error' = dataUrl 加载失败（不是用户主动取消）
  (e: 'cancel', reason?: 'error'): void
}>()

const bgEl = ref<HTMLCanvasElement>()
const drawEl = ref<HTMLCanvasElement>()
const wrapEl = ref<HTMLDivElement>()
const textInputEl = ref<HTMLInputElement>()

const canvasW = ref(0)
const canvasH = ref(0)
const displayScale = ref(1)

// color/width 在每个 item 上凝固创建时的样式，之后改 currentColor 不影响已画的对象。
// 老历史项目可能没有这两个字段 → drawXxx 会回退到默认颜色（红）和默认 lineWidth。
type RectItem = { type: 'rect'; x: number; y: number; w: number; h: number; color?: string; width?: number }
type CircleItem = { type: 'circle'; x: number; y: number; w: number; h: number; color?: string; width?: number }
type ArrowItem = { type: 'arrow'; x1: number; y1: number; x2: number; y2: number; color?: string; width?: number }
type PointerItem = { type: 'pointer'; x: number; y: number } // 形态固定，不参与色板
type TextItem = { type: 'text'; x: number; y: number; text: string; color?: string }
type MosaicItem = { type: 'mosaic'; x: number; y: number; w: number; h: number; block: number } // 像素化效果，不参与色板
type Item = RectItem | CircleItem | ArrowItem | PointerItem | TextItem | MosaicItem
type Mode = 'rect' | 'circle' | 'arrow' | 'pointer' | 'text' | 'mosaic'

const items = ref<Item[]>([])
const mode = ref<Mode>('rect')
const editing = ref<TextItem | null>(null)

// === Undo/Redo 栈 ===
// past[i] 是"再撤销一次会回到的状态"。最新动作之前的状态在栈顶。
// 任何新动作（draw / move / pointer / text / delete / clear）都会把
// 该动作之前的 items 快照 push 到 past，并清空 future。
const HISTORY_LIMIT = 50
const past = ref<Item[][]>([])
const future = ref<Item[][]>([])
/** 当前动作开始前的 items 快照，onUp/commitText 时决定 commit 还是 discard */
let pendingSnapshot: Item[] | null = null

function beginAction() {
  pendingSnapshot = clone(items.value)
}
function commitAction() {
  if (!pendingSnapshot) return
  past.value.push(pendingSnapshot)
  if (past.value.length > HISTORY_LIMIT) past.value.shift()
  future.value = []
  pendingSnapshot = null
}
function discardAction() {
  pendingSnapshot = null
}

// === 选中（用于"单对象删除"，区别于 hover） ===
const selectedIdx = ref<number>(-1)
/** 标记本次 pointer-down → up 之间是否真的"拖动"过；用于区分 click（选中）vs drag（移动） */
let actionDragged = false

// 视觉常量（基于原图分辨率）
// 颜色是「画笔色」语义（绘制到 canvas 像素，写进 PNG 数据），跟 UI 主题完全无关
// → 故意硬编码：截图标注红 = iOS 系统红 #ff3b30；色板里 4 色固定，色弱用户也能在缩略图里靠形状区分
const DEFAULT_COLOR = '#ff3b30'
const DEFAULT_LINE_WIDTH = 12
const textFontPx = 48
const textFont = `700 ${textFontPx}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
const pointerSize = 80 // 虚拟指针图形高度（px）
const mosaicBlock = 14 // 马赛克像素块大小（按原图坐标）

// 色板：每色配一个 label 用作 a11y title
// 4 色为「画笔色」字面值，绘制到 PNG 像素里，不走 token（截图作为不可变制品携带这些颜色）
const COLORS: { value: string; label: string }[] = [
  { value: '#ff3b30', label: '红' },
  { value: '#fbbf24', label: '黄' },
  { value: '#3b82f6', label: '蓝' },
  { value: '#111111', label: '黑' }
]
// 线宽档：6 细 / 12 中（默认）/ 20 粗
const WIDTHS: { value: number; label: string }[] = [
  { value: 6, label: '细' },
  { value: 12, label: '中' },
  { value: 20, label: '粗' }
]

// COLORS 是 const 字面量数组，[0] 字面意义上一定存在；noUncheckedIndexedAccess
// 不分析 length，所以这里加 ! 让 TS 闭嘴。
const currentColor = ref<string>(COLORS[0]!.value)
const currentWidth = ref<number>(DEFAULT_LINE_WIDTH)

let drawing = false
let start = { x: 0, y: 0 }
let moving: { idx: number; startPX: number; startPY: number; orig: Item } | null = null
const hoverIdx = ref<number>(-1)

const wrapStyle = computed(() => ({
  width: canvasW.value * displayScale.value + 'px',
  height: canvasH.value * displayScale.value + 'px'
}))

const textInputStyle = computed(() => {
  if (!editing.value) return {}
  return {
    left: editing.value.x * displayScale.value + 'px',
    top: editing.value.y * displayScale.value + 'px'
  }
})

const modeHint = computed(() => {
  const base = '· 拖动已有标注可移动'
  switch (mode.value) {
    case 'rect': return `拖动绘制矩形 ${base}`
    case 'circle': return `拖动绘制椭圆 ${base}`
    case 'arrow': return `拖动绘制箭头：起点 → 指向目标 ${base}`
    case 'pointer': return `点击放置虚拟指针 ${base}`
    case 'text': return `点击放置文字 ${base}`
    case 'mosaic': return `拖动选区打马赛克（脱敏） ${base}`
  }
  return ''
})

// v0.7.7 P0：Annotator mount + text mode 进入时偷宿主页焦点防字符泄漏。
// 详见 utils/stealPageFocus 注释。

onMounted(async () => {
  stealPageFocus()
  const img = new Image()
  img.onload = async () => {
    canvasW.value = img.naturalWidth
    canvasH.value = img.naturalHeight
    const maxW = window.innerWidth - 80
    const maxH = window.innerHeight - 140
    displayScale.value = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight)
    await nextTick()
    const ctx = bgEl.value!.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    redraw()
  }
  // 截图 dataUrl 损坏 / 跨域 / 解码失败时，img 不会触发 onload，用户卡在空 canvas
  // → emit cancel 让外层退出，避免无限等待
  img.onerror = () => {
    console.error('[Moo:annotator] 截图加载失败（dataUrl 可能损坏或被宿主页 CSP 阻塞）')
    emit('cancel', 'error')  // v0.7.6：明示是 error 不是用户主动 cancel，ContentApp 显示 toast 告知
  }
  img.src = props.image
  window.addEventListener('keydown', onKey)
})

// 跟踪活跃的 pointer capture，用户在拖拽中 Esc / 关闭 Annotator 时能释放
let activeCaptureEl: HTMLElement | null = null
let activeCapturePid: number | null = null
function detachPointer() {
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  if (activeCaptureEl != null && activeCapturePid != null) {
    try { activeCaptureEl.releasePointerCapture(activeCapturePid) } catch {}
  }
  activeCaptureEl = null
  activeCapturePid = null
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  detachPointer()
  // 卸载前如果还有 pending nudge action，立刻 commit；timer 也清
  if (nudgeCommitTimer) { clearTimeout(nudgeCommitTimer); nudgeCommitTimer = undefined }
  if (nudgePending) { commitAction(); nudgePending = false }
})

const TOOL_KEY_MAP: Record<string, Mode> = {
  '1': 'rect',
  '2': 'circle',
  '3': 'arrow',
  '4': 'pointer',
  '5': 'text',
  '6': 'mosaic'
}

function onKey(e: KeyboardEvent) {
  if (editing.value) return
  // cancel-guard 打开时把所有键盘交给 trap 处理：避免按 Esc 同时被 trap 关 guard +
  // 又被这里 cancel() 走"退出 Annotator"分支造成行为冲突
  if (cancelGuard.value) return
  const mod = e.metaKey || e.ctrlKey
  // 数字键 1-6 切换工具（无修饰键，且不在输入框里）
  const mapped = TOOL_KEY_MAP[e.key]
  if (!mod && !e.shiftKey && !e.altKey && mapped) {
    e.preventDefault()
    mode.value = mapped
    return
  }
  // ⌘Z / ⌘⇧Z（或 Ctrl 等价键）撤销/重做
  if (mod && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault()
    if (e.shiftKey) redo()
    else undo()
    return
  }
  // ⌘Y 也作为重做的常见绑定（Windows 习惯）
  if (mod && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault()
    redo()
    return
  }
  // Delete / Backspace 删除选中
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdx.value >= 0) {
    e.preventDefault()
    deleteSelected()
    return
  }
  // ⌘C 复制选中、⌘V 粘贴（clipboard 仅在 Annotator 内存活，不跨 session）
  if (mod && (e.key === 'c' || e.key === 'C') && selectedIdx.value >= 0) {
    e.preventDefault()
    copySelected()
    return
  }
  if (mod && (e.key === 'v' || e.key === 'V') && annoClipboard) {
    e.preventDefault()
    pasteFromClipboard()
    return
  }
  // 方向键微移选中（无修饰 1px / Shift 10px），鼠标精度不够时用得上
  if (selectedIdx.value >= 0 && !mod && !e.altKey) {
    const ARROW: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]
    }
    const delta = ARROW[e.key]
    if (delta) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      nudgeSelected(delta[0] * step, delta[1] * step)
      return
    }
  }
  if (e.key === 'Escape') {
    // 优先取消选中（如果有），其次才退出 Annotator
    if (selectedIdx.value >= 0) {
      selectedIdx.value = -1
      redraw()
      return
    }
    cancel()
  }
}

function toCanvasCoord(e: PointerEvent): { x: number; y: number } {
  const rect = drawEl.value!.getBoundingClientRect()
  return {
    x: (e.clientX - rect.left) / displayScale.value,
    y: (e.clientY - rect.top) / displayScale.value
  }
}

function onDown(e: PointerEvent) {
  if (e.button !== 0) return
  if (editing.value) return
  const p = toCanvasCoord(e)
  const hit = hitTest(p)
  actionDragged = false
  if (hit >= 0) {
    // 点中已有标注 → 进入"待移动"状态，并把它设为选中
    // 若用户随后没有拖动（只点了一下），就视为单纯选中（在 onUp 里处理）
    const target = items.value[hit]
    if (!target) return  // hit >= 0 时存在，防御一下 noUncheckedIndexedAccess
    selectedIdx.value = hit
    redraw() // 把选中高亮立刻画出来
    beginAction()
    moving = { idx: hit, startPX: p.x, startPY: p.y, orig: clone(target) }
    activeCaptureEl = e.currentTarget as HTMLElement
    activeCapturePid = e.pointerId
    activeCaptureEl.setPointerCapture(activeCapturePid)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return
  }
  // 点空白处：新建动作前先清空选中（避免"选中 A → 在别处新画 B → A 还高亮"）
  if (selectedIdx.value !== -1) {
    selectedIdx.value = -1
    redraw()
  }
  if (mode.value === 'text') {
    beginAction()
    editing.value = { type: 'text', x: p.x, y: p.y, text: '' }
    // v0.7.7 P0：text mode 创建 input 前再偷一次 focus — 防用户在 Annotator 期间
    // 又点过 page 抢回 focus 后才点 canvas（已知 mounted 偷过一次还不够）
    stealPageFocus()
    nextTick(() => textInputEl.value?.focus())
    return
  }
  if (mode.value === 'pointer') {
    // 一次点击直接放置（pointer 不参与色板，形态固定）
    beginAction()
    items.value.push({ type: 'pointer', x: p.x, y: p.y })
    commitAction()
    redraw()
    return
  }
  // rect / circle / arrow / mosaic：拖动绘制
  beginAction()
  drawing = true
  start = p
  const c = currentColor.value
  const w = currentWidth.value
  if (mode.value === 'rect') {
    items.value.push({ type: 'rect', x: p.x, y: p.y, w: 0, h: 0, color: c, width: w })
  } else if (mode.value === 'circle') {
    items.value.push({ type: 'circle', x: p.x, y: p.y, w: 0, h: 0, color: c, width: w })
  } else if (mode.value === 'arrow') {
    items.value.push({ type: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: c, width: w })
  } else if (mode.value === 'mosaic') {
    items.value.push({ type: 'mosaic', x: p.x, y: p.y, w: 0, h: 0, block: mosaicBlock })
  }
  activeCaptureEl = e.currentTarget as HTMLElement
  activeCapturePid = e.pointerId
  activeCaptureEl.setPointerCapture(activeCapturePid)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, { once: true })
}

function onMove(e: PointerEvent) {
  const p = toCanvasCoord(e)
  if (moving) {
    const cur = items.value[moving.idx]
    if (!cur) return  // moving.idx 来自先前 hitTest，理论存在；防御 noUncheckedIndexedAccess
    const orig = moving.orig
    const dx = p.x - moving.startPX
    const dy = p.y - moving.startPY
    // 超过 3px 才算"拖动"——避免微小抖动把单击当成移动
    if (!actionDragged && Math.hypot(dx, dy) > 3) actionDragged = true
    if (cur.type === 'arrow' && orig.type === 'arrow') {
      cur.x1 = orig.x1 + dx
      cur.y1 = orig.y1 + dy
      cur.x2 = orig.x2 + dx
      cur.y2 = orig.y2 + dy
    } else if (cur.type !== 'arrow' && orig.type !== 'arrow') {
      cur.x = orig.x + dx
      cur.y = orig.y + dy
    }
    redraw()
    return
  }
  if (drawing) {
    actionDragged = true
    const last = items.value[items.value.length - 1]
    if (!last) return
    if (last.type === 'rect' || last.type === 'circle' || last.type === 'mosaic') {
      last.w = p.x - start.x
      last.h = p.y - start.y
    } else if (last.type === 'arrow') {
      last.x2 = p.x
      last.y2 = p.y
    }
    redraw()
  }
}

function onUp() {
  detachPointer()
  if (moving) {
    // 没拖动 = 单纯选中（selectedIdx 已在 onDown 设过）；丢弃 pendingSnapshot
    // 拖动了 = 一次有效"移动"动作，commit 进 history
    if (actionDragged) commitAction()
    else discardAction()
    moving = null
    return
  }
  drawing = false
  const last = items.value[items.value.length - 1]
  if (!last) {
    discardAction()
    return
  }
  let popped = false
  if ((last.type === 'rect' || last.type === 'circle' || last.type === 'mosaic') && (Math.abs(last.w) < 4 || Math.abs(last.h) < 4)) {
    items.value.pop()
    popped = true
  } else if (last.type === 'arrow' && Math.hypot(last.x2 - last.x1, last.y2 - last.y1) < 8) {
    items.value.pop()
    popped = true
  }
  if (popped) {
    // 形状太小被丢弃 → 不算一次动作
    discardAction()
    redraw()
  } else {
    commitAction()
  }
}

function onCanvasHover(e: PointerEvent) {
  if (moving || drawing || editing.value) return
  const idx = hitTest(toCanvasCoord(e))
  if (idx !== hoverIdx.value) hoverIdx.value = idx
}

function hitTest(p: { x: number; y: number }): number {
  const ctx = drawEl.value?.getContext('2d')
  if (!ctx) return -1
  ctx.font = textFont
  const hitTol = DEFAULT_LINE_WIDTH + 4
  for (let i = items.value.length - 1; i >= 0; i--) {
    const it = items.value[i]
    if (!it) continue
    if (it.type === 'rect' || it.type === 'circle' || it.type === 'mosaic') {
      const x1 = Math.min(it.x, it.x + it.w)
      const x2 = Math.max(it.x, it.x + it.w)
      const y1 = Math.min(it.y, it.y + it.h)
      const y2 = Math.max(it.y, it.y + it.h)
      if (p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2) return i
    } else if (it.type === 'arrow') {
      if (distToSegment(p, it.x1, it.y1, it.x2, it.y2) <= hitTol) return i
    } else if (it.type === 'pointer') {
      // 指针锚点为 tip (it.x, it.y)，图形向右下延展约 pointerSize
      if (p.x >= it.x - 8 && p.x <= it.x + pointerSize * 0.7 &&
          p.y >= it.y - 8 && p.y <= it.y + pointerSize) return i
    } else {
      const w = ctx.measureText(it.text).width
      const h = textFontPx * 1.2
      if (p.x >= it.x && p.x <= it.x + w && p.y >= it.y && p.y <= it.y + h) return i
    }
  }
  return -1
}

function distToSegment(p: { x: number; y: number }, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - x1, p.y - y1)
  let t = ((p.x - x1) * dx + (p.y - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy))
}

function commitText() {
  if (!editing.value) return
  const text = editing.value.text.trim()
  if (text) {
    items.value.push({ ...editing.value, text, color: currentColor.value })
    commitAction()
  } else {
    // 空文字 = 取消，不进 history
    discardAction()
  }
  editing.value = null
  redraw()
}

function cancelText() {
  discardAction()
  editing.value = null
}

// pointermove 期间 redraw 可能每帧多次被调（move handler + reactive watchers），
// rAF coalesce 到每帧最多 1 次。视觉上感知不出差异，但 100+ 标注时拖拽明显流畅。
let pendingRedraw = false
function redraw() {
  if (pendingRedraw) return
  pendingRedraw = true
  requestAnimationFrame(() => {
    pendingRedraw = false
    redrawNow()
  })
}

function redrawNow() {
  const ctx = drawEl.value?.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvasW.value, canvasH.value)
  for (const it of items.value) {
    if (it.type === 'rect') drawRect(ctx, it)
    else if (it.type === 'circle') drawCircle(ctx, it)
    else if (it.type === 'arrow') drawArrow(ctx, it)
    else if (it.type === 'pointer') drawPointer(ctx, it)
    else if (it.type === 'mosaic') drawMosaic(ctx, it)
    else drawText(ctx, it)
  }
  // 选中态高亮：在选中对象外画一个虚线 bounding box
  const sel = items.value[selectedIdx.value]
  if (selectedIdx.value >= 0 && sel) {
    drawSelectionBox(ctx, sel)
  }
}

function itemBoundingBox(it: Item): { x: number; y: number; w: number; h: number } | null {
  if (it.type === 'rect' || it.type === 'circle' || it.type === 'mosaic') {
    const x = Math.min(it.x, it.x + it.w)
    const y = Math.min(it.y, it.y + it.h)
    return { x, y, w: Math.abs(it.w), h: Math.abs(it.h) }
  }
  if (it.type === 'arrow') {
    const x = Math.min(it.x1, it.x2)
    const y = Math.min(it.y1, it.y2)
    return { x, y, w: Math.abs(it.x2 - it.x1), h: Math.abs(it.y2 - it.y1) }
  }
  if (it.type === 'pointer') {
    return { x: it.x, y: it.y, w: pointerSize * 0.7, h: pointerSize }
  }
  if (it.type === 'text') {
    const ctx = drawEl.value?.getContext('2d')
    if (!ctx) return null
    ctx.font = textFont
    return { x: it.x, y: it.y, w: ctx.measureText(it.text).width, h: textFontPx * 1.2 }
  }
  return null
}

function drawSelectionBox(ctx: CanvasRenderingContext2D, it: Item) {
  const bb = itemBoundingBox(it)
  if (!bb) return
  const pad = 6
  ctx.save()
  ctx.setLineDash([10, 8])
  ctx.lineWidth = 3
  // canvas 像素色，跟主题无关。蓝色刻意区别于标注本身的画笔红/黄/蓝/黑（即使标注本来就是蓝，
  // 虚线 dash 仍能从实线里挑出来）；只画在屏幕，不进 finish 后的 PNG（finish 用 drawEl 重画一次）
  ctx.strokeStyle = '#3b82f6'
  ctx.strokeRect(bb.x - pad, bb.y - pad, bb.w + pad * 2, bb.h + pad * 2)
  ctx.restore()
}

// 复用的临时画布：原本每条 mosaic 每帧 createElement('canvas')，拖拽 30s
// 在 100 标注画布上能 churn 几百个 ImageBitmap backing 给 GC。组件作用域内
// 维持一份单例，每次 resize 到目标小尺寸即可。
let mosaicTmp: HTMLCanvasElement | null = null
let mosaicTmpCtx: CanvasRenderingContext2D | null = null

function drawMosaic(ctx: CanvasRenderingContext2D, it: MosaicItem) {
  if (!bgEl.value) return
  const block = Math.max(4, it.block)
  const x = Math.min(it.x, it.x + it.w)
  const y = Math.min(it.y, it.y + it.h)
  const w = Math.abs(it.w)
  const h = Math.abs(it.h)
  if (w < 4 || h < 4) return
  // 已有标注（包括前面的 mosaic）会被覆盖在原图上面，但马赛克的来源是原图 bgEl，
  // 因此后画的 mosaic 不会马赛克"先前已经画好的红框"——这是预期行为。
  if (!mosaicTmp) {
    mosaicTmp = document.createElement('canvas')
    mosaicTmpCtx = mosaicTmp.getContext('2d')
  }
  const tmp = mosaicTmp
  const tctx = mosaicTmpCtx
  if (!tctx) return
  const sw = Math.max(1, Math.floor(w / block))
  const sh = Math.max(1, Math.floor(h / block))
  // 复用时只在尺寸变化时改 width/height（改尺寸会清空画布）
  if (tmp.width !== sw) tmp.width = sw
  if (tmp.height !== sh) tmp.height = sh
  tctx.imageSmoothingEnabled = true
  // 从背景画布取该区域 → 缩小到 (sw, sh) → 像素化
  tctx.drawImage(bgEl.value, x, y, w, h, 0, 0, sw, sh)
  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h)
  ctx.restore()
}

function drawRect(ctx: CanvasRenderingContext2D, it: RectItem) {
  ctx.lineWidth = it.width ?? DEFAULT_LINE_WIDTH
  ctx.strokeStyle = it.color ?? DEFAULT_COLOR
  ctx.lineJoin = 'round'
  ctx.strokeRect(it.x, it.y, it.w, it.h)
}

function drawCircle(ctx: CanvasRenderingContext2D, it: CircleItem) {
  const cx = it.x + it.w / 2
  const cy = it.y + it.h / 2
  const rx = Math.abs(it.w) / 2
  const ry = Math.abs(it.h) / 2
  if (rx < 0.5 || ry < 0.5) return
  ctx.lineWidth = it.width ?? DEFAULT_LINE_WIDTH
  ctx.strokeStyle = it.color ?? DEFAULT_COLOR
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()
}

function drawArrow(ctx: CanvasRenderingContext2D, it: ArrowItem) {
  const angle = Math.atan2(it.y2 - it.y1, it.x2 - it.x1)
  const lw = it.width ?? DEFAULT_LINE_WIDTH
  const headLen = lw * 3
  const headAngle = Math.PI / 6 // 30°
  const color = it.color ?? DEFAULT_COLOR
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // 主线（在到达 tip 之前略缩短一点，避免和箭头三角叠加变粗）
  const shaftX = it.x2 - Math.cos(angle) * headLen * 0.6
  const shaftY = it.y2 - Math.sin(angle) * headLen * 0.6
  ctx.beginPath()
  ctx.moveTo(it.x1, it.y1)
  ctx.lineTo(shaftX, shaftY)
  ctx.stroke()
  // 箭头三角
  ctx.beginPath()
  ctx.moveTo(it.x2, it.y2)
  ctx.lineTo(
    it.x2 - headLen * Math.cos(angle - headAngle),
    it.y2 - headLen * Math.sin(angle - headAngle)
  )
  ctx.lineTo(
    it.x2 - headLen * Math.cos(angle + headAngle),
    it.y2 - headLen * Math.sin(angle + headAngle)
  )
  ctx.closePath()
  ctx.fill()
}

function drawPointer(ctx: CanvasRenderingContext2D, it: PointerItem) {
  // 经典鼠标指针形状：以 (it.x, it.y) 为 tip
  // 形状点（相对 tip）按 pointerSize 缩放
  const s = pointerSize / 24
  const pts: [number, number][] = [
    [0, 0],
    [0, 18],
    [4.5, 14.5],
    [7.5, 21],
    [10.5, 20],
    [7.5, 13.5],
    [13.5, 13.5]
  ]
  ctx.save()
  ctx.translate(it.x, it.y)
  ctx.scale(s, s)
  // 虚拟鼠标指针：经典「白描边 + 黑填充 + 红色 tip 高亮」配色，跟主题无关
  // 全部是 canvas 像素色，写进最终 PNG，固定字面值
  ctx.beginPath()
  // pts 是函数顶部声明的字面量常量数组，所有元素都是 [number, number]；
  // noUncheckedIndexedAccess 不分析这一点，加 ! 让 TS 闭嘴。
  ctx.moveTo(pts[0]![0], pts[0]![1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1])
  ctx.closePath()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#fff'
  ctx.stroke()
  ctx.fillStyle = '#111'
  ctx.fill()
  // tip 处的小红点高亮，强化"这里"
  ctx.restore()
  ctx.beginPath()
  ctx.arc(it.x, it.y, DEFAULT_LINE_WIDTH * 0.6, 0, Math.PI * 2)
  ctx.fillStyle = '#ff3b30'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#fff'
  ctx.stroke()
}

function drawText(ctx: CanvasRenderingContext2D, it: TextItem) {
  ctx.font = textFont
  ctx.textBaseline = 'top'
  ctx.lineWidth = 6
  // 文字描边白色：硬编码 canvas 像素值，让画笔色无论选哪个都能在截图上读得清
  ctx.strokeStyle = '#fff'
  ctx.strokeText(it.text, it.x, it.y)
  ctx.fillStyle = it.color ?? DEFAULT_COLOR
  ctx.fillText(it.text, it.x, it.y)
}

function undo() {
  if (!past.value.length) return
  future.value.push(clone(items.value))
  items.value = past.value.pop()!
  // 选中索引可能指向已不存在的项目，重置
  if (selectedIdx.value >= items.value.length) selectedIdx.value = -1
  redraw()
}

function redo() {
  if (!future.value.length) return
  past.value.push(clone(items.value))
  items.value = future.value.pop()!
  if (selectedIdx.value >= items.value.length) selectedIdx.value = -1
  redraw()
}

function deleteSelected() {
  const idx = selectedIdx.value
  if (idx < 0 || idx >= items.value.length) return
  beginAction()
  items.value.splice(idx, 1)
  selectedIdx.value = -1
  commitAction()
  redraw()
}

/** 复制粘贴：模块内存级 clipboard（不接 navigator.clipboard，因为我们存 Item 对象不是字符串） */
let annoClipboard: Item | null = null
function copySelected() {
  const it = items.value[selectedIdx.value]
  if (!it) return
  annoClipboard = clone(it)
}
function pasteFromClipboard() {
  if (!annoClipboard) return
  beginAction()
  const it = clone(annoClipboard)
  const OFFSET = 20
  if (it.type === 'arrow') {
    it.x1 += OFFSET; it.y1 += OFFSET; it.x2 += OFFSET; it.y2 += OFFSET
  } else {
    it.x += OFFSET; it.y += OFFSET
  }
  items.value.push(it)
  selectedIdx.value = items.value.length - 1
  commitAction()
  redraw()
}

/**
 * 方向键微移选中对象（dx/dy 是画布坐标，不是屏幕坐标）。
 * 连续按方向键时，多次小位移合并为**单次** history action，避免按 10 下方向键就要撤销 10 次。
 * 实现：500ms 内的连续 nudge 只在第一次 beginAction，之后追加位移，500ms 无操作后才 commit。
 */
let nudgeCommitTimer: number | undefined
let nudgePending = false
function nudgeSelected(dx: number, dy: number) {
  const idx = selectedIdx.value
  if (idx < 0 || idx >= items.value.length) return
  const it = items.value[idx]
  if (!it) return
  if (!nudgePending) {
    beginAction()
    nudgePending = true
  }
  if (it.type === 'arrow') {
    it.x1 += dx; it.y1 += dy; it.x2 += dx; it.y2 += dy
  } else {
    it.x += dx; it.y += dy
  }
  redraw()
  // 500ms 内继续按方向键 → 同一次动作；停手 500ms 后才 commit
  if (nudgeCommitTimer) clearTimeout(nudgeCommitTimer)
  nudgeCommitTimer = window.setTimeout(() => {
    if (nudgePending) {
      commitAction()
      nudgePending = false
    }
    nudgeCommitTimer = undefined
  }, 500)
}

function clearAll() {
  if (!items.value.length) return
  beginAction()
  items.value = []
  selectedIdx.value = -1
  commitAction()
  redraw()
}

const cancelGuard = ref(false)
// focus-trap + ESC = cancel + mask click = cancel 全部收口到 MooAlert 内部

function cancel() {
  // 已有标注时弹二次确认避免误退；空画布直接走
  if (items.value.length > 0 && !cancelGuard.value) {
    cancelGuard.value = true
    return
  }
  doCancel()
}

function doCancel() {
  cancelGuard.value = false
  window.removeEventListener('keydown', onKey)
  // 拖拽中按 Esc → cancel 时如果 pointer capture 还在身上，必须释放
  detachPointer()
  emit('cancel')
}

function dismissCancelGuard() {
  cancelGuard.value = false
}

function finish() {
  if (editing.value) commitText()
  window.removeEventListener('keydown', onKey)
  const out = document.createElement('canvas')
  out.width = canvasW.value
  out.height = canvasH.value
  const ctx = out.getContext('2d')!
  ctx.drawImage(bgEl.value!, 0, 0)
  ctx.drawImage(drawEl.value!, 0, 0)
  emit('finish', out.toDataURL('image/png'))
}
</script>
