<template>
  <div class="panel">
    <header class="head">
      <div class="brand">
        <img class="logo" :src="logoUrl" alt="Moo" />
        <div class="brand-text">
          <div class="brand-name">Moo Dev Tool</div>
          <div class="brand-meta" :title="hostname ? `Tab #${tabId} · ${hostname}` : `Tab #${tabId}`">
            {{ hostname || `Tab #${tabId}` }}
          </div>
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
          <span class="tab-icon" aria-hidden="true">
            <!-- Overview: 四宫格 -->
            <svg v-if="t.key === 'overview'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3"  width="7" height="7" rx="1.5"/>
              <rect x="14" y="3" width="7" height="7" rx="1.5"/>
              <rect x="3" y="14" width="7" height="7" rx="1.5"/>
              <rect x="14" y="14" width="7" height="7" rx="1.5"/>
            </svg>
            <!-- Environment: 服务器/堆叠 -->
            <svg v-else-if="t.key === 'env'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4"  width="18" height="6" rx="1.5"/>
              <rect x="3" y="14" width="18" height="6" rx="1.5"/>
              <circle cx="7" cy="7" r=".8" fill="currentColor"/>
              <circle cx="7" cy="17" r=".8" fill="currentColor"/>
            </svg>
            <!-- History: 钟表 -->
            <svg v-else-if="t.key === 'history'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9"/>
              <path d="M12 7v5l3.5 2"/>
            </svg>
            <!-- Settings: 齿轮（简化版） -->
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>
            </svg>
          </span>
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
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Environment from './tabs/Environment.vue'
import History from './tabs/History.vue'
import Overview from './tabs/Overview.vue'
import Settings from './tabs/Settings.vue'

const tabId = ref(chrome.devtools.inspectedWindow.tabId)
const hostname = ref('')
const logoUrl = chrome.runtime.getURL('icons/icon-48.png')

// 图标按 key 在 template 里 v-if 选 SVG（统一线条粗细/圆角，比之前 ◰⚙⌛☰ 杂烩 Unicode 视觉一致得多）
const tabs = [
  { key: 'overview', label: '概览' },
  { key: 'env',      label: '环境' },
  { key: 'history',  label: '历史' },
  { key: 'settings', label: '设置' }
] as const

type TabKey = typeof tabs[number]['key']
const active = ref<TabKey>('overview')

// 把"Tab #1234567"换成实际主机名——对用户有意义得多。
// 用 chrome.devtools.inspectedWindow.eval 读 location.hostname；导航后 onNavigated 重读。
function refreshHostname() {
  try {
    chrome.devtools.inspectedWindow.eval('location.hostname', (result, isException) => {
      if (isException) return
      if (typeof result === 'string') hostname.value = result
    })
  } catch {
    // chrome.devtools 偶发不可用，保留旧值
  }
}

let navListener: ((url: string) => void) | undefined

onMounted(() => {
  refreshHostname()
  navListener = () => refreshHostname()
  try {
    chrome.devtools.network.onNavigated.addListener(navListener)
  } catch {
    // 监听不可用就退回"挂载时读一次"，不影响主流程
  }
})

onBeforeUnmount(() => {
  if (navListener) {
    try { chrome.devtools.network.onNavigated.removeListener(navListener) } catch {}
  }
})
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
  min-height: 56px;
  border-bottom: 1px solid var(--moo-c-border);
  background: var(--moo-c-bg);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-right: 1px solid var(--moo-c-divider);
  min-width: 220px;
}
.logo {
  width: 36px; height: 36px;
  border-radius: 50%;
  display: block;
  flex: none;
}
.brand-text { line-height: 1.25; min-width: 0; }
.brand-name {
  font-size: var(--moo-fs-md);
  font-weight: 600;
  letter-spacing: -.01em;
  color: var(--moo-c-text);
  margin-bottom: 2px;
}
.brand-meta {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
  font-family: var(--moo-ff-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* 窄宽（≤ 400px 停靠右侧）下要让 tabs 有空间显示完整，brand-meta 自适应收缩 */
  max-width: clamp(60px, 18vw, 160px);
}

/* 窄宽下 tabs 横向滚动而不是撑爆容器（之前 ≤ 400px 整个 head 会触发横向滚动）*/
.tabs {
  flex: 1;
  display: flex;
  align-items: stretch;
  padding: 0 8px;
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar { display: none; }
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  opacity: .7;
}
.tab-icon svg {
  width: 14px;
  height: 14px;
  display: block;
}
.tab:hover { color: var(--moo-c-text); }
.tab:hover .tab-icon { opacity: 1; }
.tab:focus-visible {
  outline: none;
  color: var(--moo-c-text);
  background: var(--moo-c-bg-soft);
  border-radius: var(--moo-r-sm) var(--moo-r-sm) 0 0;
  box-shadow: inset 0 0 0 2px var(--moo-c-brand);
}
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
