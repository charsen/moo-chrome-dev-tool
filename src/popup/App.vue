<template>
  <div class="popup">
    <header class="head">
      <div class="brand">
        <img class="logo" :src="logoUrl" alt="Moo" />
        <h1>Moo Dev Tool</h1>
      </div>
      <span class="moo-chip">v{{ version }}</span>
    </header>

    <!-- v0.6.0 BREAKING：升级到 v0.6.0 后 <all_urls> 改 optional，老用户首次打开需要主动启用。
         banner 醒目展示直到用户开启或显式关闭。 -->
    <div v-if="needsHostPermUpgrade" class="upgrade-banner" role="alert">
      <div class="upgrade-title">升级到 v0.6.0 — 上报功能需要重新启用</div>
      <div class="upgrade-msg">为符合 Chrome Web Store 评审要求，「向上报服务器发送请求」改为可选权限。点下方按钮一次性启用，之后所有提交照旧工作。</div>
      <button
        type="button"
        class="moo-btn moo-btn--danger"
        :disabled="hostBusy"
        @click="toggleHostPermission"
      >{{ hostBusy ? '处理中…' : '一键启用上报功能' }}</button>
      <button type="button" class="upgrade-dismiss" @click="dismissUpgrade">稍后再说</button>
    </div>

    <main>
    <div v-if="loading" class="state state--loading">
      <div class="spinner" /> 检测中…
    </div>

    <!-- 1. 已匹配 -->
    <section v-else-if="matched.length" class="state state--matched">
      <div class="state-head">
        <span class="status-dot status-dot--on" />
        <div class="state-title">{{ matched.length > 1 ? `已启用 · 匹配到 ${matched.length} 个项目` : '已启用' }}</div>
      </div>
      <div v-for="p in matched" :key="p.id" class="proj-card">
        <div class="proj-name">{{ p.name }}</div>
        <div class="proj-meta">
          <span>{{ p.servers.length }} 个上报服务器</span>
        </div>
      </div>
      <p class="hint">
        <template v-if="matched.length > 1">
          点击悬浮球时会让你选择目标项目；快捷键 ⌘/Ctrl + Shift + B 默认走第一个。
        </template>
        <template v-else>
          悬浮球已在当前页面启用，点击或按 ⌘/Ctrl + Shift + B 截图上报。
        </template>
      </p>
    </section>

    <!-- 2. 有项目但当前 URL 不匹配 -->
    <section v-else-if="projects.length && !matched.length" class="state state--nomatch">
      <div class="state-head">
        <span class="status-dot status-dot--warn" />
        <div class="state-title">当前页面未匹配</div>
      </div>
      <div class="url-row">
        <div class="url-label">URL</div>
        <code class="url-value">{{ currentUrl || '(未知)' }}</code>
      </div>
      <div class="projs">
        <div class="projs-label">{{ projects.length }} 个已配置项目</div>
        <ul class="proj-list">
          <li v-for="p in projects" :key="p.id">
            <span class="status-dot" :class="p.enabled ? 'status-dot--on' : 'status-dot--off'" />
            <span class="li-name">{{ p.name }}</span>
            <span class="li-patterns">
              {{ p.matchPatterns.length ? p.matchPatterns.join(', ') : '(无 URL 规则)' }}
            </span>
          </li>
        </ul>
      </div>
      <!-- v0.4.7：未匹配态加快捷入口，一键把当前 host wildcard 加进首个 enabled 项目 -->
      <!-- v0.4.8：chrome:// / file:// 等无 host 时禁用按钮（生成的 wildcard 非法） -->
      <button v-if="quickEnableTarget && quickEnableHostPattern" class="onboard-cta" :disabled="quickEnableBusy" @click="quickEnableHere">
        {{ quickEnableBusy ? '配置中…' : `+ 在此页面也启用「${quickEnableTarget.name}」` }}
      </button>
      <p class="hint">点上面按钮把 <code>{{ quickEnableHostPattern || '当前域名' }}</code> 加进项目；或去 DevTools → <b>Moo</b> → <b>环境</b> 手动改规则。</p>
    </section>

    <!-- 3. 完全没配置 = 首次使用引导 -->
    <section v-else class="state state--empty">
      <div class="empty-illust">👋</div>
      <div class="state-title">{{ firstRun ? '欢迎使用 Moo Dev Tool' : '还没有项目' }}</div>
      <p class="hint" v-if="firstRun">
        这是个前后端调试工具，配好<b>项目</b> + <b>上报服务器</b>后，
        网页里会出现悬浮球——一键截图/录屏 + 自动抓现场，提交到你的 bug 系统。
      </p>
      <ol class="onboard-steps">
        <li>按 <span class="kbd">F12</span> 打开 DevTools</li>
        <li>切到 <b>Moo</b> 面板 → <b>环境</b> Tab</li>
        <li>点 <b>+</b> 新建项目，填名字 + URL 匹配规则（如 <code>https://*.example.com/*</code>）</li>
        <li v-if="firstRun">配好后回到这个页面，悬浮球会自动出现</li>
      </ol>
      <button v-if="firstRun" class="onboard-cta" @click="dismissOnboard">我看完了 →</button>
    </section>

    <!-- 最近提交（有任何 history 都显示，不限 matched / nomatch / empty 三态） -->
    <section v-if="latest" class="recent">
      <div class="recent-head">
        <span class="recent-title">最近提交</span>
        <span class="recent-count">{{ recent.length }} 条</span>
      </div>
      <!-- 第 1 条：prominent 卡 -->
      <div
        class="rh-card"
        :title="`访问当时所在的页面：${latest.url}`"
        @click="openTabUrl(latest.url)"
      >
        <div class="rh-card-row1">
          <span class="rh-status" :class="statusOf(latest).cls" :title="statusOf(latest).title">{{ statusOf(latest).label }}</span>
          <span class="rh-title" :title="latest.title">{{ latest.title }}</span>
        </div>
        <div class="rh-card-row2">
          <span class="rh-proj">{{ latest.projectName }}</span>
          <span class="rh-time">{{ relativeTime(latest.timestamp) }}</span>
        </div>
      </div>
      <!-- 第 2-3 条：compact 行 -->
      <ul v-if="rest.length" class="rh-list">
        <li
          v-for="e in rest"
          :key="e.id"
          class="rh-row"
          :title="`访问当时所在的页面：${e.url}`"
          @click="openTabUrl(e.url)"
        >
          <span class="rh-status" :class="statusOf(e).cls" :title="statusOf(e).title">{{ statusOf(e).label }}</span>
          <span class="rh-row-title" :title="e.title">{{ e.title }}</span>
          <span class="rh-row-time">{{ relativeTime(e.timestamp) }}</span>
        </li>
      </ul>
    </section>
    </main>

    <footer class="foot">
      <!-- 录屏开关：tabCapture 是 optional_permission，用户主动启用一次即可 -->
      <div class="rec-toggle">
        <span class="rec-label">录屏功能（⌥⇧R）</span>
        <button
          type="button"
          role="switch"
          :class="['popup-switch', { 'is-on': recEnabled }]"
          :aria-checked="recEnabled ? 'true' : 'false'"
          :disabled="recBusy"
          @click="toggleRecording"
        >
          <span class="popup-switch-thumb" />
        </button>
      </div>
      <div v-if="recError" class="rec-err" role="alert" aria-live="assertive">{{ recError }}</div>

      <!-- v0.5.3 #128：host_permission 改 optional 后，用户主动启用「向上报服务器 fetch」一次即可 -->
      <div class="rec-toggle">
        <span class="rec-label">允许向上报服务器发送请求</span>
        <button
          type="button"
          role="switch"
          :class="['popup-switch', { 'is-on': hostEnabled }]"
          :aria-checked="hostEnabled ? 'true' : 'false'"
          :disabled="hostBusy"
          @click="toggleHostPermission"
        >
          <span class="popup-switch-thumb" />
        </button>
      </div>
      <div v-if="hostError" class="rec-err" role="alert" aria-live="assertive">{{ hostError }}</div>

      <div class="help-pop">
        打开 DevTools 控制面板：在网页上按 <span class="kbd">F12</span>（或右键 → <b>检查</b>），切到 <b>Moo</b> 面板。
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Project } from '@/types/config'
import type { BugHistoryEntry } from '@/types/history'
import { loadConfig, saveConfig, urlMatches } from '@/storage/config'
import { listHistory } from '@/storage/history'
import { relativeTime } from '@/utils/relativeTime'
import { t } from '@/i18n'

const version = ref(chrome.runtime.getManifest().version)
// 显示尺寸 28px，用 32 比 48 更省字节 + 缩放损失更小（lighthouse image-size-responsive）
const logoUrl = chrome.runtime.getURL('icons/icon-32.png')
const ONBOARD_KEY = 'mooOnboardedAt'
const firstRun = ref(false)

async function dismissOnboard() {
  firstRun.value = false
  try {
    await chrome.storage.local.set({ [ONBOARD_KEY]: Date.now() })
  } catch {}
}
const matched = ref<Project[]>([])
const projects = ref<Project[]>([])
const currentUrl = ref('')
const loading = ref(true)
const recEnabled = ref(false)
const recBusy = ref(false)
const recError = ref('')
// v0.5.3 #128：host_permission 改 optional 后的开关状态
const hostEnabled = ref(false)
const hostBusy = ref(false)
const hostError = ref('')
// v0.6.0 BREAKING：onInstalled 升级时写 flag，banner 展示直到开启或显式关闭
const needsHostPermUpgrade = ref(false)
const UPGRADE_FLAG_KEY = 'mooNeedsHostPermUpgrade'

async function dismissUpgrade() {
  needsHostPermUpgrade.value = false
  try {
    await chrome.storage.local.remove(UPGRADE_FLAG_KEY)
    await chrome.action.setBadgeText({ text: '' }).catch(() => {})
  } catch {}
}
const recent = ref<BugHistoryEntry[]>([])
// v0.4.7：未匹配态快捷启用 —— 一键把当前 host wildcard 加进首个 enabled 项目的 matchPatterns
const quickEnableBusy = ref(false)
const quickEnableTarget = computed(() => projects.value.find(p => p.enabled) ?? null)
// v0.4.8：chrome:// / file:// / about: 这些 protocol 没有有效 host，生成 `chrome:///*`
// 这种非法 wildcard saveConfig 也不会验证 → 用户点按钮看似成功但 pattern 永远不匹配
const QUICK_ENABLE_PROTO_BLACKLIST = ['chrome:', 'chrome-extension:', 'file:', 'about:', 'edge:', 'view-source:']
const quickEnableHostPattern = computed(() => {
  try {
    const u = new URL(currentUrl.value)
    if (QUICK_ENABLE_PROTO_BLACKLIST.includes(u.protocol)) return ''
    if (!u.host) return ''
    return `${u.protocol}//${u.host}/*`
  } catch { return '' }
})
async function quickEnableHere(): Promise<void> {
  const target = quickEnableTarget.value
  const pattern = quickEnableHostPattern.value
  if (!target || !pattern) return
  quickEnableBusy.value = true
  try {
    const cfg = await loadConfig()
    const project = cfg.projects.find(p => p.id === target.id)
    if (project && !project.matchPatterns.includes(pattern)) {
      project.matchPatterns = [...project.matchPatterns, pattern]
      await saveConfig(cfg)
    }
    // 重新跑匹配（不刷 popup，让 chrome.storage.onChanged 自动触发？这里直接 close popup
    // 让用户切回 tab 时悬浮球自动出现更直观）
    window.close()
  } finally {
    quickEnableBusy.value = false
  }
}
const latest = computed<BugHistoryEntry | undefined>(() => recent.value[0])
const rest = computed<BugHistoryEntry[]>(() => recent.value.slice(1, 3))

// 点击最近提交行 → 在新 tab 打开当时提交所在的页面。
// 不要打开 remoteBase/remoteId（不一定是可访问的 web 页面，可能是裸 webhook 端点）；
// 打开 entry.url 是「回到当时出 bug 的页面」最朴素也最通用的语义。
function openTabUrl(url: string) {
  if (!url) return
  void chrome.tabs.create({ url })
  // popup 调用 chrome.tabs.create 后 popup 会自动关掉
}

interface StatusBadge { label: string; cls: string; title: string }
function statusOf(e: BugHistoryEntry): StatusBadge {
  if (!e.result.ok) {
    if (e.result.queued) return { label: '重试中', cls: 'rh-queued', title: '已加入重试队列，后台周期重试' }
    return { label: '失败', cls: 'rh-fail', title: e.result.error || `HTTP ${e.result.status ?? '?'}` }
  }
  switch (e.remoteStatus) {
    case 'done':        return { label: '完成', cls: 'rh-done', title: '后端已标记完成' }
    case 'in_progress': return { label: '处理中', cls: 'rh-prog', title: '后端处理中' }
    case 'deleted':     return { label: '已删', cls: 'rh-del', title: '后端已删除' }
    case 'open':        return { label: '待处理', cls: 'rh-open', title: '后端 open' }
    default:            return { label: '已提交', cls: 'rh-ok', title: '已提交（后端尚未回查或不支持状态）' }
  }
}

async function toggleRecording() {
  recBusy.value = true
  recError.value = ''
  try {
    if (recEnabled.value) {
      // 撤销授权
      const ok = await chrome.permissions.remove({ permissions: ['tabCapture'] })
      if (ok) recEnabled.value = false
    } else {
      // 申请授权 —— 必须在用户点击 popup 按钮的同步栈里 invoke
      // 才有 user activation；这里 button @click → toggleRecording 是直链。
      const ok = await chrome.permissions.request({ permissions: ['tabCapture'] })
      recEnabled.value = ok
      if (!ok) recError.value = t('popup.permission.cancelled')
    }
  } catch (e) {
    recError.value = (e as Error).message
  } finally {
    recBusy.value = false
  }
}

/**
 * v0.5.3 #128：开/关 `<all_urls>` host permission。
 * 申请走 origins，必须在 button @click 同步栈 invoke 维持 user activation。
 */
async function toggleHostPermission() {
  hostBusy.value = true
  hostError.value = ''
  try {
    if (hostEnabled.value) {
      const ok = await chrome.permissions.remove({ origins: ['<all_urls>'] })
      if (ok) hostEnabled.value = false
    } else {
      const ok = await chrome.permissions.request({ origins: ['<all_urls>'] })
      hostEnabled.value = ok
      if (!ok) hostError.value = t('popup.permission.cancelled')
      else {
        // 用户成功授权 → 清 upgrade flag + badge（dismissUpgrade 顺手清 storage）
        await dismissUpgrade()
      }
    }
  } catch (e) {
    hostError.value = (e as Error).message
  } finally {
    hostBusy.value = false
  }
}

onMounted(async () => {
  // v0.4.8：5 步串行 IO → 并行（之前 popup 打开 < 200ms 期望易破）
  // tabs.query / loadConfig / permissions.contains / listHistory 互不依赖，能并发
  try {
    const [tabResult, cfg, hasRecPerm, hasHostPerm, upgradeFlagObj, historyList] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      loadConfig(),
      chrome.permissions.contains({ permissions: ['tabCapture'] }),
      chrome.permissions.contains({ origins: ['<all_urls>'] }),
      chrome.storage.local.get(UPGRADE_FLAG_KEY).catch(() => ({})),
      listHistory().catch(() => [])  // 历史读失败静默不挡核心
    ])
    const tab = tabResult[0]
    currentUrl.value = tab?.url ?? ''
    projects.value = cfg.projects
    if (tab?.url && cfg.globalEnabled) {
      matched.value = cfg.projects.filter(
        (p) => p.enabled && p.matchPatterns.some((pat) => urlMatches(tab.url!, pat))
      )
    }
    recEnabled.value = hasRecPerm
    hostEnabled.value = hasHostPerm
    // v0.6.0：升级 flag 仅当还没授权时显示 banner（已开 host 即使 flag 在也不弹）
    needsHostPermUpgrade.value = !hasHostPerm && !!(upgradeFlagObj as Record<string, unknown>)[UPGRADE_FLAG_KEY]
    recent.value = historyList.slice(0, 3)
    // ONBOARD_KEY 读放最后（只在没项目时才查，多数用户 short-circuit）
    if (projects.value.length === 0) {
      const r = await chrome.storage.local.get(ONBOARD_KEY)
      if (!r[ONBOARD_KEY]) firstRun.value = true
    }
  } finally {
    loading.value = false
  }
})

</script>

<style scoped>
.popup {
  width: 320px;
  padding: 14px;
  background: var(--moo-c-bg);
  font-family: var(--moo-ff-sans);
  color: var(--moo-c-text);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.brand { display: flex; align-items: center; gap: 8px; }
.logo {
  width: 28px; height: 28px;
  border-radius: 50%;
  display: block;
  flex: none;
  /* 图标本身已是圆形深底 + 金眼，直接用，不需要额外背景 */
}
.head h1 {
  margin: 0;
  font-size: var(--moo-fs-md);
  font-weight: 600;
  letter-spacing: -.01em;
}

.state {
  padding: 12px;
  border-radius: var(--moo-r-lg);
  background: var(--moo-c-bg-soft);
  border: 1px solid var(--moo-c-border);
}
.state--loading {
  display: flex; align-items: center; gap: 8px;
  font-size: var(--moo-fs-sm);
  color: var(--moo-c-text-muted);
}
.spinner {
  width: 14px; height: 14px;
  border: 2px solid var(--moo-c-border);
  border-top-color: var(--moo-c-brand);
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.state-head {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 8px;
}
.state-title {
  font-size: var(--moo-fs-base);
  font-weight: 600;
  color: var(--moo-c-text);
}

.state--matched {
  border-color: var(--moo-c-success-soft);
  background: var(--moo-c-success-soft);
}
.state--nomatch {
  border-color: var(--moo-c-warn-soft);
  background: var(--moo-c-warn-soft);
}
.state--empty   { text-align: center; padding: 20px 16px; }

/* 状态点：除颜色外还用形状/字符区分（色弱可读）。
   on  → 绿色实心圆 + 内嵌 ✓
   warn → 橙色圆角方块 + 内嵌 !
   off → 灰色空心圆（描边） */
.status-dot {
  width: 12px; height: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  font-size: 8px;
  font-weight: 800;
  color: var(--moo-c-brand-fg);
  line-height: 1;
  box-sizing: border-box;
}
.status-dot--on {
  border-radius: 50%;
  background: var(--moo-c-success);
  box-shadow: 0 0 0 2px var(--moo-c-success-halo);
}
.status-dot--on::before { content: '✓'; }
.status-dot--warn {
  border-radius: 3px;
  background: var(--moo-c-warn);
  box-shadow: 0 0 0 2px var(--moo-c-warn-halo);
}
.status-dot--warn::before { content: '!'; }
.status-dot--off {
  border-radius: 50%;
  background: transparent;
  border: 2px solid var(--moo-c-text-faint);
}

.proj-card {
  background: var(--moo-c-bg);
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  padding: 10px 12px;
  margin-bottom: 8px;
}
.proj-name { font-weight: 600; color: var(--moo-c-text); margin-bottom: 2px; }
.proj-meta { font-size: var(--moo-fs-xs); color: var(--moo-c-text-muted); }

.url-row {
  background: var(--moo-c-bg);
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  padding: 8px 10px;
  margin-bottom: 10px;
  font-size: var(--moo-fs-xs);
}
.url-label { color: var(--moo-c-text-dim); margin-bottom: 2px; }
.url-value {
  display: block;
  font-family: var(--moo-ff-mono);
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text);
  word-break: break-all;
}

.projs-label {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
  margin-bottom: 6px;
}
.proj-list {
  list-style: none; margin: 0; padding: 0;
  background: var(--moo-c-bg);
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  font-size: var(--moo-fs-xs);
  max-height: 160px;
  overflow: auto;
}
.proj-list li {
  display: grid;
  grid-template-columns: 12px max-content 1fr;
  gap: 6px;
  align-items: baseline;
  padding: 8px 10px;
  border-bottom: 1px solid var(--moo-c-divider);
}
.proj-list li:last-child { border-bottom: none; }
.li-name { font-weight: 500; color: var(--moo-c-text); }
.li-patterns {
  font-family: var(--moo-ff-mono);
  color: var(--moo-c-text-muted);
  word-break: break-all;
  text-align: right;
}

.empty-illust { font-size: 28px; opacity: .8; margin-bottom: 6px; }

.onboard-steps {
  text-align: left;
  margin: 10px 0 0;
  padding-left: 22px;
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-muted);
  line-height: 1.7;
}
.onboard-steps li { margin: 2px 0; }
.onboard-steps b { color: var(--moo-c-text); font-weight: 600; }
.onboard-steps code {
  font-family: var(--moo-ff-mono);
  font-size: 10px;
  background: var(--moo-c-bg-elev);
  padding: 1px 5px;
  border-radius: var(--moo-r-sm);
  color: var(--moo-c-text);
}
.onboard-cta {
  margin-top: 12px;
  background: var(--moo-c-brand);
  color: var(--moo-c-brand-fg);
  border: none;
  padding: 6px 14px;
  border-radius: var(--moo-r-md);
  font-family: inherit;
  font-size: var(--moo-fs-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--moo-motion-fast);
}
.onboard-cta:hover { background: var(--moo-c-brand-hover); }

.hint {
  margin: 10px 0 0;
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-muted);
  line-height: 1.55;
}
.hint b { color: var(--moo-c-text); font-weight: 600; }

/* 最近提交（顶层 section） */
.recent {
  margin-top: 12px;
  padding: 10px;
  background: var(--moo-c-bg-soft);
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
}
.recent-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.recent-title {
  font-size: var(--moo-fs-xs);
  font-weight: 600;
  color: var(--moo-c-text-muted);
  text-transform: uppercase;
  letter-spacing: .04em;
}
.recent-count {
  font-family: var(--moo-ff-mono);
  font-size: 10px;
  color: var(--moo-c-text-dim);
}

/* 第 1 条：prominent 卡 */
.rh-card {
  background: var(--moo-c-bg);
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  padding: 8px 10px;
  cursor: pointer;
  transition: border-color var(--moo-motion-fast), background-color var(--moo-motion-fast);
}
.rh-card:hover { border-color: var(--moo-c-brand); background: var(--moo-c-brand-soft); }
.rh-card-row1 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.rh-title {
  flex: 1;
  min-width: 0; /* flex 子项 min-width: auto 默认会让标题不截断 */
  font-size: var(--moo-fs-sm);
  font-weight: 500;
  color: var(--moo-c-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rh-card-row2 {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--moo-c-text-dim);
}
.rh-proj { font-family: var(--moo-ff-mono); }
.rh-time { font-family: var(--moo-ff-mono); }

/* 第 2~3 条：compact 行 */
.rh-list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
}
.rh-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 4px;
  border-top: 1px solid var(--moo-c-divider);
  cursor: pointer;
  font-size: var(--moo-fs-xs);
  transition: background-color var(--moo-motion-fast);
}
.rh-row:hover { background: var(--moo-c-bg-elev); border-radius: var(--moo-r-sm); }
.rh-row-title {
  flex: 1;
  min-width: 0;
  color: var(--moo-c-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rh-row-time {
  font-family: var(--moo-ff-mono);
  font-size: 10px;
  color: var(--moo-c-text-dim);
}

/* 状态 chip：和 History tab 那套配色保持一致 */
.rh-status {
  flex: 0 0 auto;
  font-size: 9px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--moo-r-sm);
  letter-spacing: .02em;
  white-space: nowrap;
  border: 1px solid transparent;
}
.rh-status.rh-fail   { color: var(--moo-c-danger-fg);  background: var(--moo-c-danger-soft);  border-color: var(--moo-c-danger-soft); }
.rh-status.rh-queued { color: var(--moo-c-brand);      background: var(--moo-c-brand-soft);   border-color: var(--moo-c-brand-soft); }
.rh-status.rh-done   { color: var(--moo-c-success-fg); background: var(--moo-c-success-soft); border-color: var(--moo-c-success-soft); }
.rh-status.rh-prog   { color: var(--moo-c-warn-fg);    background: var(--moo-c-warn-soft);    border-color: var(--moo-c-warn-soft); }
.rh-status.rh-del    { color: var(--moo-c-text-muted); background: var(--moo-c-bg-soft);      border-color: var(--moo-c-border); }
/* v0.5.1：rh-open 改 warn 配色 — 跟 rh-fail（danger）区分。「后端待处理」≠「提交失败」 */
.rh-status.rh-open   { color: var(--moo-c-warn-fg);    background: var(--moo-c-warn-soft);    border-color: var(--moo-c-warn-soft); }
.rh-status.rh-ok     { color: var(--moo-c-text-muted); background: var(--moo-c-bg-soft);      border-color: var(--moo-c-border); }

/* v0.6.0 BREAKING：升级后的 host_permission 引导 banner，醒目背景 + 一键启用按钮 */
.upgrade-banner {
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid var(--moo-c-warn-soft);
  background: var(--moo-c-warn-soft);
  border-radius: 6px;
  color: var(--moo-c-warn-fg);
  font-size: var(--moo-fs-xs);
}
.upgrade-title { font-weight: 600; margin-bottom: 4px; color: var(--moo-c-text); }
.upgrade-msg { margin-bottom: 8px; line-height: 1.5; color: var(--moo-c-text-muted); }
.upgrade-banner .moo-btn { margin-right: 8px; }
.upgrade-dismiss {
  border: none; background: none;
  color: var(--moo-c-text-muted);
  font-size: var(--moo-fs-xs);
  cursor: pointer;
  text-decoration: underline;
}
.upgrade-dismiss:hover { color: var(--moo-c-text); }

.rec-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 12px 0 6px;
  padding: 8px 10px;
  background: var(--moo-c-bg-soft);
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  font-size: var(--moo-fs-sm);
}
.rec-label { color: var(--moo-c-text); font-weight: 500; }
.rec-err {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-warn-fg);
  margin-bottom: 6px;
  text-align: center;
}
/* popup-switch：和 Settings tab 那个 moo-switch 视觉一致，但作用域隔离 */
.popup-switch {
  position: relative;
  width: 32px;
  height: 18px;
  border: none;
  border-radius: 9px;
  background: var(--moo-c-border);
  cursor: pointer;
  transition: background-color var(--moo-motion-fast);
  padding: 0;
}
.popup-switch:disabled { opacity: .5; cursor: not-allowed; }
.popup-switch.is-on { background: var(--moo-c-success); }
/* thumb 圆点：跟 tokens.css 的 .moo-switch-thumb 同款，必须独立于主题保持纯白
   关闭态在浅灰轨道上 / 开启态在 indigo 实心上，都需要白色识别度 */
.popup-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  transition: transform var(--moo-motion-fast);
}
.popup-switch.is-on .popup-switch-thumb { transform: translateX(14px); }

.foot { margin-top: 12px; text-align: center; }
.help-pop {
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--moo-c-bg-soft);
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text);
  line-height: 1.6;
  text-align: left;
}
.help-pop .kbd {
  display: inline-block;
  padding: 0 5px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-sm);
  font-family: var(--moo-ff-mono);
  font-size: 10px;
  background: var(--moo-c-bg);
}
.help-pop b { color: var(--moo-c-text); font-weight: 600; }
</style>
