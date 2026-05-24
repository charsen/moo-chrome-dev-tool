import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ping,
  discoverProduct,
  listProjects,
  listUsers,
  getBug,
  _clearZentaoCaches,
  type ZentaoEnv
} from '@/background/zentao/client'

/**
 * Tier 2 · 真实禅道实例 fixture 回放测试。
 *
 * Tier 1 fuzz 是「假设异常 schema」防御性测试。
 * Tier 2 是「真实异常 schema」实例方差证据。
 *
 * 工作流：
 *   1. 同事在他公司禅道实例跑 scripts/dump-zentao-fixtures.sh（10 分钟）
 *   2. 把 raw/ 目录 zip 给 Charsen
 *   3. Charsen 跑 scripts/anonymize-fixtures.mjs 脱敏入 tests/fixtures/zentao-real/anon/
 *   4. 本测试自动加载所有 anon/ 下的 fixture 集跑一遍
 *
 * Graceful skip：如果 anon/ 目录空（没 fixture），测试 skip 而不是 fail —— 这样 CI 在 fixture
 * 还没到位时也能 green。fixture 到位后才有「真实多实例方差」验证。
 *
 * 见 [[feedback_zentao_v2_dual_track_rule]]
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const ANON_DIR = resolve(__dirname, 'fixtures/zentao-real/anon')

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

function loadFixture(name: string): unknown | null {
  const path = resolve(ANON_DIR, name)
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch { return null }
}

function fixtureSetsAvailable(): string[] {
  // 支持以后扩展：anon/<instance-id>/*.json 多实例
  // 当前简化：直接看 anon/01-login.json 在不在；在就跑「单实例集」
  if (!existsSync(ANON_DIR)) return []
  try {
    const files = readdirSync(ANON_DIR)
    if (files.some(f => f === '01-login.json')) return ['default']
    return []
  } catch { return [] }
}

beforeEach(() => {
  _clearZentaoCaches()
  vi.unstubAllGlobals()
})

const sets = fixtureSetsAvailable()
const describer = sets.length > 0 ? describe : describe.skip

describer('Tier 2 · 真实禅道响应 fixture 回放（同事 curl dump 后入仓）', () => {
  const loginFixture = loadFixture('01-login.json')
  const userDetailFixture = loadFixture('02-user-detail.json')
  const projectDetailFixture = loadFixture('03-project-detail.json')
  const projectsListFixture = loadFixture('04-projects-list.json')
  const usersListFixture = loadFixture('05-users-list.json')
  const v1ProductsFixture = loadFixture('06-v1-products.json')

  it('login fixture 解析成功（有 token + user）', () => {
    expect(loginFixture).toBeTruthy()
    const f = loginFixture as { status?: string; token?: string; user?: { id?: number; account?: string; realname?: string } }
    expect(f.status === 'success' || !!f.token).toBeTruthy()
  })

  it('ping · 用真实 /v2/users/{id} fixture → 不报错', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) return jsonRes(loginFixture)
      if (url.match(/\/api\.php\/v2\/users\/\d+/)) return jsonRes(userDetailFixture)
      return jsonRes({})
    }))
    const r = await ping(env)
    // 不管真实响应 schema 长什么样，ping 必须返 ok（v0.4.2 fallback cached 保底）
    expect(r.ok).toBe(true)
  })

  it('discoverProduct · 用真实 /v2/projects/{id} fixture → 拿到 productId（v2 或 v1 fallback）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) return jsonRes(loginFixture)
      if (url.match(/\/api\.php\/v2\/projects\/\d+$/)) return jsonRes(projectDetailFixture)
      if (url.includes('/api.php/v1/products?project=')) return jsonRes(v1ProductsFixture)
      return jsonRes({})
    }))
    const r = await discoverProduct(env)
    // v2 fixture 解析成功 → 用 v2；不成功 → v1 fixture 兜
    // 任何一边能拿到都算成功（这正是双轨设计的目的）
    expect(r.ok).toBe(true)
    if (r.ok) expect(typeof r.data).toBe('number')
  })

  it('listProjects · 用真实 /v2/projects 列表 fixture → 拿到数组', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) return jsonRes(loginFixture)
      if (url.includes('/api.php/v2/projects?')) return jsonRes(projectsListFixture)
      if (url.includes('/api.php/v1/projects?')) {
        // 如果 v2 fixture 不识别就 fallback —— 这里给空数组让测试不依赖 v1 fixture
        return jsonRes({ projects: [] })
      }
      return jsonRes({})
    }))
    const r = await listProjects(env, 50)
    expect(r.ok).toBe(true)
  })

  it('listUsers · 用真实 /v2/users 列表 fixture → 拿到数组', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/users/login')) return jsonRes(loginFixture)
      if (url.includes('/api.php/v2/users?')) return jsonRes(usersListFixture)
      if (url.includes('/api.php/v1/users?')) return jsonRes({ users: [] })
      return jsonRes({})
    }))
    const r = await listUsers(env, 200)
    expect(r.ok).toBe(true)
  })

  it('schema dump 报告：每个 fixture 的顶层字段（人眼审查用）', () => {
    const dump = {
      login: loginFixture ? Object.keys(loginFixture as object) : null,
      userDetail: userDetailFixture ? Object.keys(userDetailFixture as object) : null,
      projectDetail: projectDetailFixture ? Object.keys(projectDetailFixture as object) : null,
      projectsList: projectsListFixture ? Object.keys(projectsListFixture as object) : null,
      usersList: usersListFixture ? Object.keys(usersListFixture as object) : null,
      v1Products: v1ProductsFixture ? Object.keys(v1ProductsFixture as object) : null
    }
    // 不断言具体值，只是把 schema 形状打印到测试输出，便于 review
    // 如果以后真实响应增加新字段，这里会自动 surface
    console.log('[Tier 2 fixture schema]', JSON.stringify(dump, null, 2))
    expect(dump).toBeTruthy()
  })
})

// fixture 未到位时的 placeholder（保证 vitest 至少跑一个 test，不报 「No tests found」）
if (sets.length === 0) {
  describe('Tier 2 · 真实 fixture 测试（待同事提供 fixture）', () => {
    it.skip('SKIP - 同事还没跑 scripts/dump-zentao-fixtures.sh，等 fixture 到位后此测试集自动激活', () => {})
  })
}
