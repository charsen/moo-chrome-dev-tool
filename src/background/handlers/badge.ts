/**
 * action badge 刷新 helper。
 *
 * background/index.ts 的 submit / history.onChanged / onStartup / SW spin-up 都要刷一次；
 * 抽到独立文件让 handlers/submit.ts 也能直接 import。
 */
import { listHistory } from '@/storage/history'
import { updateActionBadge } from '@/utils/badge'

export async function refreshBadge(): Promise<void> {
  try {
    await updateActionBadge(await listHistory())
  } catch {
    // history 读失败 / chrome.action 不可用——badge 不是关键路径，静默
  }
}
