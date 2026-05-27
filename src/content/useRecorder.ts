import { ref } from 'vue'
import { MSG } from '@/types/messages'
import { safeSendMessage } from '@/utils/messaging'

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

  // v0.7.9 注释明示：timer 是 composable 内闭包变量，但 useRecorder 在 content world 只被 ContentApp
  // 调一次（module 单例语义）。stop() / cancel() / externallyStopped() 都走 cleanup() 清 timer，
  // window 卸载即整体 GC。故意不挂 onBeforeUnmount（content world 没明确 unmount hook，且 watcher
  // 上层 ContentApp 已能保证终止路径）。
  let timer: number | null = null

  async function start(): Promise<RecordingResult | null> {
    if (recording.value) return null
    error.value = ''

    let startRes: { ok?: boolean; error?: string } | undefined
    try {
      startRes = await safeSendMessage<{ ok?: boolean; error?: string }>({
        type: MSG.RECORD_START,
        source: 'content'
      })
    } catch (e) {
      error.value = (e as Error).message
      return null
    }
    if (!startRes?.ok) {
      error.value = startRes?.error || '启动录制失败'
      return null
    }

    return beginCountdown()
  }

  /**
   * background 已经通过 chrome.commands 起好录制后调用：跳过 RECORD_START，
   * 只接管本地计时 / 停止等待逻辑。返回 Promise 在 stop()/cancel() 时 resolve。
   *
   * @param startedAtMs 可选：背后真实开始时刻（Date.now() ms 形式）。content
   *   script 因同 tab navigation 重挂时，用 background 那一刻记录的 startedAt
   *   恢复 elapsed 计时——否则 rec-bar 会从 00:00 重算，跟真实已录时长不符。
   */
  function startExternally(startedAtMs?: number): Promise<RecordingResult | null> {
    if (recording.value) return Promise.resolve(null)
    error.value = ''
    return beginCountdown(startedAtMs)
  }

  function beginCountdown(startedAtMs?: number): Promise<RecordingResult | null> {
    recording.value = true
    const startTime = startedAtMs ?? Date.now()
    elapsed.value = Math.max(0, Math.floor((Date.now() - startTime) / 1000))
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

  /** 录屏被外部（Chrome"停止共享"条 / SW broadcast）强制停止：清状态，
   *  pendingResolve 解析为 null（表示没视频可附），不发 RECORD_STOP（offscreen 已自停）。 */
  function externallyStopped() {
    if (!recording.value) return
    error.value = '录屏被浏览器停止'
    pendingResolve?.(null)
    pendingResolve = null
    cleanup()
  }

  let pendingResolve: ((r: RecordingResult | null) => void) | null = null

  async function stop() {
    if (!recording.value) return
    const finalElapsed = elapsed.value
    // sendMessage 异常（service worker 重启等）也必须 resolve，避免 start() 返回的 Promise 永远悬挂
    try {
      const res = await safeSendMessage<{ ok?: boolean; dataUrl?: string; bytes?: number; mime?: string; error?: string }>({ type: MSG.RECORD_STOP, source: 'content' })
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
    // CANCEL 发不出去就算了：按取消语义 resolve null 并清状态即可
    await safeSendMessage({ type: MSG.RECORD_CANCEL, source: 'content' }, { fallback: undefined })
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

  return { recording, elapsed, error, start, startExternally, externallyStopped, stop, cancel, maxSec }
}

