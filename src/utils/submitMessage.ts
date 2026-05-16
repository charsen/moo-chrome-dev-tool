import type { SubmitBugRes } from '@/types/messages'

/**
 * 把 background 返回的 SubmitBugRes 整理成可读的 toast 消息。
 *
 * 错误来源优先级：
 *   1. res.error           —— fetch 抛错（网络/CORS/超时），最直接
 *   2. JSON.parse(res.body).error / .message  —— 服务端约定的 JSON 错误
 *   3. res.body 原文（截断）—— body 不是 JSON 时退化
 *   4. 仅 HTTP {status}    —— 兜底
 *
 * 同时会附带"已加入重试队列"提示（5xx / 网络失败时 background 会入队）。
 */
export function formatSubmitResult(res: SubmitBugRes): { ok: boolean; message: string } {
  if (res.ok) {
    let msg = `提交成功 (${res.status ?? 200})`
    if (res.trimmedHistory && res.trimmedHistory > 0) {
      // storage 配额已满，旧历史被自动丢弃。让用户知道有数据丢失，可去 设置 → 存储 清空
      msg += `（本地历史已满，自动丢弃 ${res.trimmedHistory} 条最旧记录）`
    }
    return { ok: true, message: msg }
  }

  // 1. fetch 异常
  if (res.error) {
    return {
      ok: false,
      message: appendQueued(`提交失败：${res.error}`, res.queued)
    }
  }

  // 2/3. 服务端 HTTP 错误：尽量从 body 里挖出原因
  const detail = extractServerError(res.body)
  const status = res.status ?? 0
  const head = `提交失败 (HTTP ${status})`
  const message = detail ? `${head}：${detail}` : head
  return { ok: false, message: appendQueued(message, res.queued) }
}

function extractServerError(body?: string): string {
  if (!body) return ''
  // 试 JSON
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown }
    const err = pickStr(parsed.error) || pickStr(parsed.message)
    if (err) return err
  } catch {
    // 不是 JSON，原文截断
  }
  return body.length > 160 ? body.slice(0, 160) + '…' : body
}

function pickStr(v: unknown): string {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : ''
}

function appendQueued(msg: string, queued?: boolean): string {
  return queued ? `${msg}（已加入重试队列）` : msg
}
