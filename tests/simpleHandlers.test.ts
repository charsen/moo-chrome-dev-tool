import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * v0.5.2 P0 重构第 3 阶段 — simple.ts 3 个 MSG case 抽出后的单测。
 * 覆盖 CAPTURE_SCREENSHOT / MATCH_PROJECT / PREVIEW_PAYLOAD。
 *
 * 同 zentaoHandlers.test.ts：handler 是 standalone function 可 import 调用。
 */

interface MockState {
  storageData: Record<string, unknown>
  captureFails: boolean
  captureError?: string
  capturedDataUrl: string
}

let state: MockState

function makeChrome(): void {
  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        async get(key: string) {
          return { [key]: state.storageData[key] }
        },
        async set(obj: Record<string, unknown>) {
          Object.assign(state.storageData, obj)
        }
      }
    },
    tabs: {
      async captureVisibleTab(_windowId: number, _opts: unknown) {
        if (state.captureFails) {
          throw new Error(state.captureError || '权限拒绝')
        }
        return state.capturedDataUrl
      }
    },
    windows: { WINDOW_ID_CURRENT: -2 },
    runtime: { lastError: undefined }
  }
}

beforeEach(() => {
  state = {
    storageData: {},
    captureFails: false,
    capturedDataUrl: 'data:image/png;base64,AAAA'
  }
  makeChrome()
})

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
})

const { handleCaptureScreenshot, handleMatchProject, handlePreviewPayload } =
  await import('@/background/handlers/simple')

describe('handleCaptureScreenshot', () => {
  it('happy path：返 dataUrl', async () => {
    const r = await handleCaptureScreenshot(123)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.dataUrl).toBe('data:image/png;base64,AAAA')
  })

  it('captureVisibleTab 抛错 → 返 error 不 throw', async () => {
    state.captureFails = true
    state.captureError = '页面不允许截图'
    const r = await handleCaptureScreenshot(123)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('页面不允许截图')
  })

  it('windowId 缺省时用 WINDOW_ID_CURRENT', async () => {
    const r = await handleCaptureScreenshot(undefined)
    expect(r.ok).toBe(true)
  })
})

describe('handleMatchProject', () => {
  it('url 匹配 → 返 project + matches', async () => {
    state.storageData.mooConfig = {
      globalEnabled: true,
      projects: [
        {
          id: 'p1',
          name: '测试',
          matchPatterns: ['https://example.com/*'],
          kind: 'webhook',
          servers: [],
          defaultServerId: '',
          capture: {},
          redact: {},
          enabled: true
        }
      ]
    }
    const r = await handleMatchProject('https://example.com/foo')
    expect(r.project?.id).toBe('p1')
    expect(r.matches).toHaveLength(1)
  })

  it('url 不匹配 → project=null, matches=[]', async () => {
    state.storageData.mooConfig = {
      globalEnabled: true,
      projects: [
        {
          id: 'p1',
          name: 'x',
          matchPatterns: ['https://other.com/*'],
          kind: 'webhook',
          servers: [],
          defaultServerId: '',
          capture: {},
          redact: {},
          enabled: true
        }
      ]
    }
    const r = await handleMatchProject('https://example.com/foo')
    expect(r.project).toBeNull()
    expect(r.matches).toEqual([])
  })

  it('globalEnabled=false → 即使有匹配项目也返空', async () => {
    state.storageData.mooConfig = {
      globalEnabled: false,
      projects: [
        {
          id: 'p1',
          name: 'x',
          matchPatterns: ['https://example.com/*'],
          kind: 'webhook',
          servers: [],
          defaultServerId: '',
          capture: {},
          redact: {},
          enabled: true
        }
      ]
    }
    const r = await handleMatchProject('https://example.com/foo')
    expect(r.project).toBeNull()
  })

  it('loadConfig throw → 返 {project:null, matches:[]} 不 throw', async () => {
    ;(globalThis as { chrome?: { storage?: { local?: { get?: unknown } } } }).chrome!.storage!.local!.get =
      async () => { throw new Error('storage 挂了') }
    const r = await handleMatchProject('https://example.com/foo')
    expect(r.project).toBeNull()
    expect(r.matches).toEqual([])
  })
})

describe('handlePreviewPayload', () => {
  const server = {
    id: 's1',
    name: 'test',
    endpoint: 'http://x',
    method: 'POST',
    headers: {},
    payloadTemplate: '{"title":"{{title}}"}',
    imageFormat: 'inline' as const,
    imageField: 'image'
  }

  it('happy path：渲染模板', () => {
    const r = handlePreviewPayload({ server, context: { title: 'hi' } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.rendered).toBe('{"title":"hi"}')
  })

  it('payload 缺 server → 返 error', () => {
    const r = handlePreviewPayload(undefined)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('缺 server')
  })

  it('payload 为空对象 → 返 error', () => {
    const r = handlePreviewPayload({})
    expect(r.ok).toBe(false)
  })

  it('context 缺省 → 用空 ctx 渲染（renderTemplate 缺 key 保留原占位）', () => {
    const r = handlePreviewPayload({ server })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.rendered).toBe('{"title":"{{title}}"}')
  })
})
