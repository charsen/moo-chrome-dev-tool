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

    <!-- 录制中浮条：从悬浮球的最后位置浮起，避免"动作在 A、反馈在屏幕顶"的视觉断裂 -->
    <div v-if="state === 'recording'" class="moo-rec-bar" :style="recBarStyle">
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
      @reannotate="onReannotate"
      @recapture="onRecapture"
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
import { safeSendMessage } from '@/utils/messaging'
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
const toastKind = ref<'success' | 'error' | 'info' | ''>('')
let toastTimer: number | undefined
let spaTimer: number | undefined

const recorder = useRecorder({ maxSeconds: 30 })
const recordElapsed = computed(() => recorder.elapsed.value)

/** 录制浮条的定位：读悬浮球最后存的坐标（FloatingBall.vue 同样的 'moo-ball-pos' key），
 * 进入 recording 状态时锁定一份，避免拖动后再变化导致浮条乱跳。
 * 浮条约 245px 宽，按视口边缘 clamp 防溢出。 */
// resizeTick 在窗口 resize 时累加，强制 recBarStyle 重新求值（clamp 到新视口）
const resizeTick = ref(0)
const recBarStyle = computed(() => {
  void resizeTick.value // 让计算依赖 resizeTick，resize 时重算
  const fallback: Record<string, string> = {}
  if (state.value !== 'recording') return fallback
  try {
    const saved = localStorage.getItem('moo-ball-pos')
    if (!saved) return fallback
    const parsed = JSON.parse(saved) as { x: unknown; y: unknown }
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return fallback
    const BAR_W = 245
    const BAR_H = 42
    const left = Math.max(8, Math.min(window.innerWidth - BAR_W - 8, parsed.x))
    const top = Math.max(8, Math.min(window.innerHeight - BAR_H - 8, parsed.y))
    return { left: `${left}px`, top: `${top}px`, transform: 'none' }
  } catch {
    return fallback
  }
})

const reqApi = useRequests()
const errApi = useErrors()
const capturedRequests = computed(() => reqApi.requests.value)
const capturedErrors = computed(() => errApi.errors.value)

async function refreshProject() {
  // SW 暂时不可达时静默 fallback —— 悬浮球消失比抛错让 Vue 卡死要好；下次 SPA 路由变更会再试。
  const res = (await safeSendMessage<MatchProjectRes>(
    {
      type: MSG.MATCH_PROJECT,
      source: 'content',
      payload: { url: location.href }
    },
    { fallback: { matches: [], project: null } satisfies MatchProjectRes }
  )) as MatchProjectRes
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
  // 窗口 resize 时让录制浮条重算位置（clamp 到新视口边缘）
  window.addEventListener('resize', onWindowResize)
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
  window.removeEventListener('resize', onWindowResize)
})

function onWindowResize() {
  resizeTick.value++
}

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
    res = (await safeSendMessage({
      type: MSG.CAPTURE_SCREENSHOT,
      source: 'content'
    })) as CaptureScreenshotRes
  } catch (err) {
    showToast(`截图失败: ${(err as Error).message}`, 'error')
    state.value = 'idle'
    return
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
// 这里显示中性提示（不是错误）。按钮本身已经在 UI 上挂了 ⌥⇧R 标签提示用法。
function startRecord() {
  showToast('录屏请按 ⌥⇧R（Alt+Shift+R）。可在 chrome://extensions/shortcuts 改键。', 'info')
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
  // 成功时 SubmitDialog 已经在内嵌反馈面板里展示了 ✓，不再用 toast 抢戏；
  // 失败时弹窗保留打开，toast 提示原因，方便用户改后重提。
  if (ok) {
    reset()
  } else {
    showToast(message, 'error')
  }
}

// 用户在 SubmitDialog 上点"重新标注"：退回 Annotator 用 rawImage 重画一遍。
// 已经标好的内容会丢失（Annotator 内部状态不跨 mount 保留），录屏和已选请求/错误保留。
function onReannotate() {
  if (!rawImage.value) {
    showToast('原始截图已丢失，无法重新标注', 'error')
    return
  }
  annotatedImage.value = ''
  state.value = 'annotating'
}

// 用户在 SubmitDialog 上点"重新截图"：清掉旧截图重新触发屏幕捕获。
// 录屏 / 已收集的请求/错误保留——只重做画面这一项。
async function onRecapture() {
  rawImage.value = ''
  annotatedImage.value = ''
  state.value = 'idle'
  // 等 Vue 卸载 SubmitDialog 一帧，再走 startCapture 的"等悬浮球隐藏 → 截屏"流程
  await new Promise((r) => requestAnimationFrame(r))
  void startCapture()
}

function reset() {
  state.value = 'idle'
  rawImage.value = ''
  annotatedImage.value = ''
  recordedVideo.value = null
}

function showToast(msg: string, kind: 'success' | 'error' | 'info') {
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
