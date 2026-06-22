import { describe, it, expect, vi, afterEach } from 'vitest'
import { downscaleToMaxWidth, reencodeImage, MAX_SHOT_WIDTH } from '@/utils/image'

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

  it('不依赖 fetch(dataUrl)（宿主页 CSP 禁 data: 也能缩 → 粘贴图片场景）', async () => {
    // content world 跑时宿主页 CSP connect-src 'self' 会让 fetch(dataUrl) 抛错。
    const cap = stubCanvas(3840, 2160)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('CSP: connect-src blocks data:') }))
    const out = await downscaleToMaxWidth(PNG, 2560)
    // 仍缩到 2560 → 证明走 atob 没碰 fetch（若走 fetch 会 catch 返原图、cap.w 停在 0）
    expect(cap.w).toBe(2560)
    expect(out.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('默认 maxWidth = MAX_SHOT_WIDTH(2560)', async () => {
    expect(MAX_SHOT_WIDTH).toBe(2560)
    const cap = stubCanvas(5120, 2880)
    await downscaleToMaxWidth(PNG) // 不传 maxWidth
    expect(cap.w).toBe(2560)
    expect(cap.h).toBe(1440) // round(2880 * 2560/5120)
  })
})

/**
 * reencodeImage（v0.8.14）：上传前按目标格式有损重编码（webhook→WebP / 禅道→JPEG）压体积，
 * 治「复杂截图 2560px PNG 仍 >8MB 被服务端静默丢」。stub canvas，验出 MIME、quality、
 * JPEG 填白底、非 image 原样、失败兜底。
 */
describe('reencodeImage', () => {
  /** stub 一套 canvas，记录 convertToBlob 的 type/quality + ctx 上的填底调用顺序。 */
  function stubReencode(srcW = 2560, srcH = 1440, blobType = 'image/png') {
    const cap = { outType: '', quality: undefined as number | undefined, fillStyle: '', calls: [] as string[] }
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => ({ type: blobType, arrayBuffer: async () => bytes }) })))
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: srcW, height: srcH, close: () => {} })))
    vi.stubGlobal('OffscreenCanvas', class {
      width: number; height: number
      constructor(w: number, h: number) { this.width = w; this.height = h }
      getContext() {
        return {
          set fillStyle(v: string) { cap.fillStyle = v; cap.calls.push(`fillStyle=${v}`) },
          fillRect: (..._a: number[]) => { cap.calls.push('fillRect') },
          drawImage: (..._a: unknown[]) => { cap.calls.push('drawImage') }
        }
      }
      async convertToBlob(opts: { type: string; quality?: number }) {
        cap.outType = opts.type
        cap.quality = opts.quality
        return { type: opts.type, arrayBuffer: async () => bytes }
      }
    })
    return cap
  }

  it('webp 目标 → 输出 data:image/webp，默认 quality 0.9', async () => {
    const cap = stubReencode()
    const out = await reencodeImage(PNG, 'image/webp')
    expect(cap.outType).toBe('image/webp')
    expect(cap.quality).toBe(0.9)
    expect(out.startsWith('data:image/webp;base64,')).toBe(true)
  })

  it('jpeg 目标 → 输出 data:image/jpeg + 先填白底再 drawImage（避免透明区变黑）', async () => {
    const cap = stubReencode()
    const out = await reencodeImage(PNG, 'image/jpeg')
    expect(cap.outType).toBe('image/jpeg')
    expect(out.startsWith('data:image/jpeg;base64,')).toBe(true)
    // 关键：白底填充必须在 drawImage 之前
    expect(cap.fillStyle).toBe('#fff')
    expect(cap.calls).toEqual(['fillStyle=#fff', 'fillRect', 'drawImage'])
  })

  it('webp 目标 → 不填白底（WebP 保 alpha），只 drawImage', async () => {
    const cap = stubReencode()
    await reencodeImage(PNG, 'image/webp')
    expect(cap.calls).toEqual(['drawImage'])
    expect(cap.fillStyle).toBe('')
  })

  it('自定义 quality 透传给 convertToBlob', async () => {
    const cap = stubReencode()
    await reencodeImage(PNG, 'image/webp', 0.7)
    expect(cap.quality).toBe(0.7)
  })

  it('非 data:image → 原样返回（不解码）', async () => {
    expect(await reencodeImage('https://x.com/a.png', 'image/webp')).toBe('https://x.com/a.png')
    expect(await reencodeImage('', 'image/jpeg')).toBe('')
  })

  it('解码失败（createImageBitmap throw）→ 返回原图（宁可大也别丢）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => ({ type: 'image/png', arrayBuffer: async () => new ArrayBuffer(4) }) })))
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('no bitmap') }))
    expect(await reencodeImage(PNG, 'image/webp')).toBe(PNG)
  })

  it('不改尺寸：canvas 用源图原宽高（降采样是 downscale 的事，这里只换编码）', async () => {
    let canvasW = 0, canvasH = 0
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => ({ type: 'image/png', arrayBuffer: async () => bytes }) })))
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2560, height: 1700, close: () => {} })))
    vi.stubGlobal('OffscreenCanvas', class {
      width: number; height: number
      constructor(w: number, h: number) { this.width = w; this.height = h; canvasW = w; canvasH = h }
      getContext() { return { fillRect: () => {}, drawImage: () => {} } }
      async convertToBlob(opts: { type: string }) { return { type: opts.type, arrayBuffer: async () => bytes } }
    })
    await reencodeImage(PNG, 'image/webp')
    expect(canvasW).toBe(2560)
    expect(canvasH).toBe(1700)
  })
})
