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

function post(p: Payload) {
  try {
    window.postMessage({ __moo: true, tag: TAG, payload: p }, location.origin)
  } catch {}
}

function shouldSkip(url: string): boolean {
  return /^(chrome-extension|data|blob|chrome|moz-extension):/i.test(url)
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

// ---------- fetch ----------
const origFetch = window.fetch
window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
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
  } catch {}

  if (shouldSkip(url)) return origFetch.call(this, input as any, init)

  try {
    const resp = await origFetch.call(this, input as any, init)
    const duration = performance.now() - startTime
    let respBody: string | null = null
    let size = 0
    try {
      const cloned = resp.clone()
      const text = await cloned.text()
      size = text.length
      respBody = clip(text)
    } catch {}
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

XMLHttpRequest.prototype.open = function (this: MooXHR, method: string, url: string | URL) {
  // url 类型签名说是 string | URL，但浏览器实现允许任意类型，会内部 toString。
  // 我们 hook 时若直接 url.toString() 而 url 是 number / null 会扔 TypeError，
  // 污染宿主页 XHR 行为。安全转换：用 String() 包一道，无论入参类型都不抛。
  let safeUrl = ''
  try {
    safeUrl = url == null ? '' : String(url as unknown)
  } catch { /* Symbol 等不可 String 化的极端情况 */ }
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

XMLHttpRequest.prototype.setRequestHeader = function (this: MooXHR, k: string, v: string) {
  if (this.__moo) this.__moo.reqHeaders[k] = v
  return OrigSetHeader.call(this, k, v)
}

XMLHttpRequest.prototype.send = function (this: MooXHR, body?: Document | XMLHttpRequestBodyInit | null) {
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
            const text = this.responseText
            size = text.length
            respBody = clip(text)
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

function postErr(p: ErrPayload) {
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

const origConsoleErr = console.error
console.error = function (...args: unknown[]) {
  try {
    const msg = args.map((a) => {
      if (a instanceof Error) return a.message
      if (typeof a === 'string') return a
      try { return JSON.stringify(a) } catch { return String(a) }
    }).join(' ')
    const stack = args.find((a) => a instanceof Error) ? (args.find((a) => a instanceof Error) as Error).stack : undefined
    postErr(errFrom('console', msg, stack))
  } catch {}
  // ⚠ 异步切 task 再 forward 给原 console.error：
  // main-world.ts 虽然在 main-world 跑，但 source 是 extension，Chrome 把从
  // 这条栈 fire 的所有错误都归到 chrome://extensions 错误页。同步 invoke
  // origConsoleErr 时 stack 含 hook 帧 → 宿主页任何 console.error('xxx') 都
  // 被扩展背锅。setTimeout(0) 切到下一 task，stack 重置为 web 平台，归类
  // 才正确。代价：console.error 由 sync → async，但 99% 调用是 fire-and-
  // forget，体感无差；不切 task 则扩展错误页被宿主页错误持续污染。
  setTimeout(() => {
    try { origConsoleErr.apply(console, args as never) } catch {}
  }, 0)
}

// History API monkey-patch：SPA 路由切换（pushState / replaceState）默认不触发任何
// 事件，content script 原本靠 setInterval 1s 轮询 location.href 比对。100 个 tab
// 同时挂着 = 每秒 100 次轮询。改成 hook history API + 派发 __moo_url__ message，
// 配合 popstate / hashchange 事件 覆盖所有 SPA 框架的路由切换。
const TAG_URL = '__moo_url__'
function postUrl() {
  try { window.postMessage({ __moo: true, tag: TAG_URL }, location.origin) } catch {}
}
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

