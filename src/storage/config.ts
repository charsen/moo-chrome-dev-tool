import type { BugServer, MooConfig, Project } from '@/types/config'
import { normalizeProject, DEFAULT_REDACT } from '@/types/config'

const CONFIG_KEY = 'mooConfig'

const DEFAULT_CONFIG: MooConfig = {
  projects: [],
  globalEnabled: true
}

function normalizeConfig(raw: Partial<MooConfig> | undefined | null): MooConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG }
  return {
    // 逐个 project normalize：兜底老 storage 里缺 capture/redact 等字段的项目，
    // 避免下游访问 active.capture.requestBufferSize 时 throw
    projects: Array.isArray(raw.projects) ? raw.projects.map(normalizeProject) : [],
    globalEnabled: typeof raw.globalEnabled === 'boolean' ? raw.globalEnabled : true
  }
}

/**
 * 迁移：旧版 payloadTemplate 没有 video 占位符，自动追加。
 * 只处理形如 `"screenshot": "{{image}}",`（即默认模板派生、带 trailing 逗号）的 server；
 * 用户完全自定义的模板（已含 {{video}}、或不含 {{image}}、或 image 行无 trailing 逗号）一律不动，
 * 避免破坏其 JSON 结构。
 */
function migrateServerTemplate(tpl: string): string {
  if (typeof tpl !== 'string' || tpl === '') return tpl
  if (tpl.includes('{{video}}')) return tpl
  const m = tpl.match(/([ \t]*)"screenshot"\s*:\s*"\{\{image\}\}"\s*,/)
  if (!m) return tpl
  const lead = m[1] ?? '  '
  const insertion = [
    `${lead}"screenshot": "{{image}}",`,
    `${lead}"video": "{{video}}",`,
    `${lead}"video_duration": {{videoDuration}},`,
    `${lead}"video_bytes": {{videoBytes}},`
  ].join('\n')
  return tpl.replace(m[0], insertion)
}

/** v0.4.7：检测「自定义模板但缺 video 占位」的 server —— migrate 不动它（保留用户结构），
 *  但 console.warn 让 dev 知道：用户提交时 video 字段不会被填，录屏发不到后端。
 *  v0.4.8：加 seenOnce 防 SW 每次 spin-up 重 warn 同条（noise reduction） */
function detectCustomTemplateMissingVideo(s: BugServer): boolean {
  if (typeof s.payloadTemplate !== 'string' || !s.payloadTemplate) return false
  if (s.payloadTemplate.includes('{{video}}')) return false
  // 匹配「默认派生模板」结构，匹配上的会被 migrateServerTemplate 自动补 — 不算自定义
  return !/([ \t]*)"screenshot"\s*:\s*"\{\{image\}\}"\s*,/.test(s.payloadTemplate)
}
const warnedMissingVideo = new Set<string>()

/** v0.4.9：v0.4.8 加宽 DEFAULT_REDACT.headerKeys/bodyKeys 后，老用户 storage 里的 redact
 *  原样保留（v0.1.x 老默认 ['authorization','cookie','x-auth-token']/['password','token']），
 *  新加的 7 个 OAuth/API 常见敏感字段对老用户零作用。
 *  方案：检测 redact.bodyKeys/headerKeys 是 v0.1.x 老默认 superset 时合并新 DEFAULT 进去
 *  （只补不删 — 不动用户自定义过的 keys） */
const V01_HEADER_DEFAULTS = ['authorization', 'cookie', 'x-auth-token']
const V01_BODY_DEFAULTS = ['password', 'token']
function isV01DefaultSubset(arr: string[], v01Defaults: string[]): boolean {
  if (arr.length === 0) return true
  if (arr.length > v01Defaults.length) return false
  const lc = new Set(arr.map(s => s.toLowerCase()))
  return v01Defaults.every(d => lc.has(d))
}
function mergeRedactDefaults(p: Project): { project: Project; changed: boolean } {
  const r = p.redact
  if (!r) return { project: p, changed: false }
  let bodyKeysChanged = false
  let headerKeysChanged = false
  let newBodyKeys = r.bodyKeys
  let newHeaderKeys = r.headerKeys
  // 老用户 bodyKeys 只含 v0.1 默认 → 合并新 DEFAULT
  if (isV01DefaultSubset(r.bodyKeys, V01_BODY_DEFAULTS)) {
    const merged = new Set([...r.bodyKeys.map(s => s.toLowerCase()), ...DEFAULT_REDACT.bodyKeys])
    if (merged.size > r.bodyKeys.length) {
      newBodyKeys = [...merged]
      bodyKeysChanged = true
    }
  }
  if (isV01DefaultSubset(r.headerKeys, V01_HEADER_DEFAULTS)) {
    const merged = new Set([...r.headerKeys.map(s => s.toLowerCase()), ...DEFAULT_REDACT.headerKeys])
    if (merged.size > r.headerKeys.length) {
      newHeaderKeys = [...merged]
      headerKeysChanged = true
    }
  }
  if (!bodyKeysChanged && !headerKeysChanged) return { project: p, changed: false }
  return {
    project: { ...p, redact: { ...r, bodyKeys: newBodyKeys, headerKeys: newHeaderKeys } },
    changed: true
  }
}

function applyMigrations(cfg: MooConfig): { config: MooConfig; changed: boolean } {
  let changed = false
  const projects = cfg.projects.map((p) => {
    let cur = p
    // v0.4.9 migration：老用户 redact defaults 合并
    const redactResult = mergeRedactDefaults(cur)
    if (redactResult.changed) {
      cur = redactResult.project
      changed = true
    }
    if (!Array.isArray(cur.servers) || cur.servers.length === 0) return cur
    const servers: BugServer[] = cur.servers.map((s) => {
      // v0.4.8：每个 server 只 warn 一次（SW spin-up 多次时不重复刷）
      if (detectCustomTemplateMissingVideo(s) && !warnedMissingVideo.has(s.id)) {
        warnedMissingVideo.add(s.id)
        console.warn(`[Moo:config] project "${cur.name}" server "${s.name}" 用了自定义 payloadTemplate 但缺 {{video}} 占位 — 录屏字段不会发到后端。请手动在模板里加 video / videoDuration / videoBytes 占位符（参考 DEFAULT_PAYLOAD_TEMPLATE）`)
      }
      const tpl2 = migrateServerTemplate(s.payloadTemplate)
      if (tpl2 !== s.payloadTemplate) {
        changed = true
        return { ...s, payloadTemplate: tpl2 }
      }
      return s
    })
    return servers !== cur.servers || redactResult.changed ? { ...cur, servers } : cur
  })
  return { config: changed ? { ...cfg, projects } : cfg, changed }
}

export async function loadConfig(): Promise<MooConfig> {
  const result = await chrome.storage.local.get(CONFIG_KEY)
  const cfg = normalizeConfig(result[CONFIG_KEY] as Partial<MooConfig> | undefined)
  const { config, changed } = applyMigrations(cfg)
  if (changed) {
    if (import.meta.env.DEV) console.log('[Moo:config] migrated payloadTemplate(s) to include video fields')
    // v0.7.3 P2：migration 落盘 fire-and-forget 失败会 silent → 每次 loadConfig 重做
    // migration（noise 但非 data loss）。至少 warn 让 DevTools 能看到
    void saveConfig(config).catch(e =>
      console.warn('[Moo:config] applyMigrations 落盘失败，下次 loadConfig 会重做 migration:', (e as Error).message)
    )
  }
  // 不要在生产打整份 config —— project.token / endpoint 是敏感信息，
  // 用户开 DevTools 或截图分享 console 会泄露。
  if (import.meta.env.DEV) console.log('[Moo:config] loaded', config, 'rawKey:', result[CONFIG_KEY])
  return config
}

/** v0.7.6：quota 超时 popup banner 引导清理用的 flag。general-purpose 11 审找的真痛点 —
 *  之前 saveConfig 无 try/catch 直接 throw，UI 看似切换但实际没保存（Environment / Settings
 *  改字段时 silent 丢）。现在 catch 后写 flag 让 popup 弹「⚠ 配置写入失败：存储已满，请清理历史」 */
export const QUOTA_FAIL_FLAG_KEY = 'mooConfigQuotaFailed'

export async function saveConfig(config: MooConfig): Promise<void> {
  // Vue 响应式对象在结构化克隆时可能丢字段，先解到纯对象再写入
  const plain = JSON.parse(JSON.stringify(config)) as MooConfig
  try {
    await chrome.storage.local.set({ [CONFIG_KEY]: plain })
    // 写入成功 → 清掉之前的 quota flag（用户清理历史后又能写了）
    void chrome.storage.local.remove(QUOTA_FAIL_FLAG_KEY).catch(() => {})
  } catch (e) {
    // 通常是 chrome.storage.local 5MB quota 超出 — 写 flag 让 popup banner 提示
    // 用户清理历史 / 减少 capture buffer。不要 silent 让 await 失败抛红 Vue 红屏
    void chrome.storage.local.set({
      [QUOTA_FAIL_FLAG_KEY]: { message: (e as Error).message, at: Date.now() }
    }).catch(() => { /* storage 完全锁死也无能为力，至少 throw 给调用方 */ })
    throw e
  }
  if (import.meta.env.DEV) console.log('[Moo:config] saved', plain)
}

export function onConfigChanged(handler: (config: MooConfig) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName
  ) => {
    if (area !== 'local') return
    if (!changes[CONFIG_KEY]) return
    handler(normalizeConfig(changes[CONFIG_KEY].newValue as Partial<MooConfig> | undefined))
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}

/**
 * 简单 URL 通配匹配：* 匹配任意字符（包含 /）。
 * 例：
 *   *                          → 匹配任意 URL
 *   https://*.example.com/*    → 匹配 https://api.example.com/users/123
 *   https://example.com/api/*  → 匹配 https://example.com/api/anything
 */
export function urlMatches(url: string, pattern: string): boolean {
  if (!pattern) return false
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  try {
    return new RegExp(`^${escaped}$`).test(url)
  } catch {
    return false
  }
}

/** 所有匹配当前 url 的启用项目。globalEnabled=false 时返回空数组。 */
export function matchProjects(config: MooConfig, url: string): Project[] {
  if (!config.globalEnabled) return []
  return config.projects.filter(
    (p) => p.enabled && p.matchPatterns.some((pat) => urlMatches(url, pat))
  )
}

