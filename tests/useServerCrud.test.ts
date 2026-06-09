import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useServerCrud } from '@/composables/useServerCrud'
import type { Project, BugServer } from '@/types/config'

/**
 * v0.5.3 P1 收尾：useServerCrud composable 单测。
 *
 * 覆盖：
 *   - addServer/removeServer (含 defaultServerId 自动接管)
 *   - header CRUD (key rename / val change / add / remove)
 *   - openTemplateEditor / onTemplateSave
 *   - activeProject 缺省时 noop
 */

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'test', matchPatterns: [],
  kind: 'webhook',
  servers: [],
  defaultServerId: '',
  capture: { storageKeys: [], requestBufferSize: 50 },
  redact: { bodyKeys: [], cookies: [], headers: [] },
  enabled: true,
  ...overrides
} as Project)

const confirmDialogMock = vi.fn()

function mount(project: Project | undefined, confirmReturn = true) {
  confirmDialogMock.mockReset()
  confirmDialogMock.mockResolvedValue(confirmReturn)
  const activeProject = ref<Project | undefined>(project)
  return {
    activeProject,
    crud: useServerCrud({ activeProject, confirmDialog: confirmDialogMock })
  }
}

describe('addServer', () => {
  it('happy path：push 一条 + 自动接管 defaultServerId', () => {
    const { activeProject, crud } = mount(makeProject({ servers: [] }))
    crud.addServer()
    expect(activeProject.value!.servers).toHaveLength(1)
    expect(activeProject.value!.defaultServerId).toBe(activeProject.value!.servers[0]!.id)
  })

  it('已有 defaultServerId → 不覆盖', () => {
    const { activeProject, crud } = mount(makeProject({
      servers: [{ id: 's-existing', name: 'old', endpoint: 'http://x', method: 'POST', headers: {}, payloadTemplate: '', imageFormat: 'inline', imageField: 'image' } as BugServer],
      defaultServerId: 's-existing'
    }))
    crud.addServer()
    expect(activeProject.value!.defaultServerId).toBe('s-existing')
  })

  it('activeProject undefined → noop', () => {
    const { crud, activeProject } = mount(undefined)
    crud.addServer()
    expect(activeProject.value).toBeUndefined()
  })
})

describe('removeServer', () => {
  const baseServer = (id: string, name = 'srv'): BugServer => ({
    id, name,
    endpoint: 'http://x', method: 'POST', headers: {},
    payloadTemplate: '', imageFormat: 'inline', imageField: 'image'
  })

  it('confirm 通过 → 删除', async () => {
    const { activeProject, crud } = mount(makeProject({
      servers: [baseServer('s1'), baseServer('s2')],
      defaultServerId: 's1'
    }))
    await crud.removeServer('s1')
    expect(activeProject.value!.servers).toHaveLength(1)
    expect(activeProject.value!.servers[0]!.id).toBe('s2')
  })

  it('删的是 defaultServerId → 接管到第一个剩下的', async () => {
    const { activeProject, crud } = mount(makeProject({
      servers: [baseServer('s1'), baseServer('s2')],
      defaultServerId: 's1'
    }))
    await crud.removeServer('s1')
    expect(activeProject.value!.defaultServerId).toBe('s2')
  })

  it('删完 servers 空 → defaultServerId 空串', async () => {
    const { activeProject, crud } = mount(makeProject({
      servers: [baseServer('s1')],
      defaultServerId: 's1'
    }))
    await crud.removeServer('s1')
    expect(activeProject.value!.defaultServerId).toBe('')
  })

  it('confirm 取消 → 不动', async () => {
    const { activeProject, crud } = mount(
      makeProject({ servers: [baseServer('s1')], defaultServerId: 's1' }),
      false
    )
    await crud.removeServer('s1')
    expect(activeProject.value!.servers).toHaveLength(1)
  })
})

describe('header CRUD', () => {
  const s = (): BugServer => ({
    id: 's', name: 'svr',
    endpoint: 'http://x', method: 'POST',
    headers: { Authorization: 'Bearer foo', 'X-Trace': 'abc' },
    payloadTemplate: '', imageFormat: 'inline', imageField: 'image'
  })

  it('onHeaderKeyChange 改 key → 删旧 + 加新', () => {
    const { crud } = mount(makeProject())
    const srv = s()
    crud.onHeaderKeyChange(srv, 0, 'X-Auth')
    expect(srv.headers.Authorization).toBeUndefined()
    expect(srv.headers['X-Auth']).toBe('Bearer foo')
  })

  it('onHeaderKeyChange 同名 → noop', () => {
    const { crud } = mount(makeProject())
    const srv = s()
    crud.onHeaderKeyChange(srv, 0, 'Authorization')
    expect(srv.headers.Authorization).toBe('Bearer foo')
  })

  // 改名撞已存在键 → 拒绝（防 delete old + 写 newKey 静默覆盖原 newKey 那条 → 两条塌成一条丢数据）
  it('onHeaderKeyChange 改名撞已存在键 → 拒绝，headers 不变（不塌成一条）', () => {
    const { crud } = mount(makeProject())
    const srv = { ...s(), headers: { Authorization: 'tokenA', 'Header-2': 'tokenB' } }
    // 把第二条 Header-2 改名成已存在的 Authorization → 应被拒
    const idx = Object.keys(srv.headers).indexOf('Header-2')
    crud.onHeaderKeyChange(srv, idx, 'Authorization')
    // Authorization 仍是 tokenA（没被 tokenB 覆盖）
    expect(srv.headers.Authorization).toBe('tokenA')
    // Header-2 还在（没被删）
    expect(srv.headers['Header-2']).toBe('tokenB')
    expect(Object.keys(srv.headers)).toHaveLength(2)
  })

  it('onHeaderKeyChange 改成不撞的新键 → 正常生效', () => {
    const { crud } = mount(makeProject())
    const srv = { ...s(), headers: { Authorization: 'tokenA', 'Header-2': 'tokenB' } as Record<string, string> }
    const idx = Object.keys(srv.headers).indexOf('Header-2')
    crud.onHeaderKeyChange(srv, idx, 'X-New')
    expect(srv.headers['Header-2']).toBeUndefined()
    expect(srv.headers['X-New']).toBe('tokenB')
    expect(srv.headers.Authorization).toBe('tokenA')
  })

  it('onHeaderValChange → 只动 value', () => {
    const { crud } = mount(makeProject())
    const srv = s()
    crud.onHeaderValChange(srv, 0, 'Bearer new')
    expect(srv.headers.Authorization).toBe('Bearer new')
  })

  it('addHeader → 加 Header-1 / Header-2 递增 key', () => {
    const { crud } = mount(makeProject())
    const srv = { ...s(), headers: {} as Record<string, string> }
    crud.addHeader(srv)
    expect(srv.headers['Header-1']).toBe('')
    crud.addHeader(srv)
    expect(srv.headers['Header-2']).toBe('')
  })

  it('removeHeader → delete key', () => {
    const { crud } = mount(makeProject())
    const srv = s()
    crud.removeHeader(srv, 'Authorization')
    expect(srv.headers.Authorization).toBeUndefined()
    expect(srv.headers['X-Trace']).toBe('abc')
  })
})

describe('template editor', () => {
  it('openTemplateEditor → editingTemplate 设值', () => {
    const { crud } = mount(makeProject())
    const srv: BugServer = {
      id: 's', name: 'svr', endpoint: '', method: 'POST', headers: {},
      payloadTemplate: 'old', imageFormat: 'inline', imageField: 'image'
    }
    crud.openTemplateEditor(srv)
    expect(crud.editingTemplate.value?.server.id).toBe('s')
    expect(crud.editingTemplate.value?.server.payloadTemplate).toBe('old')
  })

  it('onTemplateSave → mutate server.payloadTemplate + 清 editingTemplate', () => {
    const { crud } = mount(makeProject())
    const srv: BugServer = {
      id: 's', name: 'svr', endpoint: '', method: 'POST', headers: {},
      payloadTemplate: 'old', imageFormat: 'inline', imageField: 'image'
    }
    crud.openTemplateEditor(srv)
    crud.onTemplateSave('new template')
    expect(srv.payloadTemplate).toBe('new template')
    expect(crud.editingTemplate.value).toBeNull()
  })

  it('onTemplateSave 无 editingTemplate → noop', () => {
    const { crud } = mount(makeProject())
    crud.onTemplateSave('whatever')
    expect(crud.editingTemplate.value).toBeNull()
  })
})
