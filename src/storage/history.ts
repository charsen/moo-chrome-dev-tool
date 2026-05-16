import type { BugHistoryEntry } from '@/types/history'

const KEY = 'mooHistory'
const MAX_ENTRIES = 30

async function read(): Promise<BugHistoryEntry[]> {
  const r = await chrome.storage.local.get(KEY)
  const list = r[KEY]
  return Array.isArray(list) ? list : []
}

/** write() 结果：trimmed = 因 quota 不够被丢掉的最旧条数（0 表示一切顺利） */
interface WriteResult {
  trimmed: number
}

async function write(list: BugHistoryEntry[]): Promise<WriteResult> {
  // 写入失败（一般是配额超出）时，**逐条**丢最旧的（list[0] 是最新，pop 末尾 = 最旧）。
  // 之前的做法是二分丢一半 + 兜底清空，单次配额触顶可能直接掉掉一大半历史。
  let attempt = list.slice()
  const initialLen = attempt.length
  while (attempt.length > 0) {
    try {
      await chrome.storage.local.set({ [KEY]: attempt })
      return { trimmed: initialLen - attempt.length }
    } catch {
      attempt.pop()
    }
  }
  // 空数组也写不进去，说明 storage 整体异常 —— 静默放弃，下次 addHistoryEntry 会再试
  return { trimmed: initialLen }
}

export async function addHistoryEntry(entry: BugHistoryEntry): Promise<WriteResult> {
  const list = await read()
  list.unshift(entry)
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
