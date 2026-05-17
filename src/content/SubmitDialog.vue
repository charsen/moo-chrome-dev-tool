<template>
  <ElementPicker v-if="picking" @pick="onElementPicked" @cancel="picking = false" />

  <div v-show="!picking" class="moo-dialog-mask" @click.self="onMaskClick">
    <div class="moo-dialog" role="dialog" aria-modal="true" aria-labelledby="moo-submit-title">
      <header class="moo-dialog-head">
        <h3 id="moo-submit-title">提交 Bug — {{ project.name }}</h3>
        <button class="moo-close-btn" aria-label="关闭" @click="emit('cancel')">×</button>
      </header>

      <!-- 提交成功内嵌反馈：取代 toast 一闪而过的反馈方式 -->
      <div v-if="successInfo" class="moo-submit-success">
        <div class="moo-success-icon" aria-hidden="true">✓</div>
        <div class="moo-success-title">提交成功</div>
        <div v-if="successInfo.remoteId" class="moo-success-id">
          已记录为 <code>#{{ successInfo.remoteId }}</code>
        </div>
        <div class="moo-success-msg">{{ successInfo.message }}</div>
      </div>

      <div v-else class="moo-dialog-body">
        <!-- ① 标题（必填，置顶） -->
        <div class="moo-form-row">
          <label for="moo-title">标题 *</label>
          <input
            id="moo-title"
            ref="titleInput"
            v-model="title"
            placeholder="一句话描述问题"
          />
        </div>

        <!-- ② 描述 -->
        <div class="moo-form-row">
          <label for="moo-desc">描述</label>
          <textarea id="moo-desc" v-model="description" rows="3" placeholder="复现步骤、预期、实际…" />
        </div>

        <!-- ③ 截图缩略 -->
        <div class="moo-form-row" v-if="image">
          <label>截图</label>
          <div class="moo-thumb-wrap">
            <img class="moo-thumb moo-thumb--sm" :src="image" alt="截图预览" />
            <div class="moo-thumb-overlay">
              <button class="moo-thumb-action" type="button" @click="onReannotate">
                <span aria-hidden="true">✎</span> 重新标注
              </button>
              <button class="moo-thumb-action" type="button" @click="onRecapture">
                <span aria-hidden="true">🔄</span> 重新截图
              </button>
            </div>
          </div>
        </div>

        <!-- ④ 录像 -->
        <div class="moo-form-row" v-if="video">
          <label>录像</label>
          <div class="req-panel">
            <video class="moo-video-preview" :src="video.dataUrl" controls preload="metadata" />
            <div class="req-controls" style="border-top: 1px solid var(--c-divider); border-bottom: 0;">
              <span class="req-hint">已录制 {{ fmtDuration(video.duration) }} · {{ fmtBytes(video.bytes) }}</span>
            </div>
          </div>
        </div>

        <!-- ⑤ 服务器：0 / >1 / endpoint 空时都显示；恰好 1 个且 endpoint 正常才隐藏减噪音 -->
        <div class="moo-form-row" v-if="showServerRow">
          <label for="moo-server">服务器</label>
          <div class="server-pick">
            <select id="moo-server" v-model="serverId">
              <option v-if="!project.servers.length" disabled value="">还没有上报服务器 —— 请先到 DevTools → Moo → 环境 → 新建一个</option>
              <option v-for="s in project.servers" :key="s.id" :value="s.id">
                {{ s.name }} — {{ s.endpoint || '（尚未填请求 URL）' }}
              </option>
            </select>
            <div v-if="serverEndpointMissing" class="server-warn">
              ⚠ 服务器「{{ currentServer?.name }}」还没填请求 URL，提交会失败。<br>
              请打开 <b>DevTools → Moo → 环境</b>，找到这个服务器，在「请求 URL」那一行填上后端地址（比如 <code>http://localhost:3000/bugs</code>），然后回来点提交。
            </div>
          </div>
        </div>

        <!-- ⑥ 附件折叠组：请求 / 错误 / 元素 -->
        <details class="moo-attach" open>
          <summary class="moo-attach-hd">
            <span class="moo-attach-chev" aria-hidden="true">▸</span>
            <span class="moo-attach-title">附带请求</span>
            <span class="moo-attach-count">{{ selectedIds.size }} / {{ filtered.length }}</span>
          </summary>
          <div class="moo-attach-bd">
            <div class="req-panel">
              <div class="req-controls">
                <select v-model.number="windowMs" class="req-window" aria-label="时间窗口">
                  <option :value="5000">最近 5s</option>
                  <option :value="15000">最近 15s</option>
                  <option :value="30000">最近 30s</option>
                  <option :value="60000">最近 60s</option>
                  <option :value="-1">全部</option>
                </select>
                <input v-model="urlFilter" placeholder="按 URL 过滤" class="req-filter" />
                <button class="moo-btn small" @click="selectAll">全选</button>
                <button class="moo-btn small" @click="selectNone">清空</button>
              </div>
              <div class="req-list" v-if="filtered.length">
                <label v-for="r in filtered" :key="r.id" class="req-item">
                  <input type="checkbox" :checked="selectedIds.has(r.id)" @change="toggle(r.id)" />
                  <span :class="['method', String(r.method ?? '').toLowerCase()]">{{ r.method }}</span>
                  <span :class="['status', statusClass(r.status)]">{{ r.status || 'ERR' }}</span>
                  <span class="url" :title="r.url">{{ shortUrl(r.url) }}</span>
                  <span class="dur">{{ Math.round(r.duration) }}ms</span>
                </label>
              </div>
              <div v-else class="req-empty">
                <div>当前时间窗口内没有可附带的请求。</div>
                <div class="req-empty-hint">
                  如果你刚装好扩展或刚改完配置，刷新一下页面再操作即可。
                </div>
              </div>
            </div>
          </div>
        </details>

        <details class="moo-attach" v-if="errors.length">
          <summary class="moo-attach-hd">
            <span class="moo-attach-chev" aria-hidden="true">▸</span>
            <span class="moo-attach-title">附带错误</span>
            <span class="moo-attach-count">{{ selectedErrIds.size }} / {{ errors.length }}</span>
          </summary>
          <div class="moo-attach-bd">
            <div class="req-panel">
              <div class="req-list">
                <label v-for="e in reversedErrors" :key="e.id" class="req-item">
                  <input type="checkbox" :checked="selectedErrIds.has(e.id)" @change="toggleErr(e.id)" />
                  <span
                    :class="['status', e.level === 'console' ? 'warn' : 'err']"
                    :title="errLevelTitle(e.level)"
                  >
                    {{ errLevelLabel(e.level) }}
                  </span>
                  <span class="url" :title="e.message">{{ e.message }}</span>
                </label>
              </div>
            </div>
          </div>
        </details>

        <details class="moo-attach">
          <summary class="moo-attach-hd">
            <span class="moo-attach-chev" aria-hidden="true">▸</span>
            <span class="moo-attach-title">附带元素</span>
            <span class="moo-attach-count">{{ pickedElements.length }} 个</span>
          </summary>
          <div class="moo-attach-bd">
            <div class="req-panel">
              <div class="req-controls">
                <button class="moo-btn small" @click="picking = true">📍 选元素</button>
                <button v-if="pickedElements.length" class="moo-btn small" @click="pickedElements = []">清空</button>
                <span class="req-hint" v-if="!pickedElements.length">点击"选元素"，在页面上指定 bug 涉及的具体 DOM</span>
              </div>
              <div v-if="pickedElements.length" class="req-list">
                <div v-for="(el, i) in pickedElements" :key="i" class="req-item el-item">
                  <span class="method" :title="'tag: ' + el.tag">{{ el.tag }}</span>
                  <span class="url" :title="el.selector">{{ el.selector }}</span>
                  <button class="moo-close-btn" aria-label="移除此元素" @click="pickedElements.splice(i, 1)">×</button>
                </div>
              </div>
            </div>
          </div>
        </details>

        <!-- ⑦ 预览请求体（仅展开后显示） -->
        <div class="moo-form-row" v-if="preview">
          <label>预览</label>
          <pre class="moo-preview">{{ preview }}</pre>
        </div>
      </div>
      <footer v-if="!successInfo" class="moo-dialog-foot">
        <button class="moo-btn" @click="emit('cancel')">取消 <span class="kbd-hint">Esc</span></button>
        <button class="moo-btn ghost" :disabled="!canPreview || previewing" @click="onPreview">
          {{ previewing ? '预览中…' : '预览请求体' }}
        </button>
        <button class="moo-btn primary" :disabled="!canSubmit || submitting" @click="onSubmit">
          {{ submitting ? '提交中…' : '提交' }} <span class="kbd-hint">⌘↵</span>
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Project } from '@/types/config'
import type { CapturedRequest } from '@/types/requests'
import type { ConsoleError } from '@/types/errors'
import { MSG, type PreviewPayloadReq, type PreviewPayloadRes, type SubmitBugReq, type SubmitBugRes } from '@/types/messages'
import { formatSubmitResult } from '@/utils/submitMessage'
import { safeSendMessage } from '@/utils/messaging'
import ElementPicker, { type PickedElement } from './ElementPicker.vue'
import type { RecordingResult } from './useRecorder'

const props = defineProps<{
  project: Project
  image?: string
  video?: RecordingResult | null
  requests: CapturedRequest[]
  errors: ConsoleError[]
}>()
const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'submitted', ok: boolean, message: string): void
  /** 退回 Annotator 用原始截图重新画一遍（ContentApp 负责切状态） */
  (e: 'reannotate'): void
  /** 丢弃当前截图，重新触发屏幕捕获（ContentApp 负责切状态） */
  (e: 'recapture'): void
}>()

const title = ref('')
const description = ref('')
const serverId = ref(props.project.defaultServerId || props.project.servers[0]?.id || '')
const preview = ref('')
const submitting = ref(false)
const titleInput = ref<HTMLInputElement | null>(null)

/** 提交成功后的内嵌反馈视图。设值即覆盖 body/footer 展示 ✓ 卡片。 */
const successInfo = ref<{ message: string; remoteId?: string } | null>(null)
const SUCCESS_VIEW_MS = 1500
let successTimer: number | undefined

const windowMs = ref(30000)
const urlFilter = ref('')
const openedAt = performance.now()
const selectedIds = ref<Set<string>>(new Set())
const selectedErrIds = ref<Set<string>>(new Set())

// element picker
const picking = ref(false)
const pickedElements = ref<PickedElement[]>([])

function onElementPicked(el: PickedElement) {
  pickedElements.value.push(el)
  picking.value = false
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
function fmtDuration(s: number): string {
  const m = Math.floor(s / 60), ss = s % 60
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

const filtered = computed(() => {
  const all = props.requests
  let arr = windowMs.value < 0
    ? all
    : all.filter((r) => r.startTime + r.duration >= openedAt - windowMs.value)
  if (urlFilter.value.trim()) {
    const f = urlFilter.value.trim().toLowerCase()
    arr = arr.filter((r) => String(r.url ?? '').toLowerCase().includes(f))
  }
  return arr.slice().reverse() // 最新在上
})

const reversedErrors = computed(() => props.errors.slice().reverse())

// 默认勾选范围跟时间窗口同步：用户看到 N 条就有 N 条被勾选。
// 但**不覆盖**用户主动取消勾选的状态——用 prevFilteredIds 跟踪上次见过的 id 集合，
// 只把**真新增**的 id 自动勾上；不在新 filtered 里的 id（被过滤掉）保留勾选状态
// （即使在 dialog 内不可见，buildContext 时也会被纳入提交）
let prevFilteredIds = new Set<string>()
watch(
  () => filtered.value,
  (arr) => {
    const next = new Set(selectedIds.value)
    for (const r of arr) {
      if (!prevFilteredIds.has(r.id)) next.add(r.id)
    }
    prevFilteredIds = new Set(arr.map((r) => r.id))
    selectedIds.value = next
  },
  { immediate: true }
)

// 跟随 props.errors 变化：dialog 打开后新进来的 error 也自动勾选
// （之前是一次性赋值，新 error 不会被默认勾上，跟 selectedIds 的 watch 行为不一致）
// 用 prevErrorIds 记住"上次看到的 id"，只把**真新增**的 id 加入勾选，
// 不会覆盖用户主动取消勾选的状态
let prevErrorIds = new Set<string>()
watch(
  () => props.errors,
  (arr) => {
    const next = new Set(selectedErrIds.value)
    for (const e of arr) {
      if (!prevErrorIds.has(e.id)) next.add(e.id)
    }
    prevErrorIds = new Set(arr.map((e) => e.id))
    selectedErrIds.value = next
  },
  { immediate: true }
)

function toggle(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function selectAll() {
  selectedIds.value = new Set(filtered.value.map((r) => r.id))
}

function selectNone() {
  selectedIds.value = new Set()
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

function statusClass(status: number): string {
  if (!status) return 'err'
  if (status >= 500) return 'err'
  if (status >= 400) return 'warn'
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

const canPreview = computed(() => !!serverId.value)
const currentServer = computed(() => props.project.servers.find((s) => s.id === serverId.value))
const serverEndpointMissing = computed(() => !!currentServer.value && !currentServer.value.endpoint?.trim())
/** 显示服务器选择行的条件：0 个 / 多个 / 唯一服务器配错了。
 * 单个且配置正确才隐藏（最常见的场景，减少表单噪音）。 */
const showServerRow = computed(() => {
  if (props.project.servers.length !== 1) return true
  return serverEndpointMissing.value
})
const canSubmit = computed(() =>
  !!serverId.value && !!title.value.trim() && !serverEndpointMissing.value
)

function selectedRequests(): CapturedRequest[] {
  const ids = selectedIds.value
  return props.requests.filter((r) => ids.has(r.id))
}

function selectedErrors(): ConsoleError[] {
  const ids = selectedErrIds.value
  return props.errors.filter((e) => ids.has(e.id))
}

function toggleErr(id: string) {
  const next = new Set(selectedErrIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedErrIds.value = next
}

function buildContext() {
  return {
    title: title.value,
    description: description.value,
    image: props.image ?? '',
    url: location.href,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    timestamp: new Date().toISOString(),
    requests: selectedRequests(),
    errors: selectedErrors(),
    elements: pickedElements.value,
    video: props.video ?? null
  }
}

const previewing = ref(false)
async function onPreview() {
  if (previewing.value) return
  const server = props.project.servers.find((s) => s.id === serverId.value)
  if (!server) return
  previewing.value = true
  try {
    try {
      const res = (await safeSendMessage({
        type: MSG.PREVIEW_PAYLOAD,
        source: 'content',
        payload: { server, context: buildContext() } satisfies PreviewPayloadReq
      })) as PreviewPayloadRes
      preview.value = res.rendered
    } catch (err) {
      preview.value = `生成预览时出错：${(err as Error).message}\n（可能「Payload 模板」里有语法问题，去 DevTools → Moo → 环境 → 上报服务器 → Payload 模板 检查一下）`
    }
  } finally {
    previewing.value = false
  }
}

async function onSubmit() {
  if (!canSubmit.value || submitting.value || successInfo.value) return
  submitting.value = true
  try {
    const ctx = buildContext()
    const req: SubmitBugReq = {
      serverId: serverId.value,
      projectId: props.project.id,
      title: title.value,
      description: description.value,
      image: props.image ?? '',
      url: ctx.url,
      userAgent: ctx.userAgent,
      viewport: ctx.viewport,
      timestamp: ctx.timestamp,
      requests: ctx.requests,
      errors: ctx.errors,
      elements: ctx.elements,
      video: ctx.video ?? undefined
    }
    const res = (await safeSendMessage({
      type: MSG.SUBMIT_BUG,
      source: 'content',
      payload: req
    })) as SubmitBugRes
    const { ok, message } = formatSubmitResult(res)
    if (ok) {
      // 成功：展示 1.5s 的 ✓ 内嵌反馈再关闭。比 toast 一闪有更明确的"动作完成"感。
      successInfo.value = { message, remoteId: res.remoteId }
      successTimer = window.setTimeout(() => {
        emit('submitted', true, message)
      }, SUCCESS_VIEW_MS)
    } else {
      // 失败：dialog 不关，外层弹 toast 显示错误原因，用户可改后再提交
      emit('submitted', false, message)
    }
  } catch (err) {
    emit('submitted', false, `提交异常: ${(err as Error).message}`)
  } finally {
    submitting.value = false
  }
}

/** 成功面板期间禁止点遮罩取消，避免误关。失败/正常表单态 mask 点击仍走取消。 */
function onMaskClick() {
  if (successInfo.value) return
  emit('cancel')
}

function onReannotate() {
  if (submitting.value || successInfo.value) return
  emit('reannotate')
}

function onRecapture() {
  if (submitting.value || successInfo.value) return
  emit('recapture')
}

// 键盘快捷键：Esc 取消，⌘/Ctrl+Enter 提交
function onKeydown(e: KeyboardEvent) {
  if (picking.value) return // 选元素状态由 ElementPicker 自己接管
  if (successInfo.value) return // 成功视图期间快捷键全部禁用，等待自动关闭
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('cancel')
    return
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    void onSubmit()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  // 自动聚焦标题输入，省一次点击
  nextTick(() => titleInput.value?.focus())
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  if (successTimer) clearTimeout(successTimer)
})
</script>
