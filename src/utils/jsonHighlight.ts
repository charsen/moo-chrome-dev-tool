// 给 Overview / 任意 body 区域提供"JSON 检测 + pretty + 语法染色"三件套。
// 染色走「输出已 HTML-escape 的 string，调用方塞 v-html」路线 —— 避免在 Vue
// 模板里堆 v-for 渲染上百个 <span>，对大 JSON 性能更友好。
//
// 安全性：tokenize 完原文本后，每段（token 内容 + token 之间的 gap）都过 escapeHtml，
// 所以 body 里出现 "<script>foo</script>" 这种字符串值不会被注入。

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c] as string))
}

/**
 * 试图把 body 当 JSON parse。失败返回 undefined。
 * 只 fast-path `{` / `[` 起的对象/数组——单值 JSON（"foo"、123）极少出现在 HTTP body 里，
 * 不值得为它们多一道 try/catch + 误报检测。
 */
export function tryParseJson(text: string): unknown | undefined {
  const t = text.trim()
  if (!t) return undefined
  const c = t[0]
  if (c !== '{' && c !== '[') return undefined
  try {
    return JSON.parse(t)
  } catch {
    return undefined
  }
}

export function prettyPrintJson(value: unknown, indent = 2): string {
  try {
    return JSON.stringify(value, null, indent)
  } catch {
    // 罕见：循环引用 / BigInt（虽然这里 value 来自 JSON.parse 所以不可能）。兜底为空
    return ''
  }
}

// 经典 Bonisteel 风格 token 正则。
// - "..." 含转义字符；后面可选跟 `:` 表示是 key（JSON.stringify 输出无空格）
// - true / false / null
// - 数字（含科学计数）
const TOKEN_RE = /"(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?/g

function classify(token: string): string {
  if (token.startsWith('"')) {
    return /:\s*$/.test(token) ? 'jx-key' : 'jx-str'
  }
  if (token === 'true' || token === 'false') return 'jx-bool'
  if (token === 'null') return 'jx-null'
  return 'jx-num'
}

/**
 * 把已知/疑似 JSON 文本转换成带语法高亮的 HTML。
 * - 不假设输入合法：失败的 token 段作为纯文本 escape 输出，不抛错
 * - 输出已 HTML-escape，安全塞 v-html
 */
export function highlightJson(text: string): string {
  let out = ''
  let last = 0
  // 不能共用同一个 regex 实例的 lastIndex（多次调用会出错），每次手动复位
  TOKEN_RE.lastIndex = 0
  for (let m: RegExpExecArray | null; (m = TOKEN_RE.exec(text)); ) {
    if (m.index > last) {
      out += escapeHtml(text.slice(last, m.index))
    }
    out += `<span class="${classify(m[0])}">${escapeHtml(m[0])}</span>`
    last = m.index + m[0].length
  }
  if (last < text.length) {
    out += escapeHtml(text.slice(last))
  }
  return out
}

/**
 * 把 body 内搜索 query 在已 HTML-escape 的字符串里再叠一层 <mark> 高亮。
 * 注意：必须在 highlightJson 之后调用——先语法高亮再叠搜索 mark，否则
 * mark 会切断 jx-* span 的边界（视觉上不好看但功能 OK；这里求美观）。
 *
 * v0.8.9 重写为「明文匹配」：文本段先解码 → 在明文上找 query → 重转义后插 <mark>。
 * 旧实现直接在转义后的 HTML 串上跑 regex，会把 `&lt;` 这类实体从中间劈开
 * （搜 "t" 命中 &lt; 里的 t → 输出 `&l<mark>t</mark>;`，浏览器渲染成字面量五个字符），
 * 含 <>&" 的 body 显示损坏 + "amp"/"lt" 等查询产生假高亮。明文匹配同时修正
 * 「搜 < / & / " 字面量」的语义（用户搜的是字符本身，不是它的转义串）。
 */

// mark 边界占位符 —— 私有区码点，正常 body 文本不会出现；防御性起见处理前
// 先剥掉文本里的同款码点（万一真有也只是丢两个不可见字符，不破坏转义）
const MARK_OPEN = '\uE000'
const MARK_CLOSE = '\uE001'

/** 只解 escapeHtml 产出的 5 个实体（闭集）—— 文本段全部来自 escapeHtml，不存在其它实体 */
function decodeBasicEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" } as Record<string, string>)[e] as string)
}

export function overlayBodySearch(html: string, query: string): string {
  const q = query.trim()
  if (!q) return html
  const rx = new RegExp(escapeRegex(q), 'gi')
  const parts = html.split(/(<[^>]+>)/)  // 奇数下标 = 标签段，原样保留
  return parts.map((part, i) => {
    if (i % 2 === 1 || !part) return part
    const plain = decodeBasicEntities(part).replaceAll(MARK_OPEN, '').replaceAll(MARK_CLOSE, '')
    rx.lastIndex = 0
    if (!rx.test(plain)) return part
    rx.lastIndex = 0
    const marked = plain.replace(rx, (m: string) => `${MARK_OPEN}${m}${MARK_CLOSE}`)
    return escapeHtml(marked)
      .replaceAll(MARK_OPEN, '<mark>')
      .replaceAll(MARK_CLOSE, '</mark>')
  }).join('')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
