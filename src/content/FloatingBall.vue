<template>
  <div class="moo-ball-wrap" :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
    <!-- 项目选择器：多匹配且未选 active 时；选完自动触发 pendingAction
         注意：state !== 'idle'（录制 / 提交中）时 hidden=true，此时 picker 也必须
         一起藏起来。否则用户在 SubmitDialog 打开时仍可切项目 → 已挂的 dialog
         的 serverId / selectedIds 全 stale，提交时取的还是旧数据。 -->
    <div v-if="phase === 'picker' && !dragging && !hidden" class="moo-ball-menu moo-ball-picker">
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
        <span class="lab-stack">
          <span class="lab">{{ p.name || '(未命名)' }}</span>
          <span class="lab-sub" :title="p.matchPatterns.join(', ')">
            {{ p.matchPatterns.length ? p.matchPatterns.join(' · ') : '(无 URL 规则)' }}
          </span>
        </span>
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
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
          <circle cx="12" cy="13" r="3" />
        </svg>
      </button>
      <button
        class="moo-ball-btn moo-ball-btn--with-kbd"
        title="录屏快捷键：⌥⇧R / Alt+Shift+R（Chrome MV3 限制录屏必须由快捷键触发）"
        @click.stop="onTriggerRecord"
      >
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m22 8-6 4 6 4V8Z" />
          <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
        </svg>
        <span class="kbd-tag" aria-hidden="true">⌥⇧R</span>
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

/** 估算的悬浮球尺寸（实际 156×46，留一点 safety margin 给 hover 阴影） */
const BALL_W = 170
const BALL_H = 56
const MARGIN = 16

let hasSavedPos = false
try {
  const saved = localStorage.getItem(POS_KEY)
  if (saved) {
    const obj = JSON.parse(saved)
    if (typeof obj.x === 'number' && typeof obj.y === 'number') {
      pos.value = obj
      hasSavedPos = true
    }
  }
} catch {}

/**
 * 检测候选位置是否被宿主页面的 fixed/sticky 元素遮挡。
 * 用 elementsFromPoint 采样 5 个点（4 角 + 中心），比起遍历 querySelectorAll('*')
 * + getComputedStyle 在大页面上快一个数量级。
 */
function isBlockedByFixed(x: number, y: number): boolean {
  const points: [number, number][] = [
    [x + 4, y + 4],
    [x + BALL_W - 4, y + 4],
    [x + 4, y + BALL_H - 4],
    [x + BALL_W - 4, y + BALL_H - 4],
    [x + BALL_W / 2, y + BALL_H / 2]
  ]
  for (const [px, py] of points) {
    if (px < 0 || py < 0 || px >= window.innerWidth || py >= window.innerHeight) continue
    const els = document.elementsFromPoint(px, py)
    for (const el of els) {
      if (el === document.documentElement || el === document.body) continue
      // 注意：自己的 shadow host 也会出现在这里，跳过它本身
      if (el.id === '__moo_dev_tool_host__') continue
      const cs = window.getComputedStyle(el)
      if (cs.position === 'fixed' || cs.position === 'sticky') return true
    }
  }
  return false
}

/** 默认位置候选：从右下开始，按"用户最不可能放真东西"的顺序回退 */
function pickGoodDefaultPos(): { x: number; y: number } {
  const W = window.innerWidth
  const H = window.innerHeight
  const candidates: { x: number; y: number }[] = [
    { x: W - BALL_W - MARGIN, y: H - BALL_H - MARGIN }, // 右下（首选）
    { x: MARGIN,              y: H - BALL_H - MARGIN }, // 左下
    { x: W - BALL_W - MARGIN, y: MARGIN              }, // 右上
    { x: MARGIN,              y: MARGIN              }, // 左上
    { x: W - BALL_W - MARGIN, y: Math.round(H / 2)    } // 中右
  ]
  for (const c of candidates) {
    if (!isBlockedByFixed(c.x, c.y)) return c
  }
  return candidates[0]! // 全冲突也只能退回右下；candidates 是字面量 4 元素数组
}

/** 单匹配时进入页面就自动选定；多匹配则等用户点 picker */
function autoPickIfSingle() {
  if (props.matches.length === 1) {
    const only = props.matches[0]
    if (only && activeProjectId.value !== only.id) {
      activeProjectId.value = only.id
      emit('select-project', only.id)
    }
  }
}

onMounted(() => {
  // 没有用户保存过的位置时，按宿主页 fixed/sticky 元素挑一个不冲突的角落
  if (!hasSavedPos) {
    pos.value = pickGoodDefaultPos()
  }
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
  // 不调 setPointerCapture(row)：会把 pointerup 强行送到 row 上，
  // 子按钮的 click 事件就不再派发（down 在 button、up 在 row，target 不一致）。
  // window 监听 pointermove/up 已经能捕获到指针移到 row 外的情况，足够拖动用。
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
      x: Math.max(0, Math.min(window.innerWidth - 130, originPos.x + dx)),
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
  const only = props.matches[0]
  if (props.matches.length === 1 && only) {
    activeProjectId.value = only.id
    emit('select-project', only.id)
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
    x: Math.min(pos.value.x, window.innerWidth - 130),
    y: Math.min(pos.value.y, window.innerHeight - 48)
  }
}
</script>
