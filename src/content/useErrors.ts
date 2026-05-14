import { computed, ref } from 'vue'
import type { ConsoleError } from '@/types/errors'

const errors = ref<ConsoleError[]>([])
let bufferSize = 50
let started = false

function push(e: ConsoleError) {
  errors.value.push(e)
  while (errors.value.length > bufferSize) errors.value.shift()
}

function start() {
  if (started) return
  started = true
  window.addEventListener('message', (e) => {
    if (e.source !== window) return
    const data = e.data as { __moo?: boolean; tag?: string; payload?: ConsoleError }
    if (!data?.__moo || data.tag !== '__moo_err__' || !data.payload) return
    push(data.payload)
  })
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
