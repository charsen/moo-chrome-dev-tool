<template>
  <div class="moo-cancel-guard" @click.self="emit('cancel')">
    <div
      ref="alertEl"
      class="moo-cancel-guard-card"
      role="alertdialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="msgId"
      tabindex="-1"
    >
      <div :id="titleId" class="moo-cancel-guard-title">{{ title }}</div>
      <div :id="msgId" class="moo-cancel-guard-msg">{{ message }}</div>
      <div class="moo-cancel-guard-actions">
        <button class="moo-btn" @click="emit('cancel')">{{ cancelText }}</button>
        <button :class="['moo-btn', 'primary', danger && 'danger-confirm']" @click="emit('confirm')">
          {{ confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// content 世界二次确认 alertdialog 壳：mask + card + role=alertdialog + focus-trap + ESC = cancel + mask click = cancel。
// 跟 MooDialog 类似不接管 open 状态——consumer 用 v-if 自己控（alertdialog 默认 v-if 卸载更合理：
// 关闭后没必要保留状态，下次打开重新挂）。
//
// CSS（.moo-cancel-guard / .moo-cancel-guard-card / .moo-cancel-guard-actions / .moo-btn.danger-confirm）
// 在 src/content/styles.ts 已有，组件不引入新样式。
import { ref, computed } from 'vue'
import { useFocusTrap } from '@/composables/useFocusTrap'

let uid = 0
const localId = ++uid

const props = withDefaults(defineProps<{
  /** 标题（必填）。如「放弃标注？」 */
  title: string
  /** 消息体（必填）。简短说明后果。 */
  message: string
  /** 主操作按钮文案。默认「确认」。 */
  confirmText?: string
  /** 取消按钮文案。默认「取消」。 */
  cancelText?: string
  /**
   * 主操作是危险动作时设为 true，按钮走 .danger-confirm 红底脉动样式。
   * 默认 true——MooAlert 用途几乎都是「放弃 / 丢弃 / 删除」这类破坏性确认。
   */
  danger?: boolean
}>(), {
  confirmText: '确认',
  cancelText: '取消',
  danger: true
})

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const alertEl = ref<HTMLDivElement>()
const titleId = computed(() => `moo-alert-title-${localId}`)
const msgId = computed(() => `moo-alert-msg-${localId}`)

// ESC = cancel；focus-trap 截住 Tab 防止键盘用户走回宿主页继续操作
useFocusTrap(alertEl, {
  initialFocus: 'first',
  onEscape: () => emit('cancel')
})
</script>
