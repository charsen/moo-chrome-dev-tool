import { ref, computed } from 'vue'
import type { CapturedRequest } from '@/types/requests'
import type { CaptureConfig, RedactConfig } from '@/types/config'
import { redactRequest } from '@/utils/redact'

const requests = ref<CapturedRequest[]>([])
let bufferSize = 50
let currentRedact: RedactConfig | null = null
let started = false

function push(r: CapturedRequest) {
  requests.value.push(r)
  while (requests.value.length > bufferSize) requests.value.shift()
}

export function getCurrentRequests(): CapturedRequest[] {
  return requests.value.slice()
}

export function clearRequests() {
  requests.value = []
}

function start(initialCfg: { capture?: CaptureConfig; redact?: RedactConfig } = {}) {
  if (started) return
  started = true
  if (initialCfg.capture) bufferSize = initialCfg.capture.requestBufferSize ?? 50
  if (initialCfg.redact) currentRedact = initialCfg.redact

  window.addEventListener('message', (e) => {
    if (e.source !== window) return
    const data = e.data as { __moo?: boolean; tag?: string; payload?: CapturedRequest }
    if (!data?.__moo || data.tag !== '__moo_req__' || !data.payload) return
    const r = currentRedact ? redactRequest(data.payload, currentRedact) : data.payload
    push(r)
  })
}

export function useRequests() {
  return {
    requests: computed(() => requests.value),
    start,
    setConfig(cfg: { capture?: CaptureConfig; redact?: RedactConfig }) {
      if (cfg.capture) bufferSize = cfg.capture.requestBufferSize ?? 50
      if (cfg.redact) currentRedact = cfg.redact
    },
    clear() {
      requests.value = []
    },
    /** 取在某时间点前 windowMs 内完成的请求 */
    sliceByTime(now: number, windowMs: number) {
      const cutoff = now - windowMs
      return requests.value.filter((r) => r.startTime + r.duration >= cutoff)
    }
  }
}
