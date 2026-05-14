<template>
  <div class="popup">
    <header>
      <h3>Moo Dev Tool</h3>
      <span class="badge">v{{ version }}</span>
    </header>
    <p class="hint">打开 DevTools（F12）查看 <b>Moo</b> 面板进行调试。</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const version = ref(chrome.runtime.getManifest().version)
</script>

<style scoped>
.popup {
  width: 280px;
  padding: 14px 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}
h3 { margin: 0; font-size: 14px; }
.badge {
  font-size: 11px;
  color: #999;
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
}
.hint {
  margin: 0;
  color: #666;
  font-size: 12px;
  line-height: 1.5;
}
</style>
