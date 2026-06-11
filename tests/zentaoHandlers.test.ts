import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * v0.5.2 P0 重构第 1 阶段 — zentao 6 个 MSG case 抽到 handlers/zentao.ts 后的单测。
 *
 * 这是 background.ts 0 单测的破局点：handler 是 standalone async function 可 import 调用，
 * 不再需要 mock 整个 chrome.runtime.onMessage listener + dispatch。
 *
 * 覆盖 6 个 handler 关键路径：
 *   - happy path（login OK + 业务 OK）
 *   - login 失败 → 返 error
 *   - 业务失败 → 返 error
 *   - listModules 缺 projectId 早返
 *   - clearCache 同步返
 *   - ping cookie 走 ensureCookieSession 不同路径
 */

import type { ZentaoEnv } from '@/background/zentao/client'

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  vi.unstubAllGlobals()
  // v0.5.3 #128：handler 入口 check host permission，默认 mock 已授权
  vi.stubGlobal('chrome', {
    permissions: {
      async contains() { return true }
    }
  })
  // 每个 test 单独 stub fetch 模拟禅道响应
})

// 共用 credentials payload
const creds = { baseUrl: 'https://z.example.com', account: 'alice', password: 'secret' }
const loginSuccess = () => jsonRes({
  status: 'success',
  token: 'tok-1',
  user: { id: 42, account: 'alice', realname: '爱丽丝' }
})

async function importHandlers() {
  // dynamic import 让每次拿干净的 module（避免 SW module-level cache 跨测残留）
  const { _clearZentaoCaches } = await import('@/background/zentao/client')
  _clearZentaoCaches()
  return await import('@/background/handlers/zentao')
}

describe('host permission 未授权（v0.5.3 #128）', () => {
  it('handleZentaoTestConnection: 未授权 → 返引导文案不调 fetch', async () => {
    vi.stubGlobal('chrome', { permissions: { async contains() { return false } } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { handleZentaoTestConnection } = await importHandlers()
    const r = await handleZentaoTestConnection(creds)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('启用')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('handleZentaoListModules: 未授权 → 返引导文案不 login', async () => {
    vi.stubGlobal('chrome', { permissions: { async contains() { return false } } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { handleZentaoListModules } = await importHandlers()
    const r = await handleZentaoListModules({ ...creds, projectId: 26 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('启用')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('handleZentaoPingCookie: 未授权 → 返引导文案', async () => {
    vi.stubGlobal('chrome', { permissions: { async contains() { return false } } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { handleZentaoPingCookie } = await importHandlers()
    const r = await handleZentaoPingCookie(creds)
    expect(r.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('handleZentaoTestConnection', () => {
  it('happy path：login + ping 都 OK → 返 realname / account', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) return loginSuccess()
      if (url.match(/\/v2\/users\/42$/)) {
        return jsonRes({ id: 42, account: 'alice', realname: '爱丽丝' })
      }
      return jsonRes({})
    }))
    const { handleZentaoTestConnection } = await importHandlers()
    const r = await handleZentaoTestConnection(creds)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.realname).toBe('爱丽丝')
      expect(r.account).toBe('alice')
    }
  })

  it('login 失败 → 返 error 不调 ping', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonRes({ status: 'failed', reason: '账号或密码错误' })
    ))
    const { handleZentaoTestConnection } = await importHandlers()
    const r = await handleZentaoTestConnection(creds)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('账号或密码错误')
  })
})

describe('handleZentaoListProjects', () => {
  it('happy path：返 projects 数组', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) return loginSuccess()
      if (url.includes('/v2/projects?')) {
        return jsonRes({
          projects: [
            { id: 1, name: 'P1', status: 'doing', type: 'project' },
            { id: 2, name: 'P2', status: 'done', type: 'project' }
          ]
        })
      }
      return jsonRes({})
    }))
    const { handleZentaoListProjects } = await importHandlers()
    const r = await handleZentaoListProjects(creds)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.projects).toHaveLength(2)
      expect(r.projects?.[0]).toEqual({ id: 1, name: 'P1', status: 'doing' })
    }
  })
})

describe('handleZentaoListUsers', () => {
  it('happy path：返 users 数组', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) return loginSuccess()
      if (url.includes('/v2/users?')) {
        return jsonRes({ users: [{ id: 9, account: 'bob', realname: '鲍勃' }] })
      }
      return jsonRes({})
    }))
    const { handleZentaoListUsers } = await importHandlers()
    const r = await handleZentaoListUsers(creds)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.users?.[0]?.account).toBe('bob')
  })
})

describe('handleZentaoListUsers — v0.8.9 tier-3 接线（projectId → discoverProduct → productId 透传）', () => {
  // 普通账号场景：v2 users 不识别 + v1 users 400（权限墙）。tier-3 建单页是唯一活路 ——
  // 用「v1 挂 + 建单页好使 → 返 ok」间接断言 listUsers 真收到了 discoverProduct 的 productId。
  it('payload 带 projectId + discoverProduct 成功 → tier-3 拿到用户（productID 透传到建单页 URL）', async () => {
    let pageUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) return loginSuccess()
      if (url.match(/\/v2\/projects\/26$/)) {
        return jsonRes({ id: 26, products: [14] })  // discoverProduct → 14
      }
      if (url.includes('/v2/users?')) return jsonRes({ status: 'success', data: {} })  // 不识别
      if (url.includes('/v1/users?')) return new Response('bad request', { status: 400 })  // 权限墙
      if (url.includes('index.php') && url.includes('f=create')) {
        pageUrl = url
        return jsonRes({ status: 'success', data: JSON.stringify({ users: { zhangsan: 'zhangsan:张三' }, moduleOptionMenu: {} }) })
      }
      return jsonRes({})
    }))
    const { handleZentaoListUsers } = await importHandlers()
    const r = await handleZentaoListUsers({ ...creds, projectId: 26 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.users).toHaveLength(1)
      expect(r.users?.[0]).toMatchObject({ account: 'zhangsan', realname: '张三' })
    }
    expect(pageUrl).toContain('productID=14')  // discoverProduct 的结果真透传给了 listUsers
  })

  it('discoverProduct 失败 → 不阻断不炸，tier-3 跳过，保留原 v1 错误（行为同旧版）', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('/users/login')) return loginSuccess()
      if (url.match(/\/v2\/projects\/26$/)) {
        return new Response('', { status: 404 })  // 项目不存在 → discoverProduct 失败
      }
      if (url.includes('/v2/users?')) return jsonRes({ status: 'success', data: {} })
      if (url.includes('/v1/users?')) return new Response('bad request', { status: 400 })
      return jsonRes({})
    }))
    const { handleZentaoListUsers } = await importHandlers()
    const r = await handleZentaoListUsers({ ...creds, projectId: 26 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('HTTP 400（v1 users fallback）')  // 原错误，不是 discover 的错
    // tier-3 不可用 → 建单页 0 次请求
    expect(calls.filter(u => u.includes('index.php') && u.includes('f=create'))).toHaveLength(0)
  })
})

describe('handleZentaoListModules', () => {
  it('缺 projectId → 早返 error 不调 login', async () => {
    const fetchMock = vi.fn(async () => jsonRes({}))
    vi.stubGlobal('fetch', fetchMock)
    const { handleZentaoListModules } = await importHandlers()
    const r = await handleZentaoListModules({ ...creds })  // 无 projectId
    expect(r.ok).toBe(false)
    expect(r.error).toContain('projectId 必填')
    expect(fetchMock).not.toHaveBeenCalled()  // 完全没 login
  })

  it('happy path：login → discoverProduct → listModules', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) return loginSuccess()
      if (url.match(/\/v2\/projects\/26$/)) {
        return jsonRes({ id: 26, products: [{ id: 77 }] })
      }
      if (url.includes('/v1/modules?id=77')) {
        return jsonRes({ modules: [{ id: 100, name: 'M1', path: '/M1' }] })
      }
      return jsonRes({})
    }))
    const { handleZentaoListModules } = await importHandlers()
    const r = await handleZentaoListModules({ ...creds, projectId: 26 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.modules?.[0]?.name).toBe('M1')
  })
})

describe('handleZentaoClearCache', () => {
  it('同步返 { ok: true }（不 await，不 fetch）', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { handleZentaoClearCache } = await importHandlers()
    const r = handleZentaoClearCache()
    expect(r.ok).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
