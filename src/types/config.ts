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

export interface SubmitterSource {
  /** 提交人名字，手动填写 */
  value: string
  /** 注入到上报请求的 header 名，默认 'X-Submitter' */
  headerName?: string
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
  /** 自动从页面 storage / cookie 取提交人名，注入到上报 header */
  submitterSource?: SubmitterSource
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
