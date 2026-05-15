<template>
  <div class="moo-ball-wrap" :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
    <!-- 项目选择器：多匹配且未选 active 时；选完自动触发 pendingAction -->
    <div v-if="phase === 'picker' && !dragging" class="moo-ball-menu moo-ball-picker">
      <div class="moo-ball-picker-hd">
        当前页面匹配到 {{ matches.length }} 个项目
        <span v-if="pendingAction" class="moo-ball-picker-pending">
          · 选完自动{{ pendingAction === 'capture' ? '截图' : '录屏' }}
        </span>
      </div>
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

    <!-- 三按钮常驻：M（拖动 / 项目入口） + 截图 + 录屏 -->
    <div :class="['moo-ball-row', { dragging, hidden }]" @pointerdown="onDown">
      <button
        class="moo-ball-btn moo-ball-btn--logo"
        :title="logoTitle"
        @click.stop="onLogoClick"
      >
        <img :src="eagleUrl" class="moo-ball-icon" alt="Moo" draggable="false" />
      </button>
      <button
        class="moo-ball-btn"
        title="截图"
        @click.stop="onTriggerCapture"
      >
        <span class="ic">📷</span>
      </button>
      <button
        class="moo-ball-btn"
        title="录屏（按 ⌥⇧R 开始，Chrome 限制录屏必须由快捷键触发）"
        @click.stop="onTriggerRecord"
      >
        <span class="ic">🎥</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import type { Project } from '@/types/config'

const eagleUrl = chrome.runtime.getURL('icons/eagle-ball.png')

const props = defineProps<{
  hidden: boolean
  /** 当前页面匹配到的所有项目；多个时 logo 点开可重选 */
  matches: Project[]
}>()
const emit = defineEmits<{
  /** 选中 active 项目（单匹配时进入即 emit；多匹配选完 picker emit） */
  (e: 'select-project', projectId: string): void
  (e: 'capture'): void
  (e: 'record'): void
}>()

type Phase = 'menu' | 'picker'
type PendingAction = 'capture' | 'record' | null

const POS_KEY = 'moo-ball-pos'
const pos = ref({ x: window.innerWidth - 200, y: window.innerHeight - 70 })
const dragging = ref(false)
const phase = ref<Phase>('menu')
/** 会话内记住已选项目，避免每次点 📷/🎥 都被 picker 打断 */
const activeProjectId = ref<string>('')
/** 多匹配且未选时点 📷/🎥 暂存这个动作，选完 picker 后自动继续 */
const pendingAction = ref<PendingAction>(null)

const activeProjectName = computed(
  () => props.matches.find((p) => p.id === activeProjectId.value)?.name || ''
)
const logoTitle = computed(() => {
  if (props.matches.length > 1) {
    const cur = activeProjectName.value || '(未选)'
    return `Moo · ${cur} · 点这里切换项目`
  }
  return `Moo · ${activeProjectName.value} · 按住拖动`
})

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

/** 单匹配时进入页面就自动选定；多匹配则等用户点 picker */
function autoPickIfSingle() {
  if (props.matches.length === 1) {
    const only = props.matches[0]
    if (activeProjectId.value !== only.id) {
      activeProjectId.value = only.id
      emit('select-project', only.id)
    }
  }
}

onMounted(() => {
  autoPickIfSingle()
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
})

function onDown(e: PointerEvent) {
  if (e.button !== 0) return
  downAt = { x: e.clientX, y: e.clientY }
  originPos = { ...pos.value }
  moved = false
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, { once: true })
}

function onMove(e: PointerEvent) {
  const dx = e.clientX - downAt.x
  const dy = e.clientY - downAt.y
  if (!moved && Math.hypot(dx, dy) > 4) {
    moved = true
    dragging.value = true
  }
  if (moved) {
    pos.value = {
      x: Math.max(0, Math.min(window.innerWidth - 160, originPos.x + dx)),
      y: Math.max(0, Math.min(window.innerHeight - 48, originPos.y + dy))
    }
  }
}

function onUp() {
  window.removeEventListener('pointermove', onMove)
  if (moved) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos.value)) } catch {}
  }
  // dragging 在 next tick 才置回 false，让 click handler 通过 moved 标志早退
  setTimeout(() => { dragging.value = false }, 0)
}

/**
 * 确保 active 项目已选；多匹配未选时进入 picker 暂存动作，picker 选完后回调。
 * 返回 true 表示动作可以立即执行；false 表示已进入 picker，等 onPickProject。
 */
function ensureActive(action: PendingAction): boolean {
  if (activeProjectId.value && props.matches.some((p) => p.id === activeProjectId.value)) {
    return true
  }
  if (props.matches.length === 1) {
    activeProjectId.value = props.matches[0].id
    emit('select-project', props.matches[0].id)
    return true
  }
  // 多匹配且未选：进 picker，记下用户要做什么
  pendingAction.value = action
  phase.value = 'picker'
  return false
}

function onLogoClick() {
  if (moved) return
  if (props.matches.length <= 1) return // 单匹配点 logo 无操作（拖动手柄）
  // 多匹配：进入 picker 让用户重选
  pendingAction.value = null  // 重选不带后续动作
  phase.value = 'picker'
}

function onTriggerCapture() {
  if (moved) return
  if (!ensureActive('capture')) return
  emit('capture')
}

function onTriggerRecord() {
  if (moved) return
  if (!ensureActive('record')) return
  emit('record')
}

function onPickProject(id: string) {
  activeProjectId.value = id
  emit('select-project', id)
  phase.value = 'menu'
  const action = pendingAction.value
  pendingAction.value = null
  if (action === 'capture') emit('capture')
  else if (action === 'record') emit('record')
}

function onResize() {
  pos.value = {
    x: Math.min(pos.value.x, window.innerWidth - 160),
    y: Math.min(pos.value.y, window.innerHeight - 48)
  }
}
</script>
