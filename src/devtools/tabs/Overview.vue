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

const filtered = computed(() => {
  const now = performance.now()
  let arr = windowMs.value < 0
    ? requests.value
    : requests.value.filter((r) => r.startTime + r.duration >= now - windowMs.value)
  if (filter.value.trim()) {
    const f = filter.value.trim().toLowerCase()
    arr = arr.filter((r) => r.url.toLowerCase().includes(f))
  }
  return arr.slice().reverse()
})

const filteredErrors = computed(() => {
  const now = performance.now()
  let arr = windowMs.value < 0
    ? errors.value
    : errors.value.filter((e) => e.startTime >= now - windowMs.value)
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
  background: #fff;
  font-size: 12px;
}
.toolbar {
  flex: none;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid #eee;
  background: #fafafa;
}
.mode-tabs { display: flex; gap: 0; border: 1px solid #ddd; border-radius: 3px; overflow: hidden; }
.mode-tabs .mode {
  background: #fff;
  border: none;
  padding: 4px 10px;
  font-size: 11px;
  color: #555;
  cursor: pointer;
}
.mode-tabs .mode + .mode { border-left: 1px solid #ddd; }
.mode-tabs .mode:hover { background: #f5f5f5; }
.mode-tabs .mode.active { background: #1a73e8; color: #fff; }
.toolbar .filter { flex: 1; padding: 4px 8px; border: 1px solid #ddd; border-radius: 3px; font-size: 12px; min-width: 0; }
.toolbar .select { padding: 4px 6px; border: 1px solid #ddd; border-radius: 3px; font-size: 11px; }
.toolbar .inline { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #555; }
.toolbar .btn { font-size: 11px; padding: 3px 10px; border: 1px solid #ddd; background: #fff; border-radius: 3px; cursor: pointer; }
.toolbar .btn:hover { background: #f5f5f5; }
.toolbar .btn.danger { color: #c0392b; }
.toolbar .count { font-size: 11px; color: #888; margin-left: auto; }

.status-bar {
  flex: none;
  padding: 4px 10px;
  background: #fef3c7;
  color: #92400e;
  font-size: 11px;
  border-bottom: 1px solid #fde68a;
}

.list { flex: 1; overflow: auto; font-family: ui-monospace, Menlo, monospace; }
.row { border-bottom: 1px solid #f3f3f3; }
.row.open { background: #f9fafb; }
.row-head {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 4px 10px;
  cursor: pointer;
}
.row-head:hover { background: #f5f5f5; }
.row-head .method { flex: 0 0 50px; font-weight: 600; color: #555; }
.row-head .method.post { color: #d97706; }
.row-head .method.put, .row-head .method.patch { color: #2563eb; }
.row-head .method.delete { color: #dc2626; }
.row-head .status { flex: 0 0 38px; font-size: 10px; padding: 1px 4px; border-radius: 2px; text-align: center; }
.row-head .status.ok { background: #dcfce7; color: #15803d; }
.row-head .status.warn { background: #fef3c7; color: #b45309; }
.row-head .status.err { background: #fee2e2; color: #b91c1c; }
.row-head .url { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #444; }
.row-head .dur { flex: 0 0 55px; text-align: right; color: #888; }
.row-head .time { flex: 0 0 65px; color: #999; }

.row-detail {
  padding: 6px 10px 10px;
  background: #fff;
  border-top: 1px solid #eee;
}
.kv { display: flex; gap: 8px; font-size: 11px; padding: 2px 0; }
.kv .k { flex: 0 0 80px; color: #888; }
.kv .v { flex: 1; word-break: break-all; }
.kv .v.err { color: #b91c1c; }
.row-detail h5 { margin: 8px 0 4px; font-size: 11px; color: #555; }
.row-detail .mono {
  background: #f7f7f7;
  border: 1px solid #eee;
  border-radius: 3px;
  padding: 6px 8px;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 160px;
  overflow: auto;
  font-family: ui-monospace, Menlo, monospace;
  margin: 0;
}

.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 12px;
  padding: 20px;
  text-align: center;
}
</style>
