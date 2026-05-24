import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

/**
 * v0.5.3 P1 收尾：useZentaoEnvironment composable 单测。
 *
 * 覆盖核心路径：
 *   - canCall 跟着凭证字段变（baseUrl/account/password 三必填）
 *   - testConnection 走 safeSendMessage 拿 realname / error
 *   - loadProjects 拿 projects 列表 / 失败兜底
 *   - 切 activeProjectId 时 reset status / projectsList
 *   - 凭证字段变化触发 ZENTAO_CLEAR_CACHE 消息
 */

// vi.mock 必须在 top-level（不能在 beforeEach 内 — 模块解析时机问题）
vi.mock('@/utils/messaging', () => ({
  safeSendMessage: vi.fn()
}))

import { useZentaoEnvironment } from '@/composables/useZentaoEnvironment'
import { safeSendMessage } from '@/utils/messaging'
import { MSG } from '@/types/messages'

const mockedSendMessage = vi.mocked(safeSendMessage)

beforeEach(() => {
  mockedSendMessage.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

function makeZentaoRef(overrides: Partial<{ baseUrl: string; account: string; password: string; projectId: number; moduleId: number }> = {}) {
  return ref({
    baseUrl: 'https://z.example.com',
    account: 'alice',
    password: 'pwd',
    projectId: 1,
    moduleId: 0,
    ...overrides
  })
}

describe('canCall', () => {
  it('三必填齐全 → true', () => {
    const env = useZentaoEnvironment({
      zentao: makeZentaoRef(),
      activeProjectId: ref('p1'),
      activeKind: ref('zentao')
    })
    expect(env.canCall.value).toBe(true)
  })

  it('缺 password → false', () => {
    const env = useZentaoEnvironment({
      zentao: makeZentaoRef({ password: '' }),
      activeProjectId: ref('p1'),
      activeKind: ref('zentao')
    })
    expect(env.canCall.value).toBe(false)
  })

  it('zentao undefined → false', () => {
    const env = useZentaoEnvironment({
      zentao: ref(undefined),
      activeProjectId: ref('p1'),
      activeKind: ref('webhook')
    })
    expect(env.canCall.value).toBe(false)
  })
})

describe('testConnection', () => {
  it('happy path：拿到 realname → status ok', async () => {
    mockedSendMessage.mockResolvedValue({ ok: true, realname: '爱丽丝', account: 'alice' })
    const env = useZentaoEnvironment({
      zentao: makeZentaoRef(),
      activeProjectId: ref('p1'),
      activeKind: ref('zentao')
    })
    await env.testConnection()
    expect(env.status.value).toContain('爱丽丝')
    expect(env.statusKind.value).toBe('ok')
    expect(env.busy.value).toBe('')
  })

  it('safeSendMessage 返 {ok:false,error} → status err', async () => {
    mockedSendMessage.mockResolvedValue({ ok: false, error: '账号或密码错误' })
    const env = useZentaoEnvironment({
      zentao: makeZentaoRef(),
      activeProjectId: ref('p1'),
      activeKind: ref('zentao')
    })
    await env.testConnection()
    expect(env.status.value).toContain('账号或密码错误')
    expect(env.statusKind.value).toBe('err')
  })

  it('safeSendMessage throw → status err + finally 释放 busy', async () => {
    mockedSendMessage.mockRejectedValue(new Error('网络中断'))
    const env = useZentaoEnvironment({
      zentao: makeZentaoRef(),
      activeProjectId: ref('p1'),
      activeKind: ref('zentao')
    })
    await env.testConnection()
    expect(env.status.value).toContain('网络中断')
    expect(env.busy.value).toBe('')
  })

  it('zentao undefined → 早返不调 safeSendMessage', async () => {
    const env = useZentaoEnvironment({
      zentao: ref(undefined),
      activeProjectId: ref('p1'),
      activeKind: ref('webhook')
    })
    await env.testConnection()
    expect(mockedSendMessage).not.toHaveBeenCalled()
  })
})

describe('loadProjects', () => {
  it('happy path：拿到 projects 数组', async () => {
    mockedSendMessage.mockResolvedValue({
      ok: true,
      projects: [
        { id: 1, name: 'P1', status: 'doing' },
        { id: 2, name: 'P2', status: 'closed' }
      ]
    })
    const env = useZentaoEnvironment({
      zentao: makeZentaoRef(),
      activeProjectId: ref('p1'),
      activeKind: ref('zentao')
    })
    await env.loadProjects()
    expect(env.projectsList.value).toHaveLength(2)
    expect(env.statusKind.value).toBe('ok')
    expect(env.status.value).toContain('2')
  })

  it('返 {ok:false} → projectsList 不变', async () => {
    mockedSendMessage.mockResolvedValue({ ok: false, error: '认证失败' })
    const env = useZentaoEnvironment({
      zentao: makeZentaoRef(),
      activeProjectId: ref('p1'),
      activeKind: ref('zentao')
    })
    await env.loadProjects()
    expect(env.projectsList.value).toEqual([])
    expect(env.statusKind.value).toBe('err')
  })
})

describe('watch 副作用', () => {
  it('activeProjectId 切换 → status / projectsList 重置', async () => {
    mockedSendMessage.mockResolvedValue({ ok: true, projects: [{ id: 1, name: 'P1', status: 'doing' }] })
    const activeProjectId = ref('p1')
    const env = useZentaoEnvironment({
      zentao: makeZentaoRef(),
      activeProjectId,
      activeKind: ref('zentao')
    })
    await env.loadProjects()
    expect(env.projectsList.value).toHaveLength(1)
    // 切项目
    activeProjectId.value = 'p2'
    await new Promise(r => setTimeout(r, 0)) // flush watch
    expect(env.projectsList.value).toEqual([])
    expect(env.status.value).toBe('')
  })

  it('password 变化 → 调 ZENTAO_CLEAR_CACHE', async () => {
    const zentao = makeZentaoRef()
    const env = useZentaoEnvironment({
      zentao,
      activeProjectId: ref('p1'),
      activeKind: ref('zentao')
    })
    // 触发 ref 变化让 watch fire
    void env
    mockedSendMessage.mockResolvedValue({ ok: true })
    zentao.value = { ...zentao.value, password: 'new-pwd' }
    await new Promise(r => setTimeout(r, 0))
    // 应该调过 ZENTAO_CLEAR_CACHE
    const clearCallCalls = mockedSendMessage.mock.calls.filter(
      (call) => (call[0] as { type?: string }).type === MSG.ZENTAO_CLEAR_CACHE
    )
    expect(clearCallCalls.length).toBeGreaterThan(0)
  })
})
