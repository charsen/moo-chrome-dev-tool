import { escapeHtml } from './jsonHighlight'

/**
 * 把异常 stack 文本格式化成"函数名加粗 + 文件名清晰 + 行:列变弱"的 HTML。
 *
 * 支持的主流形态（按命中优先级）：
 *   1. V8 / Chrome:  "    at fnName (file:line:col)"
 *   2. V8 匿名:      "    at file:line:col"
 *   3. Firefox:      "fnName@file:line:col"
 *
 * 不匹配的行（异常 message 第一行 / native code / eval 嵌套）按原文 escape 后输出。
 */
export function highlightStack(stack: string): string {
  return stack.split('\n').map(highlightStackLine).join('\n')
}

function highlightStackLine(line: string): string {
  const safe = escapeHtml(line)
  // 1. V8 "    at fnName (file:line:col)"
  const m1 = safe.match(/^(\s*at\s+)(\S+)\s+\((.+?:\d+:\d+)\)\s*$/)
  if (m1) {
    return `${m1[1]!}<span class="st-fn">${m1[2]!}</span> (${formatLocation(m1[3]!)})`
  }
  // 2. V8 anonymous "    at file:line:col"
  const m2 = safe.match(/^(\s*at\s+)(.+?:\d+:\d+)\s*$/)
  if (m2) {
    return `${m2[1]!}${formatLocation(m2[2]!)}`
  }
  // 3. Firefox "fnName@file:line:col"
  const m3 = safe.match(/^(\S*)@(.+?:\d+:\d+)\s*$/)
  if (m3 && m3[1]) {
    return `<span class="st-fn">${m3[1]}</span>@${formatLocation(m3[2]!)}`
  }
  return safe
}

/** 把 "path/file.js:12:34" 切成「文件 + :行:列」 */
function formatLocation(safeLoc: string): string {
  const m = safeLoc.match(/^(.+):(\d+):(\d+)$/)
  if (!m) return `<span class="st-loc">${safeLoc}</span>`
  return `<span class="st-file">${m[1]!}</span><span class="st-loc">:${m[2]!}:${m[3]!}</span>`
}
