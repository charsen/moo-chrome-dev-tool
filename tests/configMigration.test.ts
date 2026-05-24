import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * storage/config.ts migration 单测（v0.4.5 加）。
 *
 * 之前 0 单测，是 storage 层最高风险的 dead zone（用户老数据迁移挂掉就丢配置）。
 * 覆盖：
 *   - normalizeConfig：rawConfig 各种非法形态兜底
 *   - applyMigrations：旧 payloadTemplate 加 video 字段（v0.1.x → v0.2+ 路径）
 *   - loadConfig：触发自动 migration + saveConfig 写回
 */

// 模拟 chrome.storage.local 内存版
const storage = { data: {} as Record<string, unknown> }
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: storage.data[key] }),
      set: async (kv: Record<string, unknown>) => { Object.assign(storage.data, kv) },
      remove: async (key: string) => { delete storage.data[key] }
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    }
  }
})

beforeEach(() => {
  storage.data = {}
  vi.resetModules()
})

describe('loadConfig · normalize 兜底', () => {
  it('storage 完全空 → 返默认 config（projects 空数组 + globalEnabled true）', async () => {
    const { loadConfig } = await import('@/storage/config')
    const cfg = await loadConfig()
    expect(cfg.projects).toEqual([])
    expect(cfg.globalEnabled).toBe(true)
  })

  it('rawConfig 是 null → 默认 config（不 throw）', async () => {
    storage.data.mooConfig = null
    const { loadConfig } = await import('@/storage/config')
    const cfg = await loadConfig()
    expect(cfg.projects).toEqual([])
    expect(cfg.globalEnabled).toBe(true)
  })

  it('rawConfig.projects 不是数组 → 兜底成空数组', async () => {
    storage.data.mooConfig = { projects: 'not-an-array' }
    const { loadConfig } = await import('@/storage/config')
    const cfg = await loadConfig()
    expect(cfg.projects).toEqual([])
  })

  it('rawConfig.globalEnabled 不是 boolean → 兜底成 true', async () => {
    storage.data.mooConfig = { projects: [], globalEnabled: 'yes' }
    const { loadConfig } = await import('@/storage/config')
    const cfg = await loadConfig()
    expect(cfg.globalEnabled).toBe(true)
  })

  it('老 project 缺 capture/redact/kind 字段 → normalizeProject 兜底补齐', async () => {
    storage.data.mooConfig = {
      projects: [{ id: 'p1', name: 'legacy', matchPatterns: [] }],
      globalEnabled: true
    }
    const { loadConfig } = await import('@/storage/config')
    const cfg = await loadConfig()
    expect(cfg.projects).toHaveLength(1)
    const p = cfg.projects[0]!
    expect(p.capture).toBeDefined()
    expect(p.redact).toBeDefined()
    expect(p.kind).toBe('webhook')  // 默认 kind
  })
})

describe('applyMigrations · payloadTemplate 加 video 字段', () => {
  it('默认 payloadTemplate 缺 {{video}} → 自动追加 3 个 video 字段', async () => {
    const template = `{
  "title": "{{title}}",
  "screenshot": "{{image}}",
  "url": "{{url}}"
}`
    storage.data.mooConfig = {
      projects: [{
        id: 'p1', name: 'x', matchPatterns: [],
        kind: 'webhook',
        servers: [{
          id: 's1', name: 'srv', endpoint: 'https://x.com/r', method: 'POST',
          headers: {}, payloadTemplate: template, imageField: 'image', imageFormat: 'base64'
        }],
        defaultServerId: 's1',
        capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
        redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: false },
        enabled: true
      }]
    }
    const { loadConfig } = await import('@/storage/config')
    const cfg = await loadConfig()
    const newTpl = cfg.projects[0]!.servers[0]!.payloadTemplate
    expect(newTpl).toContain('"video": "{{video}}"')
    expect(newTpl).toContain('"video_duration": {{videoDuration}}')
    expect(newTpl).toContain('"video_bytes": {{videoBytes}}')
  })

  it('已含 {{video}} 的模板 → 不动（idempotent）', async () => {
    const template = `{ "screenshot": "{{image}}", "video": "{{video}}" }`
    storage.data.mooConfig = {
      projects: [{
        id: 'p1', name: 'x', matchPatterns: [],
        kind: 'webhook',
        servers: [{
          id: 's1', name: 'srv', endpoint: 'https://x.com/r', method: 'POST',
          headers: {}, payloadTemplate: template, imageField: 'image', imageFormat: 'base64'
        }],
        defaultServerId: 's1',
        capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
        redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: false },
        enabled: true
      }]
    }
    const { loadConfig } = await import('@/storage/config')
    const cfg = await loadConfig()
    expect(cfg.projects[0]!.servers[0]!.payloadTemplate).toBe(template)
  })

  it('自定义模板不含「screenshot": "{{image}}",」标准行 → 不动', async () => {
    // 用户自定义模板，image 字段名不一样 / 没 trailing comma → migration 不该乱改
    const template = `{ "imageData": "{{image}}" }`
    storage.data.mooConfig = {
      projects: [{
        id: 'p1', name: 'x', matchPatterns: [],
        kind: 'webhook',
        servers: [{
          id: 's1', name: 'srv', endpoint: 'https://x.com/r', method: 'POST',
          headers: {}, payloadTemplate: template, imageField: 'image', imageFormat: 'base64'
        }],
        defaultServerId: 's1',
        capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
        redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: false },
        enabled: true
      }]
    }
    const { loadConfig } = await import('@/storage/config')
    const cfg = await loadConfig()
    expect(cfg.projects[0]!.servers[0]!.payloadTemplate).toBe(template)
  })

  it('migration 触发后自动 saveConfig 写回 storage', async () => {
    storage.data.mooConfig = {
      projects: [{
        id: 'p1', name: 'x', matchPatterns: [],
        kind: 'webhook',
        servers: [{
          id: 's1', name: 'srv', endpoint: 'https://x.com/r', method: 'POST',
          headers: {}, payloadTemplate: '{ "screenshot": "{{image}}", }',
          imageField: 'image', imageFormat: 'base64'
        }],
        defaultServerId: 's1',
        capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
        redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: false },
        enabled: true
      }]
    }
    const { loadConfig } = await import('@/storage/config')
    await loadConfig()
    // 第二次 load 应该拿到 migrated 后的 template
    const cfg2 = await loadConfig()
    expect(cfg2.projects[0]!.servers[0]!.payloadTemplate).toContain('{{video}}')
    // 验证 storage 真写回了
    const raw = storage.data.mooConfig as { projects: { servers: { payloadTemplate: string }[] }[] }
    expect(raw.projects[0]!.servers[0]!.payloadTemplate).toContain('{{video}}')
  })

  it('servers 为空数组 → 不动（不 throw）', async () => {
    storage.data.mooConfig = {
      projects: [{
        id: 'p1', name: 'x', matchPatterns: [],
        kind: 'zentao', servers: [], defaultServerId: '',
        capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
        redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: false },
        enabled: true
      }]
    }
    const { loadConfig } = await import('@/storage/config')
    const cfg = await loadConfig()
    expect(cfg.projects[0]!.servers).toEqual([])
  })
})
