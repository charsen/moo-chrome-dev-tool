import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * v0.7.0：claude 二轮+三轮同款扫描找到 background/index.ts 的 chrome.permissions.onAdded
 * listener 单测 + e2e 双 0 覆盖。v0.7.0 抽 export onHostPermissionAdded 后补单测。
 */

let storageData: Record<string, unknown>

beforeEach(() => {
  storageData = { mooNeedsHostPermUpgrade: true }
  ;(globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        async get(key: string) { return { [key]: storageData[key] } },
        async set(obj: Record<string, unknown>) { Object.assign(storageData, obj) },
        async remove(key: string) { delete storageData[key] }
      },
      onChanged: { addListener() {}, removeListener() {} }
    },
    permissions: {
      onAdded: { addListener() {} },
      onRemoved: { addListener() {} }
    },
    alarms: {
      onAlarm: { addListener() {} },
      async get() { return undefined },
      async create() {}
    },
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener() {} },
      onConnect: { addListener() {} },
      id: 'test',
      getManifest: () => ({ version: '0.7.0', content_scripts: [] })
    },
    commands: { onCommand: { addListener() {} } },
    scripting: {
      async getRegisteredContentScripts() { return [] },
      async unregisterContentScripts() {},
      async registerContentScripts() {}
    },
    windows: { onRemoved: { addListener() {} } }
  }
})

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
})

describe('onHostPermissionAdded', () => {
  it('授权 <all_urls> → 清 mooNeedsHostPermUpgrade flag', async () => {
    const { onHostPermissionAdded } = await import('@/background/index')
    await onHostPermissionAdded({ origins: ['<all_urls>'] })
    expect(storageData.mooNeedsHostPermUpgrade).toBeUndefined()
  })

  it('授权 *://*/* → 同样清 flag（chrome 等价 <all_urls>）', async () => {
    const { onHostPermissionAdded } = await import('@/background/index')
    await onHostPermissionAdded({ origins: ['*://*/*'] })
    expect(storageData.mooNeedsHostPermUpgrade).toBeUndefined()
  })

  it('授权特定 origin（不是全权）→ 不动 flag', async () => {
    const { onHostPermissionAdded } = await import('@/background/index')
    await onHostPermissionAdded({ origins: ['https://example.com/*'] })
    expect(storageData.mooNeedsHostPermUpgrade).toBe(true)
  })

  it('origins 缺省 → noop', async () => {
    const { onHostPermissionAdded } = await import('@/background/index')
    await onHostPermissionAdded({})
    expect(storageData.mooNeedsHostPermUpgrade).toBe(true)
  })

  it('storage.remove throw → 静默不传播（flag 残留 OK，不影响主流程）', async () => {
    ;(globalThis as { chrome: { storage: { local: { remove: () => Promise<void> } } } })
      .chrome.storage.local.remove = async () => { throw new Error('boom') }
    const { onHostPermissionAdded } = await import('@/background/index')
    await expect(onHostPermissionAdded({ origins: ['<all_urls>'] })).resolves.not.toThrow()
  })
})
