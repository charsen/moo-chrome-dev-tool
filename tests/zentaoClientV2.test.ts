import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  login,
  getBug,
  discoverProduct,
  _clearZentaoCaches,
  type ZentaoEnv
} from '@/background/zentao/client'

/**
 * v0.4.0 全面 v2 化的单测保护。
 *
 * 覆盖三个关键分支：
 *   1. login 解析 user 写入 userCache（首次/响应缺字段都兜住）
 *   2. getBug v2 嵌套 `{status, bug:{...}}` 响应 vs v1 平铺兜底
 *   3. discoverProduct v2 项目详情拿 products 数组（数字列表 / 对象列表 / 嵌套 project 包装 / 空数组）
 */

const baseUrl = 'https://z.example.com'
const env: ZentaoEnv = {
  baseUrl,
  account: 'alice',
  password: 'secret',
  projectId: 26,
  moduleId: 0
}

function mockJsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  _clearZentaoCaches()
  vi.unstubAllGlobals()
})

describe('login — v0.4.0 v2 响应 user 解析', () => {
  it('响应有 user 字段：返 token + userCache 填入（id/account/realname）', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturedUrl = url
      return mockJsonRes({ status: 'success', token: 'tok-1', user: { id: 42, account: 'alice', realname: '爱丽丝' } })
    }))
    const r = await login(baseUrl, 'alice', 'secret')
    expect(r.ok).toBe(true)
    expect(capturedUrl).toContain('/api.php/v2/users/login')
    if (r.ok) expect(r.data).toBe('tok-1')
    // 间接验证 userCache 写入：getBug 不再需要 user，但 ping/probeCookieSession 依赖它（在 e2e 测过）
  })

  it('响应 user.id 是字符串：兼容解析为 number', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJsonRes({ status: 'success', token: 't', user: { id: '99', account: 'a', realname: 'A' } })
    ))
    const r = await login(baseUrl, 'a', 's')
    expect(r.ok).toBe(true)
  })

  it('响应缺 user 字段：仍返 token 成功（userCache 不写但不报错）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockJsonRes({ status: 'success', token: 't' })))
    const r = await login(baseUrl, 'alice', 'secret')
    expect(r.ok).toBe(true)
  })

  it('status=failed：返 reason 错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockJsonRes({ status: 'failed', reason: '账号或密码错误' })))
    const r = await login(baseUrl, 'alice', 'wrong')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('账号或密码错误')
  })
})

describe('getBug — v0.4.0 走 /api.php/v2/bugs/{id} + 嵌套 shape 解析', () => {
  beforeEach(() => {
    // 让 ensureToken 不真去 login：先 mock 一次 login 填 cache，再换 fetch mock
    vi.stubGlobal('fetch', vi.fn(async () =>
      mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'alice', realname: '爱丽丝' } })
    ))
  })

  it('URL 走 v2 路径', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      return mockJsonRes({ status: 'success', bug: { id: 9999, status: 'active', deleted: false } })
    }))
    const r = await getBug(env, 9999)
    expect(r.ok).toBe(true)
    expect(calls.some(u => u.includes('/api.php/v2/bugs/9999'))).toBe(true)
  })

  it('v2 嵌套 shape：从 body.bug 解析字段', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      return mockJsonRes({
        status: 'success',
        bug: {
          id: 9999, status: 'resolved', subStatus: 'fixing',
          resolution: 'fixed', resolvedBy: 'bob', lastEditedDate: '2026-05-22 09:00:00',
          deleted: '0'
        }
      })
    }))
    const r = await getBug(env, 9999)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.id).toBe(9999)
      expect(r.data.status).toBe('resolved')
      expect(r.data.subStatus).toBe('fixing')
      expect(r.data.resolution).toBe('fixed')
      expect(r.data.resolvedBy).toBe('bob')
      expect(r.data.deleted).toBe(false)
    }
  })

  it('v1 平铺兜底 shape：禅道实例若仍返平铺，也能解析（兼容性）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      // 没 body.bug 包装，平铺
      return mockJsonRes({ id: 7777, status: 'closed', deleted: '1', closedBy: 'carol' })
    }))
    const r = await getBug(env, 7777)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.id).toBe(7777)
      expect(r.data.status).toBe('closed')
      expect(r.data.deleted).toBe(true)
      expect(r.data.closedBy).toBe('carol')
    }
  })

  it('404：返 bug 不存在错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      return new Response('', { status: 404 })
    }))
    const r = await getBug(env, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('bug 不存在或已彻底删除')
  })

  it('assignedTo 是对象（{account, realname}）：解析 account + realname', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      return mockJsonRes({
        status: 'success',
        bug: { id: 1, status: 'active', deleted: false, assignedTo: { account: 'dave', realname: '大卫' } }
      })
    }))
    const r = await getBug(env, 1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.assignedTo).toBe('dave')
      expect(r.data.assignedToName).toBe('大卫')
    }
  })

  it('v0.4.3 fallback · v2 schema 不识别 → v1 平铺拿到', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v2/bugs/5555')) {
        // v2 schema 异常：不返 bug 也不返平铺 id
        return mockJsonRes({ status: 'success', data: { weirdShape: true } })
      }
      if (url.includes('/api.php/v1/bugs/5555')) {
        return mockJsonRes({ id: 5555, status: 'resolved', resolution: 'fixed', deleted: '0' })
      }
      return mockJsonRes({})
    }))
    const r = await getBug(env, 5555)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.id).toBe(5555)
      expect(r.data.status).toBe('resolved')
      expect(r.data.resolution).toBe('fixed')
    }
    expect(calls.some(u => u.includes('/api.php/v1/bugs/5555'))).toBe(true)
  })

  it('v0.4.3 fallback · v2 + v1 都不识别 → 报「都不识别」', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v2/bugs/')) {
        return mockJsonRes({ status: 'success' })
      }
      if (url.includes('/api.php/v1/bugs/')) {
        return mockJsonRes({ noIdField: true })
      }
      return mockJsonRes({})
    }))
    const r = await getBug(env, 3333)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('都不识别')
  })
})

describe('discoverProduct — v0.4.0 走 /api.php/v2/projects/{pid} 取 products 首条', () => {
  it('URL 走 v2 路径 + 平铺响应 products 是 number[]', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      return mockJsonRes({ id: 26, products: [14, 15] })
    }))
    const r = await discoverProduct(env)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe(14)
    expect(calls.some(u => u.includes('/api.php/v2/projects/26'))).toBe(true)
  })

  it('嵌套 shape {status, project:{...}}：从 project.products 取', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      return mockJsonRes({ status: 'success', project: { id: 26, products: [{ id: 21 }, { id: 22 }] } })
    }))
    const r = await discoverProduct(env)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe(21)
  })

  it('products 是对象数组 [{id, name}]：取首条的 id', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      return mockJsonRes({ id: 26, products: [{ id: 33, name: '产品 A' }] })
    }))
    const r = await discoverProduct(env)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe(33)
  })

  it('v0.4.3 fallback · v2 空 products → 退 v1 拿到', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v2/projects/26')) {
        return mockJsonRes({ id: 26, products: [] })
      }
      if (url.includes('/api.php/v1/products?project=26')) {
        return mockJsonRes({ products: [{ id: 77, name: '产品 fallback' }] })
      }
      return mockJsonRes({})
    }))
    const r = await discoverProduct(env)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe(77)
    expect(calls.some(u => u.includes('/api.php/v1/products?project=26'))).toBe(true)
  })

  it('v0.4.3 fallback · v2 缺 products 字段 → 退 v1 拿到', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v2/projects/26')) {
        return mockJsonRes({ id: 26 })
      }
      if (url.includes('/api.php/v1/products?project=26')) {
        return mockJsonRes({ products: [{ id: 88, name: 'p' }] })
      }
      return mockJsonRes({})
    }))
    const r = await discoverProduct(env)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe(88)
  })

  it('v0.4.3 fallback · v2 缺 + v1 也空 → 报「未关联」', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v2/projects/26')) {
        return mockJsonRes({ id: 26, products: [] })
      }
      if (url.includes('/api.php/v1/products?project=26')) {
        return mockJsonRes({ products: [] })
      }
      return mockJsonRes({})
    }))
    const r = await discoverProduct(env)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('未关联任何 product')
  })

  it('项目不存在（404）：返 projectId 错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      return new Response('', { status: 404 })
    }))
    const r = await discoverProduct(env)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('26 不存在')
  })

  it('24h 缓存命中：第二次调用不再 fetch /v2/projects', async () => {
    let projectCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v2/projects/26')) projectCalls++
      return mockJsonRes({ id: 26, products: [14] })
    }))
    const r1 = await discoverProduct(env)
    const r2 = await discoverProduct(env)
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(projectCalls).toBe(1)
  })
})

describe('listProjects/listUsers — v0.4.0 URL 走 v2 + 关键查询参数', () => {
  it('listProjects URL 含 browseType=all 防 v2 默认 undone 陷阱 + recPerPage 分页', async () => {
    const { listProjects } = await import('@/background/zentao/client')
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      capturedUrl = url
      return mockJsonRes({ projects: [] })
    }))
    await listProjects(env, 50)
    expect(capturedUrl).toContain('/api.php/v2/projects')
    expect(capturedUrl).toContain('browseType=all')
    expect(capturedUrl).toContain('recPerPage=50')
    expect(capturedUrl).toContain('pageID=1')
  })

  it('listUsers URL 走 v2 + recPerPage（不是 v1 的 limit）', async () => {
    const { listUsers } = await import('@/background/zentao/client')
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      // 老用例：用响应里有 users:[] 走 v2 成功路径（不进 fallback）
      if (url.includes('/api.php/v2/users')) {
        capturedUrl = url
        return mockJsonRes({ users: [] })
      }
      return mockJsonRes({})
    }))
    await listUsers(env, 200)
    expect(capturedUrl).toContain('/api.php/v2/users')
    expect(capturedUrl).toContain('recPerPage=200')
    expect(capturedUrl).not.toContain('limit=')
  })

  it('v0.4.3 fallback · listProjects v2 schema 不识别 → v1 拿到', async () => {
    const { listProjects } = await import('@/background/zentao/client')
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v2/projects')) {
        return mockJsonRes({ status: 'success', data: {} })
      }
      if (url.includes('/api.php/v1/projects')) {
        return mockJsonRes({ projects: [{ id: 1, name: 'P1', type: 'project', status: 'doing' }] })
      }
      return mockJsonRes({})
    }))
    const r = await listProjects(env, 50)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data[0].id).toBe(1)
    expect(calls.some(u => u.includes('/api.php/v1/projects?limit=50'))).toBe(true)
  })

  it('v0.4.3 fallback · listProjects v2 + v1 都不识别 → 错误', async () => {
    const { listProjects } = await import('@/background/zentao/client')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v2/projects')) return mockJsonRes({})
      if (url.includes('/api.php/v1/projects')) return mockJsonRes({ noProjects: true })
      return mockJsonRes({})
    }))
    const r = await listProjects(env, 50)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('都不识别')
  })

  it('v0.4.3 fallback · listUsers v2 schema 不识别 → v1 拿到', async () => {
    const { listUsers } = await import('@/background/zentao/client')
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v2/users')) {
        return mockJsonRes({ status: 'success', data: { wrongShape: 1 } })
      }
      if (url.includes('/api.php/v1/users')) {
        return mockJsonRes({ users: [{ id: 9, account: 'alice', realname: '爱丽丝', role: 'dev' }] })
      }
      return mockJsonRes({})
    }))
    const r = await listUsers(env, 200)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data[0].account).toBe('alice')
      expect(r.data[0].realname).toBe('爱丽丝')
    }
    expect(calls.some(u => u.includes('/api.php/v1/users?limit=200'))).toBe(true)
  })

  it('v0.4.3 fallback · listUsers v2 + v1 都不识别 → 错误', async () => {
    const { listUsers } = await import('@/background/zentao/client')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v2/users')) return mockJsonRes({})
      if (url.includes('/api.php/v1/users')) return mockJsonRes({ wrongShape: true })
      return mockJsonRes({})
    }))
    const r = await listUsers(env, 200)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('都不识别')
  })
})

describe('v2 鉴权失效非标响应 — 真禅道 实测 200 + {result:false, message:"登录已超时"}', () => {
  // 真实场景：真禅道实例 biz12 实测 v2 endpoint 未授权返 200 + {result:false, ...}
  // 不是标准 401。所有 v2 endpoint 必须检测这个 shape 触发 retry login。
  // mock 第一次返「token 失效」非标 → 第二次 login 后真实业务响应

  function makeAuthExpiredRes() {
    return new Response(
      JSON.stringify({ result: false, message: '登录已超时，请重新登入!' }),
      { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' } }
    )
  }

  it('ping：v2 鉴权失效 → 触发 retry login → 第二次拿到真实用户详情', async () => {
    const { ping } = await import('@/background/zentao/client')
    let loginCalls = 0
    let userDetailCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        loginCalls++
        return mockJsonRes({ status: 'success', token: 't' + loginCalls, user: { id: 99, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v2/users/99')) {
        userDetailCalls++
        if (userDetailCalls === 1) return makeAuthExpiredRes()  // 第一次：token 失效非标响应
        return mockJsonRes({ id: 99, account: 'a', realname: 'A 真名' })  // 第二次：成功
      }
      throw new Error(`unexpected ${url}`)
    }))
    const r = await ping(env)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.realname).toBe('A 真名')
    expect(loginCalls).toBe(2)  // 第一次 ensureToken / 第二次 retry
    expect(userDetailCalls).toBe(2)  // 第一次失效 / 第二次成功
  })

  it('discoverProduct：v2 鉴权失效 → 触发 retry login → 第二次拿到 products', async () => {
    let projectCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v2/projects/26')) {
        projectCalls++
        if (projectCalls === 1) return makeAuthExpiredRes()
        return mockJsonRes({ id: 26, products: [14] })
      }
      throw new Error(`unexpected ${url}`)
    }))
    const r = await discoverProduct(env)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe(14)
    expect(projectCalls).toBe(2)
  })

  it('getBug：v2 鉴权失效 → retry → 第二次拿到 bug', async () => {
    let bugCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v2/bugs/8888')) {
        bugCalls++
        if (bugCalls === 1) return makeAuthExpiredRes()
        return mockJsonRes({ status: 'success', bug: { id: 8888, status: 'active', deleted: false } })
      }
      throw new Error(`unexpected ${url}`)
    }))
    const r = await getBug(env, 8888)
    expect(r.ok).toBe(true)
    expect(bugCalls).toBe(2)
  })

  it('isV2AuthExpired 匹配关键词：登录已超时 / 请重新登入 / 请重新登录 / Unauthorized', async () => {
    // 反推测试：四种鉴权失效 message 都应触发 retry（通过 ping 间接验）
    const cases = [
      '登录已超时，请重新登入!',
      '请重新登录',
      'Unauthorized',
      'token expired'
    ]
    for (const msg of cases) {
      _clearZentaoCaches()
      vi.unstubAllGlobals()
      let userCalls = 0
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url.includes('/users/login')) {
          return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
        }
        if (url.includes('/api.php/v2/users/1')) {
          userCalls++
          if (userCalls === 1) return new Response(JSON.stringify({ result: false, message: msg }), { status: 200, headers: { 'content-type': 'text/html' } })
          return mockJsonRes({ id: 1, account: 'a', realname: 'A' })
        }
        throw new Error(`unexpected ${url}`)
      }))
      const { ping } = await import('@/background/zentao/client')
      const r = await ping(env)
      expect(r.ok, `should retry on message: ${msg}`).toBe(true)
      expect(userCalls).toBe(2)
    }
  })

  it('isV2AuthExpired 不误触发：result:false 但 message 不是鉴权词（业务错误） → 不 retry', async () => {
    // 反例：result:false 但 message 是「项目不存在」之类业务错 — 不应被当成 token 失效（不 retry）
    // v0.4.2 行为变更：解析失败 + token 有效 → fallback cached（login 拿到的 user）返成功，不报错
    let userCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v2/users/1')) {
        userCalls++
        return new Response(JSON.stringify({ result: false, message: '用户不存在' }), { status: 200, headers: { 'content-type': 'text/html' } })
      }
      throw new Error(`unexpected ${url}`)
    }))
    const { ping } = await import('@/background/zentao/client')
    const r = await ping(env)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.realname).toBe('A')  // cached 兜底
    expect(userCalls).toBe(1)  // 没 retry（只调一次）
  })

  it('v0.4.2 fix · v2 /users/{id} 响应缺 id/realname → fallback cached（不报「响应格式不对」）', async () => {
    // 起因：dogfood 时同事禅道 v2 /users/{id} 返非标 schema，旧版 strict abort 卡住测试连接
    let userCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v2/users/1')) {
        userCalls++
        // 模拟某些禅道实例：返空对象 / 不规范字段
        return mockJsonRes({ foo: 'bar' })
      }
      throw new Error(`unexpected ${url}`)
    }))
    const { ping } = await import('@/background/zentao/client')
    const r = await ping(env)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.id).toBe(1)
      expect(r.data.account).toBe('a')
      expect(r.data.realname).toBe('A')
    }
    expect(userCalls).toBe(1)
  })

  it('v0.4.2 · v2 /users/{id} 响应规范（含完整 id/account/realname） → 用响应数据 + 更新 cache', async () => {
    let userCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v2/users/1')) {
        userCalls++
        return mockJsonRes({ id: 1, account: 'a-new', realname: 'A-new' })  // 假设禅道侧改名
      }
      throw new Error(`unexpected ${url}`)
    }))
    const { ping } = await import('@/background/zentao/client')
    const r = await ping(env)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.realname).toBe('A-new')  // 用响应里的新名字
    }
  })
})

describe('listModules — v0.4.0 决策：单独保留 v1（v2 无 module 端点）', () => {
  it('URL 仍走 v1：禅道 v2 RESTful 没 Module 章节，强行下线丢功能，保留有据可查', async () => {
    const { listModules } = await import('@/background/zentao/client')
    let capturedUrl = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      capturedUrl = url
      return mockJsonRes({ modules: [] })
    }))
    await listModules(env, 14)
    expect(capturedUrl).toContain('/api.php/v1/modules')
    expect(capturedUrl).toContain('id=14')
    expect(capturedUrl).toContain('type=bug')
  })
})

describe('v0.6.2 dogfood — v1 endpoint 403 cookie cascade', () => {
  it('listModules: v1 撞 403 + cookie 重试 200 → cascade 成功', async () => {
    const { listModules } = await import('@/background/zentao/client')
    let attemptCount = 0
    let lastCredentials: RequestCredentials | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v1/modules')) {
        attemptCount++
        lastCredentials = init?.credentials
        // 第 1 次 omit 撞 403；第 2 次 include 返 200
        if (attemptCount === 1) return new Response('forbidden', { status: 403 })
        return mockJsonRes({ modules: [{ id: 9, name: 'M1', path: '/M1', parent: 0 }] })
      }
      return new Response('{}')
    }))
    const r = await listModules(env, 14)
    expect(attemptCount).toBe(2)
    expect(lastCredentials).toBe('include')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toHaveLength(1)
  })

  it('listModules: 两次都 403 → 返 r1 错误（不假成）', async () => {
    const { listModules } = await import('@/background/zentao/client')
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v1/modules')) {
        n++
        return new Response('forbidden', { status: 403 })
      }
      return new Response('{}')
    }))
    const r = await listModules(env, 14)
    expect(n).toBe(2)
    expect(r.ok).toBe(false)
  })

  it('listModules: 第 1 次 200 → 不走 cascade', async () => {
    const { listModules } = await import('@/background/zentao/client')
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) {
        return mockJsonRes({ status: 'success', token: 't', user: { id: 1, account: 'a', realname: 'A' } })
      }
      if (url.includes('/api.php/v1/modules')) {
        n++
        return mockJsonRes({ modules: [] })
      }
      return new Response('{}')
    }))
    await listModules(env, 14)
    expect(n).toBe(1)  // 不重试
  })
})
