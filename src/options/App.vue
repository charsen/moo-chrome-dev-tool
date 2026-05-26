<template>
  <div class="opt-page">
    <header class="opt-head">
      <div class="brand">
        <img class="logo" :src="logoUrl" alt="Moo" />
        <div class="brand-text">
          <div class="brand-name">Moo Dev Tool</div>
          <div class="brand-meta">完整配置（独立浮窗）</div>
        </div>
      </div>
      <nav class="tabs" role="tablist" aria-label="Moo 配置" @keydown="onTabKeydown">
        <button
          v-for="(t, i) in tabs"
          :key="t.key"
          :class="['tab', { 'is-active': active === t.key }]"
          role="tab"
          :aria-selected="active === t.key"
          :aria-controls="`opt-tabpanel-${t.key}`"
          :id="`opt-tab-${t.key}`"
          :tabindex="active === t.key ? 0 : -1"
          :ref="el => { if (el) tabRefs[i] = el as HTMLElement }"
          @click="active = t.key"
        >
          <span class="tab-label">{{ t.label }}</span>
        </button>
      </nav>
    </header>
    <main class="content" role="tabpanel" :id="`opt-tabpanel-${active}`" :aria-labelledby="`opt-tab-${active}`">
      <KeepAlive>
        <Environment v-if="active === 'env'" />
        <History v-else-if="active === 'history'" />
        <Settings v-else-if="active === 'settings'" />
      </KeepAlive>
    </main>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUpdate, ref } from 'vue'
import Environment from '@/devtools/tabs/Environment.vue'
import History from '@/devtools/tabs/History.vue'
import Settings from '@/devtools/tabs/Settings.vue'

const logoUrl = chrome.runtime.getURL('icons/icon-48.png')

const tabs = [
  { key: 'env',      label: '环境' },
  { key: 'history',  label: '历史' },
  { key: 'settings', label: '设置' }
] as const

type TabKey = typeof tabs[number]['key']
const active = ref<TabKey>('env')  // 浮窗默认进环境（最常用）

// ARIA tabs 键盘导航 —— 跟 Panel.vue 同款 v0.4.9 implementation
// v0.7.4 vue-craft 审：Vue 3 函数 ref 没在 update 前清空数组 → hot reload / active
// 切换会残留旧元素 ref，Home/End 偶发指向 stale。补 onBeforeUpdate 重置。
const tabRefs: HTMLElement[] = []
onBeforeUpdate(() => { tabRefs.length = 0 })
function onTabKeydown(e: KeyboardEvent) {
  const i = tabs.findIndex(t => t.key === active.value)
  if (i < 0) return
  let nextIdx = -1
  if (e.key === 'ArrowRight') nextIdx = (i + 1) % tabs.length
  else if (e.key === 'ArrowLeft') nextIdx = (i - 1 + tabs.length) % tabs.length
  else if (e.key === 'Home') nextIdx = 0
  else if (e.key === 'End') nextIdx = tabs.length - 1
  else return
  e.preventDefault()
  const nextTab = tabs[nextIdx]
  if (!nextTab) return
  active.value = nextTab.key
  void nextTick(() => tabRefs[nextIdx]?.focus())
}
</script>

<style scoped>
.opt-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: var(--moo-ff-sans);
  background: var(--moo-c-bg);
  color: var(--moo-c-text);
}
.opt-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--moo-c-divider);
  background: var(--moo-c-bg-soft);
}
.brand { display: flex; align-items: center; gap: 10px; }
.logo { width: 28px; height: 28px; }
.brand-name { font-weight: 600; font-size: 13px; line-height: 1.2; }
.brand-meta { font-size: 11px; color: var(--moo-c-text-muted); }
.tabs { display: flex; gap: 4px; margin-left: auto; }
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 14px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--moo-c-text-muted);
  border-radius: var(--moo-r-md);
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
}
.tab:hover { color: var(--moo-c-text); background: var(--moo-c-bg-elev); }
.tab.is-active {
  color: var(--moo-c-brand-fg);
  background: var(--moo-c-brand);
  border-color: var(--moo-c-brand);
}
.tab:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--moo-c-focus-ring);
}
.content { flex: 1; overflow: auto; }
</style>
