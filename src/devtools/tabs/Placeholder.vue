<template>
  <div class="placeholder">
    <div class="illust">🚧</div>
    <p>{{ text }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ text: string }>()
</script>

<style scoped>
.placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--moo-c-text-dim);
  font-size: var(--moo-fs-sm);
  background: var(--moo-c-bg-soft);
}
.illust { font-size: 36px; opacity: .5; }
p { margin: 0; max-width: 320px; text-align: center; line-height: 1.55; }
</style>
