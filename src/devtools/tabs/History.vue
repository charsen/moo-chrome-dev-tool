<template>
  <div class="history">
    <header class="toolbar">
      <input v-model="filterDraft" placeholder="按标题/URL 过滤" class="filter" />
      <span class="count">{{ filtered.length }} / {{ list.length }}</span>
      <button class="moo-btn" @click="reload" :disabled="loading">刷新</button>
      <button class="moo-btn" @click="syncRemoteStatus" :disabled="syncing">{{ syncing ? '同步中…' : '同步远端状态' }}</button>
      <button class="moo-btn moo-btn--danger" @click="clearAll" :disabled="!list.length">清空</button>
    </header>

    <div v-if="toast" :class="['moo-toast', `moo-toast--${toastKind}`]" :role="toastKind === 'error' ? 'alert' : 'status'" aria-live="polite">{{ toast }}</div>

    <div class="list" v-if="filtered.length">
      <div
        v-for="e in filtered"
        :key="e.id"
        :class="['row', { open: openId === e.id }]"
      >
        <div class="row-head" @click="toggle(e.id)">
          <img v-if="e.image" :src="e.image" class="thumb" loading="lazy" decoding="async" />
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
            <!-- v0.4.7：禅道 entry 不让换服务器（避免把禅道 bug 错发到 webhook server） -->
            <select v-if="!isZentaoEntry(e)" v-model="resubmitTo[e.id]" class="select" @click.stop>
              <option v-for="s in servers" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
            <button class="moo-btn moo-btn--sm" @click="resubmit(e)" :disabled="busyId === e.id"
                    :title="isZentaoEntry(e) ? '用当时抓到的现场重发到原禅道项目' : '用当时抓到的现场重发'">
              {{ busyId === e.id ? '提交中…' : '重新提交' }}
            </button>
            <button class="moo-btn moo-btn--sm moo-btn--danger" @click="remove(e.id)">删除</button>
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
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { clearHistory, listHistory, onHistoryChanged, removeHistory } from '@/storage/history'
import { loadConfig } from '@/storage/config'
import { MSG, type SubmitBugReq, type SubmitBugRes } from '@/types/messages'
import type { BugHistoryEntry } from '@/types/history'
import { formatSubmitResult } from '@/utils/submitMessage'
import { safeSendMessage, MessagingError } from '@/utils/messaging'
import type { Project } from '@/types/config'
import { useToast } from '@/composables/useToast'
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

const { toast, toastKind, showToast: showToastRaw } = useToast()
// 包一层保留原有 error=5000 / 其他=2600 的 duration 策略
function showToast(msg: string, kind: 'success' | 'error' | 'info' = 'info') {
  showToastRaw(msg, kind, kind === 'error' ? 5000 : 2600)
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
    // 当前还有效的 serverId 集合 —— 用来识别 entry 原 server 是否已被删
    const validIds = new Set<string>()
    for (const p of projects.value) {
      for (const s of p.servers) validIds.add(s.id)
    }
    const fallback = validIds.size > 0 ? (Array.from(validIds)[0] ?? '') : ''
    // 给每条 entry 初始化下拉默认值。原 server 还在 → 用原 server；
    // 原 server 已被删 → 用第一个可用 server，避免 v-model 值不在 <option>
    // 列表里造成「下拉显示 A 但 v-model 还是已删除的 B」的错位。
    for (const e of list.value) {
      const existing = resubmitTo.value[e.id]
      if (existing && validIds.has(existing)) continue
      resubmitTo.value[e.id] = validIds.has(e.serverId) ? e.serverId : fallback
    }
  } finally {
    loading.value = false
  }
}

async function subscribeChanges(): Promise<void> {
  await reload()
  dispose = onHistoryChanged(() => reload())
  // v0.3：进 Tab 时如果有 zentao kind 项目的 history，自动同步一次状态。
  // webhook 路径仍要用户点「同步远端状态」（避免对未配的后端做无意义 ping）。
  const hasZentao = projects.value.some(p => p.kind === 'zentao' && list.value.some(e => e.projectId === p.id && e.remoteId))
  if (hasZentao) void syncRemoteStatus()
}

onMounted(subscribeChanges)

// v0.5.1：KeepAlive 下切走 tab 时取消 onHistoryChanged 订阅（之前不暂停 → 别窗口提交一条 bug
// 触发不可见 list reload + Vue diff 30 条 base64 缩略图行，白烧 CPU）
onActivated(async () => {
  if (!dispose) await subscribeChanges()
})
onDeactivated(() => {
  if (dispose) { dispose(); dispose = null }
})

onBeforeUnmount(() => {
  dispose?.()
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

/** v0.4.8：判断 entry 是否来自禅道路径。
 *  v0.2.0+ 起 zentao 提交时 entry.serverId 写 'zentao' marker（webhook 走 server.id uuid）。
 *  直接用 marker 判定，不依赖 project 现存 —— 防用户删过 project 后兜底失败让
 *  v0.4.7 修的「webhook 错发」bug 又以另一形式复活（agent 第 5 波 review 发现）。 */
function isZentaoEntry(e: BugHistoryEntry): boolean {
  return e.serverId === 'zentao'
}

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
  // v0.4.7：禅道 entry 强制走原 project（serverId='zentao' 是禅道路径 marker，
  // 不让用户通过下拉把它错发到 webhook server）
  let newServerId: string
  let targetProjectId: string
  if (isZentaoEntry(e)) {
    newServerId = 'zentao'
    targetProjectId = e.projectId
  } else {
    newServerId = resubmitTo.value[e.id] || e.serverId
    // 反查目标 server 所属项目
    targetProjectId = e.projectId
    for (const p of projects.value) {
      if (p.servers.some((s) => s.id === newServerId)) {
        targetProjectId = p.id
        break
      }
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

/* 工具栏：窄宽下允许 wrap，跟 Overview 一致 */
.toolbar {
  flex: none;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-bottom: 1px solid var(--moo-c-border);
  background: var(--moo-c-bg);
}
.toolbar .filter {
  flex: 1 1 180px; /* wrap 后单独占行不会缩成 40px；同行时仍能伸缩 */
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--moo-c-border);
  border-radius: var(--moo-r-md);
  background: var(--moo-c-bg);
  font-family: inherit;
  font-size: var(--moo-fs-sm);
  color: var(--moo-c-text);
  min-width: 0;
  box-sizing: border-box;
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
/* 按钮全部走 canonical .moo-btn / .moo-btn--sm / .moo-btn--danger（tokens.css），
   不再 scoped 局部覆盖 */

/* 列表 */
.list { flex: 1; overflow: auto; padding: 4px; }
.row {
  border-radius: var(--moo-r-lg);
  margin-bottom: 4px;
  border: 1px solid transparent;
  transition: border-color var(--moo-motion-fast), background-color var(--moo-motion-fast);
  /* 视口外跳过渲染/图片解码：30 条 base64 截图缩略图同时解码会卡，content-visibility
     让浏览器只对当前可见的行做 layout/paint/image-decode。contain-intrinsic-size 给
     一个粗略高度占位（接近 collapsed 行实测 80px），避免滚动条乱跳；open 行不约束
     高度（detail 区域高度变化大，让 auto 自己量）。 */
  content-visibility: auto;
  contain-intrinsic-size: 0 80px;
}
.row.open { contain-intrinsic-size: auto; }
.row:hover { background: var(--moo-c-bg-soft); }
.row.open {
  background: var(--moo-c-bg-soft);
  border-color: var(--moo-c-border);
}

.row-head {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap; /* 窄宽下 actions（select + 2 button）会把 info 挤到无法读；允许换行让 actions 落到下一行 */
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
  background: var(--moo-c-bg-inverse);
  border-color: var(--moo-c-bg-inverse);
  color: var(--moo-c-bg);
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
.info { flex: 1 1 200px; min-width: 0; }
/* basis 200px：row-head 现在 wrap，给 info 一个最小 basis 让它在同行能站稳，
   宽度不够时直接换行（让 actions 自然下沉），而不是被压成 60px 看不清标题 */
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
/* row .actions 按钮按 canonical .moo-btn--sm 出，无 scoped override */

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
  min-width: 0; /* flex 子项 min-width: auto 默认值会让 url 不截断、挤掉同行其它元素 */
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
