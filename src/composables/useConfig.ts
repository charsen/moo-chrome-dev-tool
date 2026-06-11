import { ref } from 'vue'
import type { MooConfig } from '@/types/config'
import { loadConfig, saveConfig, onConfigChanged } from '@/storage/config'

const config = ref<MooConfig>({ projects: [], globalEnabled: true })
const loaded = ref(false)
// v0.8.9：自写回声识别从「计数器」改成「内容快照比对」。
// 旧计数器的坑：chrome.storage.local.set 写入与旧值**深相等时不 fire onChanged**
// （Chromium ValueStore 写前比对），而「无变化保存」很常见（blur 重 normalize 出
// 等值数组、unmount 无脏 flush）→ 计数 +1 永不归零 → 下一次**真外部变更**（popup 切
// globalEnabled / 另一窗口改配置）被当自写吞掉 → 本地 stale，随后任何保存把整份旧
// config 写回 = 静默回滚别处改动。
// 快照比对天然没这问题：no-op 写入不产生事件也不留残留；回声（内容 == 刚存的）跳过
// 保留防闪屏属性；用户在 write→echo 窗口内继续打字也不会被回声回滚（echo 匹配的是
// lastSaved 不是当前值）。
let lastSavedJson: string | null = null

const initPromise: Promise<void> = loadConfig().then((c) => {
  config.value = c
  loaded.value = true
})

onConfigChanged((next) => {
  if (!loaded.value || !next) return
  const nextJson = JSON.stringify(next)
  if (nextJson === lastSavedJson) return          // 自写回声
  if (nextJson === JSON.stringify(config.value)) return  // 内容已一致，替换只会闪屏
  config.value = next
})

export function useConfig() {
  return {
    config,
    loaded,
    ready: initPromise,
    async save() {
      lastSavedJson = JSON.stringify(config.value)
      await saveConfig(config.value)
    }
  }
}
