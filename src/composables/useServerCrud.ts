/**
 * Environment.vue webhook 项目下「上报服务器」CRUD + headers map 编辑 + payload 模板编辑器
 * 状态集合 composable。
 *
 * v0.5.3 P1（task #127）拆分第 2 步：把 90 行 server/header/template CRUD 从 Environment.vue
 * 抽出来。不动 template，让 .vue 主体专注布局。
 *
 * 调用方传入 activeProjectRef + confirmDialog。composable 提供：
 *   - server: addServer / removeServer
 *   - header: headerEntries / onHeaderKeyChange / onHeaderValChange / addHeader / removeHeader
 *   - 大模板 modal: editingTemplate / openTemplateEditor / onTemplateSave
 */

import { ref, type Ref } from 'vue'
import { createDefaultServer, type BugServer, type Project } from '@/types/config'

export interface UseServerCrudParams {
  activeProject: Ref<Project | undefined>
  confirmDialog(opts: { title: string; message: string; danger?: boolean; confirmText?: string }): Promise<boolean>
}

export function useServerCrud(params: UseServerCrudParams) {
  /** 大尺寸 payload 模板编辑器：记住当前在编哪个 server 的模板 */
  const editingTemplate = ref<{ server: BugServer } | null>(null)

  function openTemplateEditor(server: BugServer): void {
    editingTemplate.value = { server }
  }

  function onTemplateSave(value: string): void {
    if (editingTemplate.value) {
      editingTemplate.value.server.payloadTemplate = value
    }
    editingTemplate.value = null
  }

  function addServer(): void {
    if (!params.activeProject.value) return
    const s = createDefaultServer(`服务器 ${params.activeProject.value.servers.length + 1}`)
    params.activeProject.value.servers.push(s)
    if (!params.activeProject.value.defaultServerId) {
      params.activeProject.value.defaultServerId = s.id
    }
  }

  async function removeServer(id: string): Promise<void> {
    if (!params.activeProject.value) return
    const srv = params.activeProject.value.servers.find((s) => s.id === id)
    const ok = await params.confirmDialog({
      title: `删除服务器「${srv?.name || '(未命名)'}」？`,
      message: '这台服务器的所有配置（请求 URL / 请求头 / Payload 模板）会被删除，0.8 秒后自动保存。\n如果是当前项目的唯一服务器，删完后这个项目暂时无法上报。',
      danger: true,
      confirmText: '确认删除'
    })
    if (!ok) return
    params.activeProject.value.servers = params.activeProject.value.servers.filter((s) => s.id !== id)
    if (params.activeProject.value.defaultServerId === id) {
      params.activeProject.value.defaultServerId = params.activeProject.value.servers[0]?.id ?? ''
    }
  }

  // ── headers map 编辑（v-for 渲染 entries）─────────────────────

  function headerEntries(s: BugServer): [string, string][] {
    return Object.entries(s.headers)
  }

  function onHeaderKeyChange(s: BugServer, idx: number, newKey: string): void {
    const entry = Object.entries(s.headers)[idx]
    if (!entry) return
    const [oldKey, val] = entry
    if (oldKey === newKey) return
    delete s.headers[oldKey]
    s.headers[newKey] = val
  }

  function onHeaderValChange(s: BugServer, idx: number, newVal: string): void {
    const entry = Object.entries(s.headers)[idx]
    if (!entry) return
    s.headers[entry[0]] = newVal
  }

  function addHeader(s: BugServer): void {
    let i = 1
    while (`Header-${i}` in s.headers) i++
    s.headers[`Header-${i}`] = ''
  }

  function removeHeader(s: BugServer, key: string): void {
    delete s.headers[key]
  }

  return {
    editingTemplate,
    openTemplateEditor,
    onTemplateSave,
    addServer,
    removeServer,
    headerEntries,
    onHeaderKeyChange,
    onHeaderValChange,
    addHeader,
    removeHeader
  }
}
