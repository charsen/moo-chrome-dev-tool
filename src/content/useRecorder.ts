import { ref } from 'vue'

/**
 * 屏幕录制 composable。
 *
 * 通过 navigator.mediaDevices.getDisplayMedia 录浏览器标签页（用户在弹窗选目标）。
 * 输出 video/webm dataURL，方便随 todo 上报。
 *
 * 注意：
 * - 录制必须由用户手势直接触发（按钮点击）；
 * - 默认最长 30 秒自动停止；大于这个会让 base64 体积太大；
 * - 720p / 15fps / VP9 800kbps，10 秒约 1MB，可调。
 */

const MAX_SECONDS = 30

export interface RecordingResult {
  dataUrl: string
  bytes: number
  duration: number
  mime: string
}

export function useRecorder(opts: { maxSeconds?: number } = {}) {
  const recording = ref(false)
  const elapsed = ref(0)
  const error = ref<string>('')

  const maxSec = opts.maxSeconds ?? MAX_SECONDS

  let mediaRecorder: MediaRecorder | null = null
  let chunks: Blob[] = []
  let stream: MediaStream | null = null
  let timer: number | null = null
  let resolver: ((r: RecordingResult | null) => void) | null = null

  function pickMime(): string {
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ]
    for (const m of candidates) {
      if (MediaRecorder.isTypeSupported(m)) return m
    }
    return ''
  }

  async function start(): Promise<RecordingResult | null> {
    if (recording.value) return null
    error.value = ''
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 } as MediaTrackConstraints,
        audio: false
      })
    } catch (e) {
      error.value = (e as Error).message || '用户取消或无权访问'
      return null
    }

    chunks = []
    const mime = pickMime()
    try {
      mediaRecorder = mime
        ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 800_000 })
        : new MediaRecorder(stream)
    } catch (e) {
      error.value = '不支持的视频格式：' + (e as Error).message
      stream.getTracks().forEach((t) => t.stop())
      stream = null
      return null
    }

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    mediaRecorder.onstop = async () => {
      const finalElapsed = elapsed.value
      const blob = new Blob(chunks, { type: mediaRecorder?.mimeType || 'video/webm' })
      cleanup()
      if (blob.size === 0) {
        resolver?.(null)
        resolver = null
        return
      }
      const dataUrl = await blobToDataUrl(blob)
      resolver?.({
        dataUrl,
        bytes: blob.size,
        duration: finalElapsed,
        mime: blob.type
      })
      resolver = null
    }

    // 用户从浏览器原生共享 UI 点了停止
    stream.getVideoTracks()[0].onended = () => stop()

    recording.value = true
    elapsed.value = 0
    const startTime = Date.now()
    timer = window.setInterval(() => {
      elapsed.value = Math.floor((Date.now() - startTime) / 1000)
      if (elapsed.value >= maxSec) stop()
    }, 250)

    mediaRecorder.start(1000)

    return new Promise<RecordingResult | null>((res) => {
      resolver = res
    })
  }

  function stop() {
    if (!recording.value || !mediaRecorder) return
    if (mediaRecorder.state !== 'inactive') mediaRecorder.stop()
  }

  function cancel() {
    if (!recording.value) return
    resolver?.(null)
    resolver = null
    cleanup()
  }

  function cleanup() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop())
      stream = null
    }
    mediaRecorder = null
    recording.value = false
  }

  return { recording, elapsed, error, start, stop, cancel, maxSec }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
