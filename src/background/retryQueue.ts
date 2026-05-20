// ============================================================
// 重试队列
// ------------------------------------------------------------
// 5xx / 网络错的 JSON 提交进队列，alarm 周期 + SW spin-up 触发 flush 重发。
//
// 关键约束（违反会导致用户数据丢失）：
//
// 1. flushRetryQueue 必须有 inflight 锁。MV3 SW 一次唤醒会同时收到
//    onStartup / alarm / message / bottom-IIFE 几路触发，若并发跑两份 flush，
//    两份都读到同一份队列、各自 fetch、最后 set(remaining) 互相覆盖，
//    成功条会被另一份的旧 remaining 复活回来。
// 2. enqueueRetry 必须返回真实入队结果（multipart / >1MB / quota 抛错都返 false），
//    caller 才能据此决定 toast 是不是说"已加入重试"。
// 3. 单条 body 上限 1MB —— chrome.storage.local 总配额 10MB，视频 base64 单条
//    就能 17MB+，整个队列直接爆配额；提前在 enqueue 拦掉。
// ============================================================

const RETRY_QUEUE_KEY = 'mooRetryQueue'

/** 单条 body 上限 1MB —— 见上方文件注释 */
const RETRY_MAX_BODY_BYTES = 1_000_000
/** 队列最长 50 条，超出 FIFO 裁旧 */
const RETRY_MAX_QUEUE_LEN = 50
/** 单条最多重试 5 次，超过丢弃（持续 5xx 一般是服务端永久故障） */
const RETRY_MAX_ATTEMPTS = 5

export interface QueuedRequest {
  enqueuedAt: number
  attempts: number
  endpoint: string
  method: string
  headers: Record<string, string>
  /** 只支持 JSON 字符串体重试。multipart 含二进制图片不易序列化，故不入队。 */
  bodyString: string
}

/**
 * 把一条失败请求入队。
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
  const queued: QueuedRequest = {
    enqueuedAt: Date.now(),
    attempts: 0,
    endpoint,
    method,
    headers,
    bodyString: body
  }
  try {
    const r = await globalThis.chrome.storage.local.get(RETRY_QUEUE_KEY)
    const list = (r[RETRY_QUEUE_KEY] as QueuedRequest[] | undefined) ?? []
    list.push(queued)
    // FIFO 裁旧。while 而不是 if 是为了兼容老数据已经超 50 的迁移场景
    while (list.length > RETRY_MAX_QUEUE_LEN) list.shift()
    // 整体仍可能因为多条累计超配额而抛错（被外层 catch 兜住）
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
 *
 * 共享同一个 Promise 即可：第二个 caller 直接 await 在跑的那一个，拿到一样的
 * 结果。finally 清锁 —— throw 也清，避免一次失败永久卡死后续所有 flush。
 */
let flushPromise: Promise<number> | null = null

/**
 * 处理队列：4xx 丢、5xx attempts++、≥5 丢、网络错 attempts++。
 * @returns 本轮成功重试的条数
 */
export async function flushRetryQueue(): Promise<number> {
  if (flushPromise) return flushPromise
  flushPromise = doFlush().finally(() => { flushPromise = null })
  return flushPromise
}

async function doFlush(): Promise<number> {
  const r = await globalThis.chrome.storage.local.get(RETRY_QUEUE_KEY)
  const list = (r[RETRY_QUEUE_KEY] as QueuedRequest[] | undefined) ?? []
  if (list.length === 0) return 0
  const remaining: QueuedRequest[] = []
  let processed = 0
  for (const q of list) {
    if (q.attempts >= RETRY_MAX_ATTEMPTS) continue // 放弃
    try {
      const resp = await fetch(q.endpoint, {
        method: q.method,
        headers: q.headers,
        body: q.bodyString
      })
      if (resp.ok) {
        processed++
        continue
      }
      if (resp.status >= 400 && resp.status < 500) {
        // 4xx 是不会通过重试解决的，丢弃
        continue
      }
      q.attempts++
      remaining.push(q)
    } catch {
      q.attempts++
      remaining.push(q)
    }
  }
  await globalThis.chrome.storage.local.set({ [RETRY_QUEUE_KEY]: remaining })
  return processed
}

/**
 * 当前队列长度（只 peek，不修改）。
 *
 * 给 UI（Settings 存储面板）和 SW boot IIFE 用：让外部不必知道 storage key 也
 * 不必自行解析数组。storage 读失败按"空队列"返回 0——这是只读统计调用，
 * 不应该把 storage 异常往上抛打断 UI 渲染。
 */
export async function getQueueLength(): Promise<number> {
  try {
    const r = await globalThis.chrome.storage.local.get(RETRY_QUEUE_KEY)
    const list = r[RETRY_QUEUE_KEY] as QueuedRequest[] | undefined
    return Array.isArray(list) ? list.length : 0
  } catch {
    return 0
  }
}

/**
 * 清空队列。idempotent：已空也安全（直接写空数组覆盖）。
 *
 * 写空数组而不是 remove(key)：保持 storage shape 跟 enqueue 路径一致，
 * 避免 onChanged listener 看到 newValue: undefined 时分支判断更麻烦。
 */
export async function clearQueue(): Promise<void> {
  await globalThis.chrome.storage.local.set({ [RETRY_QUEUE_KEY]: [] })
}

// 测试用：重置 inflight 锁（生产代码不要 import）
export function __resetForTest(): void {
  flushPromise = null
}
