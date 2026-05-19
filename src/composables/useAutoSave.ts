import { onBeforeUnmount, ref } from 'vue'

/**
 * 自动保存编排：debounce + saveState 状态机 + onSaveError 回调。
 *
 * 不锁定数据形态——调用方自己 watch source 后调 scheduleSave；本 composable
 * 只管「防抖 + 怎么落盘 + 状态指示」。Environment 用 draft 中间层 +
 * scheduleSave；Settings 直接 v-model + scheduleSave，复用同一套状态机。
 *
 * 状态机：
 *   idle → scheduleSave → saving → saved (1.5s) → idle
 *                                ↘ error → idle（待 retry()）
 *
 * inflight 计数：防止「保存中又一次 schedule」导致 UI 在 saving↔saved 之间闪。
 * 只在 inflight === 0 时切到 saved。
 */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface UseAutoSaveOptions {
  /** 落盘函数；抛错会进 error 状态 */
  save: () => Promise<void>
  /** 防抖毫秒数。0 表示立即保存（不防抖） */
  debounceMs?: number
  /** 错误回调（用于显示 toast 等）。不传则只切 saveState='error' */
  onError?: (err: Error) => void
  /** "saved" 视觉态持续时间，过后自动回 idle */
  savedDisplayMs?: number
}

export interface UseAutoSaveReturn {
  saveState: ReturnType<typeof ref<SaveState>>
  /** 触发一次防抖保存；在防抖窗口期内多次调用合并成一次 */
  scheduleSave: () => void
  /** 立即保存（跳过防抖）。retry 失败时用 */
  flush: () => Promise<void>
}

export function useAutoSave(opts: UseAutoSaveOptions): UseAutoSaveReturn {
  const debounceMs = opts.debounceMs ?? 800
  const savedDisplayMs = opts.savedDisplayMs ?? 1500
  const saveState = ref<SaveState>('idle')

  let debounceTimer: number | undefined
  let savedHideTimer: number | undefined
  let inflight = 0

  async function doSave() {
    debounceTimer = undefined
    inflight++
    saveState.value = 'saving'
    try {
      await opts.save()
      inflight--
      // 仅在没有后续保存在路上时才切到 saved，避免 saving↔saved 来回闪
      if (inflight === 0 && !debounceTimer) {
        saveState.value = 'saved'
        if (savedHideTimer) clearTimeout(savedHideTimer)
        savedHideTimer = window.setTimeout(() => {
          if (saveState.value === 'saved') saveState.value = 'idle'
        }, savedDisplayMs)
      }
    } catch (e) {
      inflight--
      saveState.value = 'error'
      opts.onError?.(e as Error)
    }
  }

  function scheduleSave() {
    if (debounceMs === 0) {
      void doSave()
      return
    }
    // 进入 saving 视觉态，让用户立刻看到「在保存」的反馈（即便实际 fetch 还在防抖里）
    saveState.value = 'saving'
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(doSave, debounceMs)
  }

  async function flush(): Promise<void> {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = undefined
    }
    await doSave()
  }

  // 切 tab 时清掉所有 pending timer：否则切走后 doSave 还会执行写陈旧 source，
  // savedHideTimer 同样要清，避免 setState 到已销毁的 ref
  onBeforeUnmount(() => {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = undefined }
    if (savedHideTimer) { clearTimeout(savedHideTimer); savedHideTimer = undefined }
  })

  return { saveState, scheduleSave, flush }
}
