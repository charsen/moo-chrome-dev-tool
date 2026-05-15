<template>
  <div class="moo-ball-wrap" :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
    <!-- 展开菜单 -->
    <div v-if="expanded && !dragging" class="moo-ball-menu">
      <button class="moo-ball-action" @click="onPickCapture">
        <span class="ic">📷</span>
        <span class="lab">截图</span>
      </button>
      <button class="moo-ball-action" @click="onPickRecord">
        <span class="ic">🎥</span>
        <span class="lab">录屏</span>
      </button>
    </div>

    <div
      :class="['moo-ball', { dragging, hidden, expanded }]"
      @pointerdown="onDown"
      @click="onClick"
    >
      <img :src="eagleUrl" class="moo-ball-icon" alt="Moo" draggable="false" />
      <span v-if="!expanded" class="moo-ball-tip">{{ tip }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'

const eagleUrl = chrome.runtime.getURL('icons/eagle-ball.png')

defineProps<{ tip: string; hidden: boolean }>()
const emit = defineEmits<{
  (e: 'capture'): void
  (e: 'record'): void
}>()

const POS_KEY = 'moo-ball-pos'
const pos = ref({ x: window.innerWidth - 70, y: window.innerHeight - 70 })
const dragging = ref(false)
const expanded = ref(false)
let downAt = { x: 0, y: 0 }
let originPos = { x: 0, y: 0 }
let moved = false

try {
  const saved = localStorage.getItem(POS_KEY)
  if (saved) {
    const obj = JSON.parse(saved)
    if (typeof obj.x === 'number' && typeof obj.y === 'number') pos.value = obj
  }
} catch {}

function onDown(e: PointerEvent) {
  if (e.button !== 0) return
  downAt = { x: e.clientX, y: e.clientY }
  originPos = { ...pos.value }
  moved = false
  dragging.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, { once: true })
}

function onMove(e: PointerEvent) {
  const dx = e.clientX - downAt.x
  const dy = e.clientY - downAt.y
  if (!moved && Math.hypot(dx, dy) > 4) moved = true
  if (moved) {
    pos.value = {
      x: Math.max(0, Math.min(window.innerWidth - 48, originPos.x + dx)),
      y: Math.max(0, Math.min(window.innerHeight - 48, originPos.y + dy))
    }
  }
}

function onUp() {
  dragging.value = false
  window.removeEventListener('pointermove', onMove)
  if (moved) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos.value)) } catch {}
  }
}

function onClick() {
  if (moved) return
  expanded.value = !expanded.value
}

function onPickCapture() {
  expanded.value = false
  emit('capture')
}
function onPickRecord() {
  expanded.value = false
  emit('record')
}

function onDocClick(e: MouseEvent) {
  if (!expanded.value) return
  // 点到悬浮球或菜单都忽略
  const target = e.target as Element
  if (target.closest && target.closest('.moo-ball-wrap')) return
  expanded.value = false
}

function onResize() {
  pos.value = {
    x: Math.min(pos.value.x, window.innerWidth - 48),
    y: Math.min(pos.value.y, window.innerHeight - 48)
  }
}

onMounted(() => {
  window.addEventListener('resize', onResize)
  document.addEventListener('click', onDocClick, true)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  document.removeEventListener('click', onDocClick, true)
})
</script>
