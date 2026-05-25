/**
 * v0.7.0 content_scripts 动态注册 — CWS 上架友好（manifest 不再静态 <all_urls> 全站注入）。
 *
 * 设计权衡：
 * - manifest 仍声明 content_scripts（vite/crxjs build 需要它当 entry，否则不打包），但
 *   matches 改成 placeholder URL（`https://moo.placeholder.example/*`，IANA 保留域永不命中）
 * - 真实注入靠 SW 调用 chrome.scripting.registerContentScripts，matches 取用户配置的
 *   projects[*].matchPatterns（经 toChromeMatchPatterns translator 过滤）
 * - JS 文件路径在 build 后含 hash（如 main-world.ts-DXIiV.js），SW 不 hardcode，
 *   用 chrome.runtime.getManifest() 从运行时 manifest 读真路径
 *
 * 触发时机：
 * - onInstalled / onStartup / SW spin-up IIFE：兜底全量重 sync
 * - storage.onChanged(mooConfig)：用户改 matchPatterns / kind / enabled → 200ms debounce 后 sync
 * - chrome.permissions.onAdded / onRemoved：用户授权 / 撤权 → sync（无权限的 origin chrome 自动拒）
 *
 * Plan 三审 5 风险点对应措施：
 * - translator 太严：reject 后在 console.warn 提示（v0.7.1 加 UI 提示）
 * - chrome.scripting quota：200ms debounce 防高频 register
 * - MAIN world chrome 111+：manifest minimum_chrome_version 同步提到 111
 * - 注入顺序：MAIN world + ISOLATED 都用 document_start，乱序无影响（v0.6.x 已是这个语义）
 * - onRemoved 不一定 fire：SW spin-up 兜底 sync 自愈
 */

import { loadConfig, onConfigChanged } from '@/storage/config'
import { hasHostPermission } from '@/utils/hostPermission'

const SCRIPT_ID_MAIN = 'moo-main-world'
const SCRIPT_ID_ISO = 'moo-content'

/**
 * 把用户输入的 Moo glob pattern 翻译成 chrome MV3 match pattern。
 *
 * Moo 自定义 glob（storage/config.ts urlMatches）：`*` 通配任意字符含 `/`。
 * Chrome MV3 match pattern：必须 `<scheme>://<host>/<path>`，本 translator 只接 http(s)。
 *
 * 严格策略（防止 chrome.scripting.registerContentScripts API 抛错 + CWS 评审更友好）：
 * - 只接 http/https（拒 file:// / ftp:// / chrome-extension://，普通业务调试用不到，
 *   接受了反而让 CWS 评审员问理由）
 * - 必须含 scheme + host + path（拒 `*` 单字符 / 无 scheme）
 * - 长度上限 256
 * - 去重
 * - 非法的静默 drop（caller 用 console.warn 提示）
 */
export function toChromeMatchPatterns(mooPatterns: string[]): { valid: string[]; dropped: string[] } {
  const valid: string[] = []
  const dropped: string[] = []
  const seen = new Set<string>()
  for (const raw of mooPatterns) {
    const p = (raw || '').trim()
    if (!p) continue
    if (p.length > 256) { dropped.push(p); continue }
    if (!/^https?:\/\/[^/]+\/.*$/.test(p)) {
      dropped.push(p)
      continue
    }
    if (seen.has(p)) continue
    seen.add(p)
    valid.push(p)
  }
  return { valid, dropped }
}

/**
 * 从 build 后的 manifest 读 content script JS 真路径（含 hash）。
 * 拿不到时返 null（caller 静默跳过 register）。
 */
function getBuiltScriptPaths(): { mainWorld: string[]; iso: string[] } | null {
  try {
    const manifest = chrome.runtime.getManifest() as {
      content_scripts?: Array<{ js?: string[]; world?: string }>
    }
    const scripts = manifest.content_scripts ?? []
    const mainWorld = scripts.find(s => s.world === 'MAIN')?.js ?? []
    const iso = scripts.find(s => !s.world || s.world === 'ISOLATED')?.js ?? []
    if (mainWorld.length === 0 || iso.length === 0) return null
    return { mainWorld, iso }
  } catch {
    return null
  }
}

/**
 * 从用户配置抽出所有启用项目的 matchPatterns，翻译 + 去重 + register / update / unregister
 * 现有动态 content scripts。
 *
 * 调用幂等：多次调返同样的最终状态。
 */
export async function syncContentScripts(): Promise<void> {
  try {
    const paths = getBuiltScriptPaths()
    if (!paths) {
      console.warn('[Moo] syncContentScripts: manifest content_scripts JS 路径解析失败，跳过')
      return
    }

    // v0.7.3 P1：host_permission 未授权时 chrome.scripting.registerContentScripts
    // silent 拒注入（API 不抛错），导致 popup 误显「已启用」但悬浮球不出来。
    // 早返 + unregister 已注册的（保持「无权限 = 无 active register」状态一致），
    // 跟 retryQueue:274 / handlers/zentao.ts 同款防御。
    // 用户后续授权 → permissions.onAdded → syncContentScripts 再走完整路径。
    if (!await hasHostPermission()) {
      const existing = await chrome.scripting.getRegisteredContentScripts({
        ids: [SCRIPT_ID_MAIN, SCRIPT_ID_ISO]
      }).catch(() => [])
      if (existing.length > 0) {
        await chrome.scripting.unregisterContentScripts({
          ids: existing.map(s => s.id)
        }).catch(() => { /* race 时已不存在 OK */ })
      }
      return
    }

    const config = await loadConfig()
    // P0-1 mv3-pro 四审：尊重 globalEnabled — popup footer 全局开关关闭后悬浮球应消失
    // matchProjects() 内已有同款判断，dynamic register 也得跟（之前 v0.6.x 静态 <all_urls>
    // 下 content script 仍注入但 ContentApp 内部读 globalEnabled 决定是否挂悬浮球，dynamic
    // 化后必须在 register 阶段提前拦）
    const rawPatterns = config.globalEnabled
      ? config.projects.filter(p => p.enabled).flatMap(p => p.matchPatterns ?? [])
      : []
    const { valid: matches, dropped } = toChromeMatchPatterns(rawPatterns)
    if (dropped.length > 0) {
      console.warn(`[Moo] syncContentScripts: ${dropped.length} 个 matchPattern 被 translator 拒（必须 scheme://host/path 形态）:`, dropped)
      // P0-3：写 storage flag 让 popup banner 引导用户去 Environment 修
      // （v0.6.x → v0.7.0 升级时老 patterns 如 '*' / 'example.com/*' 会全部 drop）
      void chrome.storage.local.set({ mooDroppedMatchPatterns: { count: dropped.length, samples: dropped.slice(0, 3), at: Date.now() } }).catch(() => {})
    } else {
      // 没 drop → 清 flag（用户改完 pattern 后 banner 该自动消失）
      void chrome.storage.local.remove('mooDroppedMatchPatterns').catch(() => {})
    }

    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [SCRIPT_ID_MAIN, SCRIPT_ID_ISO]
    }).catch(() => [])

    // 无合法 pattern → 卸下现有
    if (matches.length === 0) {
      if (existing.length > 0) {
        await chrome.scripting.unregisterContentScripts({
          ids: existing.map(s => s.id)
        }).catch(() => { /* 别处已 unregister 也 OK */ })
      }
      return
    }

    const newScripts = [
      {
        id: SCRIPT_ID_MAIN,
        matches,
        js: paths.mainWorld,
        runAt: 'document_start' as const,
        world: 'MAIN' as const
      },
      {
        id: SCRIPT_ID_ISO,
        matches,
        js: paths.iso,
        runAt: 'document_start' as const
        // world: 'ISOLATED' 是默认
      }
    ]

    // P0-2 mv3-pro 四审：existing 可能只含 2 id 中的 1 个（onRemoved 撤掉一半 race），
    // 走 update 整批会撞「id 不存在」chrome 拒。改幂等：先 unregister 现有 + register 新的。
    if (existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({
        ids: existing.map(s => s.id)
      }).catch(() => { /* race 时已不存在也 OK */ })
    }
    // v0.7.3 mv3-pro 7 审 P1：register 抛错时用户会落到「俩都没注册」裸奔态（pattern
    // 边界 / quota / API 内部 race 都可能）。下次 SW spin-up 自愈（index.ts:158 兜底），
    // 但缩短裸奔窗口仍值得 —— retry 一次。两次都失败再 log + 等 spin-up 兜底。
    try {
      await chrome.scripting.registerContentScripts(newScripts)
    } catch (firstErr) {
      console.warn('[Moo] syncContentScripts register first attempt failed:', (firstErr as Error).message, '— retry once')
      try {
        await chrome.scripting.registerContentScripts(newScripts)
      } catch (retryErr) {
        console.warn('[Moo] syncContentScripts register retry failed:', (retryErr as Error).message, '— 等 SW spin-up 兜底')
      }
    }
  } catch (e) {
    // chrome.scripting API 在 SW 早期 spin-up 阶段可能抛 / 权限边界 / 用户改 manifest race
    console.warn('[Moo] syncContentScripts 失败:', (e as Error).message)
  }
}

let syncDebounceTimer: ReturnType<typeof setTimeout> | undefined

/**
 * SW 启动一次性调：注册 config 变化 / 权限变化 listener 自动重 sync。
 * onInstalled / onStartup / spin-up IIFE 各自单独调 syncContentScripts() 兜底首跑。
 */
export function installDynamicScriptsListeners(): void {
  // config 改 → 200ms debounce（用户在 Environment textarea 键入 matchPatterns 高频触发）
  onConfigChanged(() => {
    clearTimeout(syncDebounceTimer)
    syncDebounceTimer = setTimeout(() => void syncContentScripts(), 200)
  })
  // 用户给权限 / 撤权 → 立即 sync（无权限的 origin chrome 会自动拒，无需 caller check）
  chrome.permissions?.onAdded?.addListener?.(() => void syncContentScripts())
  chrome.permissions?.onRemoved?.addListener?.(() => void syncContentScripts())
}
