import type { MooConfig, Project } from '@/types/config'

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

export async function loadConfig(): Promise<MooConfig> {
  const result = await chrome.storage.local.get(CONFIG_KEY)
  const cfg = normalizeConfig(result[CONFIG_KEY] as Partial<MooConfig> | undefined)
  console.log('[Moo:config] loaded', cfg, 'rawKey:', result[CONFIG_KEY])
  return cfg
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
