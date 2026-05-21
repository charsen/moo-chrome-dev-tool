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
    <div ref="rowEl" :class="['moo-ball-row', { dragging, hidden }]" @pointerdown="onDown">
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
const rowEl = ref<HTMLDivElement>()
/** drag 时 setPointerCapture 用的 pointerId，记下来好在 endDrag 里 release */
let activePointerId: number | null = null
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
/**
 * 拖动结束的时间戳（performance.now()）。click handler 用「Date.now() - dragEndedAt < 250」
 * 拦截 drag 后浏览器合成的 click —— 不再依赖 moved flag 跨 pointer 周期残留。
 *
 * 原本 `if (moved) return` 的拦截方式有副作用：moved 在 onDown 才 reset，CDP 等自动化
 * 工具的合成 click 不发 pointerdown → moved 卡在上一次 drag 的 true → 截图按钮永远点不动。
 * 改成时间戳后：真 drag 合成 click 仍被拦（< 250ms），但 250ms 之外（含 CDP 合成 click）
 * 可通过，自动化 e2e 能正常驱动悬浮球。
 */
let dragEndedAt = 0

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
  } else {
    // hasSavedPos 路径：localStorage 存的位置可能是上次窗口更大时存的，
    // 当前视口缩小后这个 x/y 可能直接在屏幕外（用户看不到悬浮球但状态正常）。
    // 用真实 BALL_W/BALL_H clamp 兜底（之前误写 130/48 是 rec-bar 尺寸，
    // 实际悬浮球宽 170px，会被切右边 40px）。
    pos.value = {
      x: Math.max(0, Math.min(window.innerWidth - BALL_W, pos.value.x)),
      y: Math.max(0, Math.min(window.innerHeight - BALL_H, pos.value.y))
    }
  }
  autoPickIfSingle()
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  // 组件被卸载时如果 drag 还在进行（罕见：state 切到 capturing 那一刻用户正在拖球），
  // 也走 endDrag 把 listener 摘干净，避免悬挂监听
  endDrag(false)
})

/** drag 是否正在进行（防 onDown 重入 + 多渠道 cleanup 走同一次 endDrag 兜底） */
let dragActive = false

function onDown(e: PointerEvent) {
  if (e.button !== 0) return
  // 防御：上一次 down 的 pointerup 如果丢了（用户拖出视口/拖到浏览器 chrome 上松手 /
  // alt-tab 系统通知抢焦），stale 的 pointermove/up/cancel/blur 监听还挂着。这一次
  // down 前先扫尾，否则 downAt/originPos 被覆盖但 move 监听共用一个 → 球继续跟鼠标跑。
  endDrag()

  dragActive = true
  downAt = { x: e.clientX, y: e.clientY }
  originPos = { ...pos.value }
  moved = false
  activePointerId = e.pointerId
  // ⚠ pointerdown 阶段**不**调 setPointerCapture：纯点击（move < 4px）时如果先 capture，
  // 子按钮的 click 派发会被 row 接走（target 移到 row 上）。延迟到 onMove 触发 dragging
  // 阈值之后再 capture——这时已经是真拖动，本来就不该触发 child click。
  //
  // 多渠道挂监听：window pointermove/up 兜常规情况；pointercancel 兜系统抢焦；
  // blur 兜 alt-tab；并在 onMove 跨阈值时 capture pointer 兜 **iframe 跨界吞事件**
  // 场景（用户在禅道这类 iframe layout 页拖球，鼠标跨过 iframe 区域时 pointermove
  // 路由到 iframe 的 window，主框架收不到事件——球卡住跟随鼠标，正是用户的报障）。
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUpOrCancel)
  window.addEventListener('pointercancel', onUpOrCancel)
  window.addEventListener('blur', onWindowBlur)
}

function onMove(e: PointerEvent) {
  if (!dragActive) return
  const dx = e.clientX - downAt.x
  const dy = e.clientY - downAt.y
  if (!moved && Math.hypot(dx, dy) > 4) {
    moved = true
    dragging.value = true
    // 跨过 drag 阈值才 setPointerCapture：纯点击（< 4px）走原 click 路径不被 capture 拦；
    // 真拖动后 capture 强制所有 pointermove/up/cancel 送到 row 上，**跨 iframe 也不丢**。
    // 这是禅道这类 iframe layout 页（pageHasIframe > 0）拖球卡住的根治。
    if (rowEl.value && activePointerId !== null) {
      try { rowEl.value.setPointerCapture(activePointerId) } catch { /* 某些浏览器对 closed shadow 内 capture 有限制，忽略 */ }
    }
  }
  if (moved) {
    pos.value = {
      x: Math.max(0, Math.min(window.innerWidth - BALL_W, originPos.x + dx)),
      y: Math.max(0, Math.min(window.innerHeight - BALL_H, originPos.y + dy))
    }
  }
}

/** pointerup / pointercancel 共用：拖动结束后落盘 + 清理。idempotent，多渠道触发只跑一次。 */
function onUpOrCancel() {
  endDrag(true)
}

/** window blur：用户拖出视口 / alt-tab → 收尾。不重定位 dragging 标志为 false 因为
 *  此时焦点不在页面上，等下次 down 时 endDrag 会再彻底重置；不落盘最后位置避免
 *  blur 抢救时把不完整的 drag 写进 localStorage。 */
function onWindowBlur() {
  endDrag(false)
}

/**
 * 拖动结束统一收口：移除所有 drag 监听 + 重置内部状态 + 视情况落盘 + 把 dragging 重置。
 * @param save  true=pointerup/cancel 正常结束（落盘最后位置）；false=blur 抢救（不落盘）
 *
 * 必须 idempotent：onDown 起手 + onUpOrCancel + blur 任意路径都会调，多次调用无副作用。
 */
function endDrag(save: boolean = false): void {
  if (!dragActive) return
  dragActive = false
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUpOrCancel)
  window.removeEventListener('pointercancel', onUpOrCancel)
  window.removeEventListener('blur', onWindowBlur)
  // release pointer capture（如果有 set 过）。pointerup 会自动 release，但 blur 兜底路径
  // 这里得显式 release——避免 capture 残留导致下次 pointerdown 行为错乱
  if (rowEl.value && activePointerId !== null) {
    try { rowEl.value.releasePointerCapture(activePointerId) } catch {}
  }
  activePointerId = null
  if (save && moved) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos.value)) } catch {}
  }
  // 记录 drag 结束时刻 —— click handler 据此拦截 250ms 内的合成 click。
  // blur 兜底路径（save=false）也要记，避免 alt-tab 抢救后浏览器仍 emit 一个合成 click。
  if (moved) dragEndedAt = Date.now()
  // dragging 在 next tick 才置回 false，让 click handler 看到当前帧仍是 dragging 状态
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
  if (Date.now() - dragEndedAt < 250) return
  if (props.matches.length <= 1) return // 单匹配点 logo 无操作（拖动手柄）
  // 多匹配：进入 picker 让用户重选
  pendingAction.value = null  // 重选不带后续动作
  phase.value = 'picker'
}

function onTriggerCapture() {
  if (Date.now() - dragEndedAt < 250) return
  if (!ensureActive('capture')) return
  emit('capture')
}

function onTriggerRecord() {
  if (Date.now() - dragEndedAt < 250) return
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
  // 同上：用真实 BALL_W/BALL_H 而不是 130/48
  pos.value = {
    x: Math.max(0, Math.min(window.innerWidth - BALL_W, pos.value.x)),
    y: Math.max(0, Math.min(window.innerHeight - BALL_H, pos.value.y))
  }
}
</script>
