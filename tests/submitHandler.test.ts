import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubmitBugReq } from '@/types/messages'

/**
 * v0.5.2 P0 重构第 3 阶段 — handlers/submit.ts 关键路径单测。
 * 覆盖 SUBMIT_BUG：webhook 双向（成功 / 5xx 入队 / 4xx 不入队 / 网络错入队）+ project/server 缺失 + zentao 委托。
 *
 * zentao submit 全链路（submitToZentao 内部）已在 zentaoSubmitBuilders 等测试覆盖，
 * 这里只测 handleSubmitBug 是否正确委托给 zentao 路径。
 */

interface MockState {
  storageData: Record<string, unknown>
}

let state: MockState

function makeChrome(): void {
  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        async get(key: string) { return { [key]: state.storageData[key] } },
        async set(obj: Record<string, unknown>) { Object.assign(state.storageData, obj) },
        async remove() {}
      },
      onChanged: { addListener() {}, removeListener() {} }
    },
    runtime: {
      getManifest: () => ({ version: '0.5.2-test' })
    },
    action: {
      async setBadgeText() {},
      async setBadgeBackgroundColor() {},
      async setTitle() {}
    },
    scripting: {
      async executeScript() { return [{ result: {} }] }
    },
    // v0.5.3 #128：handler 入口 check host permission，默认 mock 已授权
    permissions: {
      async contains() { return true }
    }
  }
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function textRes(body: string, status = 200): Response {
  return new Response(body, { status })
}

const baseReq = (overrides: Partial<SubmitBugReq> = {}): SubmitBugReq => ({
  projectId: 'p1',
  serverId: 's1',
  title: 'bug 标题',
  description: '描述',
  image: '',
  url: 'https://example.com/page',
  userAgent: 'UA',
  viewport: { w: 1280, h: 800 },
  timestamp: '2026-05-24T08:00:00Z',
  requests: [],
  errors: [],
  elements: [],
  ...overrides
})

const webhookProject = {
  id: 'p1', name: 'webhook 项目', matchPatterns: [],
  kind: 'webhook',
  servers: [{
    id: 's1', name: 'svr', endpoint: 'http://api.example.com/intake',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    payloadTemplate: '{"title":"{{title}}"}',
    imageFormat: 'inline',
    imageField: 'image'
  }],
  defaultServerId: 's1',
  capture: {},
  redact: {},
  enabled: true
}

beforeEach(() => {
  state = { storageData: {} }
  makeChrome()
  vi.unstubAllGlobals()
})

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
  vi.unstubAllGlobals()
})

async function importHandler() {
  return await import('@/background/handlers/submit')
}

describe('handleSubmitBug — host permission 未授权', () => {
  it('chrome.permissions.contains 返 false → 直接返 error 不调 fetch', async () => {
    // 覆盖 makeChrome 默认 mock，让 contains 返 false
    ;(globalThis as { chrome: { permissions: { contains: () => Promise<boolean> } } })
      .chrome.permissions.contains = async () => false
    const { handleSubmitBug } = await importHandler()
    const r = await handleSubmitBug(baseReq())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('启用')
  })
})

describe('handleSubmitBug — project/server 缺失', () => {
  it('project 不存在 → error + 写失败 history', async () => {
    state.storageData.mooConfig = { globalEnabled: true, projects: [] }
    const { handleSubmitBug } = await importHandler()
    const r = await handleSubmitBug(baseReq())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('找不到对应项目')
    // 失败 history 已写
    expect(Array.isArray(state.storageData.mooHistory)).toBe(true)
    expect((state.storageData.mooHistory as unknown[]).length).toBe(1)
  })

  it('server 不存在 → error', async () => {
    state.storageData.mooConfig = {
      globalEnabled: true,
      projects: [{ ...webhookProject, servers: [] }]
    }
    const { handleSubmitBug } = await importHandler()
    const r = await handleSubmitBug(baseReq())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('上报服务器')
  })

  it('server.endpoint 空 → error', async () => {
    state.storageData.mooConfig = {
      globalEnabled: true,
      projects: [{ ...webhookProject, servers: [{ ...webhookProject.servers[0], endpoint: '' }] }]
    }
    const { handleSubmitBug } = await importHandler()
    const r = await handleSubmitBug(baseReq())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('请求 URL')
  })
})

describe('handleSubmitBug — webhook 路径', () => {
  beforeEach(() => {
    state.storageData.mooConfig = { globalEnabled: true, projects: [webhookProject] }
  })

  it('happy path：fetch 200 → 返 ok + 写 history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ id: 555 })))
    const { handleSubmitBug } = await importHandler()
    const r = await handleSubmitBug(baseReq())
    expect(r.ok).toBe(true)
    expect((state.storageData.mooHistory as unknown[]).length).toBe(1)
  })

  it('fetch 500 → result.ok=false，进重试队列', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textRes('boom', 500)))
    const { handleSubmitBug } = await importHandler()
    const r = await handleSubmitBug(baseReq())
    expect(r.ok).toBe(false)
    expect(r.queued).toBe(true)
    const queue = state.storageData.mooRetryQueue as Array<{ kind: string }>
    expect(queue).toHaveLength(1)
    expect(queue[0].kind).toBe('webhook')
  })

  it('fetch 400 → result.ok=false，不入队（queued=false）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => textRes('bad', 400)))
    const { handleSubmitBug } = await importHandler()
    const r = await handleSubmitBug(baseReq())
    expect(r.ok).toBe(false)
    expect(r.queued).toBe(false)
    expect(state.storageData.mooRetryQueue).toBeUndefined()
  })

  it('fetch throw 网络错 → 入队', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network failed') }))
    const { handleSubmitBug } = await importHandler()
    const r = await handleSubmitBug(baseReq())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Network failed')
    expect(r.queued).toBe(true)
  })

  it('parseRemoteId 从 body 提取 id → 落到 history.remoteId', async () => {
    // parseRemoteId 只接受 string 类型 id（防服务端注入路径），number id 会被拒
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ ok: true, id: '9999' })))
    const { handleSubmitBug } = await importHandler()
    const r = await handleSubmitBug(baseReq())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.remoteId).toBe('9999')
  })
})

describe('handleSubmitBug — zentao 委托', () => {
  it('project.kind=zentao → 走 zentao 路径，login 失败不报「找不到上报服务器」', async () => {
    state.storageData.mooConfig = {
      globalEnabled: true,
      projects: [{
        id: 'p1', name: '禅道项目', matchPatterns: [],
        kind: 'zentao',
        servers: [], defaultServerId: '',
        zentao: { baseUrl: 'https://z.example.com', account: 'a', password: 'b', projectId: 1, moduleId: 0 },
        capture: {}, redact: {}, enabled: true
      }]
    }
    // login 失败让 submitToZentao 早返，避开内部 mock 不完整的细节
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonRes({ status: 'failed', reason: '账号或密码错误' })
    ))
    const { handleSubmitBug } = await importHandler()
    const r = await handleSubmitBug(baseReq())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // 关键 assert：不走 webhook 校验 → 错误来自 zentao 链路（非 server-related）
      expect(r.error).not.toContain('上报服务器')
      expect(r.error).not.toContain('找不到对应项目')
    }
  })
})
