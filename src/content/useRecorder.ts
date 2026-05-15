import { ref } from 'vue'
import { MSG } from '@/types/messages'

/**
 * 屏幕录制 composable —— 走 chrome.tabCapture + offscreen document。
 *
 * 优点：
 * - HTTP + IP 页面也能录（不依赖 page secure context）
 * - 内容脚本只发消息，所有 MediaRecorder 在 offscreen 跑
 *
 * 限制：
 * - 只录当前标签页内容（不录其他窗口）
 * - 切到别的标签会暂停（chrome 限制）
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

  let timer: number | null = null

  async function start(): Promise<RecordingResult | null> {
    if (recording.value) return null
    error.value = ''

    const startRes = await chrome.runtime.sendMessage({
      type: MSG.RECORD_START,
      source: 'content'
    })
    if (!startRes?.ok) {
      error.value = startRes?.error || '启动录制失败'
      return null
    }

    return beginCountdown()
  }

  /**
   * background 已经通过 chrome.commands 起好录制后调用：跳过 RECORD_START，
   * 只接管本地计时 / 停止等待逻辑。返回 Promise 在 stop()/cancel() 时 resolve。
   */
  function startExternally(): Promise<RecordingResult | null> {
    if (recording.value) return Promise.resolve(null)
    error.value = ''
    return beginCountdown()
  }

  function beginCountdown(): Promise<RecordingResult | null> {
    recording.value = true
    elapsed.value = 0
    const startTime = Date.now()
    timer = window.setInterval(() => {
      elapsed.value = Math.floor((Date.now() - startTime) / 1000)
      if (elapsed.value >= maxSec) {
        void stop()
      }
    }, 250)

    return new Promise<RecordingResult | null>((resolve) => {
      pendingResolve = (r) => {
        cleanup()
        resolve(r)
      }
    })
  }

  let pendingResolve: ((r: RecordingResult | null) => void) | null = null

  async function stop() {
    if (!recording.value) return
    const finalElapsed = elapsed.value
    // sendMessage 异常（service worker 重启等）也必须 resolve，避免 start() 返回的 Promise 永远悬挂
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.RECORD_STOP, source: 'content' })
      if (res?.ok && res.dataUrl) {
        pendingResolve?.({
          dataUrl: res.dataUrl,
          bytes: res.bytes ?? 0,
          duration: finalElapsed,
          mime: res.mime ?? 'video/webm'
        })
      } else {
        error.value = res?.error || '停止失败 / 无内容'
        pendingResolve?.(null)
      }
    } catch (e) {
      error.value = (e as Error).message
      pendingResolve?.(null)
    } finally {
      pendingResolve = null
    }
  }

  async function cancel() {
    if (!recording.value) return
    try {
      await chrome.runtime.sendMessage({ type: MSG.RECORD_CANCEL, source: 'content' })
    } catch {
      // 即使取消消息发不出去，也要按取消语义 resolve null 并清状态
    }
    pendingResolve?.(null)
    pendingResolve = null
    cleanup()
  }

  function cleanup() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    recording.value = false
  }

  return { recording, elapsed, error, start, startExternally, stop, cancel, maxSec }
}

/**
 * 走 chrome.tabCapture，**任何页面都能录**，不需要 secure context。
 * 保留这两个工具函数兼容旧调用方。
 */
export function isMediaDevicesAvailable(): boolean {
  return true
}

export function unavailableReason(): string {
  return ''
}
