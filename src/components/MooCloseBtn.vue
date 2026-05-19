<template>
  <button
    type="button"
    class="moo-close-btn"
    :aria-label="ariaLabel"
    @click="$emit('click', $event)"
  >×</button>
</template>

<script setup lang="ts">
// 关闭 X 按钮的统一封装。.moo-close-btn 类在 tokens.css（devtools / popup）和
// content/styles.ts（shadow DOM 注入页）都已定义，所以组件只输出标准 markup，
// CSS 由各自上下文已加载的 stylesheet 提供。
//
// 默认 aria-label「关闭」；移除附件元素这种语义不同的场景显式覆盖。
withDefaults(defineProps<{
  ariaLabel?: string
}>(), {
  ariaLabel: '关闭'
})

defineEmits<{
  (e: 'click', ev: MouseEvent): void
}>()
</script>
