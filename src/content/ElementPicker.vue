<template>
  <div class="moo-picker" @click.stop>
    <!-- 高亮目标的虚线框 -->
    <div v-if="hoverRect" class="picker-hover" :style="hoverStyle" />

    <!-- 顶部提示栏 -->
    <div class="picker-tip">
      <span class="picker-tip-icon">⊕</span>
      <span>点击选中元素 · ESC 取消</span>
      <span v-if="hoverSelector" class="picker-tip-sel">{{ truncate(hoverSelector, 80) }}</span>
    </div>

    <!-- 拦截 hover / click 的透明覆层 -->
    <div
      ref="overlayEl"
      class="picker-overlay"
      @mousemove="onMove"
      @click="onClick"
      @contextmenu.prevent="onCancel"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export interface PickedElement {
  selector: string
  tag: string
  id: string | null
  classes: string[]
  text: string
  rect: { x: number; y: number; w: number; h: number }
  attributes: Record<string, string>
  outerHtml: string
  path: string[]
}

const emit = defineEmits<{
  (e: 'pick', el: PickedElement): void
  (e: 'cancel'): void
}>()

const overlayEl = ref<HTMLDivElement>()
const hoverRect = ref<DOMRect | null>(null)
const hoverSelector = ref('')
let currentEl: Element | null = null

const hoverStyle = computed(() => {
  if (!hoverRect.value) return {}
  return {
    left: hoverRect.value.left + 'px',
    top: hoverRect.value.top + 'px',
    width: hoverRect.value.width + 'px',
    height: hoverRect.value.height + 'px'
  }
})

onMounted(() => {
  document.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey, true)
})

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    onCancel()
  }
}

function onMove(e: MouseEvent) {
  // 隐藏 overlay 自身，去拿真实命中元素
  if (!overlayEl.value) return
  overlayEl.value.style.pointerEvents = 'none'
  const target = document.elementFromPoint(e.clientX, e.clientY) as Element | null
  overlayEl.value.style.pointerEvents = ''
  if (!target || target === currentEl) return
  // 忽略我们自己注入的 shadow host
  if (target.tagName === 'MOO-DEV-TOOL-ROOT' || target.id === '__moo_root__') return
  currentEl = target
  hoverRect.value = target.getBoundingClientRect()
  hoverSelector.value = uniqueSelector(target)
}

function onClick(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (!currentEl) return
  emit('pick', describe(currentEl))
}

function onCancel() {
  emit('cancel')
}

// ============================================================
// selector 生成
// ============================================================
function uniqueSelector(el: Element): string {
  // 优先：id > [data-testid] > tag.classes:nth-of-type 链
  if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) return `#${el.id}`
  const testid = el.getAttribute('data-testid')
  if (testid) return `[data-testid="${cssEsc(testid)}"]`

  const parts: string[] = []
  let cur: Element | null = el
  let depth = 0
  while (cur && cur.nodeType === 1 && cur !== document.documentElement && depth < 6) {
    let part = cur.tagName.toLowerCase()
    if (cur.id && /^[a-zA-Z][\w-]*$/.test(cur.id)) {
      part = `#${cur.id}`
      parts.unshift(part)
      break
    }
    const cls = (cur.className && typeof cur.className === 'string')
      ? cur.className.split(/\s+/).filter((c) => c && !/[^a-zA-Z0-9_-]/.test(c) && c.length < 32).slice(0, 2)
      : []
    if (cls.length) part += '.' + cls.join('.')
    // 加 nth-of-type 防止重复
    if (cur.parentElement) {
      const siblings = Array.from(cur.parentElement.children).filter((s) => s.tagName === cur!.tagName)
      if (siblings.length > 1) {
        const idx = siblings.indexOf(cur) + 1
        part += `:nth-of-type(${idx})`
      }
    }
    parts.unshift(part)
    cur = cur.parentElement
    depth++
  }
  return parts.join(' > ')
}

function cssEsc(s: string): string {
  return s.replace(/(["\\])/g, '\\$1')
}

function describe(el: Element): PickedElement {
  const rect = el.getBoundingClientRect()
  const attrs: Record<string, string> = {}
  for (const a of Array.from(el.attributes)) {
    // 跳过冗长的 style / inline event
    if (a.name === 'style' || a.name.startsWith('on')) continue
    attrs[a.name] = a.value.length > 200 ? a.value.slice(0, 200) + '…' : a.value
  }
  const path: string[] = []
  let cur: Element | null = el
  while (cur && cur.nodeType === 1 && cur !== document.documentElement && path.length < 8) {
    let part = cur.tagName.toLowerCase()
    if (cur.id) part += `#${cur.id}`
    else if (cur.className && typeof cur.className === 'string') {
      const c = cur.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
      if (c) part += '.' + c
    }
    path.unshift(part)
    cur = cur.parentElement
  }
  return {
    selector: uniqueSelector(el),
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: (el.className && typeof el.className === 'string')
      ? el.className.split(/\s+/).filter(Boolean)
      : [],
    text: (el.textContent ?? '').trim().slice(0, 200),
    rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
    attributes: attrs,
    outerHtml: (el as HTMLElement).outerHTML.slice(0, 800),
    path
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
</script>
