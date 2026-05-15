<template>
  <div v-if="!loaded" class="loading">加载配置中…</div>
  <div v-else class="env-wrap">
    <div v-if="toast" :class="['moo-toast', `moo-toast--${toastKind}`]">{{ toast }}</div>
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
import { clone } from '@/utils/clone'

const { config, loaded, save } = useConfig()

const draft = ref<MooConfig>({ projects: [], globalEnabled: true })
const activeId = ref<string>('')
const saving = ref(false)
const initialized = ref(false)

const toast = ref('')
const toastKind = ref<'success' | 'error' | 'info'>('info')
let toastTimer: number | undefined
function showToast(msg: string, kind: 'success' | 'error' | 'info' = 'info') {
  toast.value = msg
  toastKind.value = kind
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), kind === 'error' ? 5000 : 2600)
}

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
    showToast('已保存', 'success')
  } catch (e) {
    showToast(`保存失败: ${(e as Error).message}`, 'error')
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
        showToast('文件格式不正确', 'error')
        return
      }
      // 安全确认：导入他人配置 = 同意把本机抓取的请求/cookie/storage 发到这些 endpoint。
      // 列出所有 host 让用户在落盘前看清楚，避免被预置的恶意 endpoint 偷数据。
      const endpoints = collectEndpoints(parsed.projects)
      if (endpoints.length > 0) {
        const lines = endpoints.map((e) => `  • ${e}`).join('\n')
        if (!confirm(
          `这份配置会把抓取到的数据上报到下列地址：\n\n${lines}\n\n` +
          `导入后，匹配规则命中时本机的请求 / cookie / storage / 截图都会发往以上地址。\n确认导入？`
        )) return
      }
      draft.value = {
        projects: parsed.projects,
        globalEnabled: typeof parsed.globalEnabled === 'boolean' ? parsed.globalEnabled : true
      }
      activeId.value = draft.value.projects[0]?.id ?? ''
    } catch (e) {
      showToast(`导入失败: ${(e as Error).message}`, 'error')
    }
  }
  input.click()
}

/** 从 projects 数组里抽出所有 server.endpoint 的可读 host（带协议），去重保序。 */
function collectEndpoints(projects: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of projects) {
    const servers = (p as { servers?: unknown[] })?.servers
    if (!Array.isArray(servers)) continue
    for (const s of servers) {
      const ep = (s as { endpoint?: unknown })?.endpoint
      if (typeof ep !== 'string' || !ep) continue
      let display = ep
      try {
        const u = new URL(ep)
        display = `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}`
      } catch {
        // 非法 URL：原样展示，让用户自己判断
      }
      if (!seen.has(display)) {
        seen.add(display)
        out.push(display)
      }
    }
  }
  return out
}
</script>

<style scoped>
.loading {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--moo-c-text-dim);
  font-size: var(--moo-fs-sm);
}

.env-wrap {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--moo-c-bg);
}

/* 顶部保存栏 */
.save-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--moo-c-border);
  background: var(--moo-c-bg);
  font-size: var(--moo-fs-sm);
}
.save-bar.dirty {
  background: var(--moo-c-warn-soft);
  border-bottom-color: #fde68a;
}
.save-bar .status-msg { flex: 1; color: var(--moo-c-text-muted); }
.save-bar.dirty .status-msg { color: var(--moo-c-warn-fg); font-weight: 500; }
.save-bar .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  padding: 0 14px;
  font-size: var(--moo-fs-sm);
  font-weight: 500;
  font-family: inherit;
  border: 1px solid var(--moo-c-border);
  background: var(--moo-c-bg);
  color: var(--moo-c-text);
  border-radius: var(--moo-r-md);
  cursor: pointer;
  transition: background-color var(--moo-motion-fast), border-color var(--moo-motion-fast);
}
.save-bar .btn:hover:not(:disabled) { background: var(--moo-c-bg-soft); }
.save-bar .btn:disabled { opacity: .5; cursor: not-allowed; }
.save-bar .btn.primary {
  background: var(--moo-c-brand);
  color: #fff;
  border-color: var(--moo-c-brand);
}
.save-bar .btn.primary:hover:not(:disabled) {
  background: var(--moo-c-brand-hover);
  border-color: var(--moo-c-brand-hover);
}

/* 主体（侧栏 + 详情） */
.env {
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--moo-c-bg);
}

/* 项目侧栏 */
.sidebar {
  width: 220px;
  background: var(--moo-c-bg);
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--moo-c-border);
}
.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--moo-c-divider);
  font-size: var(--moo-fs-xs);
  font-weight: 600;
  color: var(--moo-c-text-muted);
  text-transform: uppercase;
  letter-spacing: .04em;
}
.head-actions { display: flex; gap: 2px; }
.project-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  overflow: auto;
  flex: 1;
}
.project-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  cursor: pointer;
  font-size: var(--moo-fs-sm);
  border-radius: var(--moo-r-md);
  margin-bottom: 1px;
  transition: background-color var(--moo-motion-fast), color var(--moo-motion-fast);
}
.project-item:hover { background: var(--moo-c-bg-soft); }
.project-item.active {
  background: var(--moo-c-brand-soft);
  color: var(--moo-c-brand);
  font-weight: 500;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--moo-c-success);
  flex: none;
  box-shadow: 0 0 0 2px rgba(22, 163, 74, .15);
}
.dot.off {
  background: var(--moo-c-text-faint);
  box-shadow: none;
}
.name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.count { color: var(--moo-c-text-dim); font-size: var(--moo-fs-xs); font-family: var(--moo-ff-mono); }
.project-item.active .count { color: var(--moo-c-brand); }
.empty {
  padding: 16px;
  color: var(--moo-c-text-dim);
  font-size: var(--moo-fs-xs);
  text-align: center;
}
.empty.padded { padding: 24px; font-size: var(--moo-fs-sm); }

/* 详情面板 */
.detail {
  flex: 1;
  min-width: 0;
  background: var(--moo-c-bg);
  padding: 18px 22px;
  overflow: auto;
}
.empty-state {
  color: var(--moo-c-text-dim);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 表单行 */
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
}
.row label {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-muted);
  min-width: 84px;
  font-weight: 500;
}
.row label.inline {
  min-width: unset;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}
.row input[type="text"],
.row input:not([type]),
.row select {
  height: 28px;
  font-size: var(--moo-fs-sm);
  padding: 0 10px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  background: var(--moo-c-bg);
  color: var(--moo-c-text);
  flex: 1;
  min-width: 0;
  font-family: inherit;
  transition: border-color var(--moo-motion-fast), box-shadow var(--moo-motion-fast);
}
.row input[type="text"]:focus,
.row input:not([type]):focus,
.row select:focus {
  outline: none;
  border-color: var(--moo-c-brand);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, .15);
}
.row .narrow { flex: 0 0 130px; }
.row .grow   { flex: 1; }
.row .method { flex: 0 0 90px; }

/* 多行文本 */
.patterns, .template {
  width: 100%;
  font-family: var(--moo-ff-mono);
  font-size: var(--moo-fs-sm);
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  padding: 8px 10px;
  resize: vertical;
  box-sizing: border-box;
  line-height: 1.55;
  color: var(--moo-c-text);
  background: var(--moo-c-bg);
  transition: border-color var(--moo-motion-fast), box-shadow var(--moo-motion-fast);
}
.patterns:focus, .template:focus {
  outline: none;
  border-color: var(--moo-c-brand);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, .15);
}

/* 段落标题 */
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 22px 0 10px;
  padding-top: 14px;
  border-top: 1px solid var(--moo-c-divider);
}
.section-head h4 {
  margin: 0;
  font-size: var(--moo-fs-base);
  font-weight: 600;
  color: var(--moo-c-text);
  letter-spacing: -.005em;
}

/* 服务器卡 */
.server-card {
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-lg);
  padding: 14px;
  margin-bottom: 14px;
  background: var(--moo-c-bg-soft);
}

/* Header KV */
.kv-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 4px 0 10px;
}
.kv-row { display: flex; gap: 8px; align-items: center; }
.kv-row input {
  flex: 1;
  height: 26px;
  font-size: var(--moo-fs-sm);
  padding: 0 8px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  background: var(--moo-c-bg);
  color: var(--moo-c-text);
  font-family: var(--moo-ff-mono);
  min-width: 0;
}
.kv-row input:focus {
  outline: none;
  border-color: var(--moo-c-brand);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, .15);
}

/* 通用按钮 */
.btn, .danger-btn, .icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  padding: 0 12px;
  font-size: var(--moo-fs-sm);
  font-weight: 500;
  font-family: inherit;
  border: 1px solid var(--moo-c-border);
  background: var(--moo-c-bg);
  color: var(--moo-c-text);
  border-radius: var(--moo-r-md);
  cursor: pointer;
  transition: background-color var(--moo-motion-fast), border-color var(--moo-motion-fast), color var(--moo-motion-fast);
}
.btn:hover, .icon-btn:hover {
  background: var(--moo-c-bg-soft);
  border-color: var(--moo-c-text-faint);
}
.btn.small, .danger-btn.small, .icon-btn.small,
.btn.small { height: 22px; padding: 0 9px; font-size: var(--moo-fs-xs); }
.danger-btn { color: var(--moo-c-danger-fg); }
.danger-btn:hover {
  background: var(--moo-c-danger-soft);
  border-color: var(--moo-c-danger-soft);
}
.icon-btn { padding: 0 9px; }

/* 模板提示 */
.tpl-hint {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-muted);
  margin-top: 6px;
  line-height: 1.6;
}
.tpl-hint code {
  background: var(--moo-c-bg-elev);
  color: var(--moo-c-text-muted);
  padding: 1px 5px;
  border-radius: var(--moo-r-sm);
  margin-right: 4px;
  font-family: var(--moo-ff-mono);
  font-size: 10px;
}
.inline-code {
  background: var(--moo-c-bg-elev);
  color: var(--moo-c-text-muted);
  padding: 1px 5px;
  border-radius: var(--moo-r-sm);
  font-family: var(--moo-ff-mono);
  font-size: 10px;
}
</style>
