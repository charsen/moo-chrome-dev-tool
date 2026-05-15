<template>
  <div class="overview">
    <header class="toolbar">
      <div class="mode-tabs">
        <button :class="['mode', { active: mode === 'req' }]" @click="mode = 'req'">请求 ({{ requests.length }})</button>
        <button :class="['mode', { active: mode === 'err' }]" @click="mode = 'err'">错误 ({{ errors.length }})</button>
      </div>
      <input v-model="filter" :placeholder="mode === 'req' ? '按 URL 过滤' : '按 message 过滤'" class="filter" />
      <select v-model.number="windowMs" class="select">
        <option :value="5000">最近 5s</option>
        <option :value="15000">最近 15s</option>
        <option :value="30000">最近 30s</option>
        <option :value="60000">最近 60s</option>
        <option :value="-1">全部</option>
      </select>
      <label class="inline">
        <input type="checkbox" v-model="autoRefresh" /> 自动刷新
      </label>
      <button class="btn" @click="refresh" :disabled="loading">刷新</button>
      <button class="btn danger" @click="clearAll">清空</button>
      <span class="count">{{ mode === 'req' ? `${filtered.length} / ${requests.length}` : `${filteredErrors.length} / ${errors.length}` }}</span>
    </header>

    <div class="status-bar" v-if="error">{{ error }}</div>

    <div class="list" v-if="mode === 'req' && filtered.length">
      <div
        v-for="r in filtered"
        :key="r.id"
        :class="['row', { open: openId === r.id }]"
      >
        <div class="row-head" @click="toggle(r.id)">
          <span :class="['method', r.method.toLowerCase()]">{{ r.method }}</span>
          <span :class="['status', statusClass(r.status)]">{{ r.status || 'ERR' }}</span>
          <span class="url" :title="r.url">{{ shortUrl(r.url) }}</span>
          <span class="dur">{{ Math.round(r.duration) }}ms</span>
          <span class="time">{{ formatTime(r.startedAt) }}</span>
        </div>
        <div class="row-detail" v-if="openId === r.id">
          <div class="kv"><span class="k">URL</span><span class="v mono">{{ r.url }}</span></div>
          <div class="kv"><span class="k">Kind</span><span class="v">{{ r.kind }}</span></div>
          <div class="kv" v-if="r.error"><span class="k">Error</span><span class="v err">{{ r.error }}</span></div>
          <section v-if="Object.keys(r.requestHeaders).length">
            <h5>Request Headers</h5>
            <pre class="mono">{{ formatHeaders(r.requestHeaders) }}</pre>
          </section>
          <section v-if="r.requestBody">
            <h5>Request Body</h5>
            <pre class="mono">{{ r.requestBody }}</pre>
          </section>
          <section v-if="Object.keys(r.responseHeaders).length">
            <h5>Response Headers</h5>
            <pre class="mono">{{ formatHeaders(r.responseHeaders) }}</pre>
          </section>
          <section v-if="r.responseBody">
            <h5>Response Body ({{ r.responseSizeBytes }}b)</h5>
            <pre class="mono">{{ r.responseBody }}</pre>
          </section>
        </div>
      </div>
    </div>

    <div class="list" v-else-if="mode === 'err' && filteredErrors.length">
      <div
        v-for="e in filteredErrors"
        :key="e.id"
        :class="['row', { open: openId === e.id }]"
      >
        <div class="row-head" @click="toggle(e.id)">
          <span :class="['status', e.level === 'rejection' ? 'err' : e.level === 'console' ? 'warn' : 'err']">
            {{ e.level === 'rejection' ? 'REJ' : e.level === 'console' ? 'CON' : 'ERR' }}
          </span>
          <span class="url" :title="e.message">{{ e.message }}</span>
          <span class="time">{{ formatTime(e.startedAt) }}</span>
        </div>
        <div class="row-detail" v-if="openId === e.id">
          <div class="kv" v-if="e.source"><span class="k">Source</span><span class="v mono">{{ e.source }}:{{ e.line }}:{{ e.col }}</span></div>
          <section v-if="e.stack">
            <h5>Stack</h5>
            <pre class="mono">{{ e.stack }}</pre>
          </section>
        </div>
      </div>
    </div>

    <div class="empty" v-else>
      <p v-if="loading">加载中…</p>
      <p v-else-if="mode === 'req'">暂无请求。注入脚本只能抓取脚本注入之后的请求 —— 安装/刷新扩展后，刷新页面即可开始捕获。</p>
      <p v-else>暂无错误。<br>捕获范围：window.onerror、unhandledrejection、console.error。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CapturedRequest } from '@/types/requests'
import type { ConsoleError } from '@/types/errors'
import { MSG, type GetErrorsRes, type GetRequestsRes } from '@/types/messages'

const tabId = chrome.devtools.inspectedWindow.tabId
const requests = ref<CapturedRequest[]>([])
const errors = ref<ConsoleError[]>([])
const loading = ref(false)
const error = ref('')
const filter = ref('')
const windowMs = ref(30000)
const autoRefresh = ref(true)
const openId = ref('')
const mode = ref<'req' | 'err'>('req')

let timer: number | undefined

function send<T>(msg: { type: string }): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { ...msg, source: 'devtools' }, (r) => {
        if (chrome.runtime.lastError) {
          error.value = chrome.runtime.lastError.message ?? ''
          resolve(undefined)
        } else resolve(r as T)
      })
    } catch (e) {
      error.value = (e as Error).message
      if (timer) { clearInterval(timer); timer = undefined }
      resolve(undefined)
    }
  })
}

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const [r, e] = await Promise.all([
      send<GetRequestsRes>({ type: MSG.GET_REQUESTS }),
      send<GetErrorsRes>({ type: MSG.GET_ERRORS })
    ])
    if (r) requests.value = r.requests
    if (e) errors.value = e.errors
  } finally {
    loading.value = false
  }
}

async function clearAll() {
  const label = mode.value === 'req' ? '请求' : '错误'
  if (!confirm(`清空当前 Tab 的${label}记录？`)) return
  if (mode.value === 'req') {
    await send({ type: MSG.CLEAR_REQUESTS })
    requests.value = []
  } else {
    await send({ type: MSG.CLEAR_ERRORS })
    errors.value = []
  }
}

// 注：time-window 过滤用 startedAt（wall clock），不用 startTime。
// startTime 来自网页主世界的 performance.now()，跟 devtools panel 的 performance.now()
// 是两个独立时钟原点，跨上下文比较永远过不了窗口。
const filtered = computed(() => {
  const now = Date.now()
  let arr = windowMs.value < 0
    ? requests.value
    : requests.value.filter((r) => {
        const ts = new Date(r.startedAt).getTime()
        return ts + r.duration >= now - windowMs.value
      })
  if (filter.value.trim()) {
    const f = filter.value.trim().toLowerCase()
    arr = arr.filter((r) => r.url.toLowerCase().includes(f))
  }
  return arr.slice().reverse()
})

const filteredErrors = computed(() => {
  const now = Date.now()
  let arr = windowMs.value < 0
    ? errors.value
    : errors.value.filter((e) => new Date(e.startedAt).getTime() >= now - windowMs.value)
  if (filter.value.trim()) {
    const f = filter.value.trim().toLowerCase()
    arr = arr.filter((e) => e.message.toLowerCase().includes(f))
  }
  return arr.slice().reverse()
})

function toggle(id: string) {
  openId.value = openId.value === id ? '' : id
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.host + u.pathname + (u.search ? u.search : '')
  } catch {
    return url
  }
}

function statusClass(s: number) {
  if (!s) return 'err'
  if (s >= 500) return 'err'
  if (s >= 400) return 'warn'
  return 'ok'
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  } catch {
    return ''
  }
}

function formatHeaders(h: Record<string, string>): string {
  return Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\n')
}

onMounted(() => {
  refresh()
  timer = window.setInterval(() => {
    if (autoRefresh.value) refresh()
  }, 1500)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.overview {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--moo-c-bg);
  font-size: var(--moo-fs-sm);
  color: var(--moo-c-text);
}

/* 工具栏 */
.toolbar {
  flex: none;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--moo-c-border);
  background: var(--moo-c-bg);
}

/* 模式切换（请求 / 错误） */
.mode-tabs {
  display: flex;
  background: var(--moo-c-bg-elev);
  border-radius: var(--moo-r-md);
  padding: 2px;
}
.mode-tabs .mode {
  background: transparent;
  border: none;
  padding: 4px 12px;
  height: 24px;
  font-size: var(--moo-fs-xs);
  font-weight: 500;
  font-family: inherit;
  color: var(--moo-c-text-muted);
  border-radius: var(--moo-r-sm);
  cursor: pointer;
  transition: background-color var(--moo-motion-fast), color var(--moo-motion-fast);
}
.mode-tabs .mode:hover { color: var(--moo-c-text); }
.mode-tabs .mode.active {
  background: var(--moo-c-bg);
  color: var(--moo-c-text);
  box-shadow: var(--moo-sh-sm);
}

.toolbar .filter {
  flex: 1;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  background: var(--moo-c-bg);
  font-family: inherit;
  font-size: var(--moo-fs-sm);
  color: var(--moo-c-text);
  min-width: 0;
  transition: border-color var(--moo-motion-fast), box-shadow var(--moo-motion-fast);
}
.toolbar .filter:focus {
  outline: none;
  border-color: var(--moo-c-brand);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, .15);
}
.toolbar .select {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  background: var(--moo-c-bg);
  font-family: inherit;
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text);
}
.toolbar .inline {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-muted);
  cursor: pointer;
}
.toolbar .btn {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 12px;
  font-size: var(--moo-fs-xs);
  font-weight: 500;
  font-family: inherit;
  border: 1px solid var(--moo-c-border);
  background: var(--moo-c-bg);
  color: var(--moo-c-text);
  border-radius: var(--moo-r-md);
  cursor: pointer;
  transition: background-color var(--moo-motion-fast), border-color var(--moo-motion-fast);
}
.toolbar .btn:hover { background: var(--moo-c-bg-soft); border-color: var(--moo-c-text-faint); }
.toolbar .btn.danger { color: var(--moo-c-danger-fg); }
.toolbar .btn.danger:hover { background: var(--moo-c-danger-soft); border-color: var(--moo-c-danger-soft); }
.toolbar .count {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
  font-family: var(--moo-ff-mono);
  margin-left: auto;
}

/* 状态提示条 */
.status-bar {
  flex: none;
  padding: 6px 14px;
  background: var(--moo-c-warn-soft);
  color: var(--moo-c-warn-fg);
  font-size: var(--moo-fs-xs);
  border-bottom: 1px solid var(--moo-c-warn-soft);
}

/* 列表 */
.list {
  flex: 1;
  overflow: auto;
  font-family: var(--moo-ff-mono);
  padding: 2px;
}
.row {
  border-radius: var(--moo-r-sm);
  transition: background-color var(--moo-motion-fast);
}
.row:hover { background: var(--moo-c-bg-soft); }
.row.open {
  background: var(--moo-c-bg-soft);
  border: 1px solid var(--moo-c-border);
  margin-bottom: 4px;
}

.row-head {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 6px 12px;
  cursor: pointer;
}
.row-head .method {
  flex: 0 0 50px;
  font-weight: 600;
  color: var(--moo-c-text-muted);
}
.row-head .method.post                            { color: var(--moo-c-warn-fg); }
.row-head .method.put, .row-head .method.patch    { color: var(--moo-c-info); }
.row-head .method.delete                          { color: var(--moo-c-danger-fg); }
.row-head .status {
  flex: 0 0 38px;
  font-size: 10px;
  padding: 2px 5px;
  border-radius: var(--moo-r-sm);
  text-align: center;
  font-weight: 600;
}
.row-head .status.ok    { background: var(--moo-c-success-soft); color: var(--moo-c-success-fg); }
.row-head .status.warn  { background: var(--moo-c-warn-soft);    color: var(--moo-c-warn-fg); }
.row-head .status.err   { background: var(--moo-c-danger-soft);  color: var(--moo-c-danger-fg); }
.row-head .url {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--moo-c-text);
  font-size: var(--moo-fs-xs);
}
.row-head .dur {
  flex: 0 0 60px;
  text-align: right;
  color: var(--moo-c-text-dim);
  font-size: var(--moo-fs-xs);
}
.row-head .time {
  flex: 0 0 65px;
  color: var(--moo-c-text-dim);
  font-size: var(--moo-fs-xs);
}

.row-detail {
  padding: 10px 14px 14px;
  background: var(--moo-c-bg);
  border-top: 1px solid var(--moo-c-divider);
}
.kv {
  display: flex;
  gap: 10px;
  font-size: var(--moo-fs-xs);
  padding: 3px 0;
}
.kv .k {
  flex: 0 0 80px;
  color: var(--moo-c-text-dim);
}
.kv .v {
  flex: 1;
  word-break: break-all;
  color: var(--moo-c-text);
}
.kv .v.err { color: var(--moo-c-danger-fg); }
.row-detail h5 {
  margin: 10px 0 6px;
  font-size: var(--moo-fs-xs);
  font-weight: 600;
  color: var(--moo-c-text-muted);
  text-transform: uppercase;
  letter-spacing: .04em;
}
.row-detail .mono {
  background: var(--moo-c-bg-soft);
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  padding: 8px 10px;
  font-size: var(--moo-fs-xs);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 180px;
  overflow: auto;
  font-family: var(--moo-ff-mono);
  margin: 0;
  color: var(--moo-c-text);
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--moo-c-text-dim);
  font-size: var(--moo-fs-sm);
  padding: 40px;
  text-align: center;
}
.empty::before {
  content: "🌐";
  font-size: 32px;
  opacity: .5;
}
</style>
