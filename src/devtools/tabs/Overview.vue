<template>
  <div class="overview">
    <header class="toolbar">
      <div class="kind-filters" role="group" aria-label="按类型筛选">
        <button
          :class="['kind-chip', { active: kinds.has('request') }]"
          :aria-pressed="kinds.has('request')"
          @click="toggleKind('request')"
        >
          <span class="kind-dot kind-dot--req" />
          请求
          <span class="kind-count">{{ requests.length }}</span>
        </button>
        <button
          :class="['kind-chip', { active: kinds.has('error') }]"
          :aria-pressed="kinds.has('error')"
          @click="toggleKind('error')"
        >
          <span class="kind-dot kind-dot--err" />
          错误
          <span class="kind-count">{{ errors.length }}</span>
        </button>
      </div>
      <input v-model="filter" placeholder="按 URL / 错误信息过滤" class="filter" />
      <select v-model.number="windowMs" class="select" aria-label="时间窗口">
        <option :value="5000">最近 5s</option>
        <option :value="15000">最近 15s</option>
        <option :value="30000">最近 30s</option>
        <option :value="60000">最近 60s</option>
        <option :value="-1">全部</option>
      </select>
      <button
        class="icon-btn"
        :class="{ 'is-on': autoRefresh }"
        :title="autoRefresh ? '自动刷新：开（点击关）' : '自动刷新：关（点击开）'"
        :aria-pressed="autoRefresh"
        @click="autoRefresh = !autoRefresh"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 6V3l-4 4 4 4V8a6 6 0 1 1-6 6"/>
        </svg>
        <span v-if="autoRefresh" class="icon-btn-pulse" aria-hidden="true" />
      </button>
      <button class="icon-btn" title="刷新" :disabled="loading" @click="refresh">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 1 1 3 6.7"/>
          <path d="M3 21v-5h5"/>
        </svg>
      </button>
      <button class="icon-btn danger" title="清空当前 Tab 数据" @click="clearAll">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/>
          <path d="M10 11v6M14 11v6"/>
        </svg>
      </button>
      <span class="count">{{ timeline.length }} / {{ requests.length + errors.length }}</span>
    </header>

    <div class="status-bar" v-if="error">{{ error }}</div>

    <div class="list" v-if="timeline.length">
      <template v-for="item in timeline" :key="item.kind + ':' + item.data.id">
        <!-- 请求行 -->
        <div
          v-if="item.kind === 'request'"
          :class="['row', { open: openId === item.data.id }]"
        >
          <div class="row-head" @click="toggle(item.data.id)">
            <span class="kind-tag kind-tag--req" title="网络请求">REQ</span>
            <span :class="['method', item.data.method.toLowerCase()]">{{ item.data.method }}</span>
            <span :class="['status', statusClass(item.data.status)]">{{ item.data.status || 'ERR' }}</span>
            <span class="url" :title="item.data.url">{{ shortUrl(item.data.url) }}</span>
            <span class="dur">{{ Math.round(item.data.duration) }}ms</span>
            <span class="time">{{ formatTime(item.data.startedAt) }}</span>
          </div>
          <div class="row-detail" v-if="openId === item.data.id">
            <div class="kv"><span class="k">URL</span><span class="v mono">{{ item.data.url }}</span></div>
            <div class="kv"><span class="k">Kind</span><span class="v">{{ item.data.kind }}</span></div>
            <div class="kv" v-if="item.data.error"><span class="k">Error</span><span class="v err">{{ item.data.error }}</span></div>
            <div v-if="item.data.requestBody || item.data.responseBody" class="body-search-wrap">
              <input
                v-model="bodySearch"
                type="search"
                class="body-search"
                placeholder="在 body 内搜索（高亮匹配，大小写不敏感）"
                aria-label="在 body 内搜索"
              />
            </div>
            <section v-if="Object.keys(item.data.requestHeaders).length">
              <h5>Request Headers</h5>
              <pre class="mono">{{ formatHeaders(item.data.requestHeaders) }}</pre>
            </section>
            <section v-if="item.data.requestBody">
              <h5>Request Body</h5>
              <pre class="mono" v-html="highlightBody(item.data.requestBody, bodySearch)" />
            </section>
            <section v-if="Object.keys(item.data.responseHeaders).length">
              <h5>Response Headers</h5>
              <pre class="mono">{{ formatHeaders(item.data.responseHeaders) }}</pre>
            </section>
            <section v-if="item.data.responseBody">
              <h5>Response Body ({{ item.data.responseSizeBytes }}b)</h5>
              <pre class="mono" v-html="highlightBody(item.data.responseBody, bodySearch)" />
            </section>
          </div>
        </div>

        <!-- 错误行 -->
        <div
          v-else
          :class="['row', 'row--err', { open: openId === item.data.id }]"
        >
          <div class="row-head" @click="toggle(item.data.id)">
            <span
              :class="['kind-tag', 'kind-tag--err']"
              :title="errLevelTitle(item.data.level)"
            >{{ errLevelLabel(item.data.level) }}</span>
            <span class="url err-msg" :title="item.data.message">{{ item.data.message }}</span>
            <span class="time">{{ formatTime(item.data.startedAt) }}</span>
          </div>
          <div class="row-detail" v-if="openId === item.data.id">
            <div class="kv" v-if="item.data.source"><span class="k">Source</span><span class="v mono">{{ item.data.source }}:{{ item.data.line }}:{{ item.data.col }}</span></div>
            <section v-if="item.data.stack">
              <h5>Stack</h5>
              <pre class="mono">{{ item.data.stack }}</pre>
            </section>
          </div>
        </div>
      </template>
    </div>

    <div class="empty" v-else>
      <p v-if="loading">加载中…</p>
      <p v-else-if="kinds.size === 0">两个类型都已隐藏；点上方筛选重新开启。</p>
      <template v-else>
        <p class="empty-title">还没捕获到任何请求或错误</p>
        <p class="empty-hint">
          扩展只能抓到「页面加载时已经在场」之后发起的内容。
          <br>
          如果你刚装好扩展或刚改完配置，先刷新一下页面再操作。
        </p>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CapturedRequest } from '@/types/requests'
import type { ConsoleError } from '@/types/errors'
import { MSG, type GetErrorsRes, type GetRequestsRes } from '@/types/messages'
import { confirmDialog } from '../components/confirm'

type Kind = 'request' | 'error'
type TimelineItem =
  | { kind: 'request'; data: CapturedRequest; ts: number }
  | { kind: 'error'; data: ConsoleError; ts: number }

const tabId = chrome.devtools.inspectedWindow.tabId
const requests = ref<CapturedRequest[]>([])
const errors = ref<ConsoleError[]>([])
const loading = ref(false)
const error = ref('')
const filter = ref('')
const windowMs = ref(30000)
const autoRefresh = ref(true)
const openId = ref('')
/** 请求/错误两个 kind 的开关。默认都看 —— 这是合并时间线的关键 UX 改进。 */
const kinds = ref<Set<Kind>>(new Set(['request', 'error']))

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
  // 一次性清空当前 Tab 的两类数据；分别清比来回切 mode 再清要顺手得多
  const ok = await confirmDialog({
    title: '清空当前 Tab 数据',
    message: '将清空已捕获的请求和错误。',
    danger: true,
    confirmText: '清空'
  })
  if (!ok) return
  await Promise.all([
    send({ type: MSG.CLEAR_REQUESTS }),
    send({ type: MSG.CLEAR_ERRORS })
  ])
  requests.value = []
  errors.value = []
}

function toggleKind(k: Kind) {
  const next = new Set(kinds.value)
  if (next.has(k)) next.delete(k)
  else next.add(k)
  kinds.value = next
}

// 合并时间线：按 startedAt 倒排（最新在上）。
// 注：time-window 过滤用 startedAt（wall clock），不用 startTime（performance.now
// 跨上下文不可比）。
const timeline = computed<TimelineItem[]>(() => {
  const now = Date.now()
  const cutoff = windowMs.value < 0 ? -Infinity : now - windowMs.value
  const f = filter.value.trim().toLowerCase()

  const items: TimelineItem[] = []
  if (kinds.value.has('request')) {
    for (const r of requests.value) {
      const ts = new Date(r.startedAt).getTime()
      if (ts + r.duration < cutoff) continue
      if (f && !r.url.toLowerCase().includes(f)) continue
      items.push({ kind: 'request', data: r, ts })
    }
  }
  if (kinds.value.has('error')) {
    for (const e of errors.value) {
      const ts = new Date(e.startedAt).getTime()
      if (ts < cutoff) continue
      if (f && !e.message.toLowerCase().includes(f)) continue
      items.push({ kind: 'error', data: e, ts })
    }
  }
  items.sort((a, b) => b.ts - a.ts)
  return items
})

function toggle(id: string) {
  openId.value = openId.value === id ? '' : id
}

/** Body 搜索 query —— 切换展开的行时重置，避免上一个搜索状态串到下一行 */
const bodySearch = ref('')
watch(openId, () => { bodySearch.value = '' })

function highlightBody(text: string | undefined, query: string): string {
  if (!text) return ''
  const escaped = escapeHtml(text)
  const q = query.trim()
  if (!q) return escaped
  // 先 escape body，再用已 escape 的 query 做 regex 替换，结果是安全的（不会注入 HTML）
  const rx = new RegExp(escapeRegex(escapeHtml(q)), 'gi')
  return escaped.replace(rx, (m) => `<mark>${m}</mark>`)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c] as string))
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

function errLevelLabel(level: ConsoleError['level']): string {
  if (level === 'rejection') return 'REJ'
  if (level === 'console') return 'CON'
  return 'ERR'
}
function errLevelTitle(level: ConsoleError['level']): string {
  if (level === 'rejection') return 'Unhandled Promise Rejection'
  if (level === 'console') return 'console.error 调用'
  return 'window.onerror（运行时错误）'
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

/* 类型筛选 chip（请求 / 错误，可独立开关） */
.kind-filters {
  display: flex;
  gap: 4px;
  background: var(--moo-c-bg-elev);
  border-radius: var(--moo-r-md);
  padding: 2px;
}
.kind-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  padding: 4px 10px;
  height: 24px;
  font-size: var(--moo-fs-xs);
  font-weight: 500;
  font-family: inherit;
  color: var(--moo-c-text-dim);
  border-radius: var(--moo-r-sm);
  cursor: pointer;
  transition: background-color var(--moo-motion-fast), color var(--moo-motion-fast);
}
.kind-chip:hover { color: var(--moo-c-text); }
.kind-chip.active {
  background: var(--moo-c-bg);
  color: var(--moo-c-text);
  box-shadow: var(--moo-sh-sm);
}
.kind-chip .kind-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: .8;
}
.kind-chip.active .kind-dot--req { background: var(--moo-c-info); opacity: 1; }
.kind-chip.active .kind-dot--err { background: var(--moo-c-danger); opacity: 1; }
.kind-chip .kind-count {
  font-family: var(--moo-ff-mono);
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
}
.kind-chip.active .kind-count { color: var(--moo-c-text-muted); }

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
/* 二级动作图标按钮（刷新 / 清空 / 自动刷新 toggle）—— 28×28 方形，title 揭示功能 */
.toolbar .icon-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--moo-c-border);
  background: var(--moo-c-bg);
  color: var(--moo-c-text-muted);
  border-radius: var(--moo-r-md);
  cursor: pointer;
  transition: background-color var(--moo-motion-fast), border-color var(--moo-motion-fast), color var(--moo-motion-fast);
}
.toolbar .icon-btn:hover:not(:disabled) {
  background: var(--moo-c-bg-soft);
  border-color: var(--moo-c-text-faint);
  color: var(--moo-c-text);
}
.toolbar .icon-btn:disabled { opacity: .5; cursor: not-allowed; }
.toolbar .icon-btn svg { width: 14px; height: 14px; display: block; }
.toolbar .icon-btn.is-on {
  background: var(--moo-c-brand-soft);
  border-color: var(--moo-c-brand);
  color: var(--moo-c-brand);
}
.toolbar .icon-btn.is-on:hover { background: var(--moo-c-brand-soft); }
.toolbar .icon-btn.danger { color: var(--moo-c-danger-fg); }
.toolbar .icon-btn.danger:hover:not(:disabled) {
  background: var(--moo-c-danger-soft);
  border-color: var(--moo-c-danger-soft);
}
.icon-btn-pulse {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--moo-c-brand);
  animation: icon-btn-pulse 1.6s ease-in-out infinite;
}
@keyframes icon-btn-pulse {
  0%, 100% { transform: scale(1); opacity: .7; }
  50% { transform: scale(1.25); opacity: 1; }
}
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

/* kind 标识（合并时间线的关键视觉）—— 一眼区分这行是请求还是错误 */
.kind-tag {
  flex: 0 0 30px;
  font-size: 9px;
  padding: 2px 4px;
  border-radius: var(--moo-r-sm);
  text-align: center;
  font-weight: 700;
  letter-spacing: .03em;
}
.kind-tag--req {
  background: var(--moo-c-info-soft);
  color: var(--moo-c-info);
}
.kind-tag--err {
  background: var(--moo-c-danger-soft);
  color: var(--moo-c-danger-fg);
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
.row-head .err-msg { color: var(--moo-c-danger-fg); }
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
.body-search-wrap {
  margin: 8px 0 4px;
}
.body-search {
  width: 100%;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-sm);
  font-size: var(--moo-fs-xs);
  font-family: inherit;
  background: var(--moo-c-bg);
  color: var(--moo-c-text);
  transition: border-color var(--moo-motion-fast);
}
.body-search:focus {
  outline: none;
  border-color: var(--moo-c-brand);
  box-shadow: 0 0 0 2px rgba(79, 70, 229, .15);
}
.row-detail .mono :deep(mark) {
  background: var(--moo-c-warn);
  color: var(--moo-c-bg);
  padding: 0 2px;
  border-radius: 2px;
  font-weight: 600;
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
  gap: 4px;
  color: var(--moo-c-text-dim);
  font-size: var(--moo-fs-sm);
  padding: 40px;
  text-align: center;
  max-width: 480px;
  margin: 0 auto;
}
.empty::before {
  content: "🌐";
  font-size: 32px;
  opacity: .5;
  margin-bottom: 4px;
}
.empty .empty-title {
  color: var(--moo-c-text-muted);
  font-size: var(--moo-fs-base);
  font-weight: 500;
  margin: 0;
}
.empty .empty-hint {
  margin: 0;
  line-height: 1.55;
  font-size: var(--moo-fs-xs);
}
</style>
