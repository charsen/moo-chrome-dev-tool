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
      storageKeys: Array.isArray(capture.storageKeys) ? capture.storageKeys.filter((x): x is string => typeof x === 'string') : [],
      requestBufferSize: typeof capture.requestBufferSize === 'number' && capture.requestBufferSize >= 5 ? Math.min(500, Math.round(capture.requestBufferSize)) : DEFAULT_CAPTURE.requestBufferSize
    },
    redact: {
      headerKeys: Array.isArray(redact.headerKeys) ? redact.headerKeys.filter((x): x is string => typeof x === 'string') : [...DEFAULT_REDACT.headerKeys],
      bodyKeys: Array.isArray(redact.bodyKeys) ? redact.bodyKeys.filter((x): x is string => typeof x === 'string') : [...DEFAULT_REDACT.bodyKeys],
      maskPasswordInputs: typeof redact.maskPasswordInputs === 'boolean' ? redact.maskPasswordInputs : DEFAULT_REDACT.maskPasswordInputs
    },
    enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
    token: typeof r.token === 'string' ? r.token : undefined
  }
}

function normalizeServer(raw: unknown): BugServer {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<BugServer>
  const headers = (r.headers && typeof r.headers === 'object' ? r.headers : {}) as Record<string, unknown>
  const cleanHeaders: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string') cleanHeaders[k] = v
  }
  return {
    id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
    name: typeof r.name === 'string' ? r.name : '服务器',
    method: r.method === 'PUT' || r.method === 'PATCH' ? r.method : 'POST',
    endpoint: typeof r.endpoint === 'string' ? r.endpoint : '',
    headers: cleanHeaders,
    imageField: typeof r.imageField === 'string' ? r.imageField : 'image',
    imageFormat: r.imageFormat === 'multipart' ? 'multipart' : 'base64',
    payloadTemplate: typeof r.payloadTemplate === 'string' ? r.payloadTemplate : DEFAULT_PAYLOAD_TEMPLATE
  }
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
