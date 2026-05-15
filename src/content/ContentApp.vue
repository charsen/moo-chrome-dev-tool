<template>
  <div class="moo-root">
    <FloatingBall
      v-if="matches.length"
      :hidden="state !== 'idle'"
      :matches="matches"
      @select-project="onSelectProject"
      @capture="startCapture"
      @record="startRecord"
    />

    <!-- 录制中浮条 -->
    <div v-if="state === 'recording'" class="moo-rec-bar">
      <span class="rec-dot" />
      <span class="rec-time">{{ fmtDuration(recordElapsed) }}</span>
      <button class="moo-btn small" @click="stopRecording">⏹ 停止</button>
      <button class="moo-btn small" @click="cancelRecording">取消</button>
    </div>

    <Annotator
      v-if="state === 'annotating' && rawImage"
      :image="rawImage"
      @finish="onAnnotated"
      @cancel="reset"
    />
    <SubmitDialog
      v-if="state === 'submitting' && project"
      :project="project"
      :image="annotatedImage"
      :video="recordedVideo"
      :requests="capturedRequests"
      :errors="capturedErrors"
      @cancel="reset"
      @submitted="onSubmitted"
    />
    <div v-if="toast" :class="['moo-toast', toastKind]">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import FloatingBall from './FloatingBall.vue'
import Annotator from './Annotator.vue'
import SubmitDialog from './SubmitDialog.vue'
import { maskPasswordInputs } from './passwordMask'
import { useRecorder, type RecordingResult } from './useRecorder'
import type { Project } from '@/types/config'
import { MSG, type CaptureScreenshotRes, type MatchProjectRes } from '@/types/messages'
import { onConfigChanged } from '@/storage/config'
import { useRequests } from './useRequests'
import { useErrors } from './useErrors'

type State = 'idle' | 'capturing' | 'annotating' | 'recording' | 'submitting'

const state = ref<State>('idle')
/** 当前页面匹配到的所有项目（>=0 个；空数组时悬浮球不显示） */
const matches = ref<Project[]>([])
/** 当前 active 项目：唯一匹配时即 matches[0]；多匹配时由用户在悬浮球里点选确认 */
const project = ref<Project | null>(null)
const rawImage = ref('')
const annotatedImage = ref('')
const recordedVideo = ref<RecordingResult | null>(null)
const toast = ref('')
const toastKind = ref<'success' | 'error' | ''>('')
let toastTimer: number | undefined
let spaTimer: number | undefined

const recorder = useRecorder({ maxSeconds: 30 })
const recordElapsed = computed(() => recorder.elapsed.value)

const reqApi = useRequests()
const errApi = useErrors()
const capturedRequests = computed(() => reqApi.requests.value)
const capturedErrors = computed(() => errApi.errors.value)

async function refreshProject() {
  const res = (await chrome.runtime.sendMessage({
    type: MSG.MATCH_PROJECT,
    source: 'content',
    payload: { url: location.href }
  })) as MatchProjectRes
  matches.value = res.matches ?? (res.project ? [res.project] : [])
  // 唯一匹配 → 直接 active；多匹配 → 留空，等用户在悬浮球里选
  // 抓取配置始终走 matches[0]（同一 URL 命中的项目，抓取/脱敏通常一致；
  // 即使有差异，submit 时仍用用户选定的 active project，所以问题可控）
  project.value = matches.value.length === 1 ? matches.value[0] : null
  const cfgSrc = project.value ?? matches.value[0]
  if (cfgSrc) reqApi.setConfig({ capture: cfgSrc.capture, redact: cfgSrc.redact })
}

function onSelectProject(id: string) {
  const p = matches.value.find((x) => x.id === id)
  if (p) {
    project.value = p
    reqApi.setConfig({ capture: p.capture, redact: p.redact })
  }
}

function onKeydown(e: KeyboardEvent) {
  if (state.value !== 'idle' || matches.value.length === 0) return
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
    e.preventDefault()
    // 快捷键场景没 UI 让用户挑，多匹配时 default 到首个；用户事后想换可在悬浮球点切换
    if (!project.value) onSelectProject(matches.value[0].id)
    startCapture()
  }
}

onMounted(async () => {
  // 请求监听需要尽早启动，匹配项目之前先用默认配置开始收集
  reqApi.start()
  errApi.start()
  await refreshProject()
  // 配置变化时实时更新匹配
  onConfigChanged(() => refreshProject())
  // SPA 路由变化也重匹配
  let lastUrl = location.href
  spaTimer = window.setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      refreshProject()
    }
  }, 1000)
  // 快捷键：Cmd/Ctrl + Shift + B
  window.addEventListener('keydown', onKeydown, true)
  // 接收 background 通过 chrome.commands 触发的录屏（user gesture 保留在 onCommand 上下文，
  // 这里只负责开 UI / 接管计时）
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== MSG.RECORD_EXTERNAL_STARTED) return
    if (!msg.ok) {
      showToast(msg.error || '录屏启动失败', 'error')
      return
    }
    // 录屏由快捷键触发，没有 UI 让用户挑项目；多匹配时 default 到首个，
    // 用户在 SubmitDialog 之外没法切换，但符合"快捷键不被打断"的预期
    if (!project.value && matches.value.length > 0) {
      onSelectProject(matches.value[0].id)
    }
    void beginRecordingFromCommand()
  })
})

onBeforeUnmount(() => {
  if (spaTimer) clearInterval(spaTimer)
  if (toastTimer) clearTimeout(toastTimer)
  window.removeEventListener('keydown', onKeydown, true)
})

async function startCapture() {
  if (state.value !== 'idle') return
  state.value = 'capturing'
  // 等一帧让悬浮球隐藏后再截图
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

  // 按项目 redact 配置遮罩密码框
  const shouldMask = project.value?.redact?.maskPasswordInputs ?? true
  const unmask = shouldMask ? maskPasswordInputs() : () => {}
  // 再等一帧让 overlay 渲染上屏
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

  let res: CaptureScreenshotRes
  try {
    res = (await chrome.runtime.sendMessage({
      type: MSG.CAPTURE_SCREENSHOT,
      source: 'content'
    })) as CaptureScreenshotRes
  } finally {
    unmask()
  }

  if (!res.ok || !res.dataUrl) {
    showToast(`截图失败: ${res.error ?? 'unknown'}`, 'error')
    state.value = 'idle'
    return
  }
  rawImage.value = res.dataUrl
  state.value = 'annotating'
}

function onAnnotated(dataUrl: string) {
  annotatedImage.value = dataUrl
  state.value = 'submitting'
}

// 悬浮球点录屏 —— 受 Chrome MV3 限制无法在 content script 链路保留 user gesture，
// 这里只显示快捷键提示，真正的录制入口在 chrome.commands。
function startRecord() {
  showToast('请按 ⌥⇧R（Alt+Shift+R）开始录屏。可在 chrome://extensions/shortcuts 改键。', 'error')
}

async function beginRecordingFromCommand() {
  if (state.value !== 'idle') return
  state.value = 'recording'
  const result = await recorder.startExternally()
  if (!result) {
    showToast(recorder.error.value || '录制取消', 'error')
    state.value = 'idle'
    return
  }
  recordedVideo.value = result
  state.value = 'submitting'
}

function stopRecording() {
  void recorder.stop()
}

function cancelRecording() {
  void recorder.cancel()
  state.value = 'idle'
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60), ss = s % 60
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function onSubmitted(ok: boolean, message: string) {
  showToast(message, ok ? 'success' : 'error')
  if (ok) reset()
}

function reset() {
  state.value = 'idle'
  rawImage.value = ''
  annotatedImage.value = ''
  recordedVideo.value = null
}

function showToast(msg: string, kind: 'success' | 'error') {
  toast.value = msg
  toastKind.value = kind
  if (toastTimer) clearTimeout(toastTimer)
  // 失败 toast 显示更久，方便读完错误原因
  const duration = kind === 'error' ? 6000 : 2800
  toastTimer = window.setTimeout(() => {
    toast.value = ''
    toastKind.value = ''
  }, duration)
}
</script>
