import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MooConfig } from '@/types/config'

/**
 * v0.8.9 Fix E 回归：useConfig 自写回声识别从「pendingSelfWrites 计数器」改成
 * 「lastSavedJson 内容快照比对」。
 *
 * 旧计数器的泄漏：chrome.storage.local.set 写入值与旧值深相等时**不 fire onChanged**
 * （Chromium ValueStore 写前比对），而「无变化保存」很常见 → 计数 +1 永不归零 →
 * 下一次真外部变更（popup 切 globalEnabled / 另一窗口改配置）被当自写吞掉 →
 * 本地 stale，随后任何保存把整份旧 config 写回 = 静默回滚别处改动。
 *
 * 断面说明（单测层）：node 环境 stub chrome.storage（内存 Map + 手动捕获/触发
 * onChanged listener，模拟 chrome「等值写入不 fire」行为），动态 import 模块拿
 * 干净的 module-level state。不覆盖：真 chrome storage 事件时序 / 多窗口实机 ——
 * 归 e2e（panel-settings-toggle / popup-toggle-floating-ball-sync）+ 手测。
 */

type StorageListener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  area: string
) => void

let storageData: Record<string, unknown>
let storageListeners: StorageListener[]

function stubChrome() {
  storageData = {}
  storageListeners = []
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        async get(key: string) { return { [key]: storageData[key] } },
        async set(obj: Record<string, unknown>) { Object.assign(storageData, obj) },
        async remove(key: string) { delete storageData[key] }
      },
      onChanged: {
        addListener: (fn: StorageListener) => { storageListeners.push(fn) },
        removeListener: (fn: StorageListener) => {
          storageListeners = storageListeners.filter((l) => l !== fn)
        }
      }
    }
  })
}

/** 模拟 chrome 派发 mooConfig 变更事件（外部变更 / 自写回声都走这里） */
function fireConfigChanged(newValue: unknown) {
  for (const l of storageListeners) l({ mooConfig: { newValue } }, 'local')
}

async function importUseConfig() {
  const mod = await import('@/composables/useConfig')
  const { config, loaded, ready, save } = mod.useConfig()
  await ready
  expect(loaded.value).toBe(true)
  return { config, save }
}

beforeEach(() => {
  vi.resetModules()   // useConfig 是 module-level 单例（config ref + lastSavedJson），每测重置
  stubChrome()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useConfig — v0.8.9 自写回声改内容快照比对（Fix E）', () => {
  it('① 核心泄漏修复：save 相同内容（onChanged 不 fire）后，外部真变更必须被接受', async () => {
    const { config, save } = await importUseConfig()
    expect(config.value.globalEnabled).toBe(true)

    // 保存与存量深相等的内容 —— 模拟 chrome 行为：不 fire onChanged。
    // 旧计数器版在此 pendingSelfWrites=1 永不归零。
    await save()

    // 随后 popup / 另一窗口切 globalEnabled=false → 真外部变更事件
    const external: MooConfig = { projects: [], globalEnabled: false }
    fireConfigChanged(external)

    // 修后：内容 != lastSavedJson → 接受新值。旧版被残留计数吞掉（仍是 true）→ 红
    expect(config.value.globalEnabled).toBe(false)
  })

  it('② 自写回声（内容 == 刚存的）→ 不替换对象引用（防闪屏属性保留）', async () => {
    const { config, save } = await importUseConfig()
    config.value = { projects: [], globalEnabled: false }
    await save()

    const refBefore = config.value
    // chrome 真实 fire 自写事件（值有变化时会 fire）
    fireConfigChanged({ projects: [], globalEnabled: false })
    expect(config.value).toBe(refBefore)   // 引用不变 → 表单不重挂载
  })

  it('③ 外部不同内容（无 save 前置）→ 直接接受', async () => {
    const { config } = await importUseConfig()
    fireConfigChanged({ projects: [], globalEnabled: false })
    expect(config.value.globalEnabled).toBe(false)
  })

  it('④ 内容与当前一致的非回声事件 → 不替换引用（第二道防闪屏守卫）', async () => {
    const { config } = await importUseConfig()
    const refBefore = config.value
    // lastSavedJson 仍是 null（没 save 过），但事件内容与当前完全一致
    fireConfigChanged({ projects: [], globalEnabled: true })
    expect(config.value).toBe(refBefore)
  })

  it('⑤ 回声窗口内用户继续改值 → 回声不回滚当前编辑（echo 匹配 lastSaved 不匹配当前值）', async () => {
    const { config, save } = await importUseConfig()
    config.value = { projects: [], globalEnabled: false }
    await save()
    // write→echo 窗口内用户又切回 true（尚未 save）
    config.value = { projects: [], globalEnabled: true }
    // 迟到的自写回声（内容 == 刚存的 false 版本）
    fireConfigChanged({ projects: [], globalEnabled: false })
    // 回声必须被跳过，不能把用户正在编辑的 true 回滚成 false
    expect(config.value.globalEnabled).toBe(true)
  })
})
