import { computed, ref } from 'vue'
import type { ConsoleError } from '@/types/errors'
import { DEFAULT_REDACT, type RedactConfig } from '@/types/config'
import { redactBody, redactUrl } from '@/utils/redact'

const errors = ref<ConsoleError[]>([])
let bufferSize = 50
let started = false
// v0.4.8：capture.consoleErrors 开关真生效（同 useRequests.ts 同款修）
let captureEnabled = true
// 错误消息/堆栈同样可能带密钥：axios 错误会回显请求 URL（含 access_token）、
// 鉴权失败会带 Bearer/Authorization 原文、框架错误会打印组件 props。跟请求一样
// 用项目 redact 配置处理，默认 DEFAULT_REDACT 兜住配置加载完成前的空窗期。
let currentRedact: RedactConfig = DEFAULT_REDACT

function redactError(e: ConsoleError): ConsoleError {
  const keys = currentRedact.bodyKeys
  const message = redactBody(e.message, keys) ?? e.message
  const stack = e.stack ? (redactBody(e.stack, keys) ?? e.stack) : e.stack
  const source = e.source ? redactUrl(e.source, keys) : e.source
  if (message === e.message && stack === e.stack && source === e.source) return e
  return { ...e, message, stack, source }
}

function push(e: ConsoleError) {
  errors.value.push(redactError(e))
  while (errors.value.length > bufferSize) errors.value.shift()
}

/**
 * 见 useRequests.ts 同名函数注释——shape 校验仅挡随手伪造，不防同源恶意脚本。
 * v0.7.9 加固：补 id / startTime 必填 + 可选字段（stack/source/line/col）若存在
 * 必须类型对，防 main-world 演化漏字段或同源脚本传 object/null 把下游断言 / dedupe / JSON.stringify 整崩。
 */
export function isValidErrorPayload(p: unknown): p is ConsoleError {
  if (!p || typeof p !== 'object') return false
  const e = p as Record<string, unknown>
  if (typeof e.id !== 'string') return false
  if (typeof e.level !== 'string') return false
  if (typeof e.message !== 'string') return false
  if (typeof e.startedAt !== 'string') return false
  if (typeof e.startTime !== 'number') return false
  // 可选字段：只在 defined 时校 shape
  if (e.stack !== undefined && typeof e.stack !== 'string') return false
  if (e.source !== undefined && typeof e.source !== 'string') return false
  if (e.line !== undefined && typeof e.line !== 'number') return false
  if (e.col !== undefined && typeof e.col !== 'number') return false
  return true
}

function start() {
  if (started) return
  started = true
  window.addEventListener('message', (e) => {
    if (e.source !== window) return
    if (e.origin !== location.origin) return
    const data = e.data as { __moo?: boolean; tag?: string; payload?: unknown }
    if (!data?.__moo || data.tag !== '__moo_err__') return
    if (!isValidErrorPayload(data.payload)) return
    if (!captureEnabled) return  // v0.4.8：用户在 Settings 关了 consoleErrors → 不入 buffer
    push(data.payload)
  })
}

export function setErrorsEnabled(enabled: boolean): void {
  captureEnabled = enabled
  if (!enabled) errors.value = []  // 切到 off 时清已 buffer
}

/** 项目 redact 配置变化时同步：新抓的错误按新规则脱敏（已 buffer 的不回溯，同 useRequests） */
export function setErrorsRedact(cfg: RedactConfig | undefined): void {
  currentRedact = cfg ?? DEFAULT_REDACT
}

export function getCurrentErrors(): ConsoleError[] {
  return errors.value.slice()
}

export function clearErrors() {
  errors.value = []
}

export function useErrors() {
  return {
    errors: computed(() => errors.value),
    start,
    setBufferSize(n: number) { bufferSize = n },
    setRedact: setErrorsRedact,
    clear: clearErrors
  }
}
