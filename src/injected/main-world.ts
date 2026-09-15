/**
 * 注入到页面 MAIN world 的脚本：monkey-patch fetch + XHR，
 * 把每次请求事件通过 window.postMessage 抛给 ISOLATED 内容脚本。
 *
 * 严格要求：本文件不得使用 chrome.* API（MAIN world 没有）。
 * 也不引用任何 @/ 模块（保持自包含、IIFE 输出）。
 */

const MAX_BODY = 20 * 1024
const TAG = '__moo_req__'

interface Payload {
  id: string
  kind: 'fetch' | 'xhr'
  method: string
  url: string
  requestHeaders: Record<string, string>
  requestBody: string | null
  status: number
  ok: boolean
  responseHeaders: Record<string, string>
  responseBody: string | null
  responseSizeBytes: number
  startTime: number
  duration: number
  startedAt: string
  error?: string
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function clip(s: string): string {
  return s.length > MAX_BODY ? s.slice(0, MAX_BODY) + `…[truncated, total ${s.length}b]` : s
}

// ---------- 响应体读取闸门 ----------
// 为什么要闸门：下面 fetch / XHR 是「先把整个 body decode 成 JS 字符串，再 clip 到 20KB」——
// clip 是在读完之后才截的，挡不住读取本身。宿主页任何一次大响应（下载文件 / 大 JSON / 二进制）
// 都会被完整解码成字符串 → 内存峰值抬高、主线程卡顿，几十 MB 能把 tab 顶 OOM。
// 而且本文件是 MAIN world：拿不到 chrome.* 也读不到用户配置，所以「用户在 Settings 关了采集」
// 也救不了它。v0.8.17 后那次复盘实测这条。

/** 超过这个字节数就不读内容，只回一句摘要（唯一权威实现 + 单测在 src/utils/bodyGate.ts） */
const MAX_BODY_READ_BYTES = 1024 * 1024
/** 能当文本读的 mime（text/* 与 +json / +xml 后缀在 isTextualMime 里另判） */
const TEXTUAL_MIMES = [
  'application/json',
  'application/xml',
  'application/javascript',
  'application/ecmascript',
  'application/x-www-form-urlencoded',
  'application/graphql',
  'application/x-ndjson',
  'application/ld+json'
]

function mimeOf(contentType: string | null | undefined): string {
  if (!contentType) return ''
  return (contentType.split(';')[0] ?? '').trim().toLowerCase()
}

function isTextualMime(mime: string): boolean {
  if (!mime) return false
  if (mime.indexOf('text/') === 0) return true
  if (mime.slice(-5) === '+json' || mime.slice(-4) === '+xml') return true
  return TEXTUAL_MIMES.indexOf(mime) >= 0
}

/**
 * 判断这次响应体要不要真读。
 * 保守策略：只有「content-type 明确非文本」或「content-length 明确超上限」才跳过；
 * 两者拿不到（no-cors / 分块 / opaque）一律放行 —— 误判成不读会直接丢采集。
 */
function gateBody(contentType: string | null, contentLength: string | null): { skip: boolean; bytes: number; mime: string } {
  const parsed = contentLength ? Number(contentLength) : NaN
  const bytes = isFinite(parsed) && parsed > 0 ? parsed : 0
  const mime = mimeOf(contentType) || '未知类型'
  if (contentType && !isTextualMime(mime)) return { skip: true, bytes, mime }
  if (bytes > MAX_BODY_READ_BYTES) return { skip: true, bytes, mime }
  return { skip: false, bytes, mime }
}

/** 跳过时替用户看到的"响应体"。会直接显示在提交弹窗 / DevTools，必须自解释。 */
function skippedBodyNote(g: { bytes: number; mime: string }): string {
  const sizeStr = g.bytes > 0 ? ` · ${g.bytes >= 1024 * 1024 ? (g.bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(g.bytes / 1024)) + ' KB'}` : ''
  const capStr = `${MAX_BODY_READ_BYTES / 1024 / 1024} MB`
  return `[Moo 未读取响应体：${g.mime}${sizeStr}，非文本类型或超过 ${capStr} 读取上限。要看内容请用 DevTools → Network]`
}

function post(p: Payload) {
  try {
    window.postMessage({ __moo: true, tag: TAG, payload: p }, location.origin)
  } catch {}
}

function shouldSkip(url: string): boolean {
  return /^(chrome-extension|data|blob|chrome|moz-extension):/i.test(url)
}

/**
 * 把 fetch/xhr 传入的 url 补成完整 URL（带 origin）。
 * 修 v0.2.0 坑：用户 `fetch('/api/foo')` 相对路径让 curl 缺 origin 复制不能跑。
 *
 * **本文件 IIFE 注入 MAIN world 不能 import @/ 模块**，所以内联实现；
 * 同份逻辑的权威实现 + 单测在 src/utils/url.ts，改一处记得两处同步。
 */
function absolutize(url: string): string {
  if (!url) return url
  // 已含 scheme（https / http / ws / file ...）—— 不动
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return url
  try { return new URL(url, location.href).toString() } catch { return url }
}

function headersToObj(h: Headers | Record<string, string> | string[][] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  if (typeof Headers !== 'undefined' && h instanceof Headers) {
    h.forEach((v, k) => (out[k] = v))
    return out
  }
  if (Array.isArray(h)) {
    // string[][] 的元素是 [key, value] tuple，但 noUncheckedIndexedAccess 把
    // index 访问标 possibly-undefined。畸形输入（如 [[]]）会让 k/v 真的是
    // undefined —— 直接 skip 比让 out[undefined] = undefined 污染好。
    for (const row of h as string[][]) {
      const k = row[0]
      const v = row[1]
      if (typeof k === 'string' && typeof v === 'string') out[k] = v
    }
    return out
  }
  return { ...(h as Record<string, string>) }
}

async function bodyToString(body: BodyInit | null | undefined): Promise<string | null> {
  if (body == null) return null
  if (typeof body === 'string') return clip(body)
  if (body instanceof URLSearchParams) return clip(body.toString())
  if (body instanceof FormData) {
    const parts: string[] = []
    body.forEach((v, k) => {
      parts.push(`${k}=${typeof v === 'string' ? v : '[File]'}`)
    })
    return clip(parts.join('&'))
  }
  if (body instanceof Blob) return '[Blob ' + body.size + 'b]'
  if (body instanceof ArrayBuffer) return '[ArrayBuffer ' + body.byteLength + 'b]'
  return '[非字符串体]'
}

// 幂等安装守卫：backfill 会对「已注入」tab 重复 executeScript 本文件（executeScript 不去重，
// 去重只对 declarative register 成立）。无守卫则 fetch/XHR/error/history 全被二次 patch →
// 每个请求/错误重复上报、DevTools/历史出现重复行。用 window flag 拦住重复 patch。
// reload 安全：MAIN world 是页面世界、扩展 reload 时不重置 —— 老 patch 仍在 postMessage，
// reload 后新 ISOLATED content listener 照收，故重注入跳过 patch 不丢采集。
const mooMainWin = window as typeof window & { __mooMainPatched?: boolean }
const mooAlreadyPatched = mooMainWin.__mooMainPatched === true
mooMainWin.__mooMainPatched = true

// ---------- fetch ----------
const origFetch = window.fetch
const mooFetch = async function (this: typeof globalThis, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const id = uid()
  const startTime = performance.now()
  const startedAt = new Date().toISOString()

  let method = 'GET'
  let url = ''
  let reqHeaders: Record<string, string> = {}
  let reqBody: string | null = null

  try {
    if (typeof input === 'string') url = input
    else if (input instanceof URL) url = input.toString()
    else { url = input.url; method = input.method; reqHeaders = headersToObj(input.headers) }
    if (init?.method) method = init.method
    if (init?.headers) reqHeaders = { ...reqHeaders, ...headersToObj(init.headers as any) }
    reqBody = await bodyToString(init?.body)
    // 关键：用户 fetch('/api/foo') 用相对路径时 url 是 '/api/foo'，curl 命令复制出来
    // 不带 origin 不能跑。用 location.href 当 base 让 URL 构造器 normalize 成完整 URL。
    // - 绝对 URL（https://...）：原样保留
    // - 相对路径（/foo 或 foo）：补 location.origin
    // - protocol-relative（//host/path）：补 location.protocol
    // 解析失败时回落到原 url 字符串保证不丢请求。
    url = absolutize(url)
  } catch {}

  if (shouldSkip(url)) return origFetch.call(this, input as any, init)

  try {
    const resp = await origFetch.call(this, input as any, init)
    const duration = performance.now() - startTime
    let respBody: string | null = null
    let size = 0
    const gate = gateBody(resp.headers.get('content-type'), resp.headers.get('content-length'))
    if (gate.skip) {
      // 不读内容：二进制 / 超大响应走 text() 解码纯属浪费（见 gateBody 上方注释）。
      // responseSizeBytes 用 content-length（比之前的 text.length 更贴近字段名语义）。
      respBody = skippedBodyNote(gate)
      size = gate.bytes
    } else {
      try {
        const cloned = resp.clone()
        const text = await cloned.text()
        size = text.length
        respBody = clip(text)
      } catch {}
    }
    const respHeaders: Record<string, string> = {}
    resp.headers.forEach((v, k) => (respHeaders[k] = v))
    post({
      id, kind: 'fetch', method, url, requestHeaders: reqHeaders, requestBody: reqBody,
      status: resp.status, ok: resp.ok, responseHeaders: respHeaders, responseBody: respBody,
      responseSizeBytes: size, startTime, duration, startedAt
    })
    return resp
  } catch (err) {
    post({
      id, kind: 'fetch', method, url, requestHeaders: reqHeaders, requestBody: reqBody,
      status: 0, ok: false, responseHeaders: {}, responseBody: null, responseSizeBytes: 0,
      startTime, duration: performance.now() - startTime, startedAt,
      error: (err as Error).message
    })
    throw err
  }
}
if (!mooAlreadyPatched) window.fetch = mooFetch

// ---------- XHR ----------
type MooXHR = XMLHttpRequest & {
  __moo?: {
    id: string
    method: string
    url: string
    reqHeaders: Record<string, string>
    reqBody: string | null
    startTime: number
    startedAt: string
  }
}

const OrigOpen = XMLHttpRequest.prototype.open
const OrigSend = XMLHttpRequest.prototype.send
const OrigSetHeader = XMLHttpRequest.prototype.setRequestHeader

const mooOpen = function (this: MooXHR, method: string, url: string | URL) {
  // url 类型签名说是 string | URL，但浏览器实现允许任意类型，会内部 toString。
  // 我们 hook 时若直接 url.toString() 而 url 是 number / null 会扔 TypeError，
  // 污染宿主页 XHR 行为。安全转换：用 String() 包一道，无论入参类型都不抛。
  let safeUrl = ''
  try {
    safeUrl = url == null ? '' : String(url as unknown)
  } catch { /* Symbol 等不可 String 化的极端情况 */ }
  // 与 fetch hook 同等处理：xhr.open('/api/foo') 相对路径 → 补 origin，
  // 让 curl 命令拿到完整 URL 复制即可跑
  safeUrl = absolutize(safeUrl)
  this.__moo = {
    id: uid(),
    method: (method || 'GET').toUpperCase(),
    url: safeUrl,
    reqHeaders: {},
    reqBody: null,
    startTime: 0,
    startedAt: ''
  }
  // eslint-disable-next-line prefer-rest-params
  return OrigOpen.apply(this, arguments as any)
}

const mooSetHeader = function (this: MooXHR, k: string, v: string) {
  if (this.__moo) this.__moo.reqHeaders[k] = v
  return OrigSetHeader.call(this, k, v)
}

const mooSend = function (this: MooXHR, body?: Document | XMLHttpRequestBodyInit | null) {
  if (this.__moo) {
    this.__moo.startTime = performance.now()
    this.__moo.startedAt = new Date().toISOString()
    // 同步转字符串
    if (body == null) this.__moo.reqBody = null
    else if (typeof body === 'string') this.__moo.reqBody = clip(body)
    else if (body instanceof URLSearchParams) this.__moo.reqBody = clip(body.toString())
    else if (body instanceof FormData) {
      const parts: string[] = []
      body.forEach((v, k) => parts.push(`${k}=${typeof v === 'string' ? v : '[File]'}`))
      this.__moo.reqBody = clip(parts.join('&'))
    } else this.__moo.reqBody = '[非字符串体]'

    if (!shouldSkip(this.__moo.url)) {
      this.addEventListener('loadend', () => {
        const m = this.__moo!
        const duration = performance.now() - m.startTime
        let respBody: string | null = null
        let size = 0
        try {
          if (this.responseType === '' || this.responseType === 'text') {
            // 同 fetch 路径的闸门：读 responseText 会强制浏览器把整份 body 解码成字符串，
            // 对大响应（尤其二进制）是纯浪费（见 gateBody 上方注释）
            const gate = gateBody(this.getResponseHeader('content-type'), this.getResponseHeader('content-length'))
            if (gate.skip) {
              respBody = skippedBodyNote(gate)
              size = gate.bytes
            } else {
              const text = this.responseText
              size = text.length
              respBody = clip(text)
            }
          } else if (this.response) {
            respBody = '[' + this.responseType + ']'
          }
        } catch {}
        const respHeaders = parseHeaderString(this.getAllResponseHeaders())
        post({
          id: m.id, kind: 'xhr', method: m.method, url: m.url,
          requestHeaders: m.reqHeaders, requestBody: m.reqBody,
          status: this.status, ok: this.status >= 200 && this.status < 300,
          responseHeaders: respHeaders, responseBody: respBody, responseSizeBytes: size,
          startTime: m.startTime, duration, startedAt: m.startedAt
        })
      })
      this.addEventListener('error', () => {
        const m = this.__moo!
        post({
          id: m.id, kind: 'xhr', method: m.method, url: m.url,
          requestHeaders: m.reqHeaders, requestBody: m.reqBody,
          status: 0, ok: false, responseHeaders: {}, responseBody: null, responseSizeBytes: 0,
          startTime: m.startTime, duration: performance.now() - m.startTime,
          startedAt: m.startedAt, error: 'network error'
        })
      })
    }
  }
  // eslint-disable-next-line prefer-rest-params
  return OrigSend.apply(this, arguments as any)
}
if (!mooAlreadyPatched) {
  XMLHttpRequest.prototype.open = mooOpen
  XMLHttpRequest.prototype.setRequestHeader = mooSetHeader
  XMLHttpRequest.prototype.send = mooSend
}

function parseHeaderString(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw) return out
  for (const line of raw.trim().split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return out
}

// ---------- 错误抓取 ----------
const TAG_ERR = '__moo_err__'

interface ErrPayload {
  id: string
  level: 'error' | 'rejection' | 'console'
  message: string
  stack?: string
  source?: string
  line?: number
  col?: number
  startedAt: string
  startTime: number
}

// v0.4.5：失控代码 / React error loop 时同 message 可能 16ms 一发 → content useErrors.ts
// 推 ref 后 Vue 响应式更新 30fps 死循环 → 宿主页卡死。
// 加 100ms 窗口同 message 去重，相同 message 在窗口内只发一次。
const recentErrPosts = new Map<string, number>()
const ERR_POST_DEDUPE_MS = 100
function postErr(p: ErrPayload) {
  const key = `${p.level}|${p.message}|${p.source ?? ''}|${p.line ?? ''}|${p.col ?? ''}`
  const now = performance.now()
  const last = recentErrPosts.get(key)
  if (last !== undefined && now - last < ERR_POST_DEDUPE_MS) return
  recentErrPosts.set(key, now)
  // 防 map 无限增长：每次写入扫一遍清掉过期 key
  if (recentErrPosts.size > 50) {
    for (const [k, t] of recentErrPosts) {
      if (now - t >= ERR_POST_DEDUPE_MS) recentErrPosts.delete(k)
    }
  }
  try { window.postMessage({ __moo: true, tag: TAG_ERR, payload: p }, location.origin) } catch {}
}

function errFrom(level: ErrPayload['level'], message: string, stack?: string, extra?: Partial<ErrPayload>): ErrPayload {
  return {
    id: uid(),
    level,
    message,
    stack,
    startedAt: new Date().toISOString(),
    startTime: performance.now(),
    ...extra
  }
}

// 幂等：error / unhandledrejection 监听每次注入会新增不同 fn ref（不去重）→ 重注入双发；
// 各注入的 recentErrPosts 去重表互不共享救不了。守卫住只在首注入装一次。
if (!mooAlreadyPatched) {
  window.addEventListener('error', (e: ErrorEvent) => {
    postErr(errFrom('error', e.message || String(e.error), e.error?.stack, {
      source: e.filename, line: e.lineno, col: e.colno
    }))
  }, true)

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const r = e.reason
    const msg = r instanceof Error ? r.message : String(r)
    const stack = r instanceof Error ? r.stack : undefined
    postErr(errFrom('rejection', msg, stack))
  })
}

// 注：曾经 monkey-patch console.error 上报到 SubmitDialog，但 chrome 扩展错误
// 归因是看"谁 patched 了 console.error"，不是 native 调用栈 —— 即便用 setTimeout(0)
// 切 task 也救不了。结果是宿主页每个业务 console.error 都被算到 Moo 头上，
// chrome://extensions 错误页被业务报错刷屏。改回只听 window.error + unhandledrejection，
// 承担的代价：用户主动 console.error('xxx') 不再进 SubmitDialog 错误面板，但
// 未捕获异常 / promise reject 仍全抓。SubmitDialog 里 level === 'console' 的
// 分支保留为 dead code，不删，方便未来若改用另一种机制（例如 ISOLATED 内监听）
// 时不破上下游 type。

// History API monkey-patch：SPA 路由切换（pushState / replaceState）默认不触发任何
// 事件，content script 原本靠 setInterval 1s 轮询 location.href 比对。100 个 tab
// 同时挂着 = 每秒 100 次轮询。改成 hook history API + 派发 __moo_url__ message，
// 配合 popstate / hashchange 事件 覆盖所有 SPA 框架的路由切换。
const TAG_URL = '__moo_url__'
function postUrl() {
  try { window.postMessage({ __moo: true, tag: TAG_URL }, location.origin) } catch {}
}
// 幂等：history.pushState/replaceState 重注入会二次包裹 → 每次路由切换重复派发 __moo_url__。
if (!mooAlreadyPatched) {
  const _push = history.pushState
  const _replace = history.replaceState
  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    const r = _push.apply(this, args)
    postUrl()
    return r
  }
  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    const r = _replace.apply(this, args)
    postUrl()
    return r
  }
  window.addEventListener('popstate', postUrl)
  window.addEventListener('hashchange', postUrl)
}

