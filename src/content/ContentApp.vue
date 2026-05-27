<template>
  <div class="moo-root">
    <FloatingBall
      v-if="matches.length && !hostHidden"
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
      <button class="moo-btn small" aria-label="停止录屏" @click="stopRecording">⏹ 停止</button>
      <button class="moo-btn small" aria-label="取消录屏（丢弃已录内容）" @click="cancelRecording">取消</button>
    </div>

    <Annotator
      v-if="state === 'annotating' && rawImage"
      :image="rawImage"
      @finish="onAnnotated"
      @cancel="onAnnotatorCancel"
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
      @async-load-failed="(msg: string) => showToast(msg, 'error')"
    />
    <div v-if="toast" :class="['moo-toast', toastKind]" :role="toastKind === 'error' ? 'alert' : 'status'" aria-live="polite">{{ toast }}</div>

    <!-- 录屏鼠标点击涟漪（v0.7.2）：state=recording 时挂 listener；过滤 Moo 自己的 UI 点击 -->
    <div v-if="state === 'recording'" class="moo-ripple-layer" aria-hidden="true">
      <div v-for="r in ripples" :key="r.id" class="moo-ripple" :style="{ left: r.x + 'px', top: r.y + 'px' }" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import FloatingBall from './FloatingBall.vue'
import { maskPasswordInputs } from './passwordMask'
import { useRecorder, type RecordingResult } from './useRecorder'
import type { Project } from '@/types/config'
import { MSG, type CaptureScreenshotRes, type MatchProjectRes } from '@/types/messages'
import { onConfigChanged } from '@/storage/config'
import { safeSendMessage } from '@/utils/messaging'
import { useToast } from '@/composables/useToast'
import { guardFocusForHost } from '@/utils/stealPageFocus'
import { useRequests } from './useRequests'
import { useErrors, setErrorsEnabled } from './useErrors'
import { HOST_ID } from './styles'

type State = 'idle' | 'capturing' | 'annotating' | 'recording' | 'submitting'

const state = ref<State>('idle')
/** 当前页面匹配到的所有项目（>=0 个；空数组时悬浮球不显示） */
const matches = ref<Project[]>([])
/** v0.7.4：popup 点「悬浮球当前页隐藏」开关后，本 host 加入 chrome.storage.session
 *  里的隐藏列表。chrome 重启自动恢复（临时藏语义）。listener 跨 popup ↔ content
 *  同步。 */
const HIDDEN_HOSTS_KEY = 'mooHiddenFloatingBallHosts'
const hostHidden = ref(false)
let hiddenHostsWatcher: ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void) | null = null
async function refreshHostHidden(): Promise<void> {
  try {
    const r = await chrome.storage.session.get(HIDDEN_HOSTS_KEY)
    const list = (r[HIDDEN_HOSTS_KEY] as string[] | undefined) ?? []
    hostHidden.value = list.includes(location.hostname)
  } catch { hostHidden.value = false }
}
/** 当前 active 项目：唯一匹配时即 matches[0]；多匹配时由用户在悬浮球里点选确认 */
const project = ref<Project | null>(null)
const rawImage = ref('')
const annotatedImage = ref('')
const recordedVideo = ref<RecordingResult | null>(null)
// 这处 kind 多一个 '' 空态——模板里直接把 toastKind 当 class 写（不带前缀），
// hide 时需要把 kind 重置成 '' 清掉残留 class
const { toast, toastKind, showToast: showToastRaw } = useToast<'success' | 'error' | 'info' | ''>({
  initialKind: '',
  resetKindOnHide: ''
})

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
    const parsed = JSON.parse(saved) as unknown
    if (!parsed || typeof parsed !== 'object') return fallback
    const p = parsed as { x: unknown; y: unknown }
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return fallback
    if (!isFinite(p.x) || !isFinite(p.y)) return fallback
    const BAR_W = 245
    const BAR_H = 42
    const left = Math.max(8, Math.min(window.innerWidth - BAR_W - 8, p.x))
    const top = Math.max(8, Math.min(window.innerHeight - BAR_H - 8, p.y))
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
  // 注：曾尝试 try/catch 保留旧 matches 防"切 tab 闪一下消失"，但 SW 偶发不可达
  // 概率本身极低（offscreen / alarm 都能保活），那个修法的副作用反而引发回归
  // （第一次 refreshProject 拿不到 res 时 matches 就一直空）。回归原版 fallback。
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
  project.value = matches.value.length === 1 ? (matches.value[0] ?? null) : null
  const cfgSrc = project.value ?? matches.value[0]
  if (cfgSrc) {
    reqApi.setConfig({ capture: cfgSrc.capture, redact: cfgSrc.redact })
    // v0.4.8：consoleErrors 开关真生效（之前 Settings UI 显示但代码无读点）
    setErrorsEnabled(cfgSrc.capture.consoleErrors !== false)
  } else {
    // v0.4.8：URL 没匹配任何项目 → 显式停掉 capture 防隐私洞。
    // v0.7.0：main-world 也走 dynamic register 不再 all_urls 全站注入，理论上没匹配的 URL
    // 不会跑到这分支；但保留这层防御兜底 race（用户改 pattern 后 SW reregister 跟 content
    // 双向通信窗口期 + 用户在某 tab 取消选中已匹配 project）

    reqApi.setConfig({ capture: { requests: false, consoleErrors: false, storageKeys: [], requestBufferSize: 50 } })
    setErrorsEnabled(false)
  }
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
    if (!project.value && matches.value[0]) onSelectProject(matches.value[0].id)
    startCapture()
  }
}

// 监听器引用——存起来才能在 unmount 时拆掉。`onConfigChanged` 返回的 dispose
// 函数和 chrome.runtime.onMessage handler 不在 onBeforeUnmount 里清掉的话，
// 每次 Vue app 重挂（极少但 SPA 切换 / 扩展 reload 边缘 case 会触发）都会叠加
// 一份，长期累积导致 storage 变更触发 N 次 refreshProject + 多份 toast。
let disposeConfigWatcher: (() => void) | null = null
function onRuntimeMessage(raw: unknown, sender?: chrome.runtime.MessageSender) {
  // 严格校验消息来源（v0.4.5 复盘加固）：sender.id 必须 === runtime.id。
  // 任何不匹配（含 undefined / 不同 ext id）直接拒，防第三方扩展构造
  // RECORD_EXTERNAL_STARTED 让 page 凭空切到 recording 态。
  if (sender && sender.id !== chrome.runtime.id) return
  // 校验 shape：避免任意 chrome.runtime.sendMessage({type:'...',...}) 调用伪造 UI。
  // messages.ts 给出了相关接口，这里只做运行时最小校验。
  if (!raw || typeof raw !== 'object') return
  const msg = raw as { type?: unknown; ok?: unknown; error?: unknown; reason?: unknown }
  if (typeof msg.type !== 'string') return

  if (msg.type === MSG.RECORD_EXTERNAL_STARTED) {
    if (typeof msg.ok !== 'boolean') return
    if (!msg.ok) {
      showToast(typeof msg.error === 'string' ? msg.error : '录屏没能开始（可能浏览器拒了授权）。请按 ⌥⇧R 重试', 'error')
      return
    }
    // 录屏由快捷键触发，没有 UI 让用户挑项目；多匹配时 default 到首个，
    // 用户在 SubmitDialog 之外没法切换，但符合"快捷键不被打断"的预期
    if (!project.value && matches.value[0]) {
      onSelectProject(matches.value[0].id)
    }
    void beginRecordingFromCommand()
    return
  }

  if (msg.type === MSG.RECORD_AUTO_STOPPED) {
    // 用户点了 Chrome 顶部"停止共享"条 → offscreen 自动 stop → SW 转发。
    // 必须主动切回 idle，否则 rec-bar 永远停留 + useRecorder.pendingResolve
    // 永远不 resolve，state.value 卡在 'recording'。
    if (state.value === 'recording') {
      recorder.externallyStopped()
      state.value = 'idle'
      showToast('录屏已被浏览器停止（点击了"停止共享"条）。如需附视频请重新按 ⌥⇧R 起录', 'info')
    }
    return
  }
}

// SPA 路由切换：main-world.ts hook 了 history.pushState/replaceState + popstate/hashchange，
// 通过 postMessage 推 __moo_url__ 信号过来。比之前 1s 轮询省 CPU（尤其是 100 tab 场景）。
let lastUrl = location.href
function onUrlMaybeChanged() {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    refreshProject()
  }
}
function onUrlSignalMessage(e: MessageEvent) {
  if (e.source !== window || e.origin !== location.origin) return
  const data = e.data as { __moo?: boolean; tag?: string } | undefined
  if (!data?.__moo || data.tag !== '__moo_url__') return
  onUrlMaybeChanged()
}

// v0.7.8 P0：全局 focus guard — page document 上 capture-phase 监听 focusin/out，
// 焦点切到 Moo host 时 stopImmediatePropagation 让 page 富文本编辑器 / element-ui
// modal trap 收不到 event 不会抢回。覆盖所有 Moo overlay（Annotator / SubmitDialog /
// FloatingBall），不需要各组件单独 install。详见 utils/stealPageFocus 注释。
let focusGuardCleanup: (() => void) | null = null

onMounted(async () => {
  // 请求监听需要尽早启动，匹配项目之前先用默认配置开始收集
  reqApi.start()
  errApi.start()
  // v0.7.8 P0：guard 必须在所有 overlay 之前安装（user 即使在 mount 链路内点开 page modal，
  // 后续触发 overlay 时 guard 已生效）
  focusGuardCleanup = guardFocusForHost(HOST_ID)
  await refreshProject()
  // v0.7.4：读 session 隐藏 host 列表 + 监听跨 popup 同步
  await refreshHostHidden()
  hiddenHostsWatcher = (changes, area) => {
    if (area === 'session' && HIDDEN_HOSTS_KEY in changes) void refreshHostHidden()
  }
  chrome.storage.onChanged.addListener(hiddenHostsWatcher)
  // 配置变化时实时更新匹配（保存 dispose 用于 unmount 拆除）
  disposeConfigWatcher = onConfigChanged(() => refreshProject())
  // SPA 路由变化也重匹配 —— 主路径走 main-world hook 推过来的 message，
  // 底兜 popstate / hashchange 直接监听（部分页面可能不经 history API）
  window.addEventListener('message', onUrlSignalMessage)
  window.addEventListener('popstate', onUrlMaybeChanged)
  window.addEventListener('hashchange', onUrlMaybeChanged)
  // 快捷键：Cmd/Ctrl + Shift + B
  window.addEventListener('keydown', onKeydown, true)
  // 窗口 resize 时让录制浮条重算位置（clamp 到新视口边缘）
  window.addEventListener('resize', onWindowResize)
  // 接收 background 通过 chrome.commands 触发的录屏
  chrome.runtime.onMessage.addListener(onRuntimeMessage)
  // 远程录屏接管：任意 tab onMounted 都查一次全局录屏状态，命中就拉起 rec-bar。
  // 设计取舍：原录屏 tab reload 时也会命中——若 stream 真已 end，几百 ms 内
  // 后续 RECORD_AUTO_STOPPED 广播到达，rec-bar 退回 idle、悬浮球重现。短暂"先
  // 显 rec-bar 后退"比"切 tab 看不到任何录屏指示"是用户更想要的。
  void adoptRemoteRecording()
})

async function adoptRemoteRecording(): Promise<void> {
  if (state.value !== 'idle') return
  const res = (await safeSendMessage<{ recording: boolean; startedAt?: number }>(
    { type: MSG.QUERY_RECORDING_STATE, source: 'content' },
    { fallback: { recording: false } }
  )) as { recording: boolean; startedAt?: number }
  if (!res?.recording || !res.startedAt) return
  if (state.value !== 'idle') return  // 极小概率：等 SW 期间用户已开始操作
  // 多匹配且未选项目时 default 首个，跟快捷键路径对齐
  if (!project.value && matches.value[0]) onSelectProject(matches.value[0].id)
  state.value = 'recording'
  const result = await recorder.startExternally(res.startedAt)
  if (!result) {
    // STOP/CANCEL 是别的 tab 操作的 → AUTO_STOPPED 广播让我们 externallyStopped
    // → result=null。state 应该已经被 onRuntimeMessage 切到 idle 了；再防一下。
    if (state.value === 'recording') state.value = 'idle'
    return
  }
  // 同样小概率：本 tab 自己拿到 dataUrl（即本 tab 上点了停止）。走 SubmitDialog。
  recordedVideo.value = result
  state.value = 'submitting'
}

onBeforeUnmount(() => {
  window.removeEventListener('message', onUrlSignalMessage)
  window.removeEventListener('popstate', onUrlMaybeChanged)
  window.removeEventListener('hashchange', onUrlMaybeChanged)
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('pointerdown', onDocPointerDown, { capture: true })
  clearAllRipples()
  // v0.7.8 P0：清 focus guard listener
  if (focusGuardCleanup) { focusGuardCleanup(); focusGuardCleanup = null }
  chrome.runtime.onMessage.removeListener(onRuntimeMessage)
  if (hiddenHostsWatcher) {
    chrome.storage.onChanged.removeListener(hiddenHostsWatcher)
    hiddenHostsWatcher = null
  }
  disposeConfigWatcher?.()
  disposeConfigWatcher = null
})

function onWindowResize() {
  resizeTick.value++
}

// ─── 录屏鼠标点击涟漪 (v0.7.2) ────────────────────────────────────────────
// 录视频时同事看不出点了哪儿；state=recording 时挂 window pointerdown capture，
// 每次主键点击在坐标画一个 800ms 涟漪。过滤 Moo 自己 UI 内的点（rec-bar / dialog / floating-ball）。
//
// 取舍：listener 跨 closed shadow 拿不到 shadow 内 e.target，宿主世界看到的是 host
// 元素本身 → composedPath().some(n => n.id === HOST_ID) 命中即跳过；点宿主页 button
// 时 composedPath 不含 host → 画圈。
const ripples = ref<{ id: number; x: number; y: number }[]>([])
let nextRippleId = 1
const rippleTimers = new Map<number, number>()

function onDocPointerDown(e: PointerEvent) {
  if (e.button !== 0) return  // 只主键
  const path = e.composedPath()
  for (const n of path) {
    if (n instanceof Element && n.id === HOST_ID) return  // 自己 UI 内的点击跳过
  }
  const id = nextRippleId++
  ripples.value.push({ id, x: e.clientX, y: e.clientY })
  const t = window.setTimeout(() => {
    ripples.value = ripples.value.filter((r) => r.id !== id)
    rippleTimers.delete(id)
  }, 800)
  rippleTimers.set(id, t)
}

function clearAllRipples() {
  for (const t of rippleTimers.values()) clearTimeout(t)
  rippleTimers.clear()
  ripples.value = []
}

watch(state, (s, old) => {
  if (s === 'recording' && old !== 'recording') {
    window.addEventListener('pointerdown', onDocPointerDown, { capture: true, passive: true })
  } else if (s !== 'recording' && old === 'recording') {
    window.removeEventListener('pointerdown', onDocPointerDown, { capture: true })
    clearAllRipples()
  }
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
    res = (await safeSendMessage({
      type: MSG.CAPTURE_SCREENSHOT,
      source: 'content'
    })) as CaptureScreenshotRes
  } catch (err) {
    showToast(`没截到图：${(err as Error).message}。请刷新页面后重试`, 'error')
    state.value = 'idle'
    return
  } finally {
    unmask()
  }

  if (!res.ok || !res.dataUrl) {
    // v0.7.6 mv3-pro 业务深扫 P2：区分 quota error（重新截图连点 / 录屏太频繁）vs 权限 / 保护页
    const errMsg = res.error ?? '未知原因'
    const isQuota = /MAX_CAPTURE|quota|exceed/i.test(errMsg)
    const hint = isQuota
      ? '截图太频繁了（chrome 限 ≤ 2 次/秒），等 1 秒再试'
      : '可能 chrome.tabs 权限没开，或当前是 chrome:// / 应用商店 / 跨域 iframe 等保护页'
    showToast(`没截到图：${errMsg}。${hint}`, 'error')
    state.value = 'idle'
    return
  }
  rawImage.value = res.dataUrl
  state.value = 'annotating'
}

// v0.7.6 mv3-pro 业务深扫 P2：Annotator emit cancel(reason?) — 'error' 是截图 dataUrl
// 加载失败（不是用户主动取消），告知用户重试不要静默退到 idle 让用户摸不着头脑
function onAnnotatorCancel(reason?: 'error') {
  reset()
  if (reason === 'error') {
    showToast('截图加载失败，请重试。可能是 dataUrl 损坏 / 跨域 / 宿主页 CSP 阻塞', 'error')
  }
}

function onAnnotated(dataUrl: string) {
  annotatedImage.value = dataUrl
  state.value = 'submitting'
}

// 悬浮球点录屏 —— 受 Chrome MV3 限制无法在 content script 链路保留 user gesture，
// 这里显示中性提示（不是错误）。按钮本身已经在 UI 上挂了 ⌥⇧R 标签提示用法。
//
// 决策（v0.6.3 general-purpose 三审复盘）：不做 content-layer permission preflight 申请。
// 理由：① user gesture 跨 content → SW message 边界已丢，preflight 也救不了
// tabCapture.getMediaStreamId 必须 SW 直接拿 chrome.commands user activation；
// ② 当前 toast 引导用快捷键的 UX 体验对开发者用户够用（不是终端用户级）；
// ③ 改造跨 user gesture boundary 是 v0.7.x 的事，要走 chrome.action.openPopup +
// popup 内同步 enable +「点击图标 → 录屏」整套（非本版范围）。
function startRecord() {
  showToast('录屏需要键盘启动：按 ⌥⇧R（Mac）/ Alt+Shift+R（Win）。\nChrome 安全规则限制录屏必须由快捷键触发，悬浮球点击无法启动。\n如需改键：chrome://extensions/shortcuts', 'info')
}

async function beginRecordingFromCommand() {
  if (state.value !== 'idle') return
  state.value = 'recording'
  const result = await recorder.startExternally()
  if (!result) {
    showToast(recorder.error.value || '录制已取消（或浏览器中断了屏幕共享）', 'info')
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
    showToast('原始截图找不到了（可能扩展刚被重新加载）。请关闭这个提交框，重新截一张', 'error')
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
  // 失败 toast 显示更久，方便读完错误原因
  showToastRaw(msg, kind, kind === 'error' ? 6000 : 2800)
}

// Annotator / SubmitDialog 仅在「截图标注 / 提交」流程才渲染（state=annotating|submitting），
// 90% 浏览页面用不到。defineAsyncComponent 拆独立 chunk：首注入 content script
// 从 ~99KB 降到 <60KB；首次触发截图（悬浮球点击 / popup 触发）时本地 chunk 加载 ~50-100ms 内可接受。
//
// onError 兜底：扩展刚被重载（chrome://extensions 点 🔄 / 装新版）后，老 tab 里的
// content script 还在跑，但 chrome-extension://EXTID/assets/<old-hash>.js 已 404。
// 不接 onError 的话 import() reject 后 Annotator 永不挂载，悬浮球此刻又是 hidden，
// 用户什么都看不到（截图卡死）。重试一次防偶发网络抖动，再失败就 toast 让用户刷新页。
// 必须在 setup 里调（不能放模块顶层），否则闭包不到 state / showToast。
// 不加 loadingComponent —— 用户按截图键是同步动作，秒开是常态，加 loading 反而 UI 闪烁。
function makeAsyncWithFallback(
  loader: () => Promise<unknown>,
  what: string
) {
  return defineAsyncComponent({
    loader: loader as () => Promise<typeof import('./Annotator.vue')>,
    timeout: 10000,
    onError(err, retry, fail, attempts) {
      if (attempts <= 1) {
        retry()
        return
      }
      console.error(`[moo] async load failed: ${what}`, err)
      fail()
      showToast('扩展刚重载，请刷新当前页面（⌘R / F5）', 'error')
      state.value = 'idle'
    }
  })
}
const Annotator = makeAsyncWithFallback(() => import('./Annotator.vue'), 'Annotator')
const SubmitDialog = makeAsyncWithFallback(() => import('./SubmitDialog.vue'), 'SubmitDialog')
</script>
