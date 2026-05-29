/**
 * Environment.vue 中禅道凭证操作集合 composable。
 *
 * v0.5.3 P1（task #127）拆分第一步：把 200 行 zentao 操作从 Environment.vue 抽出来。
 * 不动 template，只让 script 段从 1206 → ~1100 行；同时让逻辑可单测（mock safeSendMessage）。
 *
 * 调用方传入 currentZentao 引用（活的 .value，不是值快照），composable 内 watch 它做事：
 *   - 「测试连接」/「拉项目」按钮 → testZentaoConnection / loadZentaoProjects
 *   - 凭证字段变化 → 自动清 SW token cache（防 envKey 复用错身份）
 *   - kind / project 切换 → 重置 status / projectsList
 */

import { ref, computed, watch, type Ref } from 'vue'
import type { ZentaoProjectConfig } from '@/types/config'
import { MSG, type ZentaoCredsReq, type ZentaoTestConnectionRes, type ZentaoListProjectsRes } from '@/types/messages'
import { safeSendMessage } from '@/utils/messaging'

export interface UseZentaoEnvironmentParams {
  /** 当前活跃项目的 zentao 字段（可空 — webhook 项目时 undefined） */
  zentao: Ref<ZentaoProjectConfig | undefined>
  /** 当前 activeProjectId — 切项目时 reset status */
  activeProjectId: Ref<string | undefined>
  /** 当前 activeProject kind — webhook ↔ zentao 切换时 reset */
  activeKind: Ref<'webhook' | 'zentao' | undefined>
}

export function useZentaoEnvironment(params: UseZentaoEnvironmentParams) {
  /** 「测试连接」/「拉列表」期间禁用按钮，避免双发请求 */
  const busy = ref<'' | 'test' | 'list'>('')
  /** 「测试连接」/「拉列表」结果文字 */
  const status = ref('')
  const statusKind = ref<'ok' | 'err' | ''>('')
  /** 「📋 从禅道拉列表」结果 */
  const projectsList = ref<Array<{ id: number; name: string; status: string }>>([])

  /** 三个必填都有才允许调禅道 */
  const canCall = computed(() => {
    const z = params.zentao.value
    return !!(z && z.baseUrl && z.account && z.password)
  })

  /** 切项目 / kind 切回 webhook 时清空 status + projectsList（避免误显示上一个项目结果） */
  watch(
    () => [params.activeProjectId.value, params.activeKind.value] as const,
    () => {
      status.value = ''
      statusKind.value = ''
      projectsList.value = []
    }
  )

  /** v0.4.7：禅道凭证关键字段（baseUrl/account/password/projectId）变化时清 SW token cache。
   *  防 envKey=baseUrl::account 不变（仅改 password）时老 token 复用导致用错误身份提交。 */
  watch(
    () => {
      const z = params.zentao.value
      if (!z) return null
      return `${z.baseUrl}|${z.account}|${z.password}|${z.projectId}`
    },
    (next, prev) => {
      if (next && prev && next !== prev) {
        void safeSendMessage({ type: MSG.ZENTAO_CLEAR_CACHE, source: 'devtools' }, { fallback: { ok: false } })
      }
    }
  )

  function credsPayload(): ZentaoCredsReq | null {
    const z = params.zentao.value
    if (!z) return null
    return { baseUrl: z.baseUrl, account: z.account, password: z.password }
  }

  // testConnection / loadProjects 共享同一段生命周期样板：credsPayload 守卫 → busy/pending
  // 置位 → try/catch(网络错)/finally(清 busy)。把这段逐字相同的收口抽出来，ok/err 处理
  // 留在 body 内联（safeSendMessage 泛型返值在 if (res?.ok) 处自然收窄，不丢类型安全）。
  async function runZentaoAction(
    busyKind: 'test' | 'list',
    pendingText: string,
    body: (creds: ZentaoCredsReq) => Promise<void>
  ): Promise<void> {
    const creds = credsPayload()
    if (!creds) return
    busy.value = busyKind
    status.value = pendingText
    statusKind.value = ''
    try {
      await body(creds)
    } catch (e) {
      status.value = `✗ ${(e as Error).message}`
      statusKind.value = 'err'
    } finally {
      busy.value = ''
    }
  }

  function testConnection(): Promise<void> {
    return runZentaoAction('test', '测试中…', async (creds) => {
      const res = await safeSendMessage<ZentaoTestConnectionRes>({
        type: MSG.ZENTAO_TEST_CONNECTION,
        source: 'devtools',
        payload: creds
      })
      if (res?.ok) {
        status.value = `✓ 已登录为 ${res.realname ?? res.account ?? '未知用户'}`
        statusKind.value = 'ok'
      } else {
        status.value = `✗ ${res?.error ?? '未知错误'}`
        statusKind.value = 'err'
      }
    })
  }

  function loadProjects(): Promise<void> {
    return runZentaoAction('list', '拉项目列表中…', async (creds) => {
      const res = await safeSendMessage<ZentaoListProjectsRes>({
        type: MSG.ZENTAO_LIST_PROJECTS,
        source: 'devtools',
        payload: creds
      })
      if (res?.ok && res.projects) {
        projectsList.value = res.projects
        status.value = `✓ 拉到 ${res.projects.length} 个项目，从下面下拉选`
        statusKind.value = 'ok'
      } else {
        status.value = `✗ ${res?.error ?? '未知错误'}`
        statusKind.value = 'err'
      }
    })
  }

  return {
    busy,
    status,
    statusKind,
    projectsList,
    canCall,
    testConnection,
    loadProjects
  }
}
