<template>
  <div class="panel">
    <header class="header">
      <div class="title">
        <h2>Moo Dev Tool</h2>
        <span class="tab-id">Inspected Tab: {{ tabId }}</span>
      </div>
      <nav class="tabs">
        <button
          v-for="t in tabs"
          :key="t.key"
          :class="['tab', { active: active === t.key }]"
          @click="active = t.key"
        >{{ t.label }}</button>
      </nav>
    </header>
    <main class="content">
      <section v-if="active === 'overview'">
        <p class="placeholder">骨架已就绪，等待功能实现。</p>
      </section>
      <section v-else-if="active === 'network'">
        <p class="placeholder">网络/接口调试面板（待实现）</p>
      </section>
      <section v-else-if="active === 'state'">
        <p class="placeholder">前端状态/Store 面板（待实现）</p>
      </section>
      <section v-else-if="active === 'settings'">
        <p class="placeholder">设置面板（待实现）</p>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const tabId = ref(chrome.devtools.inspectedWindow.tabId)

const tabs = [
  { key: 'overview', label: '概览' },
  { key: 'network', label: '网络' },
  { key: 'state', label: '状态' },
  { key: 'settings', label: '设置' }
] as const

type TabKey = typeof tabs[number]['key']
const active = ref<TabKey>('overview')
</script>

<style scoped>
.panel {
  height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  color: #222;
  background: #fff;
}
.header {
  border-bottom: 1px solid #e5e5e5;
  background: #fafafa;
}
.title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 8px 12px 4px;
}
.title h2 { margin: 0; font-size: 14px; font-weight: 600; }
.tab-id { color: #999; font-size: 11px; }
.tabs {
  display: flex;
  gap: 4px;
  padding: 0 8px;
}
.tab {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 6px 10px;
  font-size: 12px;
  color: #666;
  cursor: pointer;
}
.tab:hover { color: #222; }
.tab.active {
  color: #1a73e8;
  border-bottom-color: #1a73e8;
}
.content {
  flex: 1;
  padding: 12px 14px;
  overflow: auto;
}
.placeholder {
  color: #888;
  margin: 0;
}
</style>
