import { describe, it, expect, vi, afterEach } from 'vitest'
import { downscaleToMaxWidth, MAX_SHOT_WIDTH } from '@/utils/image'

/**
 * downscaleToMaxWidth（v0.8.13）：上传前把高 DPI 截图缩到 ≤2560 宽。
 * 与服务端 ImageDownscaler::toMaxWidth 同语义：只缩不放、高度按比例、保留格式、失败返原图。
 * node 无 canvas，stub createImageBitmap/OffscreenCanvas/fetch 验缩放数学。
 */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** stub 一套 canvas 链路；返回 getter 拿到实际建的 canvas 尺寸（验等比缩放）。 */
function stubCanvas(srcW: number, srcH: number, blobType = 'image/png') {
  const cap = { w: 0, h: 0, outType: '' }
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => ({ type: blobType, arrayBuffer: async () => bytes }) })))
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: srcW, height: srcH, close: () => {} })))
  vi.stubGlobal('OffscreenCanvas', class {
    width: number; height: number
    constructor(w: number, h: number) { this.width = w; this.height = h; cap.w = w; cap.h = h }
    getContext() { return { drawImage: () => {} } }
    async convertToBlob(opts: { type: string }) { cap.outType = opts.type; return { type: opts.type, arrayBuffer: async () => bytes } }
  })
  return cap
}

afterEach(() => vi.unstubAllGlobals())

describe('downscaleToMaxWidth', () => {
  it('宽 > maxWidth → 缩到 maxWidth，高度等比', async () => {
    const cap = stubCanvas(3840, 2160) // 16:9 retina
    const out = await downscaleToMaxWidth(PNG, 2560)
    expect(cap.w).toBe(2560)
    expect(cap.h).toBe(1440) // round(2160 * 2560/3840)
    expect(out.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('宽 ≤ maxWidth → 原样返回（只缩不放，不重编码）', async () => {
    stubCanvas(1920, 1080)
    const out = await downscaleToMaxWidth(PNG, 2560)
    expect(out).toBe(PNG) // 原 dataUrl 原样
  })

  it('宽恰等于 maxWidth → 不动', async () => {
    stubCanvas(2560, 1600)
    expect(await downscaleToMaxWidth(PNG, 2560)).toBe(PNG)
  })

  it('保留源格式：jpeg → jpeg', async () => {
    const cap = stubCanvas(4000, 3000, 'image/jpeg')
    const out = await downscaleToMaxWidth('data:image/jpeg;base64,xxxx', 2560)
    expect(cap.outType).toBe('image/jpeg')
    expect(out.startsWith('data:image/jpeg;base64,')).toBe(true)
  })

  it('未知格式兜底 PNG', async () => {
    const cap = stubCanvas(4000, 3000, 'image/bmp')
    await downscaleToMaxWidth('data:image/bmp;base64,xxxx', 2560)
    expect(cap.outType).toBe('image/png')
  })

  it('非 data:image → 原样返回', async () => {
    expect(await downscaleToMaxWidth('https://x.com/a.png')).toBe('https://x.com/a.png')
    expect(await downscaleToMaxWidth('')).toBe('')
  })

  it('解码失败（无 canvas / createImageBitmap throw）→ 返回原图', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => ({ type: 'image/png', arrayBuffer: async () => new ArrayBuffer(4) }) })))
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('no bitmap') }))
    expect(await downscaleToMaxWidth(PNG, 2560)).toBe(PNG)
  })

  it('默认 maxWidth = MAX_SHOT_WIDTH(2560)', async () => {
    expect(MAX_SHOT_WIDTH).toBe(2560)
    const cap = stubCanvas(5120, 2880)
    await downscaleToMaxWidth(PNG) // 不传 maxWidth
    expect(cap.w).toBe(2560)
    expect(cap.h).toBe(1440) // round(2880 * 2560/5120)
  })
})
