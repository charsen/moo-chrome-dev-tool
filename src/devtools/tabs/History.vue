<template>
  <div class="history">
    <header class="toolbar">
      <input v-model="filterDraft" placeholder="按标题/URL 过滤" class="filter" />
      <span class="count">{{ filtered.length }} / {{ list.length }}</span>
      <button class="btn" @click="reload" :disabled="loading">刷新</button>
      <button class="btn" @click="syncRemoteStatus" :disabled="syncing">{{ syncing ? '同步中…' : '同步远端状态' }}</button>
      <button class="btn danger" @click="clearAll" :disabled="!list.length">清空</button>
    </header>

    <div v-if="toast" :class="['moo-toast', `moo-toast--${toastKind}`]">{{ toast }}</div>

    <div class="list" v-if="filtered.length">
      <div
        v-for="e in filtered"
        :key="e.id"
        :class="['row', { open: openId === e.id }]"
      >
        <div class="row-head" @click="toggle(e.id)">
          <img v-if="e.image" :src="e.image" class="thumb" />
          <div v-else-if="e.hasVideo" class="thumb thumb-video" :title="`${e.videoDuration ?? 0}s 录像`">
            <span class="thumb-icon">🎥</span>
            <span v-if="e.videoDuration" class="thumb-dur">{{ formatDur(e.videoDuration) }}</span>
          </div>
          <div v-else class="thumb thumb-empty" title="无截图 / 视频">—</div>
          <div class="info">
            <div class="title-line">
              <span :class="['status', e.result.ok ? 'ok' : 'err']">{{ e.result.ok ? `${e.result.status ?? 'OK'}` : 'FAIL' }}</span>
              <span v-if="e.remoteStatus" :class="['remote-status', `rs-${e.remoteStatus}`]">{{ remoteStatusLabel(e.remoteStatus) }}</span>
              <span v-else-if="e.result.queued" class="remote-status rs-queued">队列中</span>
              <span class="title">{{ e.title || '(无标题)' }}</span>
            </div>
            <div class="meta">
              <span>{{ e.projectName }} · {{ e.serverName }}</span>
              <span class="dot-sep">·</span>
              <span>{{ formatTime(e.timestamp) }}</span>
            </div>
            <div class="meta url-line">{{ shortUrl(e.url) }}</div>
          </div>
          <div class="actions" @click.stop>
            <select v-model="resubmitTo[e.id]" class="select" @click.stop>
              <option v-for="s in servers" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
            <button class="btn small" @click="resubmit(e)" :disabled="busyId === e.id">
              {{ busyId === e.id ? '提交中…' : '重新提交' }}
            </button>
            <button class="btn danger small" @click="remove(e.id)">删除</button>
          </div>
        </div>
        <div class="row-detail" v-if="openId === e.id">
          <section v-if="e.description">
            <h5>描述</h5>
            <pre class="mono">{{ e.description }}</pre>
          </section>
          <section v-if="e.result.body || e.result.error">
            <h5>服务端响应</h5>
            <pre class="mono">{{ e.result.body ?? e.result.error }}</pre>
          </section>
          <section v-if="e.requests?.length">
            <h5>请求 ({{ e.requests.length }})</h5>
            <ul class="sub-list">
              <li v-for="r in e.requests" :key="r.id">
                <span class="m">{{ r.method }}</span>
                <span :class="['s', r.ok ? 'ok' : 'err']">{{ r.status || 'ERR' }}</span>
                <span class="u" :title="r.url">{{ r.url }}</span>
              </li>
            </ul>
          </section>
          <section v-if="e.errors?.length">
            <h5>错误 ({{ e.errors.length }})</h5>
            <ul class="sub-list">
              <li v-for="err in e.errors" :key="err.id">
                <span class="m">{{ err.level }}</span>
                <span class="u">{{ err.message }}</span>
              </li>
            </ul>
          </section>
          <div class="meta-line">
            <span>页面: {{ e.url }}</span><br>
            <span>UA: {{ e.userAgent }}</span><br>
            <span>视口: {{ e.viewport }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="empty" v-else>
      <p v-if="loading">加载中…</p>
      <p v-else>暂无历史记录。提交后会自动保存最近 30 条。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clearHistory, listHistory, onHistoryChanged, removeHistory } from '@/storage/history'
import { loadConfig } from '@/storage/config'
import { MSG, type SubmitBugReq, type SubmitBugRes } from '@/types/messages'
import type { BugHistoryEntry } from '@/types/history'
import { formatSubmitResult } from '@/utils/submitMessage'
import { safeSendMessage, MessagingError } from '@/utils/messaging'
import type { Project } from '@/types/config'
import { confirmDialog } from '../components/confirm'

const list = ref<BugHistoryEntry[]>([])
const loading = ref(false)
const syncing = ref(false)
// filter 分两个：input v-model 绑定 filterDraft（每键立即更新输入框），
// 实际触发重新过滤的 filter 走 150ms debounce —— 单次过滤要对 30 条 entry
// 做 ~100 次 toLowerCase（标题/URL/描述 + 嵌套 requests/errors），快速打字
// 每键 3000+ 次 toLowerCase 明显卡。
const filterDraft = ref('')
const filter = ref('')
let filterDebounce: number | undefined
watch(filterDraft, (v) => {
  if (filterDebounce) clearTimeout(filterDebounce)
  filterDebounce = window.setTimeout(() => { filter.value = v }, 150)
})
const openId = ref('')
const busyId = ref('')
const projects = ref<Project[]>([])
const resubmitTo = ref<Record<string, string>>({})

const toast = ref('')
const toastKind = ref<'success' | 'error' | 'info'>('info')
let toastTimer: number | undefined
function showToast(msg: string, kind: 'success' | 'error' | 'info' = 'info') {
  toast.value = msg
  toastKind.value = kind
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), kind === 'error' ? 5000 : 2600)
}

function remoteStatusLabel(s: string): string {
  return { open: '待处理', in_progress: '处理中', done: '已完成', deleted: '已删除' }[s] ?? s
}

async function syncRemoteStatus() {
  syncing.value = true
  try {
    await safeSendMessage({ type: MSG.REFRESH_HISTORY_STATUS, source: 'devtools' })
    await reload()
  } catch (e) {
    showToast(`没能从服务端拉到最新状态：${(e as Error).message}。可能后端没起，或者「请求 URL」写错了`, 'error')
  } finally {
    syncing.value = false
  }
}

let dispose: (() => void) | null = null

async function reload() {
  loading.value = true
  try {
    list.value = await listHistory()
    const cfg = await loadConfig()
    projects.value = cfg.projects
    // 给每条 entry 初始化下拉默认值为原服务器
    for (const e of list.value) {
      if (!resubmitTo.value[e.id]) resubmitTo.value[e.id] = e.serverId
    }
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await reload()
  dispose = onHistoryChanged(() => reload())
})

onBeforeUnmount(() => {
  dispose?.()
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = undefined }
  if (filterDebounce) { clearTimeout(filterDebounce); filterDebounce = undefined }
})

const filtered = computed(() => {
  if (!filter.value.trim()) return list.value
  const f = filter.value.trim().toLowerCase()
  return list.value.filter((e) =>
    // 列表字段
    e.title.toLowerCase().includes(f) ||
    e.url.toLowerCase().includes(f) ||
    e.description.toLowerCase().includes(f) ||
    // 详情字段：附带请求 URL / 错误 message（之前只能匹配标题，深层 grep 找不到）
    // 注：r.url / err.message 来源于历史 entry 内嵌的 CapturedRequest / ConsoleError，
    // 不走 normalizeHistoryEntry，可能是 undefined / 非 string，需兜底
    e.requests.some((r) => String(r.url ?? '').toLowerCase().includes(f)) ||
    e.errors.some((err) => String(err.message ?? '').toLowerCase().includes(f)) ||
    // 服务端响应正文（如果存了）
    (e.result.body?.toLowerCase().includes(f) ?? false)
  )
})

const servers = computed(() => {
  const all: { id: string; label: string }[] = []
  for (const p of projects.value) {
    for (const s of p.servers) {
      all.push({ id: s.id, label: `${p.name} / ${s.name}` })
    }
  }
  return all
})

function toggle(id: string) {
  openId.value = openId.value === id ? '' : id
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.host + u.pathname
  } catch { return url }
}

function formatDur(s: number): string {
  if (!s || s < 0) return ''
  const m = Math.floor(s / 60)
  const ss = s % 60
  // 统一带单位避免"1:23 vs 45s"混排：< 60s 显示 "45s"，>= 60s 显示 "1m23s"
  return m > 0 ? `${m}m${ss}s` : `${ss}s`
}

function formatTime(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function remove(id: string) {
  const ok = await confirmDialog({
    title: '从本地历史里删掉这条？',
    message: '只删本地的提交记录，服务端已经收到的 bug 不会受影响。删了之后无法找回。',
    danger: true,
    confirmText: '确认删除'
  })
  if (!ok) return
  await removeHistory(id)
}

async function clearAll() {
  const ok = await confirmDialog({
    title: `清空 ${list.value.length} 条本地历史？`,
    message: '只清本地的提交记录，服务端已经收到的 bug 不会受影响。清完无法找回。',
    danger: true,
    confirmText: '确认清空'
  })
  if (!ok) return
  await clearHistory()
}

async function resubmit(e: BugHistoryEntry) {
  const newServerId = resubmitTo.value[e.id] || e.serverId
  // 反查目标 server 所属项目
  let targetProjectId = e.projectId
  for (const p of projects.value) {
    if (p.servers.some((s) => s.id === newServerId)) {
      targetProjectId = p.id
      break
    }
  }
  busyId.value = e.id
  try {
    const req: SubmitBugReq = {
      serverId: newServerId,
      projectId: targetProjectId,
      title: e.title,
      description: e.description,
      image: e.image,
      url: e.url,
      userAgent: e.userAgent,
      viewport: e.viewport,
      timestamp: new Date().toISOString(),
      requests: e.requests,
      errors: e.errors
    }
    try {
      const res = (await safeSendMessage({
        type: MSG.SUBMIT_BUG,
        source: 'devtools',
        payload: req
      })) as SubmitBugRes
      const { message } = formatSubmitResult(res)
      showToast(message, res.ok ? 'success' : 'error')
    } catch (err) {
      showToast(`重新提交失败：${(err as MessagingError).message}。扩展后台可能刚被浏览器回收，请刷新页面后再点一次`, 'error')
    }
  } finally {
    busyId.value = ''
  }
}
</script>

<style scoped>
.history {
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
  box-shadow: 0 0 0 3px var(--moo-c-focus-ring);
}
.toolbar .count {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
  font-family: var(--moo-ff-mono);
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
.toolbar .btn:hover:not(:disabled) {
  background: var(--moo-c-bg-soft);
  border-color: var(--moo-c-text-faint);
}
.toolbar .btn.danger { color: var(--moo-c-danger-fg); }
.toolbar .btn.danger:hover:not(:disabled) {
  background: var(--moo-c-danger-soft);
  border-color: var(--moo-c-danger-soft);
}
.toolbar .btn:disabled { opacity: .5; cursor: not-allowed; }

/* 列表 */
.list { flex: 1; overflow: auto; padding: 4px; }
.row {
  border-radius: var(--moo-r-lg);
  margin-bottom: 4px;
  border: 1px solid transparent;
  transition: border-color var(--moo-motion-fast), background-color var(--moo-motion-fast);
}
.row:hover { background: var(--moo-c-bg-soft); }
.row.open {
  background: var(--moo-c-bg-soft);
  border-color: var(--moo-c-border);
}

.row-head {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  cursor: pointer;
}
.thumb {
  width: 64px;
  height: 42px;
  object-fit: cover;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  flex: none;
  background: var(--moo-c-bg-elev);
}
.thumb-video {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: #0f172a;
  border-color: #0f172a;
  color: #fff;
}
.thumb-video .thumb-icon { font-size: 16px; line-height: 1; }
.thumb-video .thumb-dur {
  font-family: var(--moo-ff-mono);
  font-size: 10px;
  opacity: .85;
  line-height: 1;
}
.thumb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--moo-c-text-dim);
  font-family: var(--moo-ff-mono);
}
.info { flex: 1; min-width: 0; }
.title-line {
  display: flex;
  gap: 6px;
  align-items: center;
}
.title {
  font-size: var(--moo-fs-sm);
  font-weight: 600;
  color: var(--moo-c-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

/* 状态徽章 */
.status {
  flex: none;
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--moo-r-sm);
  font-size: 10px;
  font-weight: 600;
  font-family: var(--moo-ff-mono);
  letter-spacing: .02em;
}
.status.ok  { background: var(--moo-c-success-soft); color: var(--moo-c-success-fg); }
.status.err { background: var(--moo-c-danger-soft);  color: var(--moo-c-danger-fg); }

.remote-status {
  flex: none;
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--moo-r-sm);
  font-size: 10px;
  font-weight: 500;
  border: 1px solid;
}
.remote-status.rs-open         { color: var(--moo-c-danger-fg);  border-color: var(--moo-c-danger-soft);  background: var(--moo-c-danger-soft); }
.remote-status.rs-in_progress  { color: var(--moo-c-warn-fg);    border-color: var(--moo-c-warn-soft);    background: var(--moo-c-warn-soft); }
.remote-status.rs-done         { color: var(--moo-c-success-fg); border-color: var(--moo-c-success-soft); background: var(--moo-c-success-soft); }
.remote-status.rs-deleted      { color: var(--moo-c-text-muted); border-color: var(--moo-c-border);       background: var(--moo-c-bg-soft); }
.remote-status.rs-queued       { color: var(--moo-c-brand);      border-color: var(--moo-c-brand-soft);   background: var(--moo-c-brand-soft); }

.meta {
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-dim);
  margin-top: 3px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.dot-sep { color: var(--moo-c-text-faint); }
.url-line {
  font-family: var(--moo-ff-mono);
  font-size: var(--moo-fs-xs);
  color: var(--moo-c-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 3px;
}

.actions { display: flex; gap: 6px; align-items: center; flex: none; }
.actions .select {
  height: 26px;
  font-size: var(--moo-fs-xs);
  padding: 0 6px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  background: var(--moo-c-bg);
  color: var(--moo-c-text);
  max-width: 160px;
  font-family: inherit;
}
.btn.small {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  font-size: var(--moo-fs-xs);
  font-weight: 500;
  font-family: inherit;
  border: 1px solid var(--moo-c-border);
  background: var(--moo-c-bg);
  color: var(--moo-c-text);
  border-radius: var(--moo-r-md);
  cursor: pointer;
  transition: background-color var(--moo-motion-fast);
}
.btn.small:hover:not(:disabled) { background: var(--moo-c-bg-soft); }
.btn.small:disabled { opacity: .5; cursor: not-allowed; }

/* 详情展开 */
.row-detail {
  padding: 4px 14px 14px;
  border-top: 1px solid var(--moo-c-divider);
}
.row-detail h5 {
  margin: 12px 0 6px;
  font-size: var(--moo-fs-xs);
  font-weight: 600;
  color: var(--moo-c-text-muted);
  text-transform: uppercase;
  letter-spacing: .04em;
}
.row-detail .mono {
  background: var(--moo-c-bg);
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  padding: 8px 10px;
  font-size: var(--moo-fs-xs);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--moo-ff-mono);
  margin: 0;
  max-height: 180px;
  overflow: auto;
  color: var(--moo-c-text);
}
.sub-list {
  list-style: none;
  margin: 0;
  padding: 0;
  font-family: var(--moo-ff-mono);
  font-size: var(--moo-fs-xs);
}
.sub-list li {
  display: flex;
  gap: 8px;
  padding: 3px 0;
  align-items: center;
}
.sub-list li .m {
  flex: 0 0 50px;
  color: var(--moo-c-text-muted);
  font-weight: 600;
}
.sub-list li .s {
  flex: 0 0 38px;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: var(--moo-r-sm);
  text-align: center;
  font-weight: 600;
}
.sub-list li .s.ok  { background: var(--moo-c-success-soft); color: var(--moo-c-success-fg); }
.sub-list li .s.err { background: var(--moo-c-danger-soft);  color: var(--moo-c-danger-fg); }
.sub-list li .u {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--moo-c-text-muted);
}
.meta-line {
  color: var(--moo-c-text-dim);
  font-size: var(--moo-fs-xs);
  margin-top: 10px;
  word-break: break-all;
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--moo-c-text-dim);
  padding: 40px;
  text-align: center;
  font-size: var(--moo-fs-sm);
}
.empty::before {
  content: "📭";
  font-size: 32px;
  opacity: .5;
  display: block;
}
</style>
