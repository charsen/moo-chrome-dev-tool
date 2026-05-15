<template>
  <div class="moo-ball-wrap" :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
    <!-- 多匹配场景：先让用户选项目 -->
    <div v-if="expanded && !dragging && phase === 'picker'" class="moo-ball-menu moo-ball-picker">
      <div class="moo-ball-picker-hd">当前页面匹配到多个项目</div>
      <button
        v-for="p in matches"
        :key="p.id"
        class="moo-ball-action moo-ball-picker-row"
        @click="onPickProject(p.id)"
      >
        <span class="ic">📁</span>
        <span class="lab">{{ p.name || '(未命名)' }}</span>
      </button>
    </div>

    <!-- 展开菜单（已选定项目后） -->
    <div v-else-if="expanded && !dragging" class="moo-ball-menu">
      <div v-if="matches.length > 1" class="moo-ball-active-hd">
        <span class="ic">📁</span>
        <span class="lab">{{ activeProjectName }}</span>
        <button class="moo-ball-switch" @click="onBackToPicker" title="切换项目">切换</button>
      </div>
      <button class="moo-ball-action" @click="onPickCapture">
        <span class="ic">📷</span>
        <span class="lab">截图</span>
      </button>
      <button class="moo-ball-action" @click="onPickRecord" title="Chrome 限制：录屏必须由快捷键触发">
        <span class="ic">🎥</span>
        <span class="lab">录屏 ⌥⇧R</span>
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
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import type { Project } from '@/types/config'

const eagleUrl = chrome.runtime.getURL('icons/eagle-ball.png')

const props = defineProps<{
  tip: string
  hidden: boolean
  /** 当前页面匹配到的所有项目（1 个直接用，多个需要让用户先选） */
  matches: Project[]
}>()
const emit = defineEmits<{
  /** 用户在多匹配场景下选了项目（单匹配时也会自动 emit 一次以同步给父组件） */
  (e: 'select-project', projectId: string): void
  (e: 'capture'): void
  (e: 'record'): void
}>()

type Phase = 'picker' | 'menu'

const POS_KEY = 'moo-ball-pos'
const pos = ref({ x: window.innerWidth - 70, y: window.innerHeight - 70 })
const dragging = ref(false)
const expanded = ref(false)
const phase = ref<Phase>('menu')
const activeProjectId = ref<string>('')
const activeProjectName = computed(
  () => props.matches.find((p) => p.id === activeProjectId.value)?.name || '(未命名)'
)
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
  if (expanded.value) {
    expanded.value = false
    return
  }
  expanded.value = true
  // 每次展开都重置项目选择：1 个匹配自动确认，多个匹配强制让用户选
  if (props.matches.length <= 1) {
    activeProjectId.value = props.matches[0]?.id ?? ''
    if (activeProjectId.value) emit('select-project', activeProjectId.value)
    phase.value = 'menu'
  } else {
    activeProjectId.value = ''
    phase.value = 'picker'
  }
}

function onPickProject(id: string) {
  activeProjectId.value = id
  emit('select-project', id)
  phase.value = 'menu'
}

function onBackToPicker() {
  phase.value = 'picker'
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
