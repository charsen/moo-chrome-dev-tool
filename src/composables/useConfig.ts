import { ref } from 'vue'
import type { MooConfig } from '@/types/config'
import { loadConfig, saveConfig, onConfigChanged } from '@/storage/config'

const config = ref<MooConfig>({ projects: [], globalEnabled: true })
const loaded = ref(false)
// 标记自己刚写入的次数：onConfigChanged 收到自写变更时跳过一次，避免
// 用一个新对象替换 config.value 导致输入框/表单重新挂载（视觉闪屏）。
let pendingSelfWrites = 0

const initPromise: Promise<void> = loadConfig().then((c) => {
  config.value = c
  loaded.value = true
})

onConfigChanged((next) => {
  if (!loaded.value) return
  if (pendingSelfWrites > 0) {
    pendingSelfWrites--
    return
  }
  if (next) config.value = next
})

export function useConfig() {
  return {
    config,
    loaded,
    ready: initPromise,
    async save() {
      pendingSelfWrites++
      try {
        await saveConfig(config.value)
      } catch (e) {
        pendingSelfWrites--
        throw e
      }
    }
  }
}
