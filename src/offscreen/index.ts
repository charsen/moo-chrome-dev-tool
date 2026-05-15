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
 */

interface StartMsg {
  target: 'offscreen'
  type: 'START'
  streamId: string
}
interface StopMsg { target: 'offscreen'; type: 'STOP' }
interface CancelMsg { target: 'offscreen'; type: 'CANCEL' }
type Msg = StartMsg | StopMsg | CancelMsg

let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let stream: MediaStream | null = null
let stopResolver: ((r: any) => void) | null = null

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
  if (recorder) return { ok: false, error: '已在录制中' }
  try {
    // tabCapture 拿到的 streamId 走这种"曾用名"路径取流；视频走 mandatory，audio 留给后续可选
    stream = await (navigator.mediaDevices as any).getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      }
    })
  } catch (e) {
    return { ok: false, error: '获取流失败：' + (e as Error).message }
  }

  chunks = []
  const mime = pickMime()
  try {
    recorder = mime
      ? new MediaRecorder(stream!, { mimeType: mime, videoBitsPerSecond: 1_200_000 })
      : new MediaRecorder(stream!)
  } catch (e) {
    cleanup()
    return { ok: false, error: '创建 MediaRecorder 失败：' + (e as Error).message }
  }

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }
  recorder.onstop = async () => {
    try {
      const blob = new Blob(chunks, { type: recorder?.mimeType || 'video/webm' })
      const dataUrl = blob.size > 0 ? await blobToDataUrl(blob) : ''
      stopResolver?.({ ok: blob.size > 0, dataUrl, bytes: blob.size, mime: blob.type })
    } catch (err) {
      stopResolver?.({ ok: false, error: (err as Error).message })
    } finally {
      stopResolver = null
      cleanup()
    }
  }

  // 用户从 chrome 自身的"停止共享"UI 停了 → onended → 自动停止
  stream!.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  })

  // 渲染一个 video 元素持有 stream，保证 stream 不被回收（chrome 87+ 必要）
  attachStreamSink(stream!)

  recorder.start(1000)
  return { ok: true }
}

function handleStop(): Promise<{ ok: boolean; dataUrl?: string; bytes?: number; mime?: string; error?: string }> {
  return new Promise((resolve) => {
    if (!recorder) {
      resolve({ ok: false, error: '当前未在录制' })
      return
    }
    stopResolver = resolve
    if (recorder.state !== 'inactive') {
      try { recorder.stop() } catch (e) {
        resolve({ ok: false, error: (e as Error).message })
        stopResolver = null
        cleanup()
      }
    } else {
      // 状态异常，强制结束
      resolve({ ok: false, error: 'recorder inactive' })
      stopResolver = null
      cleanup()
    }
  })
}

function handleCancel() {
  if (recorder && recorder.state !== 'inactive') {
    try { recorder.stop() } catch { /* ignore */ }
  }
  stopResolver = null
  cleanup()
}

function cleanup() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
  recorder = null
  chunks = []
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
