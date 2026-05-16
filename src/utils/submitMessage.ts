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
    let msg = `提交成功 (HTTP ${res.status ?? 200})`
    if (res.trimmedHistory && res.trimmedHistory > 0) {
      // storage 配额已满，旧历史被自动丢弃。让用户知道有数据丢失，可去 设置 → 存储 清空
      msg += `\n（本地保存历史时空间不够，自动丢弃了 ${res.trimmedHistory} 条最旧的本地记录；服务端已正常收到）`
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
  const head = httpStatusHint(status)
  const message = detail ? `${head}：${detail}` : head
  return { ok: false, message: appendQueued(message, res.queued) }
}

/** 把光秃秃的 HTTP 状态码翻译成更可操作的提示 */
function httpStatusHint(status: number): string {
  if (status === 0) return '服务端没响应（可能网络不通或 endpoint 不存在）'
  if (status === 401) return `服务端拒收（HTTP 401 未授权）—— 请检查项目 Token`
  if (status === 403) return `服务端拒收（HTTP 403 无权限）—— 当前账号可能没有提交 bug 的权限`
  if (status === 404) return `服务端找不到这个 endpoint（HTTP 404）—— 请检查上报服务器配置的 URL`
  if (status === 413) return `提交内容太大（HTTP 413）—— 截图/录像可能超过服务端上限`
  if (status === 422) return `服务端拒绝了请求格式（HTTP 422）—— 可能 payload 模板和后端 schema 不匹配`
  if (status >= 500) return `服务端报错（HTTP ${status}）—— 不是你的问题，已自动加入重试队列`
  if (status >= 400) return `请求被拒（HTTP ${status}）`
  return `提交未成功（HTTP ${status}）`
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
  return queued ? `${msg}\n这条 bug 已存到重试队列，每 5 分钟自动重试一次；也可以去 设置 → 存储 手动「立即重试」` : msg
}
