/**
 * v0.6.2 dogfood 后立：CWS 上架前的「替代自动更新」机制。
 *
 * 同事 zip 自装的扩展不会自动升级，每次 patch 都得手动重装。SW 每天一次 fetch Gitee
 * latest release API 比对版本，新版时写 storage flag → popup 弹 update-banner 引导。
 *
 * 上 CWS 后这个机制可以删（Chrome 自动接管）— PLAN_v1.0 决策 1。
 *
 * 不需要 GITEE_TOKEN：public repo 的 releases API 不要认证。
 */

export const VERSION_CHECK_FLAG_KEY = 'mooLatestVersionInfo'
export const VERSION_CHECK_ALARM = 'mooVersionCheck'

/**
 * v0.7.6：reload 前写「期望升到的版本」。SW onInstalled('update') 时对比当前
 * manifest.version → 匹配则证明升级真完成，写 UPGRADED_TOAST_FLAG 给 popup/工作台
 * 弹「✓ 已升级到 vX.Y.Z」toast。
 *
 * Why：v0.7.5 加 chrome.runtime.reload() 一键重载后，如果用户没真解压新版 zip
 * 就点 reload，扩展重启仍是旧版 — 用户没反馈难以发觉。这条链路给「真升完了」
 * 闭合反馈。
 */
export const UPGRADE_INTENT_KEY = 'mooUpgradeIntent'
export const UPGRADED_TOAST_KEY = 'mooUpgradedToast'

export interface UpgradeIntent {
  /** 用户点 reload 时期望升到的版本（来自 LatestVersionInfo.latest，不带 v 前缀）*/
  expected: string
  /** 写 intent 的时刻 — 太老（> 1h）当过期，防漏对比情况下 toast 永远不出 */
  at: number
}

export interface UpgradedToastInfo {
  /** 升级后的版本号 */
  version: string
  /** 升级完成时刻 */
  at: number
}

const GITEE_LATEST_URL = 'https://gitee.com/api/v5/repos/charsen/moo-chrome-dev-tool/releases/latest'

export interface LatestVersionInfo {
  /** 远端最新版本号，不带 v 前缀（如 "0.6.2"）*/
  latest: string
  /** 当前 manifest 版本号 */
  current: string
  /** Gitee release 页面 URL（让用户点跳转）*/
  url: string
  /** 检查时间戳 — 同事 dogfood 时如果 flag 太老（>7 天）就当不可信不弹 */
  checkedAt: number
}

/**
 * 比对版本号，true = remote 更新。仅支持 SemVer X.Y.Z 数字段（Moo 项目惯例）。
 * 任一段不是数字 → 返 false（不弹 banner 比误弹好）。
 */
export function isNewer(remote: string, current: string): boolean {
  const r = remote.replace(/^v/, '').split('.').map(Number)
  const c = current.replace(/^v/, '').split('.').map(Number)
  if (r.length !== 3 || c.length !== 3) return false
  if (r.some(n => !Number.isFinite(n)) || c.some(n => !Number.isFinite(n))) return false
  for (let i = 0; i < 3; i++) {
    const rn = r[i]!
    const cn = c[i]!
    if (rn > cn) return true
    if (rn < cn) return false
  }
  return false
}

/**
 * 拉 Gitee latest release。失败时返 null（网络 / API 限流 / 仓库私有都正常路径，
 * 不该让 SW 卡住或写错误 flag）。
 */
export async function fetchLatestVersion(): Promise<{ tag: string; url: string } | null> {
  try {
    const res = await fetch(GITEE_LATEST_URL, {
      credentials: 'omit',
      headers: { 'Accept': 'application/json' }
    })
    if (!res.ok) return null
    const body = await res.json() as { tag_name?: unknown; html_url?: unknown }
    const tag = typeof body.tag_name === 'string' ? body.tag_name : ''
    const url = typeof body.html_url === 'string' ? body.html_url : ''
    if (!tag) return null
    return { tag, url: url || 'https://gitee.com/charsen/moo-chrome-dev-tool/releases' }
  } catch {
    return null
  }
}

/**
 * v0.7.6：reload 前写 UPGRADE_INTENT_KEY 让 SW onInstalled('update') 能对比。
 * 调用方一般是 useVersionCheck.reloadExtension。
 */
export async function writeUpgradeIntent(expected: string): Promise<void> {
  try {
    const intent: UpgradeIntent = { expected, at: Date.now() }
    await chrome.storage.local.set({ [UPGRADE_INTENT_KEY]: intent })
  } catch { /* storage 写失败不挡 reload，最多没有 toast */ }
}

/**
 * v0.7.6：SW onInstalled('update') 调 — 拿当前 manifest.version 跟之前写的
 * expected 对比。匹配 → 升级真完成 → 写 toast flag + 清 update banner +
 * 清 intent。不匹配（或 intent 太老 > 1h）→ 不动 toast。
 */
export async function checkUpgradeFinished(): Promise<void> {
  try {
    const r = await chrome.storage.local.get(UPGRADE_INTENT_KEY)
    const intent = r[UPGRADE_INTENT_KEY] as UpgradeIntent | undefined
    if (!intent || !intent.expected || !intent.at) return
    // 24 小时窗口内有效 — 用户点 reload 后开会去了/忘解压超过几小时再装上是常见场景
    // （v0.7.6 初版 1h 太短，dogfood 慢响应高发，general-purpose 11 审改 24h）
    if (Date.now() - intent.at > 24 * 60 * 60_000) {
      await chrome.storage.local.remove(UPGRADE_INTENT_KEY)
      return
    }
    const current = chrome.runtime?.getManifest?.()?.version ?? ''
    if (current === intent.expected) {
      const toast: UpgradedToastInfo = { version: current, at: Date.now() }
      // 三个写操作一起：toast flag + 清 update banner + 清 intent
      await chrome.storage.local.set({ [UPGRADED_TOAST_KEY]: toast })
      await chrome.storage.local.remove([VERSION_CHECK_FLAG_KEY, UPGRADE_INTENT_KEY])
    }
    // 不匹配：intent 留着继续等下次 onInstalled（用户可能反复 reload 直到真升上去）
  } catch (e) {
    console.warn('[Moo] checkUpgradeFinished failed:', (e as Error).message)
  }
}

/**
 * SW 周期性调（由 alarms 触发）：拉 latest → 比对 → 写 / 清 flag。
 * popup / 工作台启动时读 flag 决定显示 update-banner。
 *
 * v0.7.5：inflight guard — 防 popup + 工作台 + SW alarm 三方同时跑造成
 * fetch 与 storage.set/remove 交叉 race（A 写 set，B 后回来 isNewer=false
 * 把 set 抹掉 → banner 闪一下消失）。重入合并到同一 promise。
 */
let inflightCheck: Promise<void> | null = null
export function runVersionCheck(): Promise<void> {
  if (inflightCheck) return inflightCheck
  inflightCheck = (async () => {
    try {
      const current = chrome.runtime?.getManifest?.()?.version ?? '0.0.0'
      const latest = await fetchLatestVersion()
      if (!latest) return
      if (isNewer(latest.tag, current)) {
        const info: LatestVersionInfo = {
          latest: latest.tag.replace(/^v/, ''),
          current,
          url: latest.url,
          checkedAt: Date.now()
        }
        await chrome.storage.local.set({ [VERSION_CHECK_FLAG_KEY]: info })
      } else {
        // 当前已是最新 → 清 flag（防老版本升上来 flag 残留）
        await chrome.storage.local.remove(VERSION_CHECK_FLAG_KEY)
      }
    } catch (e) {
      console.warn('[Moo] versionCheck failed:', (e as Error).message)
    } finally {
      inflightCheck = null
    }
  })()
  return inflightCheck
}
