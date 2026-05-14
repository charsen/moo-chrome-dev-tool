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
      <Environment v-if="active === 'env'" />
      <Overview v-else-if="active === 'overview'" />
      <History v-else-if="active === 'history'" />
      <Placeholder v-else-if="active === 'settings'" text="设置（Phase 3：脱敏规则 / 缓冲大小 / 快捷键）" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Environment from './tabs/Environment.vue'
import History from './tabs/History.vue'
import Overview from './tabs/Overview.vue'
import Placeholder from './tabs/Placeholder.vue'

const tabId = ref(chrome.devtools.inspectedWindow.tabId)

const tabs = [
  { key: 'overview', label: '概览' },
  { key: 'env', label: '环境' },
  { key: 'history', label: '历史' },
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
  flex: none;
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
  overflow: hidden;
  display: flex;
}
.content > * { flex: 1; min-height: 0; }
</style>
