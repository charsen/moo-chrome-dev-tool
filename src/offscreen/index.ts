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

interface StartMsg { target: 'offscreen'; type: 'START'; streamId: string }
interface StopMsg { target: 'offscreen'; type: 'STOP' }
interface CancelMsg { target: 'offscreen'; type: 'CANCEL' }
type Msg = StartMsg | StopMsg | CancelMsg

interface StopResult { ok: boolean; dataUrl?: string; bytes?: number; mime?: string; error?: string }

let state: State = 'idle'
let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let stream: MediaStream | null = null
let stopResolver: ((r: StopResult) => void) | null = null

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

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false

  if (msg.type === 'START') {
    handleStart(msg.streamId).then(sendResponse)
    return true
  }
  if (msg.type === 'STOP') {
    handleStop().then(sendResponse)
    return true
  }
  if (msg.type === 'CANCEL') {
    handleCancel()
    sendResponse({ ok: true })
    return false
  }
  return false
})

async function handleStart(streamId: string): Promise<{ ok: boolean; error?: string }> {
  if (!transition('idle', 'starting')) {
    return { ok: false, error: `当前状态 ${state}，无法开始新录制。请先停止再试` }
  }

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
      const dataUrl = blob.size > 0 ? await blobToDataUrl(blob) : ''
      if (wasStopping) {
        stopResolver?.({ ok: blob.size > 0, dataUrl, bytes: blob.size, mime: blob.type })
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
      state = 'stopping'  // 没人 await STOP；onstop 会直接 cleanup
      try { recorder?.stop() } catch { /* ignore */ }
      // 通知 background：本次录屏是被外部停止的（没人在 await STOP），
      // SW 会把消息转发给原录屏 tab 的 content script，让 rec-bar 收回。
      // catch 防 SW 暂时不可达（offscreen 文档外部 sendMessage 偶发失败）。
      try {
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_AUTO_STOPPED' }).catch(() => {})
      } catch { /* ignore */ }
    }
  })

  // 渲染一个 video 元素持有 stream，保证 stream 不被回收（chrome 87+ 必要）
  attachStreamSink(stream)

  recorder.start(1000)
  state = 'recording'
  return { ok: true }
}

function handleStop(): Promise<StopResult> {
  return new Promise((resolve) => {
    // starting 期间 STOP：还没真的 recording，且 starting 的 await 完成后会发现状态变了 → 自己 cleanup。
    // 这里 STOP 调用方需要立刻得到回应，不能 hang 等 starting 完成。
    if (state === 'starting') {
      // 标记 stopping，让 handleStart 看到 state !== 'starting' 后清场
      state = 'stopping'
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
    state = 'stopping'
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
    state = 'idle'
    return
  }
  if (state === 'recording' && recorder && recorder.state !== 'inactive') {
    // 走 stopping 让 onstop 进 cleanup，不 resolve（CANCEL 无 caller 等结果）
    state = 'stopping'
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
  if (stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
  recorder = null
  chunks = []
  state = next
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
