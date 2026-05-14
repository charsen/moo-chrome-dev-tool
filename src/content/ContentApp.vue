<template>
  <div class="moo-root">
    <FloatingBall
      v-if="project"
      :tip="`Moo · ${project.name} (⌘/Ctrl+Shift+B)`"
      :hidden="state !== 'idle'"
      @capture="startCapture"
    />
    <Annotator
      v-if="state === 'annotating' && rawImage"
      :image="rawImage"
      @finish="onAnnotated"
      @cancel="reset"
    />
    <SubmitDialog
      v-if="state === 'submitting' && project && annotatedImage"
      :project="project"
      :image="annotatedImage"
      :requests="capturedRequests"
      :errors="capturedErrors"
      @cancel="reset"
      @submitted="onSubmitted"
    />
    <div v-if="toast" :class="['moo-toast', toastKind]">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import FloatingBall from './FloatingBall.vue'
import Annotator from './Annotator.vue'
import SubmitDialog from './SubmitDialog.vue'
import { maskPasswordInputs } from './passwordMask'
import type { Project } from '@/types/config'
import { MSG, type CaptureScreenshotRes, type MatchProjectRes } from '@/types/messages'
import { onConfigChanged } from '@/storage/config'
import { useRequests } from './useRequests'
import { useErrors } from './useErrors'

type State = 'idle' | 'capturing' | 'annotating' | 'submitting'

const state = ref<State>('idle')
const project = ref<Project | null>(null)
const rawImage = ref('')
const annotatedImage = ref('')
const toast = ref('')
const toastKind = ref<'success' | 'error' | ''>('')
let toastTimer: number | undefined

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
  project.value = res.project
  if (project.value) {
    reqApi.setConfig({ capture: project.value.capture, redact: project.value.redact })
  }
}

function onKeydown(e: KeyboardEvent) {
  if (state.value !== 'idle' || !project.value) return
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
    e.preventDefault()
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
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      refreshProject()
    }
  }, 1000)
  // 快捷键：Cmd/Ctrl + Shift + B
  window.addEventListener('keydown', onKeydown, true)
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

function onSubmitted(ok: boolean, message: string) {
  showToast(message, ok ? 'success' : 'error')
  if (ok) reset()
}

function reset() {
  state.value = 'idle'
  rawImage.value = ''
  annotatedImage.value = ''
}

function showToast(msg: string, kind: 'success' | 'error') {
  toast.value = msg
  toastKind.value = kind
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = ''
    toastKind.value = ''
  }, 2800)
}
</script>
