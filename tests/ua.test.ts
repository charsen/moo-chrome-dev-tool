import { describe, it, expect } from 'vitest'
import { parseUserAgent } from '@/utils/ua'

describe('parseUserAgent', () => {
  it('Chrome on macOS', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
    expect(parseUserAgent(ua)).toEqual({ os: 'osx', browser: 'chrome' })
  })

  it('Safari on macOS', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
    expect(parseUserAgent(ua)).toEqual({ os: 'osx', browser: 'safari' })
  })

  it('Chrome on Windows 10', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    expect(parseUserAgent(ua)).toEqual({ os: 'win10', browser: 'chrome' })
  })

  it('Edge on Windows 10（Edg/ 优先于 Chrome 判断）', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Edg/120.0.0.0'
    expect(parseUserAgent(ua)).toEqual({ os: 'win10', browser: 'edge' })
  })

  it('Firefox on Linux', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'
    expect(parseUserAgent(ua)).toEqual({ os: 'linux', browser: 'firefox' })
  })

  it('Safari on iPhone', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'
    expect(parseUserAgent(ua)).toEqual({ os: 'ios', browser: 'safari' })
  })

  it('Chrome on Android', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
    // 注意：UA 里 Android 关键字优先于 Linux（detectOs 顺序保证）
    expect(parseUserAgent(ua)).toEqual({ os: 'android', browser: 'chrome' })
  })

  it('Opera on Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 OPR/105.0.0.0'
    expect(parseUserAgent(ua)).toEqual({ os: 'win10', browser: 'opera' })
  })

  it('Win 7', () => {
    const ua = 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) Chrome/120.0.0.0'
    expect(parseUserAgent(ua).os).toBe('win7')
  })

  it('未知 UA 返 others/other 兜底', () => {
    expect(parseUserAgent('SomethingWeird/1.0')).toEqual({ os: 'others', browser: 'other' })
  })

  it('空字符串不抛', () => {
    expect(parseUserAgent('')).toEqual({ os: 'others', browser: 'other' })
  })
})
