/**
 * Offscreen 文档：跑 MediaRecorder。
 *
 * 为什么需要 offscreen：
 * - MV3 service worker 没有 MediaStream / MediaRecorder
 * - HTTP + IP 的普通页面不是 secure context，拿不到 navigator.mediaDevices
 * - 扩展自己的 offscreen 页面是 secure context，且可以接收 chrome.tabCapture streamId
 *
 * 消息流：
 *   background → { target: 'offscreen', type: 'START', streamId }
 *   background → { target: 'offscreen', type: 'STOP' }       → { ok, dataUrl, bytes, mime }
 *   background → { target: 'offscreen', type: 'CANCEL' }
 *
 * 状态机（v2 重构）：
 *   idle → STARTING → RECORDING → STOPPING → idle
 *                              ↘ idle (via CANCEL)
 *   出错路径任意态 → ERROR → idle (cleanup)
 *
 * 重构动机（Batch 8-G）：
 * 原版用 `recorder == null` 暗示状态，存在多处 race：
 *   - 急按 START → START：第二次进来时 recorder 还在 getUserMedia await，
 *     `recorder` 还是 null，不会被"已经在录制"拦下；两个 stream 都拿到，
 *     第二个覆盖 recorder ref，第一个 stream 永远不 release（内存 + 摄像头
 *     灯泡 / tab 录制指示器都泄漏）。
 *   - START → CANCEL → STOP 顺序：CANCEL 时 stream 已 cleanup，STOP 还在
 *     等 stopResolver；onstop 永不触发，STOP promise 永远 hang。
 *   - SW 回收后重新 spin-up：原 stopResolver 引用丢，再 STOP 时已 cleanup
 *     过了，错误文案误导用户。
 *
 * 现在所有状态切换都过 transition() 强制 invariant，违反就显式 reject。
 */

import { canTransition, type State } from './stateMachine'

interface StartMsg { target: 'offscreen'; type: 'START'; streamId: string; tabId?: number }
interface StopMsg { target: 'offscreen'; type: 'STOP' }
interface CancelMsg { target: 'offscreen'; type: 'CANCEL' }
/** v0.4.4：SW spin-up 后查 offscreen 真实录屏状态（SW currentRecording 内存丢，offscreen 自带 keep-alive 仍在录）*/
interface QueryStateMsg { target: 'offscreen'; type: 'QUERY_STATE' }
type Msg = StartMsg | StopMsg | CancelMsg | QueryStateMsg

interface StopResult { ok: boolean; dataUrl?: string; bytes?: number; mime?: string; error?: string }

let state: State = 'idle'
let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let stream: MediaStream | null = null
let stopResolver: ((r: StopResult) => void) | null = null
/** v0.4.4：记录录屏元数据，QUERY_STATE 时回给 SW 恢复 currentRecording */
let recordingMeta: { tabId?: number; startedAt: number } | null = null
// 35s tripwire 句柄 —— 必须在 cleanup 清掉。不清的话：track-ended 自停（SW 端
// handleOffscreenAutoStopped 不关文档）后 35s 内重新开录会复用本文档，上一段的残留
// timer 到点见 state==='recording' 判真（分不清是哪段录屏）就强制 recorder.stop()
// 把新录屏掐死 —— 此刻 stopResolver===null，blob 在 onstop 里直接丢弃，整段静默丢失。
let tripwireTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 包装 canTransition：合法就提交 module-level state、返回 true；非法返回 false 不改 state。
 * 保留原签名（from 支持单值或数组）。
 */
function transition(from: State | State[], to: State): boolean {
  const candidates = Array.isArray(from) ? from : [from]
  if (!candidates.includes(state)) return false
  if (!canTransition(state, to)) return false
  state = to
  return true
}

chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
  // 严格校验消息来源（v0.4.4 复盘加固）：同扩展发的 sender.id 必须 === runtime.id。
  // 任何不匹配（含 undefined / 不同 ext id）直接拒，防恶意页面停别人的录屏。
  if (sender.id !== chrome.runtime.id) return false
  if (!msg || msg.target !== 'offscreen') return false

  if (msg.type === 'START') {
    // .catch 兜底：handleStart 内任何未捕获 throw 都必须有响应 —— 否则 SW 端
    // startTabRecording 的 await sendMessage 永久 pending，state 卡 starting、
    // stream 不释放（tab「正在被捕获」指示灯常亮），只能 CANCEL 救
    handleStart(msg.streamId, msg.tabId)
      .catch((e: unknown) => {
        cleanup('idle')
        return { ok: false, error: (e as Error)?.message || '录屏启动异常' }
      })
      .then(sendResponse)
    return true
  }
  if (msg.type === 'STOP') {
    handleStop()
      .catch((e: unknown) => ({ ok: false, error: (e as Error)?.message || '停止录屏异常' }))
      .then(sendResponse)
    return true
  }
  if (msg.type === 'CANCEL') {
    handleCancel()
    sendResponse({ ok: true })
    return false
  }
  if (msg.type === 'QUERY_STATE') {
    sendResponse({ state, meta: recordingMeta })
    return false
  }
  return false
})

async function handleStart(streamId: string, tabId?: number): Promise<{ ok: boolean; error?: string }> {
  if (!transition('idle', 'starting')) {
    return { ok: false, error: `当前状态 ${state}，无法开始新录制。请先停止再试` }
  }
  recordingMeta = { tabId, startedAt: Date.now() }

  // v0.5.0：getUserMedia 2-3s 期间 offscreen document 无 keep-alive（offscreen 不享受
  // SW 的 sendMessage reply pending 规则，chrome 130+ 可能在此期间回收 offscreen）。
  // 先 attach 空 MediaStream sink 撑住 offscreen（视频元素 attach 时 chrome 会视为活跃）
  const keepAlive = document.createElement('video')
  keepAlive.setAttribute('data-moo-sink', 'keepalive')
  keepAlive.muted = true
  keepAlive.playsInline = true
  document.body.appendChild(keepAlive)

  try {
    // tabCapture 拿到的 streamId 走这种"曾用名"路径取流；视频走 mandatory，audio 留给后续可选。
    // 必须显式给 min/max 分辨率：tabCapture 不指定时会默认 640x480，1920+ 的 tab 会被压成中间一小块、四周黑边。
    // Chrome 会在 min/max 之间按 tab 实际 viewport 采集，超过 max 才会缩放。
    stream = await (navigator.mediaDevices as { getUserMedia: (c: unknown) => Promise<MediaStream> }).getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
          minWidth: 1280,
          minHeight: 720,
          maxWidth: 3840,
          maxHeight: 2160,
          minFrameRate: 5,
          maxFrameRate: 30
        }
      }
    })
  } catch (e) {
    cleanup('idle')
    return { ok: false, error: '没拿到屏幕画面流：' + (e as Error).message + '（如果浏览器弹了选择窗口，需要点"分享"才能继续；streamId 也可能已过期 60s，请重新按 ⌥⇧R）' }
  }

  // starting 期间被 CANCEL：stream 已拿到，state 回到 idle，立即清。
  if (state !== 'starting') {
    cleanup('idle')
    return { ok: false, error: '录制在启动过程中被取消' }
  }

  chunks = []
  const mime = pickMime()
  try {
    // 比特率按 1080p ~30fps 经验值：3.5Mbps 视觉够清且 webm/vp9 压缩效率高，30 秒约 13MB。
    recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_500_000 })
      : new MediaRecorder(stream)
  } catch (e) {
    cleanup('idle')
    return { ok: false, error: '浏览器版本不支持录屏：' + (e as Error).message + '（需要 Chrome 109+）' }
  }

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }
  recorder.onstop = async () => {
    // onstop 同时可能由 STOP / CANCEL / track-ended 触发；只在 stopping 态下 resolve。
    const wasStopping = state === 'stopping'
    try {
      const blob = new Blob(chunks, { type: recorder?.mimeType || 'video/webm' })
      // v0.4.7：50MB hard cap —— 防 chrome IPC ~64MB 上限被 dataUrl 撑爆崩 offscreen。
      // v0.4.8：阈值降到 46MB —— base64 dataUrl 1.37× 膨胀，50MB blob ≈ 68MB dataUrl 仍超 IPC 64MB。
      // 46MB blob ≈ 63MB dataUrl 留点 safety。用户录长视频时 30s 限制是 content 端 timer，
      // inactive tab 节流可绕。这里是最后兜底。
      const MAX_VIDEO_BYTES = 46 * 1024 * 1024
      if (blob.size > MAX_VIDEO_BYTES) {
        if (wasStopping) stopResolver?.({
          ok: false,
          bytes: blob.size,
          mime: blob.type,
          error: `录像过大（${(blob.size / 1024 / 1024).toFixed(1)}MB > 50MB 上限），无法跨进程传给 SubmitDialog。建议缩短录屏时长或降低画质后重录`
        })
      } else {
        const dataUrl = blob.size > 0 ? await blobToDataUrl(blob) : ''
        if (wasStopping) {
          stopResolver?.({ ok: blob.size > 0, dataUrl, bytes: blob.size, mime: blob.type })
        }
      }
    } catch (err) {
      if (wasStopping) stopResolver?.({ ok: false, error: (err as Error).message })
    } finally {
      stopResolver = null
      cleanup('idle')
    }
  }

  // 用户从 chrome 自身的"停止共享"UI 停了 → onended → 自动停止
  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (state === 'recording') {
      // v0.7.9：过 transition() 强制 invariant — 非法迁移会被拦下并 log 而非静默错误
      if (!transition('recording', 'stopping')) {
        console.warn('[Moo offscreen] track-ended：recording → stopping 拒绝，state=', state)
        return
      }
      // 没人 await STOP；onstop 会直接 cleanup
      try { recorder?.stop() } catch { /* ignore */ }
      // 通知 background：本次录屏是被外部停止的（没人在 await STOP），SW 会把消息转发给
      // 原录屏 tab 的 content script，让 rec-bar 收回。
      // v0.7.9：删 50ms setTimeout retry 魔数 — SW 不可靠场景靠 storage flag + 对端 storage.onChanged
      // 监听兜底（record.ts installRecordingListeners 已加 listener）。三路保险：
      //   ① runtime.sendMessage（SW alive 时同步通道）
      //   ② chrome.alarms tripwire（35s，offscreen 端 setTimeout 也兜底）
      //   ③ storage.local.set → storage.onChanged 触发 SW 处理
      try {
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_AUTO_STOPPED' }).catch(() => {})
      } catch { /* ignore */ }
      try {
        chrome.storage.local.set({ mooOffscreenAutoStopped: { at: Date.now() } }).catch(() => {})
      } catch { /* ignore */ }
    }
  })

  // 渲染一个 video 元素持有 stream，保证 stream 不被回收（chrome 87+ 必要）
  attachStreamSink(stream)

  // getUserMedia 成功到这里之间被捕获 tab 关闭/track 结束 → stream inactive →
  // start() 抛 InvalidStateError。裸抛会让 START 永不响应（listener 虽有 .catch 兜底，
  // 这里就近 cleanup 语义更明确：释放 stream + 状态归 idle + 返回可读错误）
  try {
    recorder.start(1000)
  } catch (e) {
    cleanup('idle')
    return { ok: false, error: `录制器启动失败：${(e as Error)?.message || String(e)}` }
  }
  // v0.7.9：过 transition() — starting → recording 合法迁移
  if (!transition('starting', 'recording')) {
    console.warn('[Moo offscreen] handleStart 末尾 starting → recording 拒绝，state=', state)
    cleanup('idle')
    return { ok: false, error: '内部状态错误' }
  }

  // v0.4.8：独立 35s tripwire 兜底 content 端 30s timer（inactive tab 节流可绕导致录到 1-2 分钟）。
  // 35s 留 5s buffer 让 content 端正常 stop 先执行；如果还没停就强制 stop 防长录像爆 IPC。
  const TRIPWIRE_MS = 35_000
  tripwireTimer = setTimeout(() => {
    tripwireTimer = null
    if (state === 'recording') {
      console.log('[Moo offscreen] 35s tripwire fired — content 端 30s timer 可能被 inactive tab 节流，强制 stop')
      if (!transition('recording', 'stopping')) {
        console.warn('[Moo offscreen] tripwire transition 拒绝，state=', state)
        return
      }
      try { recorder?.stop() } catch { /* ignore */ }
      // v0.4.9：tripwire 必须通知 SW → broadcast → 所有 tab rec-bar 退（之前漏了，
      // inactive tab 用户回来看 rec-bar 还亮但已停录，再点 STOP 拿「没有正在进行的录制」错）
      try {
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_AUTO_STOPPED' }).catch(() => {})
      } catch { /* ignore */ }
      try {
        chrome.storage.local.set({ mooOffscreenAutoStopped: { at: Date.now() } }).catch(() => {})
      } catch { /* ignore */ }
    }
  }, TRIPWIRE_MS)

  return { ok: true }
}

function handleStop(): Promise<StopResult> {
  return new Promise((resolve) => {
    // starting 期间 STOP：还没真的 recording，且 starting 的 await 完成后会发现状态变了 → 自己 cleanup。
    // 这里 STOP 调用方需要立刻得到回应，不能 hang 等 starting 完成。
    if (state === 'starting') {
      // 标记 stopping，让 handleStart 看到 state !== 'starting' 后清场
      // v0.7.9：starting → stopping 合法迁移（见 stateMachine.ts ALLOWED 表）
      if (!transition('starting', 'stopping')) {
        resolve({ ok: false, error: `state machine 拒绝 ${state} → stopping` })
        return
      }
      resolve({ ok: false, error: '录制还在启动中就被停止，没拿到画面' })
      // cleanup 由 handleStart 的 if (state !== 'starting') 分支负责
      return
    }
    if (state !== 'recording' || !recorder) {
      resolve({ ok: false, error: '没有正在进行的录制（可能扩展刚被重新加载，状态丢了。请重新开始录制）' })
      return
    }
    if (recorder.state === 'inactive') {
      resolve({ ok: false, error: '录制器状态异常，强制结束。请重新开始录制' })
      cleanup('idle')
      return
    }
    // 把 resolver 挂上后 stop()，onstop 走 stopping 分支 resolve。
    stopResolver = resolve
    // v0.7.9：recording → stopping 合法迁移（前面 state !== 'recording' 已被守卫）
    if (!transition('recording', 'stopping')) {
      stopResolver = null
      resolve({ ok: false, error: `state machine 拒绝 ${state} → stopping` })
      return
    }
    try {
      recorder.stop()
    } catch (e) {
      resolve({ ok: false, error: (e as Error).message })
      stopResolver = null
      cleanup('idle')
    }
  })
}

function handleCancel() {
  // CANCEL 在任意态都能调；区分 starting / recording 处理。
  if (state === 'starting') {
    // 让 handleStart 的 if (state !== 'starting') 分支 cleanup
    // v0.7.9：starting → idle 合法迁移（CANCEL during starting）
    if (!transition('starting', 'idle')) {
      console.warn('[Moo offscreen] CANCEL during starting：迁移拒绝，state=', state)
    }
    return
  }
  if (state === 'recording' && recorder && recorder.state !== 'inactive') {
    // 走 stopping 让 onstop 进 cleanup，不 resolve（CANCEL 无 caller 等结果）
    // v0.7.9：recording → stopping 合法迁移
    if (!transition('recording', 'stopping')) {
      console.warn('[Moo offscreen] CANCEL during recording：迁移拒绝，state=', state)
      cleanup('idle')
      return
    }
    stopResolver = null
    try { recorder.stop() } catch {
      cleanup('idle')
    }
    return
  }
  // idle / stopping 态 CANCEL 是 no-op，但确保资源都释放
  cleanup('idle')
}

function cleanup(next: State) {
  // 清掉本段录屏的 tripwire —— 防文档复用时残留 timer 掐死下一段录屏（见声明处注释）
  if (tripwireTimer != null) {
    clearTimeout(tripwireTimer)
    tripwireTimer = null
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
  recorder = null
  chunks = []
  // v0.7.9：cleanup 是「资源释放收尾」语义，故意绕过 transition() invariant。
  // 任意态 → idle 在错误路径上必须能走通（即便 state 之前已被破坏），不能因 invariant
  // 拒绝就让 recorder/stream 永远不释放。这是唯一允许的 state 直写点。
  state = next
  if (next === 'idle') recordingMeta = null
  // 移除可能存在的 video sink
  document.querySelectorAll('video[data-moo-sink]').forEach((v) => v.remove())
}

function attachStreamSink(s: MediaStream) {
  const v = document.createElement('video')
  v.setAttribute('data-moo-sink', '1')
  v.srcObject = s
  v.muted = true
  v.style.display = 'none'
  v.play().catch(() => { /* ignore */ })
  document.body.appendChild(v)
}

function pickMime(): string {
  const opts = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  for (const m of opts) if (MediaRecorder.isTypeSupported(m)) return m
  return ''
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
