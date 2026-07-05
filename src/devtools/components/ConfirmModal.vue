<template>
  <div class="modal-mask" @click.self="onCancel">
    <div ref="modalRef" class="modal" role="alertdialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
      <header class="modal-hd">
        <h3 :id="titleId">{{ title }}</h3>
      </header>
      <div class="modal-bd">
        <p v-if="typeof message === 'string' && message" class="modal-msg">{{ message }}</p>
        <ul v-else-if="Array.isArray(message) && message.length" class="modal-list">
          <li v-for="(line, i) in message" :key="i">{{ line }}</li>
        </ul>
        <slot />
      </div>
      <footer class="modal-ft">
        <button class="moo-btn" @click="onCancel">{{ cancelText || '取消' }}</button>
        <button
          :class="['moo-btn', danger ? 'moo-btn--danger-solid' : 'moo-btn--primary']"
          ref="confirmBtn"
          @click="onConfirm"
        >
          {{ confirmText || '确认' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useFocusTrap } from '@/composables/useFocusTrap'

defineProps<{
  title: string
  /** string 显示为段落，string[] 显示为列表（用于"以下项目会被删除…"这类多行确认） */
  message?: string | string[]
  confirmText?: string
  cancelText?: string
  /** true 时主按钮变实心红 + 失败语义。用于不可逆操作。 */
  danger?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const titleId = `moo-modal-title-${Math.random().toString(36).slice(2, 9)}`
const confirmBtn = ref<HTMLButtonElement | null>(null)
const modalRef = ref<HTMLElement>()

// v0.4.9：focus trap + 还原（之前 onMounted 钩子只剩注释 confirmBtn 没 .focus()），
// 让键盘用户在关键确认（删除/清空）时焦点锁在 modal 内 + Esc 关闭后焦点回触发元素
useFocusTrap(modalRef, { onEscape: onCancel, initialFocus: 'first' })

function onConfirm() { emit('confirm') }
function onCancel() { emit('cancel') }

function onKeydown(e: KeyboardEvent) {
  if (e.isComposing) return // 输入法组字中的回车是选字，不该触发确认
  if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
  // Enter 默认确认；如果焦点在 cancel 按钮上，Enter 也会触发原生 click（resolve cancel），
  // 这里只处理"未聚焦任何按钮"的场景：默认走确认
  if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault()
    onConfirm()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  // v0.4.9：non-danger 自动聚焦确认按钮（让回车直接确认 — 「是否保存」语义）；
  // danger 让 focus trap 兜底 → 焦点落在第一个可聚焦元素（cancel），用户多看一眼免误删
  if (!modalRef.value) return
  nextTick(() => {
    // 暂时跳过，useFocusTrap 已经做 initialFocus
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: var(--moo-c-scrim);
  backdrop-filter: blur(2px);
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: mask-in .15s;
}
@keyframes mask-in { from { opacity: 0 } to { opacity: 1 } }

.modal {
  background: var(--moo-c-bg);
  border-radius: var(--moo-r-lg);
  width: 420px;
  max-width: calc(100vw - 32px);
  box-shadow: var(--moo-sh-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: dialog-in .18s cubic-bezier(.4, 0, .2, 1);
}
@keyframes dialog-in {
  from { opacity: 0; transform: translateY(6px) scale(.99); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.modal-hd {
  padding: 14px 18px 6px;
}
.modal-hd h3 {
  margin: 0;
  font-size: var(--moo-fs-md);
  font-weight: 600;
  color: var(--moo-c-text);
  letter-spacing: -.005em;
}

.modal-bd {
  padding: 6px 18px 16px;
  font-size: var(--moo-fs-sm);
  color: var(--moo-c-text-muted);
  line-height: 1.55;
  max-height: 60vh;
  overflow: auto;
}
.modal-msg {
  margin: 0;
  /* 允许传入的 message 用 \n 显式分段（如"上报地址列表"那种多段说明） */
  white-space: pre-line;
}
.modal-list {
  margin: 0;
  padding-left: 18px;
  font-family: var(--moo-ff-mono);
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text);
}
.modal-list li {
  margin: 2px 0;
  word-break: break-all;
}

.modal-ft {
  padding: 10px 14px;
  border-top: 1px solid var(--moo-c-divider);
  background: var(--moo-c-bg-soft);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
