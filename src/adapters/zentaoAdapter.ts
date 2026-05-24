/**
 * zentao adapter — v0.2.0 起的禅道集成路径。
 *
 * 实装 IssueAdapter<'zentao'>。adapter 主要责任：
 *   - submit: 委托 submitToZentao（业务编排在 src/background/zentao/submit.ts）
 *   - fetchStatus: 调 zentaoGetBug + mapZentaoStatus
 *   - serializeForRetry: 入队带完整 SubmitBugReq + projectId（multipart 没法 stringify）
 *   - retryFromPayload: 复用 submitToZentao + 永久失败分类（drop 认证错 / 项目不存在等）
 *
 * 跟 webhookAdapter 对比：
 *   - 不读 page storage（禅道 submit 不走模板，business context 由 submitToZentao 内部组）
 *   - 入队 payload 是 SubmitBugReq 而非 bodyString
 *   - retry 时跑完整 multipart 上传链路（用户感知重复 bug 单的风险）
 */

import type {
  IssueAdapter,
  AdapterSubmitOutcome,
  AdapterRetryPayload,
  AdapterRetryOutcome,
  AdapterStatus
} from './IssueAdapter'
import type { SubmitBugReq } from '@/types/messages'
import { getBug as zentaoGetBug, type ZentaoEnv } from '@/background/zentao/client'
import { mapZentaoStatus } from '@/background/zentaoStatus'
import { submitToZentao } from '@/background/zentao/submit'
import { dataUrlToBlob } from '@/utils/dataUrl'
import { thumbnailize } from '@/utils/image'

/**
 * zentao retry payload 形态：完整 SubmitBugReq + projectId。
 * 入队前 image 走 thumbnailize 压一次（800KB-1.5MB 原图长期驻 storage 太占空间）。
 */
export interface ZentaoRetryPayload {
  kind: 'zentao'
  projectId: string
  req: SubmitBugReq
}

/** retry 单条 body 上限 1MB（zentao item 用 estimateZentaoSize 估）*/
const RETRY_MAX_BODY_BYTES = 1_000_000

export const zentaoAdapter: IssueAdapter<'zentao'> = {
  kind: 'zentao',

  async submit(req, project, ctx): Promise<AdapterSubmitOutcome> {
    const res = await submitToZentao(req, project, dataUrlToBlob, { mooVersion: ctx.mooVersion })
    return {
      ok: res.ok,
      remoteId: res.remoteId,
      status: res.ok ? 200 : undefined,
      body: res.viewUrl,
      viewUrl: res.viewUrl,
      error: res.error,
      // 不显式给 retryable —— 让 router/retryQueue 按现行 estimateZentaoSize 兜底
      retryable: undefined
    }
  },

  async fetchStatus(project, remoteId, _ctx): Promise<AdapterStatus | undefined> {
    const z = project.zentao
    if (!z?.baseUrl || !z.account || !z.password) return undefined
    const bugId = Number(remoteId)
    if (!Number.isFinite(bugId) || bugId <= 0) return undefined
    const env: ZentaoEnv = {
      baseUrl: z.baseUrl, account: z.account, password: z.password,
      projectId: z.projectId, moduleId: z.moduleId
    }
    const r = await zentaoGetBug(env, bugId)
    if (!r.ok) return undefined
    return mapZentaoStatus(r.data)
  },

  serializeForRetry(req, project): AdapterRetryPayload | null {
    // 入队前 thumbnailize image（之前直接存 1080p PNG 800KB-1.5MB 长期驻 storage）
    // serialize 是 sync 签名但 image 处理是 async — 直接返 SubmitBugReq 让 caller 自己异步处理
    // （为保持 interface sync，这里同步只做估算判断；真 thumbnailize 在 router 调用前完成）
    const estimatedSize = estimateZentaoSize(req)
    if (estimatedSize > RETRY_MAX_BODY_BYTES) return null
    return {
      kind: 'zentao',
      projectId: project.id,
      req
    }
  },

  async retryFromPayload(payload, project): Promise<AdapterRetryOutcome> {
    const q = payload as ZentaoRetryPayload
    if (q.kind !== 'zentao') {
      return { kind: 'drop', reason: 'zentao adapter 收到非 zentao payload' }
    }
    if (!project) {
      return { kind: 'drop', reason: 'project 已被删除' }
    }
    if (project.kind !== 'zentao') {
      return { kind: 'drop', reason: 'project kind 已切换' }
    }
    const res = await submitToZentao(q.req, project, dataUrlToBlob, {
      mooVersion: globalThis.chrome.runtime?.getManifest?.()?.version
    })
    if (res.ok) return { kind: 'ok' }
    if (isPermanentFailure(res.error ?? '')) {
      return { kind: 'drop', reason: res.error ?? '永久失败' }
    }
    return { kind: 'keep', error: res.error ?? '未知错误' }
  }
}

/**
 * 让 router 入队前 await 一次 thumbnailize —— adapter interface 是 sync，
 * 异步预处理由 router 调，结果再传给 serializeForRetry。
 */
export async function preprocessZentaoForRetry(req: SubmitBugReq): Promise<SubmitBugReq> {
  return req.image ? { ...req, image: await thumbnailize(req.image) } : req
}

function estimateZentaoSize(req: SubmitBugReq): number {
  // image / video 是 base64 字符串，length 已经接近字节数（base64 约 4/3 倍原始）
  let n = (req.image?.length ?? 0)
    + (req.video?.dataUrl.length ?? 0)
    + (req.description?.length ?? 0)
    + (req.title?.length ?? 0)
  if (req.requests?.length) n += JSON.stringify(req.requests).length
  if (req.errors?.length) n += JSON.stringify(req.errors).length
  return n
}

/** 判断错误是否「永久失败」（重试无意义，drop）。复刻 retryQueue.ts:isPermanentFailure */
export function isPermanentFailure(error: string): boolean {
  return /登录失败|缺少必填|未授权|Unauthorized|缺禅道配置|未关联.*product|WAF 拦截|认证持续失败|响应都不识别|项目.*不存在|bug 不存在|返非 JSON|未返响应体|缺 user/.test(error)
}
