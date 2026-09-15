/**
 * 响应体读取闸门（纯函数 / 唯一权威实现）。
 *
 * **要解决的问题**：`src/injected/main-world.ts` 的 fetch / XHR 钩子会把**整个**响应体
 * clone 出来 decode 成 JS 字符串，读完才 `clip()` 截到 20KB —— 截断挡不住读取本身的
 * 开销。于是宿主页里任何一次大响应（文件下载、大 JSON、二进制）都被完整解码：内存峰值
 * 抬高、主线程卡顿，几十 MB 的响应甚至能把 tab 顶 OOM。而且 MAIN world 既拿不到
 * `chrome.*` 也读不到用户配置，所以「采集开关关了」也救不了它（钩子照样全量读）。
 *
 * **闸门策略**（故意保守 —— 宁可多读一次也不要误判成"不读"而丢采集）：
 *   1. content-type 明确不是文本类 → 不读。二进制走 `text()` 解码纯属浪费，clip 完也是乱码。
 *   2. content-length 大于上限 → 不读（把真实字节数带回去，UI 仍能显示体积）。
 *   3. 拿不到 content-type / content-length（`no-cors`、分块传输、opaque）→ **放行**。
 *      这类情况占日常接口的大多数，误判成"不读"会直接丢采集，代价比多读一次大得多。
 *
 * ⚠ `src/injected/main-world.ts` 有同语义的**内联副本** —— 那个文件是 IIFE 注入 MAIN world，
 * 不能 import `@/` 模块（见该文件头注释与 `absolutize` 的同类处理），所以这里是权威实现、
 * 那边必须同步改。`tests/bodyGate.test.ts` 会读两边源码断言阈值与 mime 表一致，漂了就红。
 */

/** 单次读取响应体的字节上限。超过就不读内容，只留一句摘要。 */
export const MAX_BODY_READ_BYTES = 1024 * 1024

/** 能当文本读的 mime（`text/*` 与 `+json` / `+xml` 后缀在函数里另外判） */
export const TEXTUAL_MIMES: readonly string[] = [
  'application/json',
  'application/xml',
  'application/javascript',
  'application/ecmascript',
  'application/x-www-form-urlencoded',
  'application/graphql',
  'application/x-ndjson',
  'application/ld+json'
]

const TEXTUAL_MIME_SET = new Set(TEXTUAL_MIMES)

/** 去掉 `; charset=...` 并小写。拿不到就返 ''。 */
export function mimeOf(contentType: string | null | undefined): string {
  if (!contentType) return ''
  return (contentType.split(';')[0] ?? '').trim().toLowerCase()
}

export function isTextualContentType(contentType: string | null | undefined): boolean {
  const mime = mimeOf(contentType)
  if (!mime) return false
  if (mime.startsWith('text/')) return true
  if (mime.endsWith('+json') || mime.endsWith('+xml')) return true
  return TEXTUAL_MIME_SET.has(mime)
}

export interface BodyReadGate {
  /** true = 不要读内容 */
  skip: boolean
  /** 由 content-length 得到的字节数；拿不到就是 0 */
  bytes: number
  /** mime（拿不到时是 '未知类型'），拼摘要用 */
  mime: string
}

export function gateResponseBodyRead(
  contentType: string | null | undefined,
  contentLength: string | null | undefined,
  maxBytes: number = MAX_BODY_READ_BYTES
): BodyReadGate {
  const parsed = contentLength ? Number(contentLength) : NaN
  // content-length 可能是 '12345' / '' / 'NaN'（分块）——只认正有限数
  const bytes = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  const mime = mimeOf(contentType) || '未知类型'

  if (contentType && !isTextualContentType(contentType)) {
    return { skip: true, bytes, mime }
  }
  if (bytes > maxBytes) {
    return { skip: true, bytes, mime }
  }
  return { skip: false, bytes, mime }
}

function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * 跳过读取时替用户看到的"响应体"。故意写成自解释的一句话 —— 它会直接显示在
 * 提交弹窗 / DevTools 的 Response Body 区域，必须让人一眼知道「不是空的，是 Moo 没读」
 * 以及「去哪儿看」。
 */
export function skippedBodyNote(gate: BodyReadGate, maxBytes: number = MAX_BODY_READ_BYTES): string {
  const sizeStr = gate.bytes > 0 ? ` · ${humanBytes(gate.bytes)}` : ''
  return `[Moo 未读取响应体：${gate.mime}${sizeStr}，非文本类型或超过 ${humanBytes(maxBytes)} 读取上限。要看内容请用 DevTools → Network]`
}
