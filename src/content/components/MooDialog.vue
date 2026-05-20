<template>
  <div class="moo-dialog-mask" @click.self="onMaskClick">
    <div
      ref="dialogEl"
      class="moo-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="labelledBy"
      :aria-label="labelledBy ? undefined : title"
      tabindex="-1"
    >
      <slot name="head">
        <header v-if="title" class="moo-dialog-head">
          <h3 :id="labelledBy">{{ title }}</h3>
          <MooCloseBtn @click="emit('close')" />
        </header>
      </slot>
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
// content 世界通用 dialog 壳：mask + container + role=dialog + aria + focus-trap + ESC + 点 mask 关。
// 不接管「open/close 状态」——consumer 用 v-if / v-show 自己控；这样 SubmitDialog 那种
// 「打开 ElementPicker 时 v-show 隐藏 dialog 保留 form state」的场景不受影响。
//
// .moo-dialog-mask / .moo-dialog / .moo-dialog-head CSS 在 src/content/styles.ts 已定义
// （shadow DOM 注入），跟 MooCloseBtn 同样模式：组件只出 markup，样式由 host 上下文 stylesheet 提供。
import { ref } from 'vue'
import MooCloseBtn from '@/components/MooCloseBtn.vue'
import { useFocusTrap } from '@/composables/useFocusTrap'

const props = withDefaults(defineProps<{
  /** 标题。给了就渲染默认 header；不给走 head slot。 */
  title?: string
  /** aria-labelledby 指向的 id。给了就渲染到 h3#id，让屏幕阅读器拿到标题。
   * 不给则用 aria-label=title 作为兜底（同样可达，但 labelledby 更标准）。 */
  labelledBy?: string
  /** 点击 mask 自身是否触发 close。默认 true。
   * 关键操作（如带未保存草稿的 dialog）应传 false 防误关。 */
  maskClosable?: boolean
  /** focus-trap 初始焦点策略，透传 useFocusTrap。
   * 'container'：聚焦 dialog 容器自身（适用于组件 onMounted 后自己 focus 输入框）。
   * 'first'：首个可聚焦元素。 */
  initialFocus?: 'first' | 'container'
}>(), {
  maskClosable: true,
  initialFocus: 'first'
})

const emit = defineEmits<{
  (e: 'close'): void
}>()

const dialogEl = ref<HTMLDivElement>()

// ESC 走 useFocusTrap 的 onEscape 钩子（在 dialog 容器上挂监听，不污染宿主页）
useFocusTrap(dialogEl, {
  initialFocus: props.initialFocus,
  onEscape: () => emit('close')
})

function onMaskClick() {
  if (props.maskClosable) emit('close')
}
</script>
