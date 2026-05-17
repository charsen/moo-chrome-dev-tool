import { ref, computed } from 'vue'
import type { CapturedRequest } from '@/types/requests'
import type { CaptureConfig, RedactConfig } from '@/types/config'
import { redactRequest } from '@/utils/redact'

const requests = ref<CapturedRequest[]>([])
let bufferSize = 50
let currentRedact: RedactConfig | null = null
let started = false

/**
 * postMessage 通道无法做加密签名，所以靠"长得像不像"挡掉随便伪造的载荷。
 * 必填字段都是基本类型；可选字段（error）不校验。攻击者要伪造的话必须把所有
 * 必填字段都写对，本质上等同于"故意上报一条假请求"——这种程度的攻击在
 * 同源脚本上下文里已无防御意义（同源脚本本身能干更糟的事）。
 */
function isValidRequestPayload(p: unknown): p is CapturedRequest {
  if (!p || typeof p !== 'object') return false
  const r = p as Record<string, unknown>
  return typeof r.url === 'string'
    && typeof r.method === 'string'
    && typeof r.status === 'number'
    && typeof r.duration === 'number'
    && typeof r.startedAt === 'string'
}

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
    // 三重防伪造：(1) 必须是本窗口自己 postMessage（拦跨 frame）；
    // (2) origin 必须是当前页面 origin（拦跨域 iframe 的 same-source 攻击）；
    // (3) payload 必须长得像 CapturedRequest（拦同源页面脚本伪造 telemetry）。
    if (e.source !== window) return
    if (e.origin !== location.origin) return
    const data = e.data as { __moo?: boolean; tag?: string; payload?: unknown }
    if (!data?.__moo || data.tag !== '__moo_req__') return
    if (!isValidRequestPayload(data.payload)) return
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
