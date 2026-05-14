<template>
  <div
    :class="['moo-ball', { dragging, hidden }]"
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    @pointerdown="onDown"
    @click="onClick"
  >
    <img :src="eagleUrl" class="moo-ball-icon" alt="Moo" draggable="false" />
    <span class="moo-ball-tip">{{ tip }}</span>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'

const eagleUrl = chrome.runtime.getURL('icons/eagle-ball.png')

const props = defineProps<{ tip: string; hidden: boolean }>()
const emit = defineEmits<{ (e: 'capture'): void }>()

const POS_KEY = 'moo-ball-pos'
const pos = ref({ x: window.innerWidth - 70, y: window.innerHeight - 70 })
const dragging = ref(false)
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
  emit('capture')
}

function onResize() {
  pos.value = {
    x: Math.min(pos.value.x, window.innerWidth - 48),
    y: Math.min(pos.value.y, window.innerHeight - 48)
  }
}

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))
</script>
