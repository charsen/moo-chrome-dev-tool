<template>
  <div class="popup">
    <header class="head">
      <div class="brand">
        <img class="logo" :src="logoUrl" alt="Moo" />
        <h1>Moo Dev Tool</h1>
      </div>
      <span class="moo-chip">v{{ version }}</span>
    </header>

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
      <p class="hint">在 DevTools → <b>Moo</b> → <b>环境</b> 中修改匹配规则后保存。</p>
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
      <div v-if="recError" class="rec-err">{{ recError }}</div>

      <button class="link" @click="helpOpen = !helpOpen">
        如何打开 DevTools 面板 {{ helpOpen ? '▴' : '▾' }}
      </button>
      <div v-if="helpOpen" class="help-pop">
        在网页上按 <span class="kbd">F12</span>（或右键 → <b>检查</b>），切到 <b>Moo</b> 面板。
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Project } from '@/types/config'
import { loadConfig, urlMatches } from '@/storage/config'

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
const helpOpen = ref(false)
const recEnabled = ref(false)
const recBusy = ref(false)
const recError = ref('')

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
      if (!ok) recError.value = '已取消授权'
    }
  } catch (e) {
    recError.value = (e as Error).message
  } finally {
    recBusy.value = false
  }
}

onMounted(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    currentUrl.value = tab?.url ?? ''
    const cfg = await loadConfig()
    projects.value = cfg.projects
    if (tab?.url && cfg.globalEnabled) {
      matched.value = cfg.projects.filter(
        (p) => p.enabled && p.matchPatterns.some((pat) => urlMatches(tab.url!, pat))
      )
    }
    // 首次使用判定：没建过项目 + 没标记过"看完引导"。两条都满足才算"new user"
    if (projects.value.length === 0) {
      const r = await chrome.storage.local.get(ONBOARD_KEY)
      if (!r[ONBOARD_KEY]) firstRun.value = true
    }
    // 读 tabCapture optional permission 当前状态
    recEnabled.value = await chrome.permissions.contains({ permissions: ['tabCapture'] })
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
  color: #fff;
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
  color: #fff;
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
  color: var(--moo-c-warn);
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
.link {
  background: transparent;
  border: none;
  color: var(--moo-c-brand);
  font-size: var(--moo-fs-xs);
  font-family: var(--moo-ff-sans);
  cursor: pointer;
  padding: 4px;
  transition: color var(--moo-motion-fast);
}
.link:hover { color: var(--moo-c-brand-hover); text-decoration: underline; }
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
