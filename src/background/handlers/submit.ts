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
import { addHistoryEntry, markHistoryEntryQueued, upsertHistoryEntry } from '@/storage/history'
import { pushQueueItem, removeQueueItemsByHistoryId } from '@/background/retryQueue'
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
    const historyId = await writeFailureHistory(req, undefined, err)
    return { ok: false, error: err, historyId }
  }

  const adapter = getAdapter(project.kind)
  if (!adapter) {
    const err = `不支持的 adapter kind: ${project.kind}`
    const historyId = await writeFailureHistory(req, project, err)
    return { ok: false, error: err, historyId }
  }

  // 手动「重试 / 历史重提」：先移除旧失败对应的队列项。否则这次手动提交成功之后，
  // 定时重试还会把同一条再发一次 → 远端重复工单（队列项与本条 history 是同一 id）。
  const replaceId = typeof req.replacesHistoryId === 'string' && req.replacesHistoryId
    ? req.replacesHistoryId
    : undefined
  if (replaceId) {
    try { await removeQueueItemsByHistoryId(replaceId) } catch (e) {
      console.warn('[Moo] remove queued duplicate failed', e)
    }
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
    error: outcome.error,
    warnings: outcome.warnings
  }

  // entry 先建（id 在这里生成）：失败入队时把 entry.id 带进 queue item，
  // 重试成功后 doFlush 才能据此把这条 history 翻成成功（不带 = 永远显示失败）。
  // 手动重试沿用了原失败 entry 的 id → 原地更新，不新增重复行。
  const entry = buildHistoryEntry(req, project, outcome)
  if (replaceId) entry.id = replaceId
  result.historyId = entry.id

  // ① 先写 history、再入重试队列。反顺序（入队 → 写 history）在 SW 中途被回收时会留下
  // 一条引用「不存在的 entry id」的队列项：重试成功后回填无处可写，用户看不到任何记录，
  // 还会手动重提产生重复单。先落 history 的最坏情况只是「失败已记录、没进重试队列」，
  // 用户至少看得到、能手动重提。
  try {
    if (replaceId) {
      // 原地替换原失败记录（保留同一 id/位置），不新增第二条
      await upsertHistoryEntry(entry)
    } else {
      const writeRes = await addHistoryEntry(entry)
      if (writeRes.allDropped) {
        // storage 整体异常 —— 连本次新条都没存到本地。UI 必须告诉用户「服务端已收到
        // 但本地没记录」，否则下次去 History tab 找不到这条提交还以为是 bug。
        result.historyAllDropped = true
      } else if (writeRes.trimmed > 0) {
        // 旧历史被丢了 trimmed 条，新条已落地。UI 提示用户去清空一些项目腾空间。
        result.trimmedHistory = writeRes.trimmed
      }
    }
  } catch (e) {
    console.warn('[Moo] failed to save history', e)
  }

  // ② 失败入队：adapter 给 retryable 信号优先；否则按 HTTP 状态自决。
  // 默认 false，仅 retryable !== false + payload 可序列化时调 pushQueueItem 覆盖。
  if (!outcome.ok) {
    result.queued = false
    if (outcome.retryable !== false) {
      // 先 thumbnailize（zentao 路径 image 太大长期驻 storage）—— 跑 await 异步预处理
      const reqForRetry = project.kind === 'zentao' ? await preprocessZentaoForRetry(req) : req
      const payload = await adapter.serializeForRetry(reqForRetry, project)
      if (payload !== null) {
        const push = await pushQueueItem(payload, entry.id)
        result.queued = push.queued
        if (push.trimmed > 0) result.retryQueueTrimmed = push.trimmed
      }
    }
    // 真入队了才给 history 打「队列中」标（History / popup 早就读这个字段，之前没人写）。
    if (result.queued) {
      try { await markHistoryEntryQueued(entry.id) } catch (e) {
        console.warn('[Moo] failed to mark history queued', e)
      }
    }
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
    images: req.images,
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
      : (server?.endpoint ? deriveRemoteBase(server.endpoint) : undefined),
    // v0.7.6 P1-1：禅道 5 字段快照让 History 重提保持一致（dogfood「重提变回默认」修）
    zentaoType: req.zentaoType,
    zentaoSeverity: req.zentaoSeverity,
    zentaoPri: req.zentaoPri,
    zentaoAssignedTo: req.zentaoAssignedTo,
    zentaoModuleId: req.zentaoModuleId
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
): Promise<string> {
  const replaceId = typeof req.replacesHistoryId === 'string' && req.replacesHistoryId
    ? req.replacesHistoryId
    : undefined
  if (replaceId) {
    try { await removeQueueItemsByHistoryId(replaceId) } catch { /* best-effort */ }
  }
  const entry: BugHistoryEntry = {
    id: replaceId ?? crypto.randomUUID(),
    timestamp: Date.now(),
    projectId: req.projectId,
    projectName: project?.name ?? t('submit.project.deleted-placeholder'),
    serverId: req.serverId,
    serverName: t('submit.server.deleted-placeholder'),
    title: req.title,
    description: req.description,
    image: req.image,
    images: req.images,
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
    if (replaceId) await upsertHistoryEntry(entry)
    else await addHistoryEntry(entry)
  } catch (e) {
    console.warn('[Moo] writeFailureHistory failed', (e as Error).message)
  }
  void refreshBadge()
  return entry.id
}
