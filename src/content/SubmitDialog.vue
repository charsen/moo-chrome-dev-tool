<template>
  <div class="moo-dialog-mask" @click.self="emit('cancel')">
    <div class="moo-dialog">
      <header class="moo-dialog-head">
        <h3>提交 Bug — {{ project.name }}</h3>
        <button class="moo-close-btn" @click="emit('cancel')">×</button>
      </header>
      <div class="moo-dialog-body">
        <div class="moo-form-row">
          <label>截图</label>
          <img class="moo-thumb" :src="image" />
        </div>
        <div class="moo-form-row">
          <label>标题</label>
          <input v-model="title" placeholder="一句话描述问题" />
        </div>
        <div class="moo-form-row">
          <label>描述</label>
          <textarea v-model="description" rows="3" placeholder="复现步骤、预期、实际…" />
        </div>
        <div class="moo-form-row">
          <label>服务器</label>
          <select v-model="serverId">
            <option v-for="s in project.servers" :key="s.id" :value="s.id">
              {{ s.name }} — {{ s.endpoint || '(未配置 endpoint)' }}
            </option>
            <option v-if="!project.servers.length" disabled value="">无可用服务器，请先在 DevTools 配置</option>
          </select>
        </div>

        <div class="moo-form-row moo-req-row">
          <label>
            附带请求
            <div class="req-count">{{ selectedIds.size }} / {{ filtered.length }}</div>
          </label>
          <div class="req-panel">
            <div class="req-controls">
              <select v-model="windowMs" class="req-window">
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
                <span :class="['method', r.method.toLowerCase()]">{{ r.method }}</span>
                <span :class="['status', statusClass(r.status)]">{{ r.status || 'ERR' }}</span>
                <span class="url" :title="r.url">{{ shortUrl(r.url) }}</span>
                <span class="dur">{{ Math.round(r.duration) }}ms</span>
              </label>
            </div>
            <div v-else class="req-empty">
              暂无符合条件的请求。提示：MAIN world 脚本只能抓到注入之后发起的请求，安装/刷新后才有数据。
            </div>
          </div>
        </div>

        <div class="moo-form-row moo-req-row" v-if="errors.length">
          <label>
            附带错误
            <div class="req-count">{{ selectedErrIds.size }} / {{ errors.length }}</div>
          </label>
          <div class="req-panel">
            <div class="req-list">
              <label v-for="e in errors.slice().reverse()" :key="e.id" class="req-item">
                <input type="checkbox" :checked="selectedErrIds.has(e.id)" @change="toggleErr(e.id)" />
                <span :class="['status', e.level === 'error' ? 'err' : e.level === 'rejection' ? 'err' : 'warn']">
                  {{ e.level === 'rejection' ? 'REJ' : e.level === 'console' ? 'CON' : 'ERR' }}
                </span>
                <span class="url" :title="e.message">{{ e.message }}</span>
              </label>
            </div>
          </div>
        </div>

        <div class="moo-form-row" v-if="preview">
          <label>预览</label>
          <pre class="moo-preview">{{ preview }}</pre>
        </div>
      </div>
      <footer class="moo-dialog-foot">
        <button class="moo-btn" @click="emit('cancel')">取消</button>
        <button class="moo-btn" :disabled="!canPreview" @click="onPreview">预览 payload</button>
        <button class="moo-btn primary" :disabled="!canSubmit || submitting" @click="onSubmit">
          {{ submitting ? '提交中…' : '提交' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Project } from '@/types/config'
import type { CapturedRequest } from '@/types/requests'
import type { ConsoleError } from '@/types/errors'
import { MSG, type PreviewPayloadReq, type PreviewPayloadRes, type SubmitBugReq, type SubmitBugRes } from '@/types/messages'

const props = defineProps<{
  project: Project
  image: string
  requests: CapturedRequest[]
  errors: ConsoleError[]
}>()
const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'submitted', ok: boolean, message: string): void
}>()

const title = ref('')
const description = ref('')
const serverId = ref(props.project.defaultServerId || props.project.servers[0]?.id || '')
const preview = ref('')
const submitting = ref(false)

const windowMs = ref(30000)
const urlFilter = ref('')
const openedAt = performance.now()
const selectedIds = ref<Set<string>>(new Set())
const selectedErrIds = ref<Set<string>>(new Set())

const filtered = computed(() => {
  const all = props.requests
  let arr = windowMs.value < 0
    ? all
    : all.filter((r) => r.startTime + r.duration >= openedAt - windowMs.value)
  if (urlFilter.value.trim()) {
    const f = urlFilter.value.trim().toLowerCase()
    arr = arr.filter((r) => r.url.toLowerCase().includes(f))
  }
  return arr.slice().reverse() // 最新在上
})

// 打开时默认勾选最近 5 秒内的请求与所有错误
{
  const recent = props.requests.filter((r) => r.startTime + r.duration >= openedAt - 5000)
  selectedIds.value = new Set(recent.map((r) => r.id))
  selectedErrIds.value = new Set(props.errors.map((e) => e.id))
}

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

const canPreview = computed(() => !!serverId.value)
const canSubmit = computed(() => !!serverId.value && !!title.value.trim())

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
    image: props.image,
    url: location.href,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    timestamp: new Date().toISOString(),
    requests: selectedRequests(),
    errors: selectedErrors()
  }
}

async function onPreview() {
  const server = props.project.servers.find((s) => s.id === serverId.value)
  if (!server) return
  const res = (await chrome.runtime.sendMessage({
    type: MSG.PREVIEW_PAYLOAD,
    source: 'content',
    payload: { server, context: buildContext() } satisfies PreviewPayloadReq
  })) as PreviewPayloadRes
  preview.value = res.rendered
}

async function onSubmit() {
  submitting.value = true
  try {
    const ctx = buildContext()
    const req: SubmitBugReq = {
      serverId: serverId.value,
      projectId: props.project.id,
      title: title.value,
      description: description.value,
      image: props.image,
      url: ctx.url,
      userAgent: ctx.userAgent,
      viewport: ctx.viewport,
      timestamp: ctx.timestamp,
      requests: ctx.requests,
      errors: ctx.errors
    }
    const res = (await chrome.runtime.sendMessage({
      type: MSG.SUBMIT_BUG,
      source: 'content',
      payload: req
    })) as SubmitBugRes
    if (res.ok) {
      emit('submitted', true, `提交成功 (${res.status})`)
    } else {
      emit('submitted', false, `提交失败: ${res.error ?? `HTTP ${res.status}`}`)
    }
  } catch (err) {
    emit('submitted', false, `提交异常: ${(err as Error).message}`)
  } finally {
    submitting.value = false
  }
}
</script>
