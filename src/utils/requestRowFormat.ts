/**
 * 请求行 / 错误行的格式化工具。
 *
 * v0.4.5 抽：SubmitDialog.vue + Overview.vue 之前各自维护一份，逻辑字面一致。
 * 唯一差别：Overview shortUrl 含 host，SubmitDialog 不含（SubmitDialog 在 closed shadow
 * 里宽度受限，host 一般已经能从 URL chip 推出）。统一成一个函数 + includeHost 开关。
 */

import type { ConsoleError } from '@/types/errors'

export function shortUrl(url: string, opts: { includeHost?: boolean } = {}): string {
  try {
    const u = new URL(url)
    const base = u.pathname + (u.search ? u.search : '')
    return opts.includeHost ? u.host + base : base
  } catch {
    return url
  }
}

/** status chip 颜色类：err（5xx / 网络错）/ warn（4xx）/ ok（2xx-3xx） */
export function statusClass(status: number): 'err' | 'warn' | 'ok' {
  if (!status) return 'err'
  if (status >= 500) return 'err'
  if (status >= 400) return 'warn'
  return 'ok'
}

/**
 * 行级「出错强调」左色条：4xx 橙 / 5xx + 网络错 红。
 * 跟 statusClass 共用一套阈值；statusClass 用于 chip 染色，failClass 用于整行外层 class。
 */
export function failClass(status: number): 'is-err' | 'is-warn' | '' {
  if (!status) return 'is-err'
  if (status >= 500) return 'is-err'
  if (status >= 400) return 'is-warn'
  return ''
}

/** 慢请求 duration 染色：≥1s 橙、≥3s 红。200 但 5s 也是问题，chip 看不出来。 */
export function durClass(duration: number): 'dur--xslow' | 'dur--slow' | '' {
  if (duration >= 3000) return 'dur--xslow'
  if (duration >= 1000) return 'dur--slow'
  return ''
}

export function errLevelLabel(level: ConsoleError['level']): string {
  if (level === 'rejection') return 'REJ'
  if (level === 'console') return 'CON'
  return 'ERR'
}

export function errLevelTitle(level: ConsoleError['level']): string {
  if (level === 'rejection') return 'Unhandled Promise Rejection'
  if (level === 'console') return 'console.error 调用'
  return 'window.onerror（运行时错误）'
}
