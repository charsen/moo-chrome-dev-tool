export type HttpMethod = 'POST' | 'PUT' | 'PATCH'
export type ImageFormat = 'base64' | 'multipart'
export type ProjectKind = 'webhook' | 'zentao'

/**
 * 禅道项目配置（B' 路径，v0.2.0 起）。
 * password 按用户 2026-05-21 决策本地明文存 chrome.storage.local（不进 sync 不上云）。
 * 不做用户态加密 —— chrome.storage 已按用户隔离，再加密只让用户误以为更安全。
 */
export interface ZentaoProjectConfig {
  /** 禅道地址，强校验 http(s)://；trim trailing slash 在 normalize 里做 */
  baseUrl: string
  /** 禅道账号（同浏览器登录用的） */
  account: string
  /** 禅道密码 */
  password: string
  /** 必填，> 0 */
  projectId: number
  /** ≥ 0，默认 0 */
  moduleId: number
  defaultSeverity: 1 | 2 | 3 | 4
  defaultPri: 1 | 2 | 3 | 4
  defaultType: string
  /** 可空；留空则禅道按项目规则自己分派 */
  defaultAssignedTo?: string
}

export const DEFAULT_ZENTAO: ZentaoProjectConfig = {
  baseUrl: '',
  account: '',
  password: '',
  projectId: 0,
  moduleId: 0,
  defaultSeverity: 3,
  defaultPri: 3,
  defaultType: 'codeerror'
}

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
  /**
   * 上报通道类型。v0.2.0 起加入。老数据无此字段时 normalize 默认 'webhook' 兼容。
   * - 'webhook': 用 servers + payloadTemplate（v0.1.x 老路径）
   * - 'zentao': 用 zentao.{baseUrl, account, password, projectId, ...} 直接对接禅道
   */
  kind: ProjectKind
  servers: BugServer[]
  defaultServerId: string
  /**
   * 禅道配置；kind='zentao' 时使用。
   * 即使 kind 切回 'webhook' 也保留此字段（用户切回去不丢配置），但 normalize 会清空 password。
   */
  zentao?: ZentaoProjectConfig
  capture: CaptureConfig
  redact: RedactConfig
  /** 是否启用（关闭后即使匹配也不显示悬浮球） */
  enabled: boolean
  /**
   * 上报 token（每个开发者一个）。从 scaffold 的 /scaffold/accounts 页面获取。
   * 通过 payload 模板的 `{{token}}` 占位符写进 POST body 的 token 字段（webhook 风格，
   * 不进 header / 不进 URL），后端读 body.token 校验。服务端命中后自动用账号 username
   * 作为提交人。
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
  "token": "{{token}}",
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
    kind: 'webhook',
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
    // 老数据无 kind 字段时默认 'webhook'，与 v0.1.x 一致行为兼容
    kind: r.kind === 'zentao' ? 'zentao' : 'webhook',
    servers: Array.isArray(r.servers) ? r.servers.map(normalizeServer) : [],
    defaultServerId: typeof r.defaultServerId === 'string' ? r.defaultServerId : '',
    // zentao 字段即使 kind='webhook' 也保留（用户切回去不丢配置）；
    // 不存在或全部字段不合法时返回 undefined 防止 schema 里塞空对象误导
    zentao: normalizeZentao(r.zentao),
    capture: {
      requests: typeof capture.requests === 'boolean' ? capture.requests : DEFAULT_CAPTURE.requests,
      consoleErrors: typeof capture.consoleErrors === 'boolean' ? capture.consoleErrors : DEFAULT_CAPTURE.consoleErrors,
      // localStorage / sessionStorage key 是页面侧的标识符，正常都是 [A-Za-z0-9_.-]
      // 攻击者导入配置可塞 `__proto__` / 含空格 / RTL 字符的 key 试图绕过 JS 引擎 / 触发原型污染。
      // 这里 + 限制 key 长度 ≤ 128 字符 + 限 50 个上限，防巨型配置卡 readPageStorage。
      // 额外显式黑名单 __proto__ / constructor / prototype —— 这三个名字满足
      // [A-Za-z0-9_] 但用 obj[key] 访问时会爬原型链，是经典原型污染入口。
      storageKeys: Array.isArray(capture.storageKeys)
        ? capture.storageKeys
            .filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128 && /^[A-Za-z0-9_.\-:]+$/.test(x) && !isReservedKey(x))
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

// ─────────────── ZentaoProjectConfig normalize / sanitize ───────────────

/**
 * 把 raw.zentao（可能来自老数据 / 用户导入 / partial UI 输入）兜成 ZentaoProjectConfig
 * 或 undefined。**不抛**，任何脏字段单独兜底。
 *
 * 即使 kind='webhook' 也保留 zentao 字段（防用户切回去丢配置），但 password 在
 * import / export 路径里另外剥（不在这里清，否则会破坏正常 save→load 流程）。
 */
function normalizeZentao(raw: unknown): ZentaoProjectConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Partial<ZentaoProjectConfig>
  return {
    baseUrl: sanitizeZentaoBaseUrl(r.baseUrl),
    account: sanitizeZentaoAccount(r.account),
    password: sanitizeZentaoPassword(r.password),
    projectId: sanitizePositiveInt(r.projectId, 0),
    moduleId: sanitizeNonNegInt(r.moduleId, DEFAULT_ZENTAO.moduleId),
    defaultSeverity: sanitizeSeverityOrPri(r.defaultSeverity, DEFAULT_ZENTAO.defaultSeverity),
    defaultPri: sanitizeSeverityOrPri(r.defaultPri, DEFAULT_ZENTAO.defaultPri),
    defaultType: sanitizeBugType(r.defaultType),
    defaultAssignedTo: typeof r.defaultAssignedTo === 'string'
      ? (sanitizeZentaoAccount(r.defaultAssignedTo) || undefined)
      : undefined
  }
}

/** baseUrl: 必须 http(s):// + trim trailing slash + 长度 ≤ 256 */
function sanitizeZentaoBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const s = raw.trim().replace(/\/+$/, '')
  if (!s || s.length > 256) return ''
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return s
  } catch { return '' }
}

/** account: 可见 ASCII，长度 ≤ 64（禅道账号通常是手机号 / 邮箱 / 字母数字） */
function sanitizeZentaoAccount(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const s = raw.trim()
  if (!s || s.length > 64) return ''
  if (!/^[\x21-\x7E]+$/.test(s)) return ''
  return s
}

/** password: 不 trim（前后空格可能合法），拒 CRLF（防 header injection），长度 ≤ 512 */
function sanitizeZentaoPassword(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  if (raw.length > 512) return ''
  if (/[\r\n]/.test(raw)) return ''
  return raw
}

function sanitizePositiveInt(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw
  if (typeof raw === 'string') {
    const n = Number(raw)
    if (Number.isInteger(n) && n > 0) return n
  }
  return fallback
}

function sanitizeNonNegInt(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw
  if (typeof raw === 'string') {
    const n = Number(raw)
    if (Number.isInteger(n) && n >= 0) return n
  }
  return fallback
}

function sanitizeSeverityOrPri(raw: unknown, fallback: 1 | 2 | 3 | 4): 1 | 2 | 3 | 4 {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (n === 1 || n === 2 || n === 3 || n === 4) return n
  return fallback
}

/** bug type 进 multipart 字段，限 token-safe ASCII + 防原型污染关键字 */
function sanitizeBugType(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_ZENTAO.defaultType
  const s = raw.trim().slice(0, 64)
  if (!s) return DEFAULT_ZENTAO.defaultType
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return DEFAULT_ZENTAO.defaultType
  if (isReservedKey(s)) return DEFAULT_ZENTAO.defaultType
  return s
}

/**
 * Import / export 用：剥掉 zentao.password（避免误传同事）。
 * 调用方决定是否使用——load 流程不要走这个，否则用户每次开浏览器都要重输密码。
 */
export function stripSensitiveProjectFields(p: Project): Project {
  if (!p.zentao) return p
  return { ...p, zentao: { ...p.zentao, password: '' } }
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
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return 'image'
  // regex 允许下划线，单独黑掉 prototype pollution 关键字
  if (isReservedKey(s)) return 'image'
  return s
}

/** 防原型污染：以下三个名字用 obj[key] 访问会落到 prototype 上而不是 own property，
 *  在 storage key / form field name / 模板变量名 等需要做"普通字符串"用的位置必须排除。 */
function isReservedKey(s: string): boolean {
  return s === '__proto__' || s === 'constructor' || s === 'prototype'
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
