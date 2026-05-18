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
    remoteBase: typeof e.remoteBase === 'string' ? e.remoteBase : undefined
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
  const shrunk: BugHistoryEntry = entry.image
    ? { ...entry, image: await thumbnailize(entry.image) }
    : entry
  const list = await read()
  list.unshift(shrunk)
  if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES
  return write(list)
}

export async function listHistory(): Promise<BugHistoryEntry[]> {
  return read()
}

export async function removeHistory(id: string): Promise<void> {
  const list = await read()
  await write(list.filter((e) => e.id !== id))
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ [KEY]: [] })
}

export async function updateHistoryEntry(id: string, entry: BugHistoryEntry): Promise<void> {
  const list = await read()
  const idx = list.findIndex((e) => e.id === id)
  if (idx < 0) return
  list[idx] = entry
  await write(list)
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
