import type { BugHistoryEntry } from '@/types/history'
import { thumbnailize } from '@/utils/image'

const KEY = 'mooHistory'
const MAX_ENTRIES = 30

/**
 * 把任何形态的 raw 数据归一化成合法 BugHistoryEntry，缺字段都给兜底默认值。
 *
 * 起因：v0.1.6 撞过一次 `e.requests.length` crash —— 老版本 / 异常路径
 * 写入的 entry 可能缺关键字段，History.vue 模板里直接访问就炸。光兜底
 * requests/errors 不够（紧接着会撞 e.result.ok、e.title.toLowerCase）；
 * 统一在 read 边界做完整 normalize，让所有 read 出来的 entry 都是合法
 * BugHistoryEntry，下游 .vue 模板完全不必担心 shape。
 */
function normalizeHistoryEntry(raw: unknown): BugHistoryEntry {
  const e = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  const str = (v: unknown, fb = ''): string => typeof v === 'string' ? v : fb
  const num = (v: unknown, fb = 0): number => typeof v === 'number' && isFinite(v) ? v : fb
  const bool = (v: unknown, fb = false): boolean => typeof v === 'boolean' ? v : fb
  const arr = <T>(v: unknown): T[] => Array.isArray(v) ? v as T[] : []
  // 禅道 severity/pri 是 1|2|3|4 枚举：非这四个值（含 undefined / 越界 / 非数字）一律归 undefined
  const oneToFour = (v: unknown): 1 | 2 | 3 | 4 | undefined =>
    (v === 1 || v === 2 || v === 3 || v === 4) ? v : undefined
  const result = (e.result && typeof e.result === 'object') ? e.result as Record<string, unknown> : {}

  return {
    id: str(e.id) || crypto.randomUUID(),
    timestamp: num(e.timestamp, Date.now()),
    projectId: str(e.projectId),
    projectName: str(e.projectName, '(未知项目)'),
    serverId: str(e.serverId),
    serverName: str(e.serverName, '(未知服务器)'),
    title: str(e.title, '(无标题)'),
    description: str(e.description),
    image: str(e.image),
    // v0.8.10 多图必须读回 —— normalizer 漏列 = read 时静默剥光（v0.8.7 禅道 5 字段同款教训）
    images: Array.isArray(e.images)
      ? (e.images as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined,
    hasVideo: bool(e.hasVideo),
    videoDuration: num(e.videoDuration),
    url: str(e.url),
    userAgent: str(e.userAgent),
    viewport: str(e.viewport),
    requests: arr(e.requests),
    errors: arr(e.errors),
    result: {
      ok: bool(result.ok),
      status: typeof result.status === 'number' ? result.status : undefined,
      body: typeof result.body === 'string' ? result.body : undefined,
      error: typeof result.error === 'string' ? result.error : undefined,
      queued: typeof result.queued === 'boolean' ? result.queued : undefined
    },
    remoteId: typeof e.remoteId === 'string' ? e.remoteId : undefined,
    remoteStatus: typeof e.remoteStatus === 'string'
      ? e.remoteStatus as BugHistoryEntry['remoteStatus']
      : undefined,
    remoteStatusUpdatedAt: typeof e.remoteStatusUpdatedAt === 'string'
      ? e.remoteStatusUpdatedAt
      : undefined,
    remoteBase: typeof e.remoteBase === 'string' ? e.remoteBase : undefined,
    // 禅道快照 5 字段必须在 read 边界保留 —— 漏了的话 listHistory()→read() 每次 map 都把它们
    // 剥光：History.vue「重提」读到 undefined（丢用户当初选的 类型/严重/优先级/指派人/模块，
    // 回落默认值），且状态回查 updateHistoryEntry 写回会把磁盘上的也永久抹掉。v0.7.6 P1-1
    // 当初补了 写(submit)+类型+读(History.vue) 三端，唯独漏了这个 normalizer，等于没修。
    zentaoType: typeof e.zentaoType === 'string' ? e.zentaoType : undefined,
    zentaoSeverity: oneToFour(e.zentaoSeverity),
    zentaoPri: oneToFour(e.zentaoPri),
    zentaoAssignedTo: typeof e.zentaoAssignedTo === 'string' ? e.zentaoAssignedTo : undefined,
    zentaoModuleId: typeof e.zentaoModuleId === 'number' && isFinite(e.zentaoModuleId)
      ? e.zentaoModuleId
      : undefined
  }
}

async function read(): Promise<BugHistoryEntry[]> {
  const r = await chrome.storage.local.get(KEY)
  const list = r[KEY]
  if (!Array.isArray(list)) return []
  return list.map(normalizeHistoryEntry)
}

/**
 * write() 结果：
 * - trimmed:    因 quota 不够被丢掉的最旧条数（0 表示一切顺利）
 * - allDropped: 连空数组都写不进去（storage 整体异常），调用方应该告诉用户
 *               「本次没保存到本地，但服务端已收到」而不是假装成功
 */
interface WriteResult {
  trimmed: number
  allDropped: boolean
}

async function write(list: BugHistoryEntry[]): Promise<WriteResult> {
  // 写入失败（一般是配额超出）时，**逐条**丢最旧的（list[0] 是最新，pop 末尾 = 最旧）。
  // 之前的做法是二分丢一半 + 兜底清空，单次配额触顶可能直接掉掉一大半历史。
  let attempt = list.slice()
  const initialLen = attempt.length
  while (attempt.length > 0) {
    try {
      await chrome.storage.local.set({ [KEY]: attempt })
      return { trimmed: initialLen - attempt.length, allDropped: false }
    } catch {
      attempt.pop()
    }
  }
  // 空数组也写不进去，说明 storage 整体异常。调用方知道之后才能给用户真实
  // 反馈（不要再 toast「提交成功」+「丢了 N 条」，那时连新条也丢了）。
  try {
    await chrome.storage.local.set({ [KEY]: [] })
  } catch {
    // storage 完全锁死，无能为力。仍然 return allDropped=true 让调用方决定。
  }
  return { trimmed: initialLen, allDropped: true }
}

export async function addHistoryEntry(entry: BugHistoryEntry): Promise<WriteResult> {
  // 入库前把截图压成缩略图。原始全分辨率早就 POST 给后端了，本地只为
  // 用户回顾用，没必要存 800KB 的 PNG base64 —— 否则 30 条历史轻松爆
  // chrome.storage.local 10MB 配额（实测能存的只有 5-8 条）。
  let shrunk: BugHistoryEntry = entry.image
    ? { ...entry, image: await thumbnailize(entry.image) }
    : entry
  // v0.8.10 多图同样逐张缩略 —— 5 张全分辨率 PNG dataUrl 轻松爆 10MB 配额
  if (entry.images?.length) {
    shrunk = { ...shrunk, images: await Promise.all(entry.images.map((i) => thumbnailize(i))) }
  }
  // v0.4.9：包 withWriteMutex（v0.4.8 修了 remove/clear/update 漏了 add）→ 防 tab A 提交时
  // tab B 删 entry，A 的 snapshot 写回让 X 复活。v0.4.7 4 个月 bug 路径之一仍开
  return withWriteMutex(async () => {
    const list = await read()
    list.unshift(shrunk)
    // v0.7.6：cap-trim 也算 trimmed（general-purpose 11 审 P2）— 之前只有 quota
    // 失败路径设 trimmed，正常 30 条满后丢老的用户看不到。调用方据此决定是否提示
    const beforeCap = list.length
    if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES
    const capTrimmed = beforeCap - list.length
    const result = await write(list)
    return { ...result, trimmed: result.trimmed + capTrimmed }
  })
}

export async function listHistory(): Promise<BugHistoryEntry[]> {
  return read()
}

// v0.4.8：read→modify→write 加 mutex 防多窗口并发 last-write-wins 让已删 entry 复活。
// 同款思路：retryQueue 的 flushPromise inflight 锁。
let writeMutex: Promise<unknown> = Promise.resolve()
function withWriteMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeMutex.then(fn, fn)
  writeMutex = next.catch(() => {})
  return next
}

export async function removeHistory(id: string): Promise<void> {
  await withWriteMutex(async () => {
    const list = await read()
    await write(list.filter((e) => e.id !== id))
  })
}

export async function clearHistory(): Promise<void> {
  await withWriteMutex(async () => {
    await chrome.storage.local.set({ [KEY]: [] })
  })
}

/**
 * retry 队列重试成功后把首次失败写的 entry 翻成成功（result.ok=true + 回填 remoteId）。
 * 不提供这步的话：History 永远显示「失败」、红 badge 24h 不消、用户看着「失败」手动
 * 重提 → 远端产生重复 bug 单（重试其实已经建过一条）。entry 已被删 / 找不到则静默跳过。
 */
export async function markHistoryEntryRetrySuccess(id: string, remoteId?: string): Promise<void> {
  await withWriteMutex(async () => {
    const list = await read()
    const idx = list.findIndex((e) => e.id === id)
    const old = idx >= 0 ? list[idx] : undefined
    if (!old) return
    list[idx] = {
      ...old,
      result: { ok: true, status: old.result.status, body: old.result.body },
      remoteId: remoteId ?? old.remoteId
    }
    await write(list)
  })
}

export async function updateHistoryEntry(id: string, entry: BugHistoryEntry): Promise<void> {
  await withWriteMutex(async () => {
    const list = await read()
    const idx = list.findIndex((e) => e.id === id)
    if (idx < 0) return
    list[idx] = entry
    await write(list)
  })
}

export function onHistoryChanged(handler: () => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName
  ) => {
    if (area === 'local' && changes[KEY]) handler()
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
