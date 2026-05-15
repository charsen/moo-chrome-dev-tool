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

    recording.value = true
    elapsed.value = 0
    const startTime = Date.now()
    timer = window.setInterval(() => {
      elapsed.value = Math.floor((Date.now() - startTime) / 1000)
      if (elapsed.value >= maxSec) {
        // 自动停止
        void stop()
      }
    }, 250)

    return new Promise<RecordingResult | null>((resolve) => {
      // 把 resolve 挂到 stop 上：stop() 会主动调用
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
    pendingResolve = null
  }

  async function cancel() {
    if (!recording.value) return
    await chrome.runtime.sendMessage({ type: MSG.RECORD_CANCEL, source: 'content' })
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

  return { recording, elapsed, error, start, stop, cancel, maxSec }
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
