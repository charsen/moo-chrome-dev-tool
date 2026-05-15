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
          placeholder="输入文字 → ✓ 确认 / ✕ 取消"
        />
        <button class="moo-text-btn ok" @click="commitText" title="确认 (Enter)">✓</button>
        <button class="moo-text-btn cancel" @click="cancelText" title="取消 (Esc)">✕</button>
      </div>
    </div>
    <div class="moo-toolbar moo-toolbar--stacked">
      <div class="toolbar-row tools-row">
        <button :class="['tool', { active: mode === 'rect' }]" @click="mode = 'rect'" title="矩形">▭<span>矩形</span></button>
        <button :class="['tool', { active: mode === 'circle' }]" @click="mode = 'circle'" title="圆形">◯<span>圆形</span></button>
        <button :class="['tool', { active: mode === 'arrow' }]" @click="mode = 'arrow'" title="箭头">↗<span>箭头</span></button>
        <button :class="['tool', { active: mode === 'pointer' }]" @click="mode = 'pointer'" title="指针">➤<span>指针</span></button>
        <button :class="['tool', { active: mode === 'text' }]" @click="mode = 'text'" title="文字">T<span>文字</span></button>
        <button :class="['tool', { active: mode === 'mosaic' }]" @click="mode = 'mosaic'" title="马赛克">▓<span>马赛克</span></button>
      </div>
      <div class="toolbar-row action-row">
        <span class="hint">{{ modeHint }}</span>
        <div class="actions-right">
          <button @click="undo" :disabled="!items.length">撤销</button>
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

const props = defineProps<{ image: string }>()
const emit = defineEmits<{
  (e: 'finish', dataUrl: string): void
  (e: 'cancel'): void
}>()

const bgEl = ref<HTMLCanvasElement>()
const drawEl = ref<HTMLCanvasElement>()
const wrapEl = ref<HTMLDivElement>()
const textInputEl = ref<HTMLInputElement>()

const canvasW = ref(0)
const canvasH = ref(0)
const displayScale = ref(1)

type RectItem = { type: 'rect'; x: number; y: number; w: number; h: number }
type CircleItem = { type: 'circle'; x: number; y: number; w: number; h: number }
type ArrowItem = { type: 'arrow'; x1: number; y1: number; x2: number; y2: number }
type PointerItem = { type: 'pointer'; x: number; y: number } // 锚点为指针 tip
type TextItem = { type: 'text'; x: number; y: number; text: string }
type MosaicItem = { type: 'mosaic'; x: number; y: number; w: number; h: number; block: number }
type Item = RectItem | CircleItem | ArrowItem | PointerItem | TextItem | MosaicItem
type Mode = 'rect' | 'circle' | 'arrow' | 'pointer' | 'text' | 'mosaic'

const items = ref<Item[]>([])
const mode = ref<Mode>('rect')
const editing = ref<TextItem | null>(null)

// 视觉常量（基于原图分辨率）
const lineWidth = 12
const textFontPx = 48
const textFont = `700 ${textFontPx}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
const pointerSize = 80 // 虚拟指针图形高度（px）
const mosaicBlock = 14 // 马赛克像素块大小（按原图坐标）

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

onMounted(async () => {
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
  img.src = props.image
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointermove', onMove)
})

function onKey(e: KeyboardEvent) {
  if (editing.value) return
  if (e.key === 'Escape') cancel()
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
  if (hit >= 0) {
    moving = { idx: hit, startPX: p.x, startPY: p.y, orig: clone(items.value[hit]) }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return
  }
  if (mode.value === 'text') {
    editing.value = { type: 'text', x: p.x, y: p.y, text: '' }
    nextTick(() => textInputEl.value?.focus())
    return
  }
  if (mode.value === 'pointer') {
    // 一次点击直接放置
    items.value.push({ type: 'pointer', x: p.x, y: p.y })
    redraw()
    return
  }
  // rect / circle / arrow / mosaic：拖动绘制
  drawing = true
  start = p
  if (mode.value === 'rect') {
    items.value.push({ type: 'rect', x: p.x, y: p.y, w: 0, h: 0 })
  } else if (mode.value === 'circle') {
    items.value.push({ type: 'circle', x: p.x, y: p.y, w: 0, h: 0 })
  } else if (mode.value === 'arrow') {
    items.value.push({ type: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y })
  } else if (mode.value === 'mosaic') {
    items.value.push({ type: 'mosaic', x: p.x, y: p.y, w: 0, h: 0, block: mosaicBlock })
  }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, { once: true })
}

function onMove(e: PointerEvent) {
  const p = toCanvasCoord(e)
  if (moving) {
    const cur = items.value[moving.idx]
    const orig = moving.orig
    const dx = p.x - moving.startPX
    const dy = p.y - moving.startPY
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
  window.removeEventListener('pointermove', onMove)
  if (moving) {
    moving = null
    return
  }
  drawing = false
  const last = items.value[items.value.length - 1]
  if (!last) return
  if ((last.type === 'rect' || last.type === 'circle' || last.type === 'mosaic') && (Math.abs(last.w) < 4 || Math.abs(last.h) < 4)) {
    items.value.pop()
    redraw()
  } else if (last.type === 'arrow' && Math.hypot(last.x2 - last.x1, last.y2 - last.y1) < 8) {
    items.value.pop()
    redraw()
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
  const hitTol = lineWidth + 4
  for (let i = items.value.length - 1; i >= 0; i--) {
    const it = items.value[i]
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

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function commitText() {
  if (!editing.value) return
  const text = editing.value.text.trim()
  if (text) items.value.push({ ...editing.value, text })
  editing.value = null
  redraw()
}

function cancelText() {
  editing.value = null
}

function redraw() {
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
}

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
  const tmp = document.createElement('canvas')
  const sw = Math.max(1, Math.floor(w / block))
  const sh = Math.max(1, Math.floor(h / block))
  tmp.width = sw
  tmp.height = sh
  const tctx = tmp.getContext('2d')
  if (!tctx) return
  tctx.imageSmoothingEnabled = true
  // 从背景画布取该区域 → 缩小到 (sw, sh) → 像素化
  tctx.drawImage(bgEl.value, x, y, w, h, 0, 0, sw, sh)
  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h)
  ctx.restore()
}

function drawRect(ctx: CanvasRenderingContext2D, it: RectItem) {
  ctx.lineWidth = lineWidth
  ctx.strokeStyle = '#ff3b30'
  ctx.lineJoin = 'round'
  ctx.strokeRect(it.x, it.y, it.w, it.h)
}

function drawCircle(ctx: CanvasRenderingContext2D, it: CircleItem) {
  const cx = it.x + it.w / 2
  const cy = it.y + it.h / 2
  const rx = Math.abs(it.w) / 2
  const ry = Math.abs(it.h) / 2
  if (rx < 0.5 || ry < 0.5) return
  ctx.lineWidth = lineWidth
  ctx.strokeStyle = '#ff3b30'
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()
}

function drawArrow(ctx: CanvasRenderingContext2D, it: ArrowItem) {
  const angle = Math.atan2(it.y2 - it.y1, it.x2 - it.x1)
  const headLen = lineWidth * 3
  const headAngle = Math.PI / 6 // 30°
  ctx.strokeStyle = '#ff3b30'
  ctx.fillStyle = '#ff3b30'
  ctx.lineWidth = lineWidth
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
  // 白色外圈描边 + 黑色填充，叠加红色高光
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.closePath()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#fff'
  ctx.stroke()
  ctx.fillStyle = '#111'
  ctx.fill()
  // tip 处的小红点高亮，强化"这里"
  ctx.restore()
  ctx.beginPath()
  ctx.arc(it.x, it.y, lineWidth * 0.6, 0, Math.PI * 2)
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
  ctx.strokeStyle = '#fff'
  ctx.strokeText(it.text, it.x, it.y)
  ctx.fillStyle = '#ff3b30'
  ctx.fillText(it.text, it.x, it.y)
}

function undo() {
  items.value.pop()
  redraw()
}

function clearAll() {
  items.value = []
  redraw()
}

function cancel() {
  window.removeEventListener('keydown', onKey)
  emit('cancel')
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
