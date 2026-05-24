import { computed, ref } from 'vue'
import type { ConsoleError } from '@/types/errors'

const errors = ref<ConsoleError[]>([])
let bufferSize = 50
let started = false
// v0.4.8：capture.consoleErrors 开关真生效（同 useRequests.ts 同款修）
let captureEnabled = true

function push(e: ConsoleError) {
  errors.value.push(e)
  while (errors.value.length > bufferSize) errors.value.shift()
}

/** 见 useRequests.ts 同名函数注释——shape 校验仅挡随手伪造，不防同源恶意脚本。 */
function isValidErrorPayload(p: unknown): p is ConsoleError {
  if (!p || typeof p !== 'object') return false
  const e = p as Record<string, unknown>
  return typeof e.level === 'string'
    && typeof e.message === 'string'
    && typeof e.startedAt === 'string'
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
    clear: clearErrors
  }
}
