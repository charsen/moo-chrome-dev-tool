import type { BugHistoryEntry } from '@/types/history'

const KEY = 'mooHistory'
const MAX_ENTRIES = 30

async function read(): Promise<BugHistoryEntry[]> {
  const r = await chrome.storage.local.get(KEY)
  const list = r[KEY]
  return Array.isArray(list) ? list : []
}

async function write(list: BugHistoryEntry[]): Promise<void> {
  // 写入失败（一般是配额超出）时，逐步丢弃最旧的项再试
  let attempt = list.slice()
  for (let i = 0; i < 5; i++) {
    try {
      await chrome.storage.local.set({ [KEY]: attempt })
      return
    } catch {
      attempt = attempt.slice(0, Math.max(1, Math.floor(attempt.length / 2)))
    }
  }
  // 最后兜底：清空
  await chrome.storage.local.set({ [KEY]: [] })
}

export async function addHistoryEntry(entry: BugHistoryEntry): Promise<void> {
  const list = await read()
  list.unshift(entry)
  if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES
  await write(list)
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

export async function readHistory(): Promise<BugHistoryEntry[]> {
  return read()
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
