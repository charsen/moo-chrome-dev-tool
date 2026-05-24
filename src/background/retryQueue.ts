// ============================================================
// 重试队列
// ------------------------------------------------------------
// 5xx / 网络错的 JSON 提交进队列，alarm 周期 + SW spin-up 触发 flush 重发。
//
// v0.2.0 起队列拓展成 discriminated union：
//   kind='webhook'：v0.1.x 原有 fetch 重试（endpoint + method + headers + bodyString）
//   kind='zentao' ：禅道 multipart 提交重试（projectId + 完整 SubmitBugReq，flush 时
//                  重新走 submitToZentao 拼 multipart fetch；这是绕开「multipart 没法直接
//                  stringify 入 storage」的唯一办法）
//
// 老 storage 里没有 kind 字段：normalize 时默认 'webhook'，所有 v0.1.x 字段直接 match。
//
// 关键约束（违反会导致用户数据丢失）：
//
// 1. flushRetryQueue 必须有 inflight 锁。MV3 SW 一次唤醒会同时收到
//    onStartup / alarm / message / bottom-IIFE 几路触发，若并发跑两份 flush，
//    两份都读到同一份队列、各自 fetch、最后 set(remaining) 互相覆盖，
//    成功条会被另一份的旧 remaining 复活回来。
// 2. enqueueRetry 必须返回真实入队结果（multipart / >1MB / quota 抛错都返 false），
//    caller 才能据此决定 toast 是不是说"已加入重试"。
// 3. 单条 body 上限 1MB（zentao item 用 estimateZentaoSize 估）—— chrome.storage.local
//    总配额 10MB，视频 base64 单条就能 17MB+，整个队列直接爆配额；提前在 enqueue 拦掉。
// ============================================================

import type { SubmitBugReq } from '@/types/messages'
import type { Project } from '@/types/config'
import { submitToZentao } from '@/background/zentao/submit'
import { dataUrlToBlob } from '@/utils/dataUrl'
import { thumbnailize } from '@/utils/image'
import { loadConfig } from '@/storage/config'

const RETRY_QUEUE_KEY = 'mooRetryQueue'

/** 单条 body 上限 1MB —— 见上方文件注释 */
const RETRY_MAX_BODY_BYTES = 1_000_000
/** 队列最长 50 条，超出 FIFO 裁旧 */
const RETRY_MAX_QUEUE_LEN = 50
/** 单条最多重试 5 次，超过丢弃（持续 5xx 一般是服务端永久故障） */
export const RETRY_MAX_ATTEMPTS = 5

interface QueuedBase {
  enqueuedAt: number
  attempts: number
  /** 上次尝试的 HTTP 状态（zentao 路径下：成功 = 不入队；4xx-token-related = 不入队；5xx/网络错 = 入此字段） */
  lastStatus?: number
  /** 上次失败原因摘要 */
  lastError?: string
}

export interface QueuedWebhook extends QueuedBase {
  kind: 'webhook'
  endpoint: string
  method: string
  headers: Record<string, string>
  /** 只支持 JSON 字符串体重试。multipart 含二进制图片不易序列化，故不入队（zentao 走 kind='zentao' 分支）。 */
  bodyString: string
}

export interface QueuedZentao extends QueuedBase {
  kind: 'zentao'
  projectId: string
  /** 完整 SubmitBugReq 反序列化后 flush 重跑 submitToZentao 拼 multipart 即可 */
  req: SubmitBugReq
}

export type QueuedItem = QueuedWebhook | QueuedZentao

/** 兼容老代码 alias：v0.1.x 只有 webhook 一种 */
export type QueuedRequest = QueuedWebhook

/**
 * 老 storage 里的 entry 没有 kind 字段（v0.1.x）。读出来时若无 kind 字段，
 * 默认按 'webhook' 处理。enqueue 写入永远带 kind，所以这步只对历史 storage 生效。
 */
function normalizeQueueItem(raw: unknown): QueuedItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<QueuedZentao> & Partial<QueuedWebhook>
  if (r.kind === 'zentao') {
    if (!r.projectId || !r.req || typeof r.enqueuedAt !== 'number') return null
    return {
      kind: 'zentao',
      enqueuedAt: r.enqueuedAt,
      attempts: r.attempts ?? 0,
      projectId: r.projectId,
      req: r.req,
      lastStatus: r.lastStatus,
      lastError: r.lastError
    }
  }
  // 默认或 kind='webhook'：兼容 v0.1.x 老条目（无 kind）
  if (typeof r.endpoint !== 'string' || typeof r.bodyString !== 'string' || typeof r.enqueuedAt !== 'number') return null
  return {
    kind: 'webhook',
    enqueuedAt: r.enqueuedAt,
    attempts: r.attempts ?? 0,
    endpoint: r.endpoint,
    method: r.method ?? 'POST',
    headers: r.headers ?? {},
    bodyString: r.bodyString,
    lastStatus: r.lastStatus,
    lastError: r.lastError
  }
}

/** 读队列；storage 异常**会往上抛**（让 doFlush 的 inflight 锁能被 finally 清掉）。 */
async function readQueue(): Promise<QueuedItem[]> {
  const r = await globalThis.chrome.storage.local.get(RETRY_QUEUE_KEY)
  const raw = r[RETRY_QUEUE_KEY]
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeQueueItem).filter((x): x is QueuedItem => x !== null)
}

/**
 * 把一条 webhook 失败请求入队。
 * @returns 是否真的入队（caller 用来决定 toast 文案要不要提"已加入重试"）
 */
export async function enqueueRetry(
  endpoint: string,
  method: string,
  headers: Record<string, string>,
  body: BodyInit
): Promise<boolean> {
  if (typeof body !== 'string') return false // multipart 不重试
  if (body.length > RETRY_MAX_BODY_BYTES) return false // 太大不入队
  const item: QueuedWebhook = {
    kind: 'webhook',
    enqueuedAt: Date.now(),
    attempts: 0,
    endpoint,
    method,
    headers,
    bodyString: body
  }
  return pushItem(item)
}

/**
 * 把一条 zentao 失败提交入队。flush 时调 submitToZentao 重跑 multipart fetch。
 *
 * 1MB 阈值用估算（SubmitBugReq 序列化后字符长度）来卡 —— 带 video 的请求几乎肯定超，
 * 跟 webhook multipart 不入队保持一致行为：用户得自己去 历史 Tab 手动重提。
 */
export async function enqueueZentaoRetry(projectId: string, req: SubmitBugReq): Promise<boolean> {
  // v0.4.8：入队前 thumbnailize image（之前禅道路径直接存 1080p PNG 800KB-1.5MB 长期驻留 storage）。
  // 跟 webhook 路径（history.ts）保持一致，重试时拿缩略图重提没问题（用户看到的也是缩略图）
  const reqForQueue: SubmitBugReq = req.image
    ? { ...req, image: await thumbnailize(req.image) }
    : req
  const estimatedSize = estimateZentaoSize(reqForQueue)
  if (estimatedSize > RETRY_MAX_BODY_BYTES) return false
  const item: QueuedZentao = {
    kind: 'zentao',
    enqueuedAt: Date.now(),
    attempts: 0,
    projectId,
    req: reqForQueue
  }
  return pushItem(item)
}

function estimateZentaoSize(req: SubmitBugReq): number {
  // image / video 是 base64 字符串，length 已经接近字节数（base64 约 4/3 倍原始）
  let n = (req.image?.length ?? 0)
    + (req.video?.dataUrl.length ?? 0)
    + (req.description?.length ?? 0)
    + (req.title?.length ?? 0)
  // requests / errors JSON 序列化估算（大致）
  if (req.requests?.length) n += JSON.stringify(req.requests).length
  if (req.errors?.length) n += JSON.stringify(req.errors).length
  return n
}

async function pushItem(item: QueuedItem): Promise<boolean> {
  try {
    // pushItem 是写路径，storage 读失败也按"无现存队列"处理（兜底 []），
    // 让用户的新失败仍能进队。get 异常时给个空数组兜，不让 enqueue 整体失败。
    let list: QueuedItem[] = []
    try { list = await readQueue() } catch { list = [] }
    list.push(item)
    while (list.length > RETRY_MAX_QUEUE_LEN) list.shift()
    await globalThis.chrome.storage.local.set({ [RETRY_QUEUE_KEY]: list })
    return true
  } catch (e) {
    console.warn('[Moo] enqueueRetry storage set failed', (e as Error).message)
    return false
  }
}

/**
 * inflight 锁：SW spin-up 时 onStartup / 底部 IIFE / 紧跟着的 alarm 可能并发触发
 * flush。无锁的话两份并发都读到同一份队列，各自 fetch 完写 remaining 时互相
 * 覆盖，成功重试可能被另一份覆盖回原状。
 */
let flushPromise: Promise<number> | null = null

/**
 * v0.4.5：flushPromise 是 SW 内存锁，SW 30s 回收后锁丢但 inflight fetch 在 keep-alive 期间已发出。
 * 下次 spin-up 立即 flush 时若上次 fetch 还没返回，**同一条 retry 发两次**（特别是禅道 multipart
 * 重发会产生重复 bug 单）。加 storage 级 ≤30s hard cooldown 兜底。
 */
const FLUSH_COOLDOWN_KEY = 'mooLastFlushAt'
// v0.5.0：从 30s 抬到 90s — 禅道 multipart 上传可能 60s+，30s cooldown 不够覆盖
// 跨 SW 重启窗口期：老 fetch 还没回，新 SW 已读 mooLastFlushAt ≥30s 放行 → 重复发 bug 单
const FLUSH_COOLDOWN_MS = 90_000

async function shouldSkipForCooldown(): Promise<boolean> {
  // 不吞 storage 错 —— storage 坏了让 caller 知道（跟 readQueue 一致语义）
  const { [FLUSH_COOLDOWN_KEY]: last } = await chrome.storage.local.get(FLUSH_COOLDOWN_KEY)
  return typeof last === 'number' && Date.now() - last < FLUSH_COOLDOWN_MS
}

async function markFlushStart(): Promise<void> {
  await chrome.storage.local.set({ [FLUSH_COOLDOWN_KEY]: Date.now() })
}

export async function flushRetryQueue(): Promise<number> {
  if (flushPromise) return flushPromise
  // v0.4.5：同步设置 flushPromise 避免 shouldSkipForCooldown await 期间第二个 caller 漏进。
  // 把 cooldown check + markFlushStart + doFlush 都放进同一个 Promise 里原子化。
  flushPromise = (async () => {
    if (await shouldSkipForCooldown()) {
      console.log('[Moo] flushRetryQueue 跳过：30s cooldown 内（防 SW 回收后重发重复条）')
      return 0
    }
    await markFlushStart()
    return doFlush()
  })().finally(() => { flushPromise = null })
  return flushPromise
}

/**
 * 单条重试结果：
 *   'ok'   成功，从队列移除
 *   'drop' 永久放弃（4xx / 认证持久失败 / project 被删 / kind 切换）
 *   object keep 在队列里 attempts++，写 lastStatus / lastError
 */
type RetryOutcome = 'ok' | 'drop' | { status?: number; error: string }

async function doFlush(): Promise<number> {
  const list = await readQueue()
  if (list.length === 0) return 0
  const remaining: QueuedItem[] = []
  let processed = 0
  // zentao 路径要 loadConfig 才能拿到 project；只在确实有 zentao 条目时 load
  let configCache: Awaited<ReturnType<typeof loadConfig>> | null = null
  const getConfig = async () => configCache ?? (configCache = await loadConfig())

  for (const q of list) {
    if (q.attempts >= RETRY_MAX_ATTEMPTS) continue
    const res: RetryOutcome = q.kind === 'webhook'
      ? await retryWebhook(q)
      : await retryZentao(q, await getConfig())
    if (res === 'ok') { processed++; continue }
    if (res === 'drop') continue
    q.attempts++
    q.lastStatus = res.status
    q.lastError = res.error
    remaining.push(q)
  }
  await globalThis.chrome.storage.local.set({ [RETRY_QUEUE_KEY]: remaining })
  return processed
}

async function retryWebhook(q: QueuedWebhook): Promise<RetryOutcome> {
  try {
    const resp = await fetch(q.endpoint, { method: q.method, headers: q.headers, body: q.bodyString })
    if (resp.ok) return 'ok'
    if (resp.status >= 400 && resp.status < 500) return 'drop'
    return { status: resp.status, error: resp.statusText || `HTTP ${resp.status}` }
  } catch (e) {
    return { status: undefined, error: (e as Error)?.message || '网络错误' }
  }
}

async function retryZentao(q: QueuedZentao, config: { projects: Project[] }): Promise<RetryOutcome> {
  const project = config.projects.find(p => p.id === q.projectId)
  if (!project) return 'drop' // project 被删 / 改了 id
  if (project.kind !== 'zentao') return 'drop' // 项目切回 webhook 了
  const res = await submitToZentao(q.req, project, dataUrlToBlob, {
    mooVersion: globalThis.chrome.runtime?.getManifest?.()?.version
  })
  if (res.ok) return 'ok'
  // v0.4.7：扩展 drop 覆盖所有「永久失败」分类，避免无意义重试 5x
  // 漏过的会被 ⚠️5/5 ⚠️ 暂存浪费队列槽位；都是 deterministic 配置/服务侧问题，重试同样 payload 同样结果
  if (isPermanentFailure(res.error ?? '')) return 'drop'
  return { error: res.error ?? '未知错误' }
}

/** v0.4.7：判断错误是否「永久失败」（重试无意义，drop）。
 *  v0.4.6 之前正则只覆盖 5 类，漏掉 product/项目/WAF/schema/认证持续/bug 不存在 → 重试 5x 浪费。 */
// v0.5.0：导出给单测直接测全部 keyword（之前只有「登录失败」一个 keyword 有回归）
export function isPermanentFailure(error: string): boolean {
  // v0.4.8 加 3 类禅道 schema/cookie 永久错（agent 第 5 波 review 发现）：
  //   - 「返非 JSON」/「未返响应体」(client.ts schema 错)
  //   - 「缺 user.realname」(login 成功但响应不完整)
  return /登录失败|缺少必填|未授权|Unauthorized|缺禅道配置|未关联.*product|WAF 拦截|认证持续失败|响应都不识别|项目.*不存在|bug 不存在|返非 JSON|未返响应体|缺 user/.test(error)
}

/** 只读统计 API：storage 读失败按"空队列"返回，不该把 storage 异常往上抛打断 UI 渲染。 */
export async function getQueueLength(): Promise<number> {
  try { return (await readQueue()).length } catch { return 0 }
}

export async function getQueueItems(): Promise<QueuedItem[]> {
  try { return await readQueue() } catch { return [] }
}

/**
 * 按 enqueuedAt 时间戳删单条。
 * Date.now() 在 SW 单线程同毫秒并发概率近 0，足够当唯一 id 用。
 */
export async function removeQueueItem(enqueuedAt: number): Promise<boolean> {
  try {
    const list = await readQueue()
    const next = list.filter((q) => q.enqueuedAt !== enqueuedAt)
    if (next.length === list.length) return false
    await globalThis.chrome.storage.local.set({ [RETRY_QUEUE_KEY]: next })
    return true
  } catch {
    return false
  }
}

export async function clearQueue(): Promise<void> {
  await globalThis.chrome.storage.local.set({ [RETRY_QUEUE_KEY]: [] })
}

// 测试用：重置 inflight 锁（生产代码不要 import）
export function __resetForTest(): void {
  flushPromise = null
}
