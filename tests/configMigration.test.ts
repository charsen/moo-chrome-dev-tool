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

  it('已含 {{video}} + {{imagesJson}} 的模板 → 不动（真 idempotent）', async () => {
    const template = `{ "screenshot": "{{image}}", "screenshots": {{imagesJson}}, "video": "{{video}}" }`
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

  // ── v0.8.11 多图迁移：关键修复 —— 旧实现「已含 video 即提前返回」会让 v0.4.7~v0.8.10
  //    期间配置的用户（有 video、缺 screenshots，正是多图发不出去那批）永远拿不到 screenshots ──
  it('v0.8.11 核心修复：已含 {{video}} 但缺 screenshots → 仍补 screenshots（不被 video 提前返回吞掉）', async () => {
    const template = `{
  "screenshot": "{{image}}",
  "video": "{{video}}"
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
    expect(newTpl).toContain('"screenshots": {{imagesJson}}')
    // screenshots 必须插在 screenshot 之后、video 之前（与默认模板结构对齐）
    expect(newTpl.indexOf('"screenshot": "{{image}}"')).toBeLessThan(newTpl.indexOf('"screenshots"'))
    expect(newTpl.indexOf('"screenshots"')).toBeLessThan(newTpl.indexOf('"video"'))
  })

  it('v0.8.11：纯老默认模板（缺 video + 缺 screenshots）→ 两个迁移都补，结构匹配新默认模板', async () => {
    const template = `{
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
    expect(newTpl).toContain('"screenshots": {{imagesJson}}')
    expect(newTpl).toContain('"video": "{{video}}"')
    // 渲染后整体仍是合法 JSON（迁移没破坏结构）
    const { renderTemplate } = await import('@/utils/template')
    const rendered = renderTemplate(newTpl, { image: 'data:1', images: ['data:1', 'data:2'], video: '', videoDuration: 0, videoBytes: 0, url: 'u' })
    const parsed = JSON.parse(rendered)
    expect(parsed.screenshots).toEqual(['data:1', 'data:2'])
  })

  it('v0.8.11：用户手动用过 {{imagesJson}}（哪怕换名 shots）→ 不重复插 screenshots', async () => {
    const template = `{ "screenshot": "{{image}}", "shots": {{imagesJson}}, "video": "{{video}}" }`
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

  // ★ v0.8.14：cloud 单图模板（screenshot 末字段、无尾逗号）—— 旧迁移漏匹配致多图发不出去
  it('★ v0.8.14：cloud 单图模板 screenshot 末字段无逗号 → loadConfig 自动补 screenshots 且仍合法 JSON', async () => {
    const template = `{
  "token": "{{token}}",
  "title": "{{title}}",
  "screenshot": "{{image}}"
}`
    storage.data.mooConfig = {
      projects: [{
        id: 'p1', name: 'cloud', matchPatterns: [],
        kind: 'webhook',
        servers: [{
          id: 's1', name: 'cloud', endpoint: 'https://sc.example.com/api/v1/todos/intake', method: 'POST',
          headers: {}, payloadTemplate: template, imageField: 'screenshot', imageFormat: 'base64'
        }],
        defaultServerId: 's1',
        capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
        redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: false },
        enabled: true
      }]
    }
    const { loadConfig } = await import('@/storage/config')
    const cfg = await loadConfig()
    const tpl = cfg.projects[0]!.servers[0]!.payloadTemplate
    expect(tpl).toContain('"screenshots": {{imagesJson}}')
    const { renderTemplate } = await import('@/utils/template')
    const parsed = JSON.parse(renderTemplate(tpl, { token: 't', title: 'x', image: 'data:1', images: ['data:1', 'data:2'] }))
    expect(parsed.screenshots).toEqual(['data:1', 'data:2']) // 多图真发出去了
  })

  it('自定义模板不含「screenshot": "{{image}}"」行 → 不动', async () => {
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

// v0.5.0 加：mergeRedactDefaults migration（老用户 v0.1.x bodyKeys 不会自动补 v0.4.8 新加 keys）
describe('mergeRedactDefaults · v0.4.8+ 老用户 redact 默认值合并', () => {
  it('老用户 bodyKeys 是 v0.1.x 默认 [password,token] → 合并 v0.4.8 新加 keys', async () => {
    storage.data.mooConfig = {
      projects: [{
        id: 'p1', name: 'x', matchPatterns: [],
        kind: 'webhook',
        servers: [],
        defaultServerId: '',
        capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
        redact: {
          headerKeys: ['authorization', 'cookie', 'x-auth-token'],
          bodyKeys: ['password', 'token'],
          maskPasswordInputs: true
        },
        enabled: true
      }]
    }
    const { loadConfig } = await import('@/storage/config')
    const cfg = await loadConfig()
    const newBody = cfg.projects[0]!.redact.bodyKeys
    // 合并后应该包含 v0.4.8 加的 access_token / refresh_token 等
    expect(newBody).toContain('access_token')
    expect(newBody).toContain('refresh_token')
    expect(newBody).toContain('id_token')
    expect(newBody).toContain('client_secret')
    // 原有的也保留
    expect(newBody).toContain('password')
    expect(newBody).toContain('token')
  })

  it('用户自定义过 bodyKeys（非 v0.1.x superset）→ 不动', async () => {
    storage.data.mooConfig = {
      projects: [{
        id: 'p1', name: 'x', matchPatterns: [],
        kind: 'webhook',
        servers: [],
        defaultServerId: '',
        capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
        redact: {
          headerKeys: [],
          bodyKeys: ['custom-secret-field'],  // 完全自定义
          maskPasswordInputs: true
        },
        enabled: true
      }]
    }
    const { loadConfig } = await import('@/storage/config')
    const cfg = await loadConfig()
    expect(cfg.projects[0]!.redact.bodyKeys).toEqual(['custom-secret-field'])
  })

  // ── v0.8.8 Fix B：用户在 Settings 主动删光 redact keys → migration 不得复活默认 ──
  // 回归背景：isV01DefaultSubset 旧版对空数组 return true，把 [] 当 v0.1 老用户处理，
  // 12 个默认 key 全量合回 + loadConfig 落盘 —— 用户显式清空（如调试想看原始 body）
  // 每次 loadConfig 都被打回默认，与迁移声明的「只补不删、不动用户自定义」直接矛盾。
  function projectWithRedact(redact: { headerKeys: string[]; bodyKeys: string[] }) {
    return {
      id: 'p1', name: 'x', matchPatterns: [],
      kind: 'webhook', servers: [], defaultServerId: '',
      capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
      redact: { ...redact, maskPasswordInputs: true },
      enabled: true
    }
  }

  it('v0.8.8 round-trip：bodyKeys=[] + headerKeys=[] → loadConfig 后仍是 []，且不触发 changed 写盘', async () => {
    storage.data.mooConfig = {
      projects: [projectWithRedact({ headerKeys: [], bodyKeys: [] })],
      globalEnabled: true
    }
    const rawBefore = JSON.stringify(storage.data.mooConfig)
    const { loadConfig } = await import('@/storage/config')
    const cfg = await loadConfig()
    expect(cfg.projects[0]!.redact.bodyKeys).toEqual([])
    expect(cfg.projects[0]!.redact.headerKeys).toEqual([])
    // changed=false → 不该有 fire-and-forget saveConfig 写盘；等一个宏任务让 void 链落地再比对
    await new Promise((r) => setTimeout(r, 0))
    expect(JSON.stringify(storage.data.mooConfig)).toBe(rawBefore)
  })

  it('v0.8.8 两侧独立判定：bodyKeys=[]（用户清空）+ headerKeys=v0.1 默认（老用户）→ header 合并、body 保持 []', async () => {
    storage.data.mooConfig = {
      projects: [projectWithRedact({
        headerKeys: ['authorization', 'cookie', 'x-auth-token'],
        bodyKeys: []
      })],
      globalEnabled: true
    }
    const { loadConfig } = await import('@/storage/config')
    const cfg = await loadConfig()
    // 老用户侧照常合并（v0.4.8 新加的 header 默认进来）
    expect(cfg.projects[0]!.redact.headerKeys).toContain('x-api-key')
    expect(cfg.projects[0]!.redact.headerKeys).toContain('authorization')
    // 清空侧不复活
    expect(cfg.projects[0]!.redact.bodyKeys).toEqual([])
  })

  it('用户 bodyKeys 包含 v0.1 默认 + 一两个自定义 → 不算 v0.1 superset，不动', async () => {
    storage.data.mooConfig = {
      projects: [{
        id: 'p1', name: 'x', matchPatterns: [],
        kind: 'webhook',
        servers: [],
        defaultServerId: '',
        capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
        redact: {
          headerKeys: [],
          bodyKeys: ['password', 'token', 'custom-extra'],
          maskPasswordInputs: true
        },
        enabled: true
      }]
    }
    const { loadConfig } = await import('@/storage/config')
    const cfg = await loadConfig()
    // 超过 v0.1 默认 length → 不动
    expect(cfg.projects[0]!.redact.bodyKeys).toEqual(['password', 'token', 'custom-extra'])
  })
})
