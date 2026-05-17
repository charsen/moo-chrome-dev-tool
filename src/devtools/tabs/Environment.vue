<template>
  <div v-if="!loaded" class="loading">加载配置中…</div>
  <div v-else class="env-wrap">
    <div v-if="toast" :class="['moo-toast', `moo-toast--${toastKind}`]">{{ toast }}</div>
    <div class="save-bar" :class="`is-${saveState}`">
      <span class="status-msg">
        <template v-if="saveState === 'saving'">保存中…</template>
        <template v-else-if="saveState === 'error'">
          ⚠ 保存没成功 — 可能 chrome.storage 配额满了，请点「重试」或清理一些项目
          <button class="retry-btn" @click="retrySave">重试</button>
        </template>
        <template v-else>✓ 已自动保存</template>
      </span>
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
        <!-- 项目数 > 6 才显示搜索框：少量项目时一眼能看完，搜索反而占空间 -->
        <div v-if="draft.projects.length > 6" class="project-search">
          <input
            v-model="projectFilter"
            type="search"
            placeholder="搜索项目"
            aria-label="搜索项目"
          />
        </div>
        <ul class="project-list">
          <li
            v-for="p in filteredProjects"
            :key="p.id"
            :class="['project-item', { active: p.id === activeId }]"
            @click="activeId = p.id"
          >
            <span class="dot" :class="{ off: !p.enabled }" />
            <span class="name">{{ p.name || '(未命名)' }}</span>
            <span class="count" :class="{ 'count--zero': p.servers.length === 0 }" :title="p.servers.length === 0 ? '没有上报服务器，悬浮球能匹配但提交会失败' : `${p.servers.length} 个上报服务器`">
              {{ p.servers.length === 0 ? '⚠ 无服务器' : p.servers.length }}
            </span>
          </li>
          <li v-if="!draft.projects.length" class="empty">暂无项目，点击 + 新建</li>
          <li v-else-if="!filteredProjects.length" class="empty">未匹配到项目</li>
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
          <div class="token-input">
            <input
              v-model="activeProject.token"
              :type="tokenVisible ? 'text' : 'password'"
              placeholder="从 /scaffold/accounts 获取你的个人 token"
              autocomplete="off"
              spellcheck="false"
              class="grow"
            />
            <button
              type="button"
              class="token-toggle"
              :aria-label="tokenVisible ? '隐藏 token' : '显示 token'"
              :title="tokenVisible ? '隐藏' : '显示'"
              @click="tokenVisible = !tokenVisible"
            >{{ tokenVisible ? '🙈' : '👁' }}</button>
          </div>
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

        <div v-if="!activeProject.servers.length" class="server-empty-warn">
          ⚠ 这个项目没有上报服务器，<b>悬浮球能匹配但点提交会失败</b>。点上面「+ 新建服务器」配一个。
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
            <label>请求 URL</label>
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
              <button
                class="icon-btn"
                :aria-label="`移除 Header ${headerEntries(s)[i][0]}`"
                @click="removeHeader(s, headerEntries(s)[i][0])"
              >×</button>
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
          <div class="row template-row-head">
            <label>Payload 模板</label>
            <button class="btn small" type="button" @click="openTemplateEditor(s)">
              ⤢ 大尺寸编辑
            </button>
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

    <PayloadEditorModal
      v-if="editingTemplate"
      :model-value="editingTemplate.server.payloadTemplate"
      @save="onTemplateSave"
      @cancel="editingTemplate = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useConfig } from '@/composables/useConfig'
import {
  createDefaultProject,
  createDefaultServer,
  normalizeProject,
  type BugServer,
  type MooConfig,
  type Project
} from '@/types/config'
import { clone } from '@/utils/clone'
import { confirmDialog } from '../components/confirm'
import PayloadEditorModal from '../components/PayloadEditorModal.vue'

const { config, loaded, save } = useConfig()

const draft = ref<MooConfig>({ projects: [], globalEnabled: true })
const activeId = ref<string>('')
const initialized = ref(false)
/** Token 输入框默认遮罩，眼睛按钮切换显示。录屏/演示场景不暴露明文。 */
const tokenVisible = ref(false)
/** 项目列表搜索（项目 > 6 个时显示搜索框） */
const projectFilter = ref('')

const filteredProjects = computed(() => {
  const f = projectFilter.value.trim().toLowerCase()
  if (!f) return draft.value.projects
  return draft.value.projects.filter((p) => (p.name || '').toLowerCase().includes(f))
})

/** 大尺寸 payload 模板编辑器：记住当前在编哪个 server 的模板 */
const editingTemplate = ref<{ server: BugServer } | null>(null)
function openTemplateEditor(server: BugServer) {
  editingTemplate.value = { server }
}
function onTemplateSave(value: string) {
  if (editingTemplate.value) {
    editingTemplate.value.server.payloadTemplate = value
  }
  editingTemplate.value = null
}

// === 自动保存：draft 任何深层变化触发 800ms 防抖，再提交到 config 并落盘 ===
// 沿用了原有 draft 层是为了在用户高频输入（如 URL 模板）期间避免每次 keystroke
// 都触发 onConfigChanged → 内容脚本重新匹配的"在键入中已被部分应用"问题。
type SaveState = 'idle' | 'saving' | 'saved' | 'error'
const SAVE_DEBOUNCE_MS = 800
const saveState = ref<SaveState>('idle')
let saveDebounceTimer: number | undefined
let savedHideTimer: number | undefined

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

// 任何 draft 变更 → 防抖 800ms → 落盘
watch(
  draft,
  () => {
    if (!initialized.value) return
    if (!dirty.value) return // draft 与 config 等价，不需要再写
    scheduleSave()
  },
  { deep: true }
)

function scheduleSave() {
  saveState.value = 'saving'
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer)
  saveDebounceTimer = window.setTimeout(doSave, SAVE_DEBOUNCE_MS)
}

async function doSave() {
  // 标记防抖 timer 已 fire；若 save 期间用户继续输入会再次 scheduleSave 把它设回 number
  saveDebounceTimer = undefined
  try {
    config.value = clone(draft.value)
    await save()
    // 仅在没有后续保存还在路上时才切到 saved，避免来回闪
    if (!saveDebounceTimer) {
      saveState.value = 'saved'
      if (savedHideTimer) clearTimeout(savedHideTimer)
      savedHideTimer = window.setTimeout(() => {
        if (saveState.value === 'saved') saveState.value = 'idle'
      }, 1500)
    }
  } catch (e) {
    saveState.value = 'error'
    showToast(`改动没保存成功：${(e as Error).message}。点击顶部的"重试"按钮再试一次`, 'error')
  }
}

function retrySave() {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer)
    saveDebounceTimer = undefined
  }
  void doSave()
}

// 切 tab 时清掉所有 pending timer，否则切走后 doSave 还会执行写陈旧 draft，
// savedHideTimer / toastTimer 同样要清，避免 setState 到已销毁的 ref
onBeforeUnmount(() => {
  if (saveDebounceTimer) { clearTimeout(saveDebounceTimer); saveDebounceTimer = undefined }
  if (savedHideTimer)    { clearTimeout(savedHideTimer);    savedHideTimer = undefined }
  if (toastTimer)        { clearTimeout(toastTimer);        toastTimer = undefined }
})

function addProject() {
  const p = createDefaultProject(`项目 ${draft.value.projects.length + 1}`)
  draft.value.projects.push(p)
  activeId.value = p.id
}

async function removeProject(id: string) {
  const proj = draft.value.projects.find((p) => p.id === id)
  const serverCount = proj?.servers.length ?? 0
  const ok = await confirmDialog({
    title: `删除项目「${proj?.name || '(未命名)'}」？`,
    message: `项目下的 ${serverCount} 个上报服务器配置会一起被删，0.8 秒后自动保存到本地。\n该域名下的网页不再显示悬浮球。`,
    danger: true,
    confirmText: '确认删除'
  })
  if (!ok) return
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

async function removeServer(id: string) {
  if (!activeProject.value) return
  const srv = activeProject.value.servers.find((s) => s.id === id)
  const ok = await confirmDialog({
    title: `删除服务器「${srv?.name || '(未命名)'}」？`,
    message: '这台服务器的所有配置（请求 URL / 请求头 / Payload 模板）会被删除，0.8 秒后自动保存。\n如果是当前项目的唯一服务器，删完后这个项目暂时无法上报。',
    danger: true,
    confirmText: '确认删除'
  })
  if (!ok) return
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

/** 导入配置上限 1MB —— 即使有 100 个项目 × 50 个 server × 64KB 模板，正常也只到几 MB；
 *  超出大概率是恶意 / 损坏文件，避免 JSON.parse 阻塞 devtools 渲染进程几秒 */
const IMPORT_MAX_BYTES = 1024 * 1024

function importConfig() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    if (file.size > IMPORT_MAX_BYTES) {
      showToast(`这个文件太大（${(file.size / 1024 / 1024).toFixed(1)} MB > 1 MB 上限）。Moo 导出的正常配置不会这么大，请确认文件是否损坏或被篡改`, 'error')
      return
    }
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.projects)) {
        showToast('这个 JSON 文件格式不对（应该有顶层 projects 数组）。请确认是 Moo 导出的配置文件', 'error')
        return
      }
      // 安全确认：导入他人配置 = 同意把本机抓取的请求/cookie/storage 发到这些 endpoint。
      // 列出所有 host 让用户在落盘前看清楚，避免被预置的恶意 endpoint 偷数据。
      const endpoints = collectEndpoints(parsed.projects)
      // 同时数一下「带预置 token 的项目」—— 别人给你的配置里如果带了他的 token，
      // 导入后你提交 bug 都会用他的身份记录到他的看板，是一种钓鱼手法。必须显式告知用户。
      const tokenCount = countProjectsWithToken(parsed.projects)
      if (endpoints.length > 0 || tokenCount > 0) {
        const lines: string[] = []
        if (endpoints.length > 0) {
          lines.push(
            '这份配置会把抓取到的数据上报到下列地址：',
            '',
            ...endpoints.map((e) => `  • ${e}`),
            '',
            '导入后，匹配规则命中时本机的请求 / cookie / storage / 截图都会发往以上地址。'
          )
        }
        if (tokenCount > 0) {
          if (lines.length) lines.push('')
          lines.push(`⚠ 其中 ${tokenCount} 个项目自带了预置 token——使用 Moo 提交 bug 时会用「配置作者」的身份上报，不是你自己的。如果不认识这份配置的来源，建议导入后手动清空 token 字段，改成自己的。`)
        }
        const ok = await confirmDialog({
          title: '确认导入配置',
          message: lines.join('\n'),
          danger: true,
          confirmText: '导入'
        })
        if (!ok) return
      }
      // 逐个 project normalize：导入他人或老版本 JSON 时可能缺 capture/redact/servers 等字段，
      // 走 normalize 兜底，避免后续 UI 读取 active.capture.xxx 时炸
      draft.value = {
        projects: parsed.projects.map(normalizeProject),
        globalEnabled: typeof parsed.globalEnabled === 'boolean' ? parsed.globalEnabled : true
      }
      activeId.value = draft.value.projects[0]?.id ?? ''
    } catch (e) {
      showToast(`没能读取这个文件：${(e as Error).message}。请确认是 Moo 导出的 JSON 配置文件`, 'error')
    }
  }
  input.click()
}

/** 数一下导入 JSON 里有多少个 project 带 .token 字段（仅做提示，不做拦截） */
function countProjectsWithToken(projects: unknown[]): number {
  let n = 0
  for (const p of projects) {
    const t = (p as { token?: unknown })?.token
    if (typeof t === 'string' && t.trim()) n++
  }
  return n
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

/* 顶部保存状态条（自动保存语义，无手动按钮） */
.save-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--moo-c-border);
  background: var(--moo-c-bg);
  font-size: var(--moo-fs-xs);
  min-height: 28px;
}
.save-bar .status-msg {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--moo-c-text-muted);
  transition: color var(--moo-motion-fast);
}
.save-bar.is-saving .status-msg { color: var(--moo-c-text); }
.save-bar.is-saved  .status-msg { color: var(--moo-c-success); font-weight: 500; }
.save-bar.is-error  .status-msg { color: var(--moo-c-danger);  font-weight: 500; }
.save-bar .retry-btn {
  background: transparent;
  border: 1px solid var(--moo-c-danger);
  color: var(--moo-c-danger);
  border-radius: var(--moo-r-sm);
  padding: 1px 8px;
  font-size: var(--moo-fs-xs);
  cursor: pointer;
  font-family: inherit;
}
.save-bar .retry-btn:hover { background: var(--moo-c-danger-soft); }

/* 项目搜索框（项目 > 6 时显示） */
.project-search {
  padding: 4px 10px 6px;
  border-bottom: 1px solid var(--moo-c-divider);
}
.project-search input {
  width: 100%;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  background: var(--moo-c-bg);
  font-size: var(--moo-fs-xs);
  font-family: inherit;
  color: var(--moo-c-text);
  transition: border-color var(--moo-motion-fast), box-shadow var(--moo-motion-fast);
}
.project-search input:focus {
  outline: none;
  border-color: var(--moo-c-brand);
  box-shadow: 0 0 0 3px var(--moo-c-focus-ring);
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
  box-shadow: 0 0 0 2px var(--moo-c-success-halo);
}
.dot.off {
  background: var(--moo-c-text-faint);
  box-shadow: none;
}
.name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.count { color: var(--moo-c-text-dim); font-size: var(--moo-fs-xs); font-family: var(--moo-ff-mono); }
.project-item.active .count { color: var(--moo-c-brand); }
/* 0 服务器的项目：用警示色提示用户这条配置不完整，hover 看 title */
.count--zero,
.project-item.active .count--zero { color: var(--moo-c-warn-fg); font-family: var(--moo-ff-sans); }

.server-empty-warn {
  margin: 8px 0 12px;
  padding: 10px 12px;
  background: var(--moo-c-warn-soft);
  border: 1px solid var(--moo-c-warn);
  border-radius: var(--moo-r-md);
  color: var(--moo-c-warn-fg);
  font-size: var(--moo-fs-sm);
  line-height: 1.5;
}
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
.row input[type="password"],
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
.row input[type="password"]:focus,
.row input:not([type]):focus,
.row select:focus {
  outline: none;
  border-color: var(--moo-c-brand);
  box-shadow: 0 0 0 3px var(--moo-c-focus-ring);
}

/* Token 输入框 + 显隐切换 */
.token-input {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.token-input input { font-family: var(--moo-ff-mono); }
.token-toggle {
  flex: 0 0 28px;
  height: 28px;
  border: 1px solid var(--moo-c-border);
  background: var(--moo-c-bg);
  border-radius: var(--moo-r-md);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  transition: background-color var(--moo-motion-fast), border-color var(--moo-motion-fast);
}
.token-toggle:hover { background: var(--moo-c-bg-soft); border-color: var(--moo-c-text-faint); }
.row .narrow { flex: 0 0 130px; }
.row .grow   { flex: 1; }
.row .method { flex: 0 0 90px; }

/* Payload 模板行的头：label + "大尺寸编辑" 按钮齐高 */
.template-row-head {
  align-items: center;
}
.template-row-head label { flex: 1; }

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
  box-shadow: 0 0 0 3px var(--moo-c-focus-ring);
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
  box-shadow: 0 0 0 3px var(--moo-c-focus-ring);
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
