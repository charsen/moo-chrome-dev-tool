/**
 * HISTORY_REMOVE / HISTORY_CLEAR 入口 —— devtools 的「删单条 / 清空历史」必须经这里执行。
 *
 * **为什么不许 devtools 直接 import `removeHistory` / `clearHistory`**：
 * `storage/history.ts` 的 `withWriteMutex` 是**模块内存锁**（一条模块级 promise 链），
 * devtools / popup / options 与 SW 各持一把互不相干的锁。而这些写路径都是对**整份**
 * `mooHistory` 数组做 read-modify-write，于是：
 *
 *   devtools: 读(快照 S) ──────────── filter 掉 A ── 写回(S - A)
 *   SW:               读(S) ── unshift 新条 ── 写回(S + 新条)     ← 覆盖掉上面的删除
 *
 * 结果就是用户删掉的条目复活（v0.4.8 加锁本来就是为了治这个，但只治了 SW 内部），
 * 或者反过来把 SW 刚提交的条目吞掉。触发窗口不小：慢 webhook / 禅道 multipart 期间
 * 用户随手去 History 删旧条目就会撞上。
 *
 * v0.8.9 已经为 retryQueue 落地了同样的路由（MSG.RETRY_QUEUE_REMOVE / RETRY_QUEUE_CLEAR），
 * history 当时漏了 —— 本文件补齐。**读路径（listHistory）无害，各 UI 继续直调，不必绕 SW。**
 */

import type { HistoryClearRes, HistoryRemoveRes } from '@/types/messages'
import { clearHistory, removeHistory } from '@/storage/history'

export async function handleHistoryRemove(
  payload: { id: string } | undefined
): Promise<HistoryRemoveRes> {
  const id = payload?.id
  // payload 来自跨进程 IPC，TS 保证不了；runtime 补一道，别让 undefined 进 filter 变成「全不匹配」
  if (typeof id !== 'string' || id === '') {
    return { ok: false, removed: false, error: 'HISTORY_REMOVE payload 缺 id' }
  }
  try {
    return { ok: true, removed: await removeHistory(id) }
  } catch (e) {
    // storage 写失败——必须报错，不能让 UI 以为删掉了（那条其实还在）
    return { ok: false, removed: false, error: (e as Error).message }
  }
}

export async function handleHistoryClear(): Promise<HistoryClearRes> {
  try {
    await clearHistory()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
