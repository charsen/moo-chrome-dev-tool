import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isNewer, fetchLatestVersion, runVersionCheck, VERSION_CHECK_FLAG_KEY,
  writeUpgradeIntent, checkUpgradeFinished, UPGRADE_INTENT_KEY, UPGRADED_TOAST_KEY
} from '@/utils/versionCheck'

/**
 * v0.6.2 后立的版本检查机制单测。
 */

describe('isNewer', () => {
  it('0.6.3 > 0.6.2 → true', () => {
    expect(isNewer('0.6.3', '0.6.2')).toBe(true)
  })

  it('0.6.2 > 0.6.2 → false', () => {
    expect(isNewer('0.6.2', '0.6.2')).toBe(false)
  })

  it('0.6.1 < 0.6.2 → false', () => {
    expect(isNewer('0.6.1', '0.6.2')).toBe(false)
  })

  it('v 前缀正确剥离', () => {
    expect(isNewer('v1.0.0', '0.9.9')).toBe(true)
    expect(isNewer('1.0.0', 'v0.9.9')).toBe(true)
  })

  it('major / minor / patch 三段都对比', () => {
    expect(isNewer('1.0.0', '0.99.99')).toBe(true)
    expect(isNewer('0.7.0', '0.6.99')).toBe(true)
  })

  it('非 SemVer 格式 → false（不弹 banner）', () => {
    expect(isNewer('latest', '0.6.2')).toBe(false)
    expect(isNewer('1.0', '0.9.0')).toBe(false)
    expect(isNewer('0.6.2-beta', '0.6.1')).toBe(false)
  })
})

describe('fetchLatestVersion', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('happy path：返 tag + url', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      tag_name: 'v0.7.0',
      html_url: 'https://gitee.com/x/y/releases/v0.7.0'
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const r = await fetchLatestVersion()
    expect(r?.tag).toBe('v0.7.0')
    expect(r?.url).toContain('v0.7.0')
  })

  it('html_url 缺 → fallback 通用 releases 页面', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tag_name: 'v0.7.0' }), { status: 200 })))
    const r = await fetchLatestVersion()
    expect(r?.url).toContain('/releases')
  })

  it('fetch 失败 → null（不传播）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    expect(await fetchLatestVersion()).toBeNull()
  })

  it('HTTP 5xx → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('err', { status: 500 })))
    expect(await fetchLatestVersion()).toBeNull()
  })

  it('tag_name 不是 string → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tag_name: 123 }), { status: 200 })))
    expect(await fetchLatestVersion()).toBeNull()
  })
})

describe('runVersionCheck', () => {
  let storage: Record<string, unknown>

  beforeEach(() => {
    storage = {}
    vi.unstubAllGlobals()
    ;(globalThis as { chrome?: unknown }).chrome = {
      runtime: { getManifest: () => ({ version: '0.6.2' }) },
      storage: {
        local: {
          async get(key: string) { return { [key]: storage[key] } },
          async set(obj: Record<string, unknown>) { Object.assign(storage, obj) },
          async remove(key: string) { delete storage[key] }
        }
      }
    }
  })

  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome
    vi.unstubAllGlobals()
  })

  it('远端有新版 → storage 写入 LatestVersionInfo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      tag_name: 'v0.7.0',
      html_url: 'https://gitee.com/x/y/releases/v0.7.0'
    }), { status: 200 })))
    await runVersionCheck()
    const info = storage[VERSION_CHECK_FLAG_KEY] as { latest: string; current: string }
    expect(info?.latest).toBe('0.7.0')
    expect(info?.current).toBe('0.6.2')
  })

  it('远端跟本地一致 → 清掉残留 flag', async () => {
    storage[VERSION_CHECK_FLAG_KEY] = { latest: '0.7.0', current: '0.6.2', url: '', checkedAt: Date.now() }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      tag_name: 'v0.6.2'
    }), { status: 200 })))
    await runVersionCheck()
    expect(storage[VERSION_CHECK_FLAG_KEY]).toBeUndefined()
  })

  it('远端 fetch 失败 → flag 不变（保留之前的）', async () => {
    storage[VERSION_CHECK_FLAG_KEY] = { latest: '0.7.0', current: '0.6.2', url: '', checkedAt: Date.now() }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    await runVersionCheck()
    expect(storage[VERSION_CHECK_FLAG_KEY]).toBeDefined()
  })

  it('远端版本更老 → 清 flag（防降级误弹）', async () => {
    storage[VERSION_CHECK_FLAG_KEY] = { latest: '0.5.0', current: '0.6.2', url: '', checkedAt: Date.now() }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      tag_name: 'v0.5.0'
    }), { status: 200 })))
    await runVersionCheck()
    expect(storage[VERSION_CHECK_FLAG_KEY]).toBeUndefined()
  })

  // v0.8.1 hotfix：三态返值（newer / latest / fail）— 修「fetch fail 时 UI 谎报已是最新」
  describe('v0.8.1 三态返值', () => {
    it('远端有新版 → 返 "newer"', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        tag_name: 'v0.7.0'
      }), { status: 200 })))
      expect(await runVersionCheck()).toBe('newer')
    })

    it('远端 = 本地 → 返 "latest"', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        tag_name: 'v0.6.2'
      }), { status: 200 })))
      expect(await runVersionCheck()).toBe('latest')
    })

    it('远端版本更老 → 返 "latest"（开发版本 > tag 也算最新）', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        tag_name: 'v0.5.0'
      }), { status: 200 })))
      expect(await runVersionCheck()).toBe('latest')
    })

    it('Gitee API 限流 403 → 返 "fail"（不再谎报 latest）', async () => {
      vi.stubGlobal('fetch', vi.fn(async () =>
        new Response('403 Forbidden (Rate Limit Exceeded)', { status: 403 })
      ))
      expect(await runVersionCheck()).toBe('fail')
    })

    it('fetch throw → 返 "fail"', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
      expect(await runVersionCheck()).toBe('fail')
    })

    it('返 JSON 无 tag_name → 返 "fail"', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })))
      expect(await runVersionCheck()).toBe('fail')
    })

    it('返非 SemVer tag（如 "preview"）→ 返 "fail"（不让 isNewer 误判 latest）', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        tag_name: 'preview'
      }), { status: 200 })))
      expect(await runVersionCheck()).toBe('fail')
    })
  })
})

describe('writeUpgradeIntent + checkUpgradeFinished (v0.7.6 升级闭合)', () => {
  let storage: Record<string, unknown>

  function setupChrome(currentVersion: string) {
    storage = {}
    ;(globalThis as { chrome?: unknown }).chrome = {
      runtime: { getManifest: () => ({ version: currentVersion }) },
      storage: {
        local: {
          async get(key: string | string[]) {
            if (Array.isArray(key)) {
              return Object.fromEntries(key.map(k => [k, storage[k]]))
            }
            return { [key]: storage[key] }
          },
          async set(obj: Record<string, unknown>) { Object.assign(storage, obj) },
          async remove(key: string | string[]) {
            const keys = Array.isArray(key) ? key : [key]
            for (const k of keys) delete storage[k]
          }
        }
      }
    }
  }

  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome
  })

  it('writeUpgradeIntent 写入 expected + at', async () => {
    setupChrome('0.7.5')
    await writeUpgradeIntent('0.7.6')
    const intent = storage[UPGRADE_INTENT_KEY] as { expected: string; at: number } | undefined
    expect(intent?.expected).toBe('0.7.6')
    expect(typeof intent?.at).toBe('number')
    expect(intent!.at).toBeGreaterThan(0)
  })

  it('升级匹配 → 写 UPGRADED_TOAST + 清 VERSION_CHECK_FLAG + 清 INTENT', async () => {
    setupChrome('0.7.6')  // 当前已经是 0.7.6
    storage[UPGRADE_INTENT_KEY] = { expected: '0.7.6', at: Date.now() - 1000 }
    storage[VERSION_CHECK_FLAG_KEY] = { latest: '0.7.6', current: '0.7.5', url: 'x', checkedAt: Date.now() }
    await checkUpgradeFinished()
    const toast = storage[UPGRADED_TOAST_KEY] as { version: string } | undefined
    expect(toast?.version).toBe('0.7.6')
    expect(storage[VERSION_CHECK_FLAG_KEY]).toBeUndefined()  // banner 清
    expect(storage[UPGRADE_INTENT_KEY]).toBeUndefined()  // intent 清
  })

  it('升级不匹配（manifest 仍是旧）→ 不动 toast / banner / intent 留着等下次', async () => {
    setupChrome('0.7.5')  // 没真升上去
    storage[UPGRADE_INTENT_KEY] = { expected: '0.7.6', at: Date.now() - 1000 }
    storage[VERSION_CHECK_FLAG_KEY] = { latest: '0.7.6', current: '0.7.5', url: 'x', checkedAt: Date.now() }
    await checkUpgradeFinished()
    expect(storage[UPGRADED_TOAST_KEY]).toBeUndefined()  // 没 toast
    expect(storage[VERSION_CHECK_FLAG_KEY]).toBeDefined()  // banner 还在
    expect(storage[UPGRADE_INTENT_KEY]).toBeDefined()  // intent 留着
  })

  it('intent 超过 24h 过期 → 清 intent 不发 toast', async () => {
    setupChrome('0.7.6')
    storage[UPGRADE_INTENT_KEY] = { expected: '0.7.6', at: Date.now() - 25 * 60 * 60_000 }  // 25h 前
    await checkUpgradeFinished()
    expect(storage[UPGRADED_TOAST_KEY]).toBeUndefined()
    expect(storage[UPGRADE_INTENT_KEY]).toBeUndefined()  // 过期清掉
  })

  it('intent 23h 内还有效 → 升级匹配后弹 toast（dogfood 用户开会回来场景）', async () => {
    setupChrome('0.7.6')
    storage[UPGRADE_INTENT_KEY] = { expected: '0.7.6', at: Date.now() - 23 * 60 * 60_000 }  // 23h 前
    await checkUpgradeFinished()
    const toast = storage[UPGRADED_TOAST_KEY] as { version: string } | undefined
    expect(toast?.version).toBe('0.7.6')
  })

  it('没 intent → no-op（不抛错）', async () => {
    setupChrome('0.7.6')
    await checkUpgradeFinished()  // 不应 throw
    expect(storage[UPGRADED_TOAST_KEY]).toBeUndefined()
  })
})
