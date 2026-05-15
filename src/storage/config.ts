import type { BugServer, MooConfig, Project } from '@/types/config'

const CONFIG_KEY = 'mooConfig'

const DEFAULT_CONFIG: MooConfig = {
  projects: [],
  globalEnabled: true
}

function normalizeConfig(raw: Partial<MooConfig> | undefined | null): MooConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG }
  return {
    projects: Array.isArray(raw.projects) ? raw.projects : [],
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

function applyMigrations(cfg: MooConfig): { config: MooConfig; changed: boolean } {
  let changed = false
  const projects = cfg.projects.map((p) => {
    if (!Array.isArray(p.servers) || p.servers.length === 0) return p
    const servers: BugServer[] = p.servers.map((s) => {
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
    console.log('[Moo:config] migrated payloadTemplate(s) to include video fields')
    void saveConfig(config)
  }
  console.log('[Moo:config] loaded', config, 'rawKey:', result[CONFIG_KEY])
  return config
}

export async function saveConfig(config: MooConfig): Promise<void> {
  // Vue 响应式对象在结构化克隆时可能丢字段，先解到纯对象再写入
  const plain = JSON.parse(JSON.stringify(config)) as MooConfig
  await chrome.storage.local.set({ [CONFIG_KEY]: plain })
  console.log('[Moo:config] saved', plain)
}

export async function updateConfig(updater: (cfg: MooConfig) => MooConfig): Promise<MooConfig> {
  const current = await loadConfig()
  const next = updater(current)
  await saveConfig(next)
  return next
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

export function matchProject(config: MooConfig, url: string): Project | null {
  if (!config.globalEnabled) return null
  for (const project of config.projects) {
    if (!project.enabled) continue
    if (project.matchPatterns.some((p) => urlMatches(url, p))) {
      return project
    }
  }
  return null
}
