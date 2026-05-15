<template>
  <div class="history">
    <header class="toolbar">
      <input v-model="filter" placeholder="按标题/URL 过滤" class="filter" />
      <span class="count">{{ filtered.length }} / {{ list.length }}</span>
      <button class="btn" @click="reload" :disabled="loading">刷新</button>
      <button class="btn" @click="syncRemoteStatus" :disabled="syncing">{{ syncing ? '同步中…' : '同步远端状态' }}</button>
      <button class="btn danger" @click="clearAll" :disabled="!list.length">清空</button>
    </header>

    <div class="list" v-if="filtered.length">
      <div
        v-for="e in filtered"
        :key="e.id"
        :class="['row', { open: openId === e.id }]"
      >
        <div class="row-head" @click="toggle(e.id)">
          <img :src="e.image" class="thumb" />
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
          <section v-if="e.requests.length">
            <h5>请求 ({{ e.requests.length }})</h5>
            <ul class="sub-list">
              <li v-for="r in e.requests" :key="r.id">
                <span class="m">{{ r.method }}</span>
                <span :class="['s', r.ok ? 'ok' : 'err']">{{ r.status || 'ERR' }}</span>
                <span class="u" :title="r.url">{{ r.url }}</span>
              </li>
            </ul>
          </section>
          <section v-if="e.errors.length">
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
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { clearHistory, listHistory, onHistoryChanged, removeHistory } from '@/storage/history'
import { loadConfig } from '@/storage/config'
import { MSG, type SubmitBugReq, type SubmitBugRes } from '@/types/messages'
import type { BugHistoryEntry } from '@/types/history'
import { formatSubmitResult } from '@/utils/submitMessage'
import type { Project } from '@/types/config'

const list = ref<BugHistoryEntry[]>([])
const loading = ref(false)
const syncing = ref(false)
const filter = ref('')
const openId = ref('')
const busyId = ref('')
const projects = ref<Project[]>([])
const resubmitTo = ref<Record<string, string>>({})

function remoteStatusLabel(s: string): string {
  return { open: '待处理', in_progress: '处理中', done: '已完成', deleted: '已删除' }[s] ?? s
}

async function syncRemoteStatus() {
  syncing.value = true
  try {
    await chrome.runtime.sendMessage({ type: MSG.REFRESH_HISTORY_STATUS, source: 'devtools' })
    await reload()
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

onBeforeUnmount(() => dispose?.())

const filtered = computed(() => {
  if (!filter.value.trim()) return list.value
  const f = filter.value.trim().toLowerCase()
  return list.value.filter((e) =>
    e.title.toLowerCase().includes(f) ||
    e.url.toLowerCase().includes(f) ||
    e.description.toLowerCase().includes(f)
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

function formatTime(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function remove(id: string) {
  if (!confirm('删除该记录？')) return
  await removeHistory(id)
}

async function clearAll() {
  if (!confirm('清空全部历史记录？')) return
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
    const res = (await chrome.runtime.sendMessage({
      type: MSG.SUBMIT_BUG,
      source: 'devtools',
      payload: req
    })) as SubmitBugRes
    const { message } = formatSubmitResult(res)
    alert(message)
  } finally {
    busyId.value = ''
  }
}
</script>

<style scoped>
.history { height: 100%; display: flex; flex-direction: column; background: #fff; font-size: 12px; }
.toolbar {
  flex: none;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid #eee;
  background: #fafafa;
}
.toolbar .filter { flex: 1; padding: 4px 8px; border: 1px solid #ddd; border-radius: 3px; font-size: 12px; min-width: 0; }
.toolbar .count { font-size: 11px; color: #888; }
.toolbar .btn { font-size: 11px; padding: 3px 10px; border: 1px solid #ddd; background: #fff; border-radius: 3px; cursor: pointer; }
.toolbar .btn:hover { background: #f5f5f5; }
.toolbar .btn.danger { color: #c0392b; }

.list { flex: 1; overflow: auto; }
.row { border-bottom: 1px solid #f0f0f0; }
.row.open { background: #f9fafb; }
.row-head {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  cursor: pointer;
}
.row-head:hover { background: #f5f5f5; }
.thumb { width: 60px; height: 40px; object-fit: cover; border: 1px solid #ddd; border-radius: 3px; flex: none; }
.info { flex: 1; min-width: 0; }
.title-line { display: flex; gap: 8px; align-items: center; }
.title { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status { font-size: 10px; padding: 1px 6px; border-radius: 2px; flex: none; }
.status.ok { background: #dcfce7; color: #15803d; }
.status.err { background: #fee2e2; color: #b91c1c; }
.remote-status {
  font-size: 10px; padding: 1px 6px; border-radius: 2px; flex: none;
  border: 1px solid;
}
.remote-status.rs-open { color: #b91c1c; border-color: #fecaca; background: #fef2f2; }
.remote-status.rs-in_progress { color: #92400e; border-color: #fde68a; background: #fef3c7; }
.remote-status.rs-done { color: #15803d; border-color: #bbf7d0; background: #dcfce7; }
.remote-status.rs-deleted { color: #6b7280; border-color: #e5e7eb; background: #f9fafb; }
.remote-status.rs-queued { color: #4338ca; border-color: #c7d2fe; background: #e0e7ff; }
.meta { font-size: 10px; color: #999; margin-top: 2px; }
.dot-sep { margin: 0 4px; }
.url-line { font-family: ui-monospace, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actions { display: flex; gap: 6px; align-items: center; flex: none; }
.actions .select { font-size: 11px; padding: 3px 4px; border: 1px solid #ddd; border-radius: 3px; max-width: 160px; }
.btn.small { padding: 2px 8px; font-size: 11px; }

.row-detail { padding: 4px 12px 12px; }
.row-detail h5 { margin: 8px 0 4px; font-size: 11px; color: #555; }
.row-detail .mono {
  background: #f7f7f7;
  border: 1px solid #eee;
  border-radius: 3px;
  padding: 6px 8px;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: ui-monospace, Menlo, monospace;
  margin: 0;
  max-height: 160px;
  overflow: auto;
}
.sub-list { list-style: none; margin: 0; padding: 0; font-family: ui-monospace, Menlo, monospace; font-size: 11px; }
.sub-list li { display: flex; gap: 8px; padding: 2px 0; }
.sub-list li .m { flex: 0 0 50px; color: #555; font-weight: 600; }
.sub-list li .s { flex: 0 0 38px; font-size: 10px; padding: 1px 4px; border-radius: 2px; text-align: center; }
.sub-list li .s.ok { background: #dcfce7; color: #15803d; }
.sub-list li .s.err { background: #fee2e2; color: #b91c1c; }
.sub-list li .u { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #444; }
.meta-line { color: #888; font-size: 10px; margin-top: 8px; word-break: break-all; }

.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  padding: 30px;
  text-align: center;
}
</style>
