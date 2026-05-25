/**
 * SUBMIT_BUG 入口 —— 选 adapter → 调 adapter.submit → 写 history + 刷 badge + 入队。
 *
 * v0.5.2 P0 重构第 3 阶段：从 background/index.ts 抽出来。
 * v0.5.3 IssueAdapter 接入：业务逻辑（buildRequestBody / readPageStorage / submitToZentao）
 * 全部下放到 src/adapters/{webhook,zentao}Adapter.ts。本文件只剩 router 责任：
 *   - project 缺失 → writeFailureHistory + 早返
 *   - 按 project.kind 查 adapter
 *   - 调 adapter.submit 拿 outcome
 *   - 失败时 adapter.serializeForRetry → retryQueue.pushItem
 *   - 拼 history entry + 刷 badge
 *
 * 加新 adapter（github / jira）：本文件零改动；只在 src/adapters/index.ts 注册即可。
 */

import type { Project } from '@/types/config'
import type { BugHistoryEntry } from '@/types/history'
import type { SubmitBugReq, SubmitBugRes } from '@/types/messages'
import { loadConfig } from '@/storage/config'
import { addHistoryEntry } from '@/storage/history'
import { pushQueueItem } from '@/background/retryQueue'
import { getAdapter } from '@/adapters'
import { deriveRemoteBase } from '@/adapters/webhookAdapter'
import { preprocessZentaoForRetry } from '@/adapters/zentaoAdapter'
import { refreshBadge } from './badge'
import { hasHostPermission } from '@/utils/hostPermission'
import { t } from '@/i18n'

export async function handleSubmitBug(req: SubmitBugReq, tabId?: number): Promise<SubmitBugRes> {
  // v0.5.3 #128：host_permission 从 mandatory 改 optional 后，submit / fetch / readPageStorage
  // 都需要权限。没授权时不调 adapter，直接引导用户去 popup 启用。
  if (!await hasHostPermission()) {
    const err = t('host-permission.required')
    return { ok: false, error: err }
  }

  const config = await loadConfig()
  const project = config.projects.find((p) => p.id === req.projectId)
  if (!project) {
    const err = t('submit.project.not-found')
    await writeFailureHistory(req, undefined, err)
    return { ok: false, error: err }
  }

  const adapter = getAdapter(project.kind)
  if (!adapter) {
    const err = `不支持的 adapter kind: ${project.kind}`
    await writeFailureHistory(req, project, err)
    return { ok: false, error: err }
  }

  const mooVersion = chrome.runtime?.getManifest?.()?.version
  const outcome = await adapter.submit(req, project, { mooVersion, tabId })

  // 拼 SubmitBugRes：保持现行 caller（ContentApp / SubmitDialog）字段语义不变
  const result: SubmitBugRes = {
    ok: outcome.ok,
    status: outcome.status,
    body: outcome.body,
    remoteId: outcome.remoteId,
    viewUrl: outcome.viewUrl,
    error: outcome.error
  }

  // 失败时算 queued：adapter 给 retryable 信号优先；否则按 HTTP 状态自决。
  // 默认 false，仅 retryable !== false + payload 可序列化时调 pushQueueItem 覆盖
  if (!outcome.ok) {
    result.queued = false
    if (outcome.retryable !== false) {
      // 先 thumbnailize（zentao 路径 image 太大长期驻 storage）—— 跑 await 异步预处理
      const reqForRetry = project.kind === 'zentao' ? await preprocessZentaoForRetry(req) : req
      const payload = adapter.serializeForRetry(reqForRetry, project)
      if (payload !== null) result.queued = await pushQueueItem(payload)
    }
  }

  // 写 history（成功 + 失败都写）
  const entry = buildHistoryEntry(req, project, outcome)
  try {
    const writeRes = await addHistoryEntry(entry)
    if (writeRes.allDropped) {
      // storage 整体异常 —— 连本次新条都没存到本地。UI 必须告诉用户「服务端已收到
      // 但本地没记录」，否则下次去 History tab 找不到这条提交还以为是 bug。
      result.historyAllDropped = true
    } else if (writeRes.trimmed > 0) {
      // 旧历史被丢了 trimmed 条，新条已落地。UI 提示用户去清空一些项目腾空间。
      result.trimmedHistory = writeRes.trimmed
    }
  } catch (e) {
    console.warn('[Moo] failed to save history', e)
  }

  // 提交成功/失败都刷一次 badge：成功条让 24h 内的失败计数不动，但读 history
  // 也顺手处理掉「老 entry 超出 24h 窗口要从 badge 里减掉」的衰减
  void refreshBadge()

  return result
}

function buildHistoryEntry(req: SubmitBugReq, project: Project, outcome: { ok: boolean; status?: number; body?: string; error?: string; remoteId?: string }): BugHistoryEntry {
  // server 字段：zentao 没 server 概念用占位串；webhook 取 req.serverId 对应 server
  const server = project.kind === 'webhook' ? project.servers.find(s => s.id === req.serverId) : undefined
  const isZentao = project.kind === 'zentao'

  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    projectId: project.id,
    projectName: project.name,
    serverId: isZentao ? 'zentao' : (server?.id ?? req.serverId),
    serverName: isZentao
      ? `禅道（${project.zentao?.baseUrl ?? ''}）`
      : (server?.name ?? t('submit.server.deleted-placeholder')),
    title: req.title,
    description: req.description,
    image: req.image,
    hasVideo: !!req.video,
    videoDuration: req.video?.duration ?? 0,
    url: req.url,
    userAgent: req.userAgent,
    viewport: req.viewport,
    requests: req.requests,
    errors: req.errors,
    result: outcome.ok
      ? { ok: true, status: outcome.status ?? 200, body: outcome.body ?? '' }
      : { ok: false, error: outcome.error },
    remoteId: outcome.remoteId,
    remoteBase: isZentao
      ? project.zentao?.baseUrl
      : (server?.endpoint ? deriveRemoteBase(server.endpoint) : undefined)
  }
}

/**
 * project 缺失或不识别 adapter 时仍把本次"尝试"落到 history，让用户知道发生过提交。
 * 不然出现「我刚提交了一条 bug 怎么 History 完全没痕迹」的体验黑洞。
 */
async function writeFailureHistory(
  req: SubmitBugReq,
  project: Project | undefined,
  errorMsg: string
): Promise<void> {
  const entry: BugHistoryEntry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    projectId: req.projectId,
    projectName: project?.name ?? t('submit.project.deleted-placeholder'),
    serverId: req.serverId,
    serverName: t('submit.server.deleted-placeholder'),
    title: req.title,
    description: req.description,
    image: req.image,
    hasVideo: !!req.video,
    videoDuration: req.video?.duration ?? 0,
    url: req.url,
    userAgent: req.userAgent,
    viewport: req.viewport,
    requests: req.requests,
    errors: req.errors,
    result: { ok: false, error: errorMsg },
    remoteBase: undefined
  }
  try {
    await addHistoryEntry(entry)
  } catch (e) {
    console.warn('[Moo] writeFailureHistory failed', (e as Error).message)
  }
  void refreshBadge()
}
