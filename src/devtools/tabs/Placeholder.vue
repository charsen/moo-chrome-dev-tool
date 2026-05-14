<template>
  <div class="placeholder">
    <p>{{ text }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ text: string }>()
</script>

<style scoped>
.placeholder {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 13px;
}
</style>
