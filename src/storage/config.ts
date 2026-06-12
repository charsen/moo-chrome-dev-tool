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
 * 迁移默认派生模板：自动补 v0.4.7 的 {{video}} 三件 + v0.8.11 的多图 "screenshots" 字段。
 * 两个迁移**各自独立判断**——只处理形如 `"screenshot": "{{image}}",`（默认模板派生、带 trailing
 * 逗号）的 server；用户完全自定义的模板（不含该行、或 image 行无 trailing 逗号）一律不动。
 *
 * ⚠ v0.8.11 关键修复：旧实现 `if (includes('{{video}}')) return` 会让「已有 video 但缺
 * screenshots」的模板（v0.4.7~v0.8.10 期间配置的用户，正是多图发不出去那批）提前返回、永远
 * 拿不到 screenshots 迁移。改成两段独立跑：video 迁移后 screenshot 行仍在，screenshots 迁移
 * 继续匹配它插在其后，最终结构与新 DEFAULT_PAYLOAD_TEMPLATE 对齐。
 */
function migrateServerTemplate(tpl: string): string {
  if (typeof tpl !== 'string' || tpl === '') return tpl
  let out = tpl
  const screenshotLine = /([ \t]*)"screenshot"\s*:\s*"\{\{image\}\}"\s*,/

  // 迁移 1（v0.4.7）：缺 {{video}} → screenshot 行后补 video 三件
  if (!out.includes('{{video}}')) {
    const m = out.match(screenshotLine)
    if (m) {
      const lead = m[1] ?? '  '
      out = out.replace(m[0], [
        `${lead}"screenshot": "{{image}}",`,
        `${lead}"video": "{{video}}",`,
        `${lead}"video_duration": {{videoDuration}},`,
        `${lead}"video_bytes": {{videoBytes}},`
      ].join('\n'))
    }
  }

  // 迁移 2（v0.8.11 多图）：缺 {{imagesJson}} → screenshot 行后补 "screenshots" 数组字段。
  // 守卫 includes('{{imagesJson}}')：用户手动加过（哪怕换名 "shots": {{imagesJson}}）则不重复插。
  if (!out.includes('{{imagesJson}}')) {
    const m = out.match(screenshotLine)
    if (m) {
      const lead = m[1] ?? '  '
      out = out.replace(m[0], [
        `${lead}"screenshot": "{{image}}",`,
        `${lead}"screenshots": {{imagesJson}},`
      ].join('\n'))
    }
  }

  return out
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
  // 空数组 ≠ 老用户：缺字段的老数据在 normalizeProject 兜的是非空 DEFAULT_REDACT，
  // 能走到这里的 [] 只可能是用户在 Settings 主动删光（如调试想看原始 body）。
  // 之前判 true 会把 12 个默认 key 全量合回 + loadConfig 落盘 —— 用户的显式清空
  // 永远复活，与本迁移声明的「只补不删、不动用户自定义」直接矛盾。
  if (arr.length === 0) return false
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
    if (import.meta.env.DEV) console.log('[Moo:config] migrated payloadTemplate(s) to include video + screenshots(多图) fields')
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
 * URL 通配匹配。
 *
 * v0.8.9：「scheme://host/path」形态按 **Chrome match-pattern 语义**对齐 —— 同一份
 * pattern 字符串既交给 chrome.scripting 注册内容脚本（Chrome 自己的语义），又在这里
 * 做悬浮球/采集匹配。两边语义分叉时出现「内容脚本注入了但球永远不出」（实测困惑）：
 *   - Chrome：`*.example.com` 命中裸域 example.com 本身 + 任意层子域；本函数旧译法
 *     `.*\.example\.com` 不命中裸域；
 *   - Chrome：pattern host 不写端口 → 任意端口命中；旧译法 `:8443` 直接挂。
 * 对齐规则（只对结构化形态生效）：
 *   - scheme `*` → http/https；
 *   - host `*.h` → 命中 h 与任意层子域；host 内其它 `*` → 域内通配（不跨 / 和 :）；
 *   - pattern 不带端口 → URL 任意端口命中；`:*` 同；显式 `:8787` → 精确匹配；
 *   - path `*` → 任意（含 / 与 query）。
 * 非结构化形态（纯 `*` / 老配置遗留）走旧的「* 匹配任意字符」整串规则，行为不变。
 *
 * 例：
 *   https://*.example.com/*    → 命中 https://example.com/ 与 https://api.example.com:8443/users/1
 *   https://example.com/api/*  → 命中 https://example.com/api/anything（任意端口）
 */
export function urlMatches(url: string, pattern: string): boolean {
  if (!pattern) return false
  const m = /^(\*|[a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/]+)(\/.*)?$/.exec(pattern)
  try {
    if (m) {
      const schemeRe = m[1] === '*' ? 'https?' : escapeRegexLit(m[1] as string)
      const hostPort = m[2] as string
      const pm = /^(.*?)(?::(\d+|\*))?$/.exec(hostPort) as RegExpExecArray
      const host = pm[1] ?? ''
      const port = pm[2]
      let hostRe: string
      if (host === '*') {
        hostRe = '[^/:]+'
      } else if (host.startsWith('*.')) {
        hostRe = `(?:[^/:]+\\.)*${escapeRegexLit(host.slice(2)).replace(/\*/g, '[^/:]*')}`
      } else {
        hostRe = escapeRegexLit(host).replace(/\*/g, '[^/:]*')
      }
      const portRe = port === undefined || port === '*' ? '(?::\\d+)?' : `:${port}`
      const pathRe = escapeRegexLit(m[3] ?? '/*').replace(/\*/g, '.*')
      return new RegExp(`^${schemeRe}://${hostRe}${portRe}${pathRe}$`).test(url)
    }
    // 兜底：非结构化 pattern —— 旧规则原样保留
    const escaped = escapeRegexLit(pattern).replace(/\*/g, '.*')
    return new RegExp(`^${escaped}$`).test(url)
  } catch {
    return false
  }
}

/** 转义 regex 字面量（不转 `*` —— `*` 是 pattern 的通配语义，由 caller 按位置翻译） */
function escapeRegexLit(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
}

/** 所有匹配当前 url 的启用项目。globalEnabled=false 时返回空数组。 */
export function matchProjects(config: MooConfig, url: string): Project[] {
  if (!config.globalEnabled) return []
  return config.projects.filter(
    (p) => p.enabled && p.matchPatterns.some((pat) => urlMatches(url, pat))
  )
}

