<template>
  <!-- 「再截一张」延迟触发器（v0.8.12）：点弹窗的「＋ 再截一张」后，弹窗收起，本触发器
       浮起。用户可先在页面自由操作（切 SPA 内 tab / 滚动 / 展开面板）再点「📷 现在截图」。
       默认右下角，可拖动改位。拖拽用 FloatingBall 同款 pointer-capture 模式（跨 iframe 不丢
       事件），所有 window 监听在 onBeforeUnmount + endDrag 收口清理。 -->
  <div class="moo-arm-wrap" :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
    <div
      ref="rowEl"
      :class="['moo-arm-row', { dragging }]"
      @pointerdown="onDown"
    >
      <button
        class="moo-arm-btn moo-arm-btn--shoot"
        title="现在截图（先切好页面再点）"
        aria-label="现在截图（截当前页面，追加为一张）"
        @click.stop="onShoot"
      >
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
          <circle cx="12" cy="13" r="3" />
        </svg>
        <span class="lab">现在截图</span>
      </button>
      <button
        class="moo-arm-btn moo-arm-btn--cancel"
        title="取消，回到提交弹窗（不新增截图）"
        aria-label="取消，回到提交弹窗（不新增截图）"
        @click.stop="onCancel"
      >取消</button>
    </div>
    <div class="moo-arm-hint" aria-hidden="true">切好页面（滚动 / 切 tab）再点截图 · 可拖动</div>
  </div>
</template>

<script setup lang="ts">
// 拖拽实现照搬 FloatingBall.vue 的 pointer-capture 模式：4px 阈值区分点击/拖动，
// 跨阈值后 setPointerCapture 让 pointermove/up 强制路由到 row（跨 iframe 不丢），
// 多渠道（pointerup / pointercancel / blur）收口走同一个 idempotent 的 endDrag。
import { onBeforeUnmount, ref } from 'vue'

const emit = defineEmits<{
  /** 点「现在截图」：隐藏 Moo UI → captureVisibleTab → 标注 */
  (e: 'shoot'): void
  /** 点「取消」：回提交弹窗，不新增截图 */
  (e: 'cancel'): void
}>()

const rowEl = ref<HTMLDivElement>()
const dragging = ref(false)

/** 触发器估算尺寸（实际约 248×40，留 margin 给阴影 / clamp） */
const ROW_W = 260
const ROW_H = 52
const MARGIN = 16

// 默认右下角；不落 localStorage —— arming 是一次性临时态，下次再截重新从右下起。
const pos = ref({
  x: Math.max(MARGIN, window.innerWidth - ROW_W - MARGIN),
  y: Math.max(MARGIN, window.innerHeight - ROW_H - MARGIN)
})

// ── 拖拽状态（FloatingBall 同款）─────────────────────────────────────────────
let dragActive = false
let activePointerId: number | null = null
let downAt = { x: 0, y: 0 }
let originPos = { x: 0, y: 0 }
let moved = false
/** 拖动结束时刻：click handler 用「< 250ms」拦截拖动后浏览器合成的 click，
 *  避免拖完松手误触发截图 / 取消（同 FloatingBall 的时间戳拦截）。 */
let dragEndedAt = 0
/** endDrag 里把 dragging 复位的 0ms timer 句柄 —— 卸载时一并清，防 post-unmount write。 */
let dragResetTimer: number | undefined

function onDown(e: PointerEvent) {
  if (e.button !== 0) return
  // 防御：上次 pointerup 丢了（拖出视口 / alt-tab）时 stale 监听还挂着，先扫尾
  endDrag()
  dragActive = true
  downAt = { x: e.clientX, y: e.clientY }
  originPos = { ...pos.value }
  moved = false
  activePointerId = e.pointerId
  // 跨阈值后才 setPointerCapture（纯点击不 capture，否则子按钮 click 被 row 接走）
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
    if (rowEl.value && activePointerId !== null) {
      try { rowEl.value.setPointerCapture(activePointerId) } catch { /* closed shadow 内 capture 受限时忽略 */ }
    }
  }
  if (moved) {
    pos.value = {
      x: Math.max(0, Math.min(window.innerWidth - ROW_W, originPos.x + dx)),
      y: Math.max(0, Math.min(window.innerHeight - ROW_H, originPos.y + dy))
    }
  }
}

function onUpOrCancel() { endDrag(true) }
function onWindowBlur() { endDrag(false) }

/** 拖拽结束统一收口（idempotent，多渠道触发只跑一次）：摘所有监听 + release capture。 */
function endDrag(_save: boolean = false): void {
  if (!dragActive) return
  dragActive = false
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUpOrCancel)
  window.removeEventListener('pointercancel', onUpOrCancel)
  window.removeEventListener('blur', onWindowBlur)
  if (rowEl.value && activePointerId !== null) {
    try { rowEl.value.releasePointerCapture(activePointerId) } catch {}
  }
  activePointerId = null
  // 不落盘位置：arming 一次性临时态，下次重新右下起手（区别于 FloatingBall 记忆位置）
  if (moved) dragEndedAt = Date.now()
  if (dragResetTimer) clearTimeout(dragResetTimer)
  dragResetTimer = window.setTimeout(() => { dragging.value = false; dragResetTimer = undefined }, 0)
}

function onShoot() {
  if (Date.now() - dragEndedAt < 250) return  // 拦截拖动后合成 click
  emit('shoot')
}

function onCancel() {
  if (Date.now() - dragEndedAt < 250) return
  emit('cancel')
}

onBeforeUnmount(() => {
  // drag 进行中被卸载（点「现在截图」切到 capturing 那刻正好在拖）也走 endDrag 摘干净
  endDrag(false)
  if (dragResetTimer) { clearTimeout(dragResetTimer); dragResetTimer = undefined }
})
</script>
