<template>
  <div v-if="!loaded" class="loading">加载配置中…</div>
  <div v-else class="env-wrap">
    <div class="save-bar" :class="{ dirty }">
      <span class="status-msg">
        <template v-if="dirty">● 有未保存的更改</template>
        <template v-else>✓ 已保存</template>
      </span>
      <button class="btn primary" :disabled="!dirty || saving" @click="onSave">
        {{ saving ? '保存中…' : '保存' }}
      </button>
      <button class="btn" :disabled="!dirty || saving" @click="onRevert">撤销</button>
    </div>
    <div class="env">
      <aside class="sidebar">
        <div class="sidebar-head">
          <span>项目</span>
          <div class="head-actions">
            <button class="icon-btn" title="新建项目" @click="addProject">+</button>
            <button class="icon-btn" title="导入配置" @click="importConfig">↓</button>
            <button class="icon-btn" title="导出配置" @click="exportConfig">↑</button>
          </div>
        </div>
        <ul class="project-list">
          <li
            v-for="p in draft.projects"
            :key="p.id"
            :class="['project-item', { active: p.id === activeId }]"
            @click="activeId = p.id"
          >
            <span class="dot" :class="{ off: !p.enabled }" />
            <span class="name">{{ p.name || '(未命名)' }}</span>
            <span class="count">{{ p.servers.length }}</span>
          </li>
          <li v-if="!draft.projects.length" class="empty">暂无项目，点击 + 新建</li>
        </ul>
      </aside>

      <main class="detail" v-if="activeProject">
        <div class="row">
          <label>项目名</label>
          <input v-model="activeProject.name" />
          <label class="inline">
            <input type="checkbox" v-model="activeProject.enabled" />
            启用
          </label>
          <button class="danger-btn" @click="removeProject(activeProject.id)">删除项目</button>
        </div>

        <div class="row">
          <label>URL 匹配（每行一个，<code class="inline-code">*</code> 匹配任意字符）</label>
        </div>
        <textarea
          class="patterns"
          rows="3"
          :value="activeProject.matchPatterns.join('\n')"
          @input="onPatternsChange($event)"
          placeholder="* （所有页面）&#10;https://*.example.com/*"
        />
        <div class="tpl-hint">
          示例：<code>*</code> 匹配全部 ·
          <code>https://*.example.com/*</code> 匹配子域名 ·
          <code>http*://localhost:*/*</code> 匹配本地任意端口
        </div>

        <div class="section-head">
          <h4>上报 Token</h4>
        </div>
        <div class="row">
          <label>Token</label>
          <input
            v-model="activeProject.token"
            placeholder="从 /scaffold/accounts 获取你的个人 token"
            class="grow"
          />
        </div>
        <div class="tpl-hint">
          上报时会自动注入 <code class="inline-code">Authorization: Bearer …</code> 与
          <code class="inline-code">X-Scaffold-Token</code> 两个 header；服务端命中后会用账号 username 作为提交人。
          留空则按匿名提交（若服务端配了共享 token 也会被拒）。
        </div>

        <div class="section-head">
          <h4>上报服务器</h4>
          <button class="btn" @click="addServer">+ 新建服务器</button>
        </div>

        <div v-if="!activeProject.servers.length" class="empty padded">
          还没有服务器配置，新建一个。
        </div>

        <div v-for="s in activeProject.servers" :key="s.id" class="server-card">
          <div class="row">
            <label>名称</label>
            <input v-model="s.name" />
            <label class="inline">
              <input
                type="radio"
                :name="`def-${activeProject.id}`"
                :value="s.id"
                v-model="activeProject.defaultServerId"
              />
              默认
            </label>
            <button class="danger-btn small" @click="removeServer(s.id)">删除</button>
          </div>
          <div class="row">
            <label>请求</label>
            <select v-model="s.method" class="method">
              <option>POST</option>
              <option>PUT</option>
              <option>PATCH</option>
            </select>
            <input v-model="s.endpoint" placeholder="https://your-bug-server/api/bugs" class="grow" />
          </div>
          <div class="row">
            <label>请求头</label>
          </div>
          <div class="kv-list">
            <div v-for="(_, i) in headerEntries(s)" :key="i" class="kv-row">
              <input
                :value="headerEntries(s)[i][0]"
                @change="onHeaderKeyChange(s, i, ($event.target as HTMLInputElement).value)"
                placeholder="Header-Name"
              />
              <input
                :value="headerEntries(s)[i][1]"
                @input="onHeaderValChange(s, i, ($event.target as HTMLInputElement).value)"
                placeholder="value"
              />
              <button class="icon-btn" @click="removeHeader(s, headerEntries(s)[i][0])">×</button>
            </div>
            <button class="btn small" @click="addHeader(s)">+ 添加 Header</button>
          </div>
          <div class="row">
            <label>图片字段</label>
            <input v-model="s.imageField" class="narrow" />
            <label>格式</label>
            <select v-model="s.imageFormat" class="narrow">
              <option value="base64">base64 (JSON)</option>
              <option value="multipart">multipart</option>
            </select>
          </div>
          <div class="row">
            <label>Payload 模板</label>
          </div>
          <textarea v-model="s.payloadTemplate" class="template" rows="8" />
          <div class="tpl-hint">
            可用变量：
            <code v-pre>{{title}}</code>
            <code v-pre>{{description}}</code>
            <code v-pre>{{url}}</code>
            <code v-pre>{{userAgent}}</code>
            <code v-pre>{{viewport}}</code>
            <code v-pre>{{timestamp}}</code>
            <code v-pre>{{image}}</code>
            <code v-pre>{{requestsJson}}</code>
            <code v-pre>{{errorsJson}}</code>
          </div>
        </div>
      </main>

      <main class="detail empty-state" v-else>
        <p>左侧选择或新建一个项目开始配置。</p>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useConfig } from '@/composables/useConfig'
import {
  createDefaultProject,
  createDefaultServer,
  type BugServer,
  type MooConfig,
  type Project
} from '@/types/config'

const { config, loaded, save } = useConfig()

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

const draft = ref<MooConfig>({ projects: [], globalEnabled: true })
const activeId = ref<string>('')
const saving = ref(false)
const initialized = ref(false)

const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(config.value))

// 加载完成 & 外部变更时同步 draft；只有"已初始化且脏"的情况下保留草稿，
// 第一次进入时 draft 是空、config 已加载——必须放行第一次同步。
watch(
  () => [loaded.value, config.value] as const,
  ([isLoaded]) => {
    if (!isLoaded) return
    if (initialized.value && dirty.value) return
    draft.value = clone(config.value)
    if (!activeId.value && draft.value.projects.length) {
      activeId.value = draft.value.projects[0].id
    }
    initialized.value = true
  },
  { immediate: true }
)

const activeProject = computed<Project | undefined>(() =>
  draft.value.projects.find((p) => p.id === activeId.value)
)

async function onSave() {
  saving.value = true
  try {
    config.value = clone(draft.value)
    await save()
  } finally {
    saving.value = false
  }
}

function onRevert() {
  if (!confirm('放弃所有未保存修改？')) return
  draft.value = clone(config.value)
  if (!draft.value.projects.find((p) => p.id === activeId.value)) {
    activeId.value = draft.value.projects[0]?.id ?? ''
  }
}

function addProject() {
  const p = createDefaultProject(`项目 ${draft.value.projects.length + 1}`)
  draft.value.projects.push(p)
  activeId.value = p.id
}

function removeProject(id: string) {
  if (!confirm('确认删除该项目？(还需点保存生效)')) return
  draft.value.projects = draft.value.projects.filter((p) => p.id !== id)
  if (activeId.value === id) {
    activeId.value = draft.value.projects[0]?.id ?? ''
  }
}

function onPatternsChange(e: Event) {
  if (!activeProject.value) return
  const text = (e.target as HTMLTextAreaElement).value
  activeProject.value.matchPatterns = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

function addServer() {
  if (!activeProject.value) return
  const s = createDefaultServer(`服务器 ${activeProject.value.servers.length + 1}`)
  activeProject.value.servers.push(s)
  if (!activeProject.value.defaultServerId) {
    activeProject.value.defaultServerId = s.id
  }
}

function removeServer(id: string) {
  if (!activeProject.value) return
  if (!confirm('确认删除该服务器？(还需点保存生效)')) return
  activeProject.value.servers = activeProject.value.servers.filter((s) => s.id !== id)
  if (activeProject.value.defaultServerId === id) {
    activeProject.value.defaultServerId = activeProject.value.servers[0]?.id ?? ''
  }
}

function headerEntries(s: BugServer): [string, string][] {
  return Object.entries(s.headers)
}

function onHeaderKeyChange(s: BugServer, idx: number, newKey: string) {
  const entries = Object.entries(s.headers)
  const [oldKey, val] = entries[idx]
  if (oldKey === newKey) return
  delete s.headers[oldKey]
  s.headers[newKey] = val
}

function onHeaderValChange(s: BugServer, idx: number, newVal: string) {
  const [key] = Object.entries(s.headers)[idx]
  s.headers[key] = newVal
}

function addHeader(s: BugServer) {
  let i = 1
  while (`Header-${i}` in s.headers) i++
  s.headers[`Header-${i}`] = ''
}

function removeHeader(s: BugServer, key: string) {
  delete s.headers[key]
}

async function exportConfig() {
  const data = JSON.stringify(draft.value, null, 2)
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `moo-config-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function importConfig() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed.projects)) {
        alert('文件格式不正确')
        return
      }
      draft.value = {
        projects: parsed.projects,
        globalEnabled: typeof parsed.globalEnabled === 'boolean' ? parsed.globalEnabled : true
      }
      activeId.value = draft.value.projects[0]?.id ?? ''
    } catch (e) {
      alert(`导入失败: ${(e as Error).message}`)
    }
  }
  input.click()
}
</script>

<style scoped>
.loading {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 12px;
}
.env-wrap {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.save-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid #e5e5e5;
  background: #fafafa;
  font-size: 12px;
}
.save-bar.dirty { background: #fef9c3; border-bottom-color: #fde68a; }
.save-bar .status-msg { flex: 1; color: #555; }
.save-bar.dirty .status-msg { color: #92400e; font-weight: 500; }
.save-bar .btn {
  font-size: 12px;
  padding: 4px 14px;
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 3px;
  cursor: pointer;
}
.save-bar .btn:hover:not(:disabled) { background: #f5f5f5; }
.save-bar .btn:disabled { opacity: 0.5; cursor: not-allowed; }
.save-bar .btn.primary { background: #1a73e8; color: #fff; border-color: #1a73e8; }
.save-bar .btn.primary:hover:not(:disabled) { background: #1763cc; }
.env {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 1px;
  background: #e5e5e5;
}
.sidebar {
  width: 200px;
  background: #fff;
  display: flex;
  flex-direction: column;
}
.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid #eee;
  font-size: 12px;
  font-weight: 600;
}
.head-actions { display: flex; gap: 4px; }
.project-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow: auto;
  flex: 1;
}
.project-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
}
.project-item:hover { background: #f5f5f5; }
.project-item.active { background: #e8f0fe; color: #1a73e8; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; flex: none; }
.dot.off { background: #ccc; }
.name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.count { color: #999; font-size: 11px; }
.empty { padding: 12px; color: #aaa; font-size: 12px; text-align: center; }
.empty.padded { padding: 20px; }

.detail {
  flex: 1;
  background: #fff;
  padding: 14px 16px;
  overflow: auto;
}
.empty-state { color: #aaa; display: flex; align-items: center; justify-content: center; }

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}
.row label { font-size: 12px; color: #555; min-width: 80px; }
.row label.inline { min-width: unset; display: flex; align-items: center; gap: 4px; }
.row input[type="text"], .row input:not([type]), .row select {
  font-size: 12px;
  padding: 4px 6px;
  border: 1px solid #ddd;
  border-radius: 3px;
  background: #fff;
  flex: 1;
  min-width: 0;
}
.row .narrow { flex: 0 0 130px; }
.row .grow { flex: 1; }
.row .method { flex: 0 0 80px; }

.patterns, .template {
  width: 100%;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12px;
  border: 1px solid #ddd;
  border-radius: 3px;
  padding: 6px 8px;
  resize: vertical;
  box-sizing: border-box;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 18px 0 8px;
  border-top: 1px solid #eee;
  padding-top: 12px;
}
.section-head h4 { margin: 0; font-size: 13px; }

.server-card {
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #fafafa;
}

.kv-list { display: flex; flex-direction: column; gap: 4px; margin: 4px 0 8px; }
.kv-row { display: flex; gap: 6px; align-items: center; }
.kv-row input { flex: 1; font-size: 12px; padding: 3px 6px; border: 1px solid #ddd; border-radius: 3px; min-width: 0; }

.btn, .danger-btn, .icon-btn {
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 3px;
  cursor: pointer;
}
.btn:hover, .danger-btn:hover, .icon-btn:hover { background: #f5f5f5; }
.btn.small { padding: 2px 8px; font-size: 11px; }
.danger-btn { color: #c0392b; }
.danger-btn.small { padding: 2px 8px; font-size: 11px; }
.icon-btn { padding: 2px 8px; }

.tpl-hint { font-size: 11px; color: #888; margin-top: 4px; }
.tpl-hint code {
  background: #f0f0f0;
  padding: 1px 4px;
  border-radius: 2px;
  margin-right: 4px;
  font-family: ui-monospace, Menlo, monospace;
}
.inline-code {
  background: #f0f0f0;
  padding: 1px 4px;
  border-radius: 2px;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11px;
}
</style>
