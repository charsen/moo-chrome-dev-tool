<template>
  <div class="popup">
    <header>
      <h3>Moo Dev Tool</h3>
      <span class="badge">v{{ version }}</span>
    </header>

    <div v-if="loading" class="status">检测中…</div>

    <!-- 1. 已匹配 -->
    <div v-else-if="project" class="status matched">
      <div class="line">
        <span class="dot" /> 已匹配项目：<b>{{ project.name }}</b>
      </div>
      <div class="hint">悬浮球已在该页面启用，点击即可截图上报。</div>
      <div class="hint">配置了 <b>{{ project.servers.length }}</b> 个上报服务器。</div>
    </div>

    <!-- 2. 有项目但当前 URL 不匹配 -->
    <div v-else-if="projects.length" class="status nomatch">
      <div class="line">当前页面 <b>不在</b> 任何已配置项目的匹配规则内。</div>
      <div class="hint">当前 URL：</div>
      <div class="url-box">{{ currentUrl || '(未知)' }}</div>
      <div class="hint">已配置 {{ projects.length }} 个项目：</div>
      <ul class="project-list">
        <li v-for="p in projects" :key="p.id">
          <span class="dot" :class="{ off: !p.enabled }" />
          <b>{{ p.name }}</b>
          <span class="patterns">
            {{ p.matchPatterns.length ? p.matchPatterns.join(', ') : '(无 URL 规则)' }}
          </span>
        </li>
      </ul>
      <div class="hint sub">想让本页生效：DevTools → Moo → 环境 → 改 URL 匹配规则后<b>保存</b>。</div>
    </div>

    <!-- 3. 完全没配置 -->
    <div v-else class="status empty">
      <div class="line">还没有任何项目配置。</div>
      <div class="hint">打开 DevTools（F12）→ <b>Moo</b> 面板 → "环境" Tab 新建项目并添加 URL 匹配规则。</div>
    </div>

    <footer>
      <button class="link" @click="openDevtoolsHelp">如何打开 DevTools 面板？</button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Project } from '@/types/config'
import { loadConfig, urlMatches } from '@/storage/config'

const version = ref(chrome.runtime.getManifest().version)
const project = ref<Project | null>(null)
const projects = ref<Project[]>([])
const currentUrl = ref('')
const loading = ref(true)

onMounted(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    currentUrl.value = tab?.url ?? ''
    const cfg = await loadConfig()
    projects.value = cfg.projects
    // 不走 background MATCH_PROJECT 了，直接本地匹配以保证一致
    if (tab?.url && cfg.globalEnabled) {
      for (const p of cfg.projects) {
        if (!p.enabled) continue
        if (p.matchPatterns.some((pat) => urlMatches(tab.url!, pat))) {
          project.value = p
          break
        }
      }
    }
  } finally {
    loading.value = false
  }
})

function openDevtoolsHelp() {
  alert('在网页上按 F12（或右键 → 检查），切到 "Moo" 面板。')
}
</script>

<style scoped>
.popup {
  width: 300px;
  padding: 12px 14px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}
h3 { margin: 0; font-size: 14px; }
.badge {
  font-size: 11px;
  color: #999;
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 3px;
}
.status {
  border-radius: 4px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.6;
}
.status.matched { background: #f0f9f4; color: #14532d; }
.status.nomatch { background: #fff7ed; color: #7c2d12; }
.status.empty { background: #f3f4f6; color: #374151; }
.line { font-size: 13px; }
.hint { color: #555; margin-top: 4px; }
.hint.sub { font-size: 11px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #f3d9a0; }
.dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  margin-right: 5px;
}
.dot.off { background: #ccc; }
.url-box {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11px;
  background: #fff;
  border: 1px solid #fde68a;
  border-radius: 3px;
  padding: 4px 6px;
  margin: 2px 0 4px;
  word-break: break-all;
  color: #444;
}
.project-list {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  font-size: 11px;
}
.project-list li {
  padding: 4px 0;
  border-top: 1px dashed #f3d9a0;
  line-height: 1.4;
}
.project-list li:first-child { border-top: none; }
.project-list .patterns {
  display: block;
  font-family: ui-monospace, Menlo, monospace;
  color: #7c2d12;
  margin-left: 12px;
  word-break: break-all;
}
footer {
  margin-top: 10px;
  text-align: center;
}
.link {
  background: transparent;
  border: none;
  color: #1a73e8;
  font-size: 11px;
  cursor: pointer;
  padding: 4px;
}
.link:hover { text-decoration: underline; }
</style>
