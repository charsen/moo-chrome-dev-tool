import { onBeforeUnmount, ref } from 'vue'
import { runVersionCheck, writeUpgradeIntent } from '@/utils/versionCheck'
import { MSG } from '@/types/messages'

/**
 * v0.7.5：popup + 工作台版本检查 UX 共用 composable。
 *
 * 抽出来前两处各 30 行同构（min-600ms spinner / 2.5s 「已是最新」timer / reload
 * 录屏防丢 / cleanup），now ~5 行调用。
 *
 * 调用方各自管 updateInfo（popup 走 Promise.all 并行 IO 性能优化不抽；工作台
 * 单独 loadUpdateFlag 简洁）。
 *
 * v0.8.1 hotfix：接收 runVersionCheck 真三态（newer/latest/fail），不再用
 * `!hasUpdate()` 判定「已是最新」 — 旧逻辑在 Gitee API 限流 / 网络错时把 fail
 * 当 latest 谎报，用户没法 detect 真新版（dogfood v0.8.0 发布后立刻撞）。新增
 * `checkFailed` ref 让 UI 显示「检查失败，稍后重试」+ 手动 fallback 链接。
 */
export interface UseVersionCheckOptions {
  /** v0.8.1 起仅供未来使用 — latest/fail 由 runVersionCheck 真返值决定，不再依赖此 getter */
  hasUpdate: () => boolean
  /** v0.7.6：调用方提供「期望升到的版本号」让 SW onInstalled 能对比验证升级真完
   *  成（用户没真解压 zip 时不会弹「已升级」toast）。一般 = updateInfo.latest。 */
  expectedVersion?: () => string | null
}

export function useVersionCheck(opts: UseVersionCheckOptions) {
  const checking = ref(false)
  const lastChecked = ref('')
  const checkJustDone = ref(false)
  // v0.8.1 hotfix：fetch fail（API 限流 / 网络错 / SemVer parse 失败）单独显示
  const checkFailed = ref(false)
  let doneTimer: number | undefined

  async function runCheck() {
    if (checking.value) return
    checking.value = true
    checkJustDone.value = false
    checkFailed.value = false
    if (doneTimer) { clearTimeout(doneTimer); doneTimer = undefined }
    const start = Date.now()
    try {
      const result = await runVersionCheck()
      // 最小 600ms spinner（fetch Gitee API < 500ms 一闪而过用户看不见）
      const elapsed = Date.now() - start
      if (elapsed < 600) await new Promise(r => setTimeout(r, 600 - elapsed))
      const now = new Date()
      lastChecked.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      // v0.8.1：按 runVersionCheck 真返值决定 UI — 不再用 `!hasUpdate()` 谎报
      if (result === 'latest') {
        checkJustDone.value = true
        doneTimer = window.setTimeout(() => {
          checkJustDone.value = false
          doneTimer = undefined
        }, 2500)
      } else if (result === 'fail') {
        checkFailed.value = true
        // fail 显示 4s（比 latest 2.5s 久）— 给用户时间看 fallback 链接 + 复制 URL
        doneTimer = window.setTimeout(() => {
          checkFailed.value = false
          doneTimer = undefined
        }, 4000)
      }
      // 'newer' → storage.onChanged 触发 banner 抢戏，chip 不抢
    } finally {
      checking.value = false
    }
  }

  // chrome.runtime.reload() 等价 chrome://extensions ↻（重读 manifest + dist）。
  // P0 防丢：录屏中 reload 会让 offscreen MediaRecorder 销毁 + chunks 全丢，
  // 先查 SW 录屏状态，正在录就 confirm。SW 不可达 fallback 直接 reload。
  async function reloadExtension() {
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.QUERY_RECORDING_STATE }) as
        | { recording?: boolean } | undefined
      if (res?.recording) {
        if (!confirm('Moo 正在录屏 — 重新加载会让已录内容丢失。继续吗？')) return
      }
    } catch { /* SW 不可达，直接 reload */ }
    // v0.7.6：reload 前写 UPGRADE_INTENT，让 SW onInstalled 对比验证升级真完成
    const expected = opts.expectedVersion?.()
    if (expected) await writeUpgradeIntent(expected)
    chrome.runtime.reload()
  }

  onBeforeUnmount(() => {
    if (doneTimer) { clearTimeout(doneTimer); doneTimer = undefined }
  })

  return { checking, lastChecked, checkJustDone, checkFailed, runCheck, reloadExtension }
}
