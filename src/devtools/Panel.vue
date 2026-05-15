<template>
  <div class="panel">
    <header class="head">
      <div class="brand">
        <span class="logo">M</span>
        <div class="brand-text">
          <div class="brand-name">Moo Dev Tool</div>
          <div class="brand-meta">Tab #{{ tabId }}</div>
        </div>
      </div>
      <nav class="tabs" role="tablist">
        <button
          v-for="t in tabs"
          :key="t.key"
          :class="['tab', { 'is-active': active === t.key }]"
          role="tab"
          :aria-selected="active === t.key"
          @click="active = t.key"
        >
          <span class="tab-icon" aria-hidden="true">{{ t.icon }}</span>
          <span class="tab-label">{{ t.label }}</span>
        </button>
      </nav>
    </header>
    <main class="content">
      <Environment v-if="active === 'env'" />
      <Overview v-else-if="active === 'overview'" />
      <History v-else-if="active === 'history'" />
      <Settings v-else-if="active === 'settings'" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Environment from './tabs/Environment.vue'
import History from './tabs/History.vue'
import Overview from './tabs/Overview.vue'
import Settings from './tabs/Settings.vue'

const tabId = ref(chrome.devtools.inspectedWindow.tabId)

const tabs = [
  { key: 'overview', label: '概览',  icon: '◰' },
  { key: 'env',      label: '环境',  icon: '⚙' },
  { key: 'history',  label: '历史',  icon: '⌛' },
  { key: 'settings', label: '设置',  icon: '☰' }
] as const

type TabKey = typeof tabs[number]['key']
const active = ref<TabKey>('overview')
</script>

<style scoped>
.panel {
  height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: var(--moo-ff-sans);
  font-size: var(--moo-fs-base);
  color: var(--moo-c-text);
  background: var(--moo-c-bg);
}

.head {
  flex: none;
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--moo-c-border);
  background: var(--moo-c-bg);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-right: 1px solid var(--moo-c-divider);
  min-width: 200px;
}
.logo {
  width: 28px; height: 28px;
  border-radius: var(--moo-r-md);
  background: var(--moo-c-brand);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: -.02em;
}
.brand-text { line-height: 1.2; }
.brand-name {
  font-size: var(--moo-fs-md);
  font-weight: 600;
  letter-spacing: -.01em;
  color: var(--moo-c-text);
}
.brand-meta {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
  font-family: var(--moo-ff-mono);
}

.tabs {
  flex: 1;
  display: flex;
  align-items: stretch;
  padding: 0 8px;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  font-family: inherit;
  font-size: var(--moo-fs-sm);
  color: var(--moo-c-text-muted);
  cursor: pointer;
  transition: color var(--moo-motion-fast), border-color var(--moo-motion-fast);
  user-select: none;
  position: relative;
  top: 1px;
}
.tab-icon {
  font-size: 13px;
  opacity: .7;
}
.tab:hover { color: var(--moo-c-text); }
.tab:hover .tab-icon { opacity: 1; }
.tab.is-active {
  color: var(--moo-c-brand);
  border-bottom-color: var(--moo-c-brand);
}
.tab.is-active .tab-icon { opacity: 1; }

.content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  background: var(--moo-c-bg-soft);
}
.content > * { flex: 1; min-height: 0; }
</style>
