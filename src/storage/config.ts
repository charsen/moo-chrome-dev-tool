import type { BugServer, MooConfig, Project } from '@/types/config'
import { normalizeProject } from '@/types/config'

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
 *  但 console.warn 让 dev 知道：用户提交时 video 字段不会被填，录屏发不到后端。 */
function detectCustomTemplateMissingVideo(s: BugServer): boolean {
  if (typeof s.payloadTemplate !== 'string' || !s.payloadTemplate) return false
  if (s.payloadTemplate.includes('{{video}}')) return false
  // 匹配「默认派生模板」结构，匹配上的会被 migrateServerTemplate 自动补 — 不算自定义
  return !/([ \t]*)"screenshot"\s*:\s*"\{\{image\}\}"\s*,/.test(s.payloadTemplate)
}

function applyMigrations(cfg: MooConfig): { config: MooConfig; changed: boolean } {
  let changed = false
  const projects = cfg.projects.map((p) => {
    if (!Array.isArray(p.servers) || p.servers.length === 0) return p
    const servers: BugServer[] = p.servers.map((s) => {
      if (detectCustomTemplateMissingVideo(s)) {
        console.warn(`[Moo:config] project "${p.name}" server "${s.name}" 用了自定义 payloadTemplate 但缺 {{video}} 占位 — 录屏字段不会发到后端。请手动在模板里加 video / videoDuration / videoBytes 占位符（参考 DEFAULT_PAYLOAD_TEMPLATE）`)
      }
      const tpl2 = migrateServerTemplate(s.payloadTemplate)
      if (tpl2 !== s.payloadTemplate) {
        changed = true
        return { ...s, payloadTemplate: tpl2 }
      }
      return s
    })
    return changed ? { ...p, servers } : p
  })
  return { config: changed ? { ...cfg, projects } : cfg, changed }
}

export async function loadConfig(): Promise<MooConfig> {
  const result = await chrome.storage.local.get(CONFIG_KEY)
  const cfg = normalizeConfig(result[CONFIG_KEY] as Partial<MooConfig> | undefined)
  const { config, changed } = applyMigrations(cfg)
  if (changed) {
    if (import.meta.env.DEV) console.log('[Moo:config] migrated payloadTemplate(s) to include video fields')
    void saveConfig(config)
  }
  // 不要在生产打整份 config —— project.token / endpoint 是敏感信息，
  // 用户开 DevTools 或截图分享 console 会泄露。
  if (import.meta.env.DEV) console.log('[Moo:config] loaded', config, 'rawKey:', result[CONFIG_KEY])
  return config
}

export async function saveConfig(config: MooConfig): Promise<void> {
  // Vue 响应式对象在结构化克隆时可能丢字段，先解到纯对象再写入
  const plain = JSON.parse(JSON.stringify(config)) as MooConfig
  await chrome.storage.local.set({ [CONFIG_KEY]: plain })
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

