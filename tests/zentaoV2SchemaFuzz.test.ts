import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  discoverProduct,
  listProjects,
  listUsers,
  getBug,
  ping,
  _clearZentaoCaches,
  type ZentaoEnv
} from '@/background/zentao/client'

/**
 * Tier 1A · v2 schema fuzz 表驱动测试（v0.4.3 后立项）。
 *
 * 痛点：v0.4.0 hard 切 v2 后连炸 3 次（ping/discoverProduct/+ 3 endpoint 加固），
 * 失败模式都一样：**真禅道实例 v2 返 200 但 schema 跟 dogfood 假设不同**。
 *
 * 这个测试不预测 schema 长啥样，而是穷举「8 种常见异常 schema」，
 * 验证「任何变体下代码都 degrade 优雅」(fallback v1 / fallback cached)。
 *
 * 8 种变体 × 5 个 v2 endpoint = 40 个用例。
 * 每加新 v2 endpoint 必须加进来跑一遍。
 *
 * 见 CLAUDE.md「禅道 v2 API 改造硬规则」+ [[feedback_zentao_v2_dual_track_rule]]
 */

const env: ZentaoEnv = {
  baseUrl: 'https://z.example.com',
  account: 'alice',
  password: 'secret',
  projectId: 26,
  moduleId: 0
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function rawRes(text: string, status = 200, contentType = 'text/html'): Response {
  return new Response(text, { status, headers: { 'content-type': contentType } })
}

const loginRes = () => jsonRes({
  status: 'success',
  token: 't',
  user: { id: 42, account: 'alice', realname: '爱丽丝' }
})

/**
 * 8 种 v2 异常 schema 变体（都是 HTTP 200，模拟「真禅道返 200 但 schema 异常」真实场景）。
 *
 * 不包含 401/404/5xx —— 那些是 HTTP 层错误，各 endpoint 单独处理。
 */
const FUZZ_VARIANTS: Array<{ name: string; res: () => Response }> = [
  { name: '空对象 {}', res: () => jsonRes({}) },
  { name: '只有外层 status', res: () => jsonRes({ status: 'success' }) },
  { name: '数据字段是 null', res: () => jsonRes({ products: null, projects: null, users: null, bug: null }) },
  { name: '数据字段是空对象 {}', res: () => jsonRes({ products: {}, projects: {}, users: {}, bug: {} }) },
  { name: '数据字段类型错（返字符串）', res: () => jsonRes({ products: 'wrong', projects: 'wrong', users: 'wrong' }) },
  { name: '字段名变体（包了 data 层）', res: () => jsonRes({ data: { products: [], projects: [], users: [] } }) },
  { name: '业务 result:false 非 auth message', res: () => jsonRes({ result: false, message: '某业务错误' }) },
  { name: 'HTML 错误页（200 但非 JSON）', res: () => rawRes('<html><body>error</body></html>', 200) }
]

beforeEach(() => {
  _clearZentaoCaches()
  vi.unstubAllGlobals()
})

describe('v2 schema fuzz · discoverProduct（v2 异常 → fallback v1 拿到）', () => {
  it.each(FUZZ_VARIANTS)('$name → fallback v1 拿到 productId', async (variant) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) return loginRes()
      if (url.includes('/api.php/v2/projects/26')) return variant.res()
      if (url.includes('/api.php/v1/products?project=26')) {
        return jsonRes({ products: [{ id: 99, name: 'fallback' }] })
      }
      return jsonRes({})
    }))
    const r = await discoverProduct(env)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe(99)
  })
})

describe('v2 schema fuzz · listProjects（v2 异常 → fallback v1 拿到）', () => {
  it.each(FUZZ_VARIANTS)('$name → fallback v1 拿到列表', async (variant) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) return loginRes()
      if (url.includes('/api.php/v2/projects?')) return variant.res()
      if (url.includes('/api.php/v1/projects?')) {
        return jsonRes({ projects: [{ id: 1, name: 'P1', type: 'project', status: 'doing' }] })
      }
      return jsonRes({})
    }))
    const r = await listProjects(env, 50)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toHaveLength(1)
  })
})

describe('v2 schema fuzz · listUsers（v2 异常 → fallback v1 拿到）', () => {
  it.each(FUZZ_VARIANTS)('$name → fallback v1 拿到列表', async (variant) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) return loginRes()
      if (url.includes('/api.php/v2/users?')) return variant.res()
      if (url.includes('/api.php/v1/users?')) {
        return jsonRes({ users: [{ id: 9, account: 'a', realname: 'A' }] })
      }
      return jsonRes({})
    }))
    const r = await listUsers(env, 200)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toHaveLength(1)
  })
})

describe('v2 schema fuzz · getBug（v2 异常 → fallback v1 拿到）', () => {
  it.each(FUZZ_VARIANTS)('$name → fallback v1 平铺拿到', async (variant) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) return loginRes()
      if (url.includes('/api.php/v2/bugs/9999')) return variant.res()
      if (url.includes('/api.php/v1/bugs/9999')) {
        return jsonRes({ id: 9999, status: 'active', deleted: '0' })
      }
      return jsonRes({})
    }))
    const r = await getBug(env, 9999)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.id).toBe(9999)
  })
})

describe('v2 schema fuzz · ping（v2 异常 → fallback cached profile）', () => {
  it.each(FUZZ_VARIANTS)('$name → fallback cached（不报 token 失效）', async (variant) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) return loginRes()
      if (url.includes('/api.php/v2/users/42')) return variant.res()
      return jsonRes({})
    }))
    const r = await ping(env)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.account).toBe('alice')
      expect(r.data.realname).toBe('爱丽丝')
    }
  })
})
