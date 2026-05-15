<template>
  <div class="popup">
    <header class="head">
      <div class="brand">
        <span class="logo">M</span>
        <h1>Moo Dev Tool</h1>
      </div>
      <span class="moo-chip">v{{ version }}</span>
    </header>

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

    <!-- 3. 完全没配置 -->
    <section v-else class="state state--empty">
      <div class="empty-illust">📋</div>
      <div class="state-title">还没有项目</div>
      <p class="hint">打开 DevTools（F12）→ <b>Moo</b> 面板 → "环境" Tab 新建项目。</p>
    </section>

    <footer class="foot">
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
const matched = ref<Project[]>([])
const projects = ref<Project[]>([])
const currentUrl = ref('')
const loading = ref(true)
const helpOpen = ref(false)

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
  width: 24px; height: 24px;
  border-radius: var(--moo-r-sm);
  background: var(--moo-c-brand);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: -.02em;
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

.state--matched { border-color: #bbf7d0; background: #f0fdf4; }
.state--nomatch { border-color: #fed7aa; background: #fffbeb; }
.state--empty   { text-align: center; padding: 20px 16px; }

.status-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex: none;
}
.status-dot--on   { background: var(--moo-c-success); box-shadow: 0 0 0 3px rgba(22, 163, 74, .12); }
.status-dot--warn { background: var(--moo-c-warn);    box-shadow: 0 0 0 3px rgba(217, 119, 6, .12); }
.status-dot--off  { background: var(--moo-c-text-faint); }

.proj-card {
  background: var(--moo-c-bg);
  border: 1px solid #bbf7d0;
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

.empty-illust { font-size: 28px; opacity: .6; margin-bottom: 6px; }

.hint {
  margin: 10px 0 0;
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-muted);
  line-height: 1.55;
}
.hint b { color: var(--moo-c-text); font-weight: 600; }

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
