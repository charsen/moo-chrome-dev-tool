export type HttpMethod = 'POST' | 'PUT' | 'PATCH'
export type ImageFormat = 'base64' | 'multipart'

export interface BugServer {
  id: string
  name: string
  endpoint: string
  method: HttpMethod
  headers: Record<string, string>
  /**
   * Payload 模板。支持 {{var}} 字符串插值与 {{varJson}} 自动 JSON.stringify。
   * 当 imageFormat === 'multipart' 时，body 字段会按模板渲染后作为 form-data 字段，
   * 截图独立放在 imageField 指定的字段里。
   */
  payloadTemplate: string
  imageField: string
  imageFormat: ImageFormat
}

export interface CaptureConfig {
  /** 抓取最近网络请求 */
  requests: boolean
  /** 抓取 console.error / window.onerror / unhandledrejection */
  consoleErrors: boolean
  /** localStorage / sessionStorage 白名单 key */
  storageKeys: string[]
  /** 当前用户信息来源（可选） */
  userInfo?: {
    source: 'localStorage' | 'sessionStorage' | 'cookie'
    key: string
  }
  /** 环形缓冲：保留最近多少条请求 */
  requestBufferSize: number
}

export interface RedactConfig {
  /** 脱敏的 header key（不区分大小写） */
  headerKeys: string[]
  /** 脱敏的 body 字段名 */
  bodyKeys: string[]
  /** 截图前覆盖 type=password 输入框 */
  maskPasswordInputs: boolean
}

export interface Project {
  id: string
  name: string
  /** URL 通配模式，支持 * 通配，例如 https://*.example.com/* */
  matchPatterns: string[]
  servers: BugServer[]
  defaultServerId: string
  capture: CaptureConfig
  redact: RedactConfig
  /** 是否启用（关闭后即使匹配也不显示悬浮球） */
  enabled: boolean
  /**
   * 上报 token（每个开发者一个）。从 scaffold 的 /scaffold/accounts 页面获取。
   * 上报时会作为 Authorization: Bearer {token} 与 X-Scaffold-Token 同时注入；
   * 服务端命中后会自动用账号 username 作为提交人。
   */
  token?: string
}

export interface MooConfig {
  projects: Project[]
  /** 全局快捷键开关等可扩展 */
  globalEnabled: boolean
}

export const DEFAULT_CAPTURE: CaptureConfig = {
  requests: true,
  consoleErrors: true,
  storageKeys: [],
  requestBufferSize: 50
}

export const DEFAULT_REDACT: RedactConfig = {
  headerKeys: ['authorization', 'cookie', 'x-auth-token'],
  bodyKeys: ['password', 'token'],
  maskPasswordInputs: true
}

export const DEFAULT_PAYLOAD_TEMPLATE = `{
  "title": "{{title}}",
  "description": "{{description}}\\n\\n页面: {{url}}\\nUA: {{userAgent}}\\n视口: {{viewport}}\\n时间: {{timestamp}}",
  "screenshot": "{{image}}",
  "video": "{{video}}",
  "video_duration": {{videoDuration}},
  "video_bytes": {{videoBytes}},
  "context": {
    "url": "{{url}}",
    "userAgent": "{{userAgent}}",
    "requests": {{requestsJson}},
    "errors": {{errorsJson}}
  }
}`

export function createDefaultProject(name = '新项目'): Project {
  return {
    id: crypto.randomUUID(),
    name,
    matchPatterns: [],
    servers: [],
    defaultServerId: '',
    capture: { ...DEFAULT_CAPTURE },
    redact: { ...DEFAULT_REDACT, headerKeys: [...DEFAULT_REDACT.headerKeys], bodyKeys: [...DEFAULT_REDACT.bodyKeys] },
    enabled: true
  }
}

/**
 * 把任意 raw 数据补齐成合法 Project：未知/缺失字段用默认值兜底。
 * 用于：
 * - storage/config.ts loadConfig：老 storage 里 v0.0.x 时缺 capture/redact 的 project
 * - Environment.vue importConfig：用户导入他人 JSON 时可能没有所有字段
 *
 * **不抛**，能容忍多脏数据；返回的对象一定满足 Project schema，所有读取点直接用即可。
 */
export function normalizeProject(raw: unknown): Project {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Project>
  const capture = (r.capture && typeof r.capture === 'object' ? r.capture : {}) as Partial<CaptureConfig>
  const redact = (r.redact && typeof r.redact === 'object' ? r.redact : {}) as Partial<RedactConfig>
  return {
    id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
    name: typeof r.name === 'string' ? r.name : '新项目',
    matchPatterns: Array.isArray(r.matchPatterns) ? r.matchPatterns.filter((x): x is string => typeof x === 'string') : [],
    servers: Array.isArray(r.servers) ? r.servers.map(normalizeServer) : [],
    defaultServerId: typeof r.defaultServerId === 'string' ? r.defaultServerId : '',
    capture: {
      requests: typeof capture.requests === 'boolean' ? capture.requests : DEFAULT_CAPTURE.requests,
      consoleErrors: typeof capture.consoleErrors === 'boolean' ? capture.consoleErrors : DEFAULT_CAPTURE.consoleErrors,
      // localStorage / sessionStorage key 是页面侧的标识符，正常都是 [A-Za-z0-9_.-]
      // 攻击者导入配置可塞 `__proto__` / 含空格 / RTL 字符的 key 试图绕过 JS 引擎 / 触发原型污染。
      // 这里 + 限制 key 长度 ≤ 128 字符 + 限 50 个上限，防巨型配置卡 readPageStorage。
      storageKeys: Array.isArray(capture.storageKeys)
        ? capture.storageKeys
            .filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128 && /^[A-Za-z0-9_.\-:]+$/.test(x))
            .slice(0, 50)
        : [],
      requestBufferSize: typeof capture.requestBufferSize === 'number' && capture.requestBufferSize >= 5 ? Math.min(500, Math.round(capture.requestBufferSize)) : DEFAULT_CAPTURE.requestBufferSize
    },
    redact: {
      headerKeys: Array.isArray(redact.headerKeys) ? redact.headerKeys.filter((x): x is string => typeof x === 'string') : [...DEFAULT_REDACT.headerKeys],
      bodyKeys: Array.isArray(redact.bodyKeys) ? redact.bodyKeys.filter((x): x is string => typeof x === 'string') : [...DEFAULT_REDACT.bodyKeys],
      maskPasswordInputs: typeof redact.maskPasswordInputs === 'boolean' ? redact.maskPasswordInputs : DEFAULT_REDACT.maskPasswordInputs
    },
    enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
    // token 限制为可见 ASCII + 长度 ≤ 512；防导入巨量字符串或带 CRLF 注入到 Authorization
    token: typeof r.token === 'string' ? sanitizeToken(r.token) : undefined
  }
}

function sanitizeToken(raw: string): string | undefined {
  const s = raw.trim()
  if (!s) return undefined
  if (s.length > 512) return undefined
  // 只允许可打印 ASCII（包括 - . _ ~ + 等 OAuth token 常见字符），拒 CRLF / 控制符
  if (!/^[\x21-\x7E]+$/.test(s)) return undefined
  return s
}

/** 限制单条 header key/value 长度，防 4MB 大字段在 multipart 表头里溢出 */
const HEADER_KEY_MAX = 256
const HEADER_VAL_MAX = 4096
/** HTTP token 字符集（RFC 7230 §3.2.6）—— 排除 :/= 等 header name 不能有的字符 */
const HEADER_KEY_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
/** payloadTemplate 64KB 上限，超过即说明配置异常 */
const PAYLOAD_TEMPLATE_MAX = 64 * 1024

function normalizeServer(raw: unknown): BugServer {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<BugServer>
  const headers = (r.headers && typeof r.headers === 'object' ? r.headers : {}) as Record<string, unknown>
  const cleanHeaders: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v !== 'string') continue
    // key 必须是合法 HTTP token + 长度上限；防导入 4MB header name 让 multipart 表头爆裂
    if (typeof k !== 'string' || !k || k.length > HEADER_KEY_MAX) continue
    if (!HEADER_KEY_PATTERN.test(k)) continue
    // value 不能含 CRLF（防 header injection），不能超长
    if (v.length > HEADER_VAL_MAX) continue
    if (/[\r\n]/.test(v)) continue
    cleanHeaders[k] = v
  }
  const name = typeof r.name === 'string' ? r.name.slice(0, 100) : '服务器'
  const imageField = typeof r.imageField === 'string'
    ? sanitizeImageField(r.imageField)
    : 'image'
  const payloadTemplate = typeof r.payloadTemplate === 'string' && r.payloadTemplate.length <= PAYLOAD_TEMPLATE_MAX
    ? r.payloadTemplate
    : DEFAULT_PAYLOAD_TEMPLATE
  return {
    id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
    name,
    method: r.method === 'PUT' || r.method === 'PATCH' ? r.method : 'POST',
    endpoint: sanitizeEndpoint(r.endpoint),
    headers: cleanHeaders,
    imageField,
    imageFormat: r.imageFormat === 'multipart' ? 'multipart' : 'base64',
    payloadTemplate
  }
}

/** imageField 会作为 multipart form-data 字段名 + 模板里的 `{{imageField}}` 占位符；
 *  只允许 token-safe ASCII 防止注入怪异字符（如 `__proto__` / 含空格 / RTL chars）。 */
function sanitizeImageField(raw: string): string {
  const s = raw.trim().slice(0, 64)
  return /^[A-Za-z0-9_-]+$/.test(s) ? s : 'image'
}

/**
 * endpoint 协议白名单：仅允许 http / https；其他协议（javascript: / data: / file: / ftp:）
 * 一律清空。导入恶意 JSON 时这是关键防线——`collectEndpoints` 在确认 dialog 里显示给用户看的
 * 是文本，但如果不在这里清掉，确认后真的会拿 `javascript://...` 去 fetch。
 */
function sanitizeEndpoint(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const s = raw.trim()
  if (!s) return ''
  // 空字符串、相对路径、看起来像主机名 — 这些都不会发请求，留着；后端真要 fetch 时再校验
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return s
  // 有协议头时强校验
  try {
    const u = new URL(s)
    if (u.protocol === 'http:' || u.protocol === 'https:') return s
  } catch {
    // URL 解析失败也算可疑，清掉
  }
  return ''
}

export function createDefaultServer(name = '新服务器'): BugServer {
  return {
    id: crypto.randomUUID(),
    name,
    endpoint: '',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    payloadTemplate: DEFAULT_PAYLOAD_TEMPLATE,
    imageField: 'screenshot',
    imageFormat: 'base64'
  }
}
