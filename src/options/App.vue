<template>
  <div class="opt-page">
    <header class="opt-head">
      <div class="brand">
        <img class="logo" :src="logoUrl" alt="Moo" />
        <div class="brand-text">
          <div class="brand-name">Moo Dev Tool <span class="ver">v{{ version }}</span></div>
          <div class="brand-meta">
            <template v-if="inspectedHost">📍 {{ inspectedHost }}</template>
            <template v-else>工作区（独立浮窗）</template>
          </div>
          <!-- v0.7.5：工作区更新提示 + 手动检查 + 一键 reload。
               有新版：① 下载 link + ③ reload 按钮（chrome.runtime.reload() 等价
               chrome://extensions ↻，免去手动跳扩展页）
               无新版：「⟳ 检查更新」立即触发不等 24h -->
          <div class="update-line">
            <template v-if="updateInfo">
              <a :href="updateInfo.url" target="_blank" rel="noopener noreferrer" class="update-link"
                :aria-label="`下载 v${updateInfo.latest} zip（新窗口）`">
                ⬆ v{{ updateInfo.latest }} ① 下载
              </a>
              <button type="button" class="update-reload" @click="reloadExtension"
                title="解压覆盖原扩展目录后点这里，等价 chrome://extensions ↻ 重新加载">
                ③ 重新加载
              </button>
            </template>
            <button v-else type="button"
              :class="['update-check', { 'is-done': checkJustDone, 'is-failed': checkFailed }]"
              :disabled="checking"
              :title="checkFailed
                ? '检查失败（Gitee API 限流 / 网络错）— 点击跳 Gitee releases 手动核对'
                : ''"
              @click="checkFailed ? openReleasesPage() : checkNow()">
              <template v-if="checking">⟳ 检查中…</template>
              <template v-else-if="checkJustDone">✓ 已是最新（{{ lastChecked }}）</template>
              <template v-else-if="checkFailed">⚠ 检查失败 · 点击查看</template>
              <template v-else-if="lastChecked">⟳ 检查更新（上次 {{ lastChecked }}）</template>
              <template v-else>⟳ 检查更新</template>
            </button>
          </div>
        </div>
      </div>
      <nav class="tabs" role="tablist" aria-label="Moo 工作区" @keydown="onTabKeydown">
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
          <!-- v0.7.5：4 tab SVG 图标 — 跟 Panel.vue v0.4.9 同款视觉一致 -->
          <span class="tab-icon" aria-hidden="true">
            <svg v-if="t.key === 'overview'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3"  width="7" height="7" rx="1.5"/>
              <rect x="14" y="3" width="7" height="7" rx="1.5"/>
              <rect x="3" y="14" width="7" height="7" rx="1.5"/>
              <rect x="14" y="14" width="7" height="7" rx="1.5"/>
            </svg>
            <svg v-else-if="t.key === 'env'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4"  width="18" height="6" rx="1.5"/>
              <rect x="3" y="14" width="18" height="6" rx="1.5"/>
              <circle cx="7" cy="7" r=".8" fill="currentColor"/>
              <circle cx="7" cy="17" r=".8" fill="currentColor"/>
            </svg>
            <svg v-else-if="t.key === 'history'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9"/>
              <path d="M12 7v5l3.5 2"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>
            </svg>
          </span>
          <span class="tab-label">{{ t.label }}</span>
        </button>
      </nav>
    </header>
    <main class="content" role="tabpanel" :id="`opt-tabpanel-${active}`" :aria-labelledby="`opt-tab-${active}`">
      <KeepAlive>
        <Overview v-if="active === 'overview'" />
        <Environment v-else-if="active === 'env'" />
        <History v-else-if="active === 'history'" />
        <Settings v-else-if="active === 'settings'" />
      </KeepAlive>
    </main>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUpdate, onBeforeUnmount, onMounted, ref } from 'vue'
import Overview from '@/devtools/tabs/Overview.vue'
import Environment from '@/devtools/tabs/Environment.vue'
import History from '@/devtools/tabs/History.vue'
import Settings from '@/devtools/tabs/Settings.vue'
import { VERSION_CHECK_FLAG_KEY, type LatestVersionInfo } from '@/utils/versionCheck'
import { useVersionCheck } from '@/composables/useVersionCheck'

const logoUrl = chrome.runtime.getURL('icons/icon-48.png')
const version = chrome.runtime.getManifest().version
// v0.7.5：浮窗工作区显示「📍 <inspected host>」让用户知道在看哪个 tab 的数据。
// host 由 options/main.ts pre-mount shim 通过 chrome.windows.getLastFocused 拿好。
const inspectedHost = (window as { __mooInspectedHost?: string }).__mooInspectedHost ?? ''

// v0.7.5：工作台版本检查 — SW alarm 每 24h 跑 runVersionCheck 写
// chrome.storage.local VERSION_CHECK_FLAG_KEY。这里读 flag + 监听 onChanged +
// 手动触发不等 24h。跟 popup 同款行为。
const updateInfo = ref<LatestVersionInfo | null>(null)
// v0.7.5：版本检查 UX 抽到 useVersionCheck composable（popup + 工作台同款行为）
// v0.7.6：补 expectedVersion 让 reload 前写 UPGRADE_INTENT，SW onInstalled 验证后弹「✓ 已升级」
const {
  checking,
  lastChecked,
  checkJustDone,
  checkFailed,
  runCheck: checkNow,
  reloadExtension
} = useVersionCheck({
  expectedVersion: () => updateInfo.value?.latest ?? null
})

// v0.8.1：chip fail 状态点击 fallback — 直接打开 Gitee releases 页让用户手动核对
function openReleasesPage() {
  chrome.tabs.create({ url: 'https://gitee.com/charsen/moo-chrome-dev-tool/releases' })
}

function loadUpdateFlag() {
  void chrome.storage.local.get(VERSION_CHECK_FLAG_KEY).then(r => {
    const raw = r[VERSION_CHECK_FLAG_KEY]
    if (raw && typeof raw === 'object') {
      const info = raw as LatestVersionInfo
      const age = Date.now() - (info.checkedAt ?? 0)
      if (info.latest && info.url && age < 7 * 24 * 60 * 60_000) {
        updateInfo.value = info
        return
      }
    }
    updateInfo.value = null
  }).catch(() => { updateInfo.value = null })
}

// 注：runCheck 没法直接调 loadUpdateFlag —— chrome.storage.onChanged 会异步同步，
// 但 same-context write 不一定 fire onChanged，所以 storageWatcher 兜底重读

let storageWatcher: ((c: Record<string, chrome.storage.StorageChange>, area: string) => void) | null = null
onMounted(() => {
  loadUpdateFlag()
  storageWatcher = (changes, area) => {
    if (area === 'local' && VERSION_CHECK_FLAG_KEY in changes) loadUpdateFlag()
  }
  chrome.storage.onChanged.addListener(storageWatcher)
})
onBeforeUnmount(() => {
  if (storageWatcher) {
    chrome.storage.onChanged.removeListener(storageWatcher)
    storageWatcher = null
  }
  // versionCheck timer cleanup 已由 useVersionCheck composable 自管
})

// v0.7.5：tab 顺序按使用频率 — 概览（每次看）/ 历史（次频）/ 环境（一次配）/ 设置（极少改）
const tabs = [
  { key: 'overview', label: '概览' },
  { key: 'history',  label: '历史' },
  { key: 'env',      label: '环境' },
  { key: 'settings', label: '设置' }
] as const

type TabKey = typeof tabs[number]['key']
const active = ref<TabKey>('overview')  // v0.7.5：默认进概览（跟 DevTools panel 一致，工作区第一眼看实时请求/错误）

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
.brand-name .ver { color: var(--moo-c-text-muted); font-weight: 400; font-size: 11px; margin-left: 4px; }
.brand-meta { font-size: 11px; color: var(--moo-c-text-muted); }

/* v0.7.5：工作台更新提示 + 手动检查 */
.update-line {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.2;
  min-height: 22px;   /* 锁高度防「检查更新 single button」↔「下载 + reload 双按钮」切换抖动 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.update-link {
  color: var(--moo-c-warn-fg);
  font-weight: 500;
  text-decoration: none;
  padding: 2px 6px;
  background: var(--moo-c-warn-soft);
  border-radius: var(--moo-r-sm);
  border: 1px solid var(--moo-c-warn-soft);
}
/* hover 背景翻到 --moo-c-warn-fg：dark 下该 token 是浅黄(#fcd34d)，原 #fff 白字几乎不可读。
   改 var(--moo-c-bg)（跟 BodyViewer 同款）— 浅色主题=白底深字范式翻转，两主题都达 AA。 */
.update-link:hover { background: var(--moo-c-warn-fg); color: var(--moo-c-bg); }
.update-reload {
  margin-left: 6px;
  background: var(--moo-c-brand);
  color: var(--moo-c-brand-fg);
  border: 1px solid var(--moo-c-brand);
  border-radius: var(--moo-r-sm);
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  padding: 2px 8px;
}
.update-reload:hover { background: var(--moo-c-brand-hover); border-color: var(--moo-c-brand-hover); }
.update-check {
  background: transparent;
  border: none;
  color: var(--moo-c-text-muted);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  text-decoration-style: dotted;
}
.update-check:hover:not(:disabled) { color: var(--moo-c-text); }
.update-check:disabled { opacity: .6; cursor: not-allowed; }
.update-check.is-done {
  color: var(--moo-c-success-fg);
  text-decoration: none;
  font-weight: 500;
}
/* v0.8.1：fail 状态 — 红色让用户知道不是「已是最新」而是「真没拿到 remote」 */
.update-check.is-failed {
  color: var(--moo-c-danger-fg);
  text-decoration: none;
  font-weight: 500;
}
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
.tab-icon { display: inline-flex; }
.tab-icon svg { width: 14px; height: 14px; flex: none; }
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
