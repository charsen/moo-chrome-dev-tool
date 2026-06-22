/**
 * 把可能很大的截图 dataUrl 压成可读但占空间小的缩略图。
 *
 * 为啥要做：原始 1080p PNG base64 ~800KB，30 条 history 直奔 24MB，远
 * 超 chrome.storage.local 10MB 配额 —— 实测只能存 5-8 条而非声称的 30 条。
 * History tab 里这张图本来只是给用户回顾自己提了什么，不是给后端的
 * （提交时后端拿的是 req.image 全分辨率原图，不经这里）。降到 1280px
 * 宽 + JPEG 0.75 质量后单图 ~150KB，30 条 ~4.5MB 稳进配额。
 *
 * 失败时返回原 dataUrl —— 宁可承受配额风险也别丢用户截图。
 *
 * 注：依赖 createImageBitmap / OffscreenCanvas（Chrome 80+），都是 MV3
 * service worker 里可用的 API。FileReader 在 SW 里不可用，所以手动
 * arrayBuffer → btoa 转 base64。
 */
export async function thumbnailize(
  dataUrl: string,
  maxWidth = 1280,
  quality = 0.75
): Promise<string> {
  if (!dataUrl || typeof dataUrl !== 'string') return ''
  if (!dataUrl.startsWith('data:image/')) return dataUrl
  // 已经够小（< ~200KB base64 字符）就别费劲解码再编码
  if (dataUrl.length < 200_000) return dataUrl

  try {
    const resp = await fetch(dataUrl)
    const blob = await resp.blob()
    const bitmap = await createImageBitmap(blob)
    const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return dataUrl
    }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
    return await blobToDataUrl(outBlob)
  } catch (e) {
    console.warn('[Moo] thumbnailize failed', (e as Error).message)
    return dataUrl
  }
}

/** 截图上传前的「最大宽度」上限 —— 与服务端 ImageDownscaler::MAX_IMAGE_WIDTH 对齐。 */
export const MAX_SHOT_WIDTH = 2560

/**
 * 把截图 dataUrl 按「最大宽度」等比降采样后再用于上传。
 *
 * 为啥要做：高 DPI / retina 屏 captureVisibleTab 截出的是物理像素，1280 CSS 宽在
 * DPR 2–3 下实际 2560–3840px、PNG 5–6MB。上传前缩到 ≤ maxWidth 宽省上传带宽 + 减小
 * payload（缓解 webhook/zentao 重试队列 1MB 上限 + 多图叠加体积）。
 *
 * 与服务端 `ImageDownscaler::toMaxWidth` 同语义：
 * - **只缩不放**：宽度 ≤ maxWidth 直接返回原 dataUrl（重编码反可能增体积/软化文字）。
 * - **高度按比例缩放**（等比，不形变）。
 * - **保留源格式**：PNG → PNG（截图文字清晰 + alpha）、jpeg/webp 原样，其它兜底 PNG
 *   （captureVisibleTab 出的就是 PNG）。
 * - 失败一律返回原图 —— 宁可大也别丢截图。
 *
 * createImageBitmap / OffscreenCanvas 在 MV3 service worker 里可用，可在 SW 截图 handler 调。
 */
export async function downscaleToMaxWidth(
  dataUrl: string,
  maxWidth = MAX_SHOT_WIDTH
): Promise<string> {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return dataUrl
  if (maxWidth < 1) return dataUrl

  try {
    // 不走 fetch(dataUrl)：downscaleToMaxWidth 现也在 content world 跑（SubmitDialog 粘贴图片），
    // 宿主页 CSP connect-src 'self' 不含 data: scheme 时 fetch(dataUrl) 直接 Failed to fetch
    // （SubmitDialog 录像转 blob 早踩过同款坑）→ 改 atob 同步解析绕开宿主 CSP。SW 截图路径同样适用。
    const blob = dataUrlToBlob(dataUrl)
    if (!blob) return dataUrl
    const bitmap = await createImageBitmap(blob)
    if (bitmap.width <= maxWidth) {
      bitmap.close()
      return dataUrl // 只缩不放
    }
    const w = maxWidth
    const h = Math.max(1, Math.round(bitmap.height * (maxWidth / bitmap.width)))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return dataUrl
    }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    // 保留源格式（PNG 文字清晰 + alpha）；jpeg/webp 原样，未知兜底 PNG。
    const type = blob.type === 'image/jpeg' || blob.type === 'image/webp' ? blob.type : 'image/png'
    const outBlob = await canvas.convertToBlob({ type, quality: 0.92 })
    return await blobToDataUrl(outBlob)
  } catch (e) {
    console.warn('[Moo] downscaleToMaxWidth failed', (e as Error).message)
    return dataUrl
  }
}

/**
 * 把截图 dataUrl **有损重编码**成指定格式（WebP / JPEG），上传前调用以压体积。
 *
 * 为啥要做：downscaleToMaxWidth 只缩宽不换格式 —— 复杂截图（满屏文字/细节）的
 * 2560px PNG 仍可达 10-13MB（高熵内容 PNG 无损压不掉）。云端 extractBinary 有 8MB/张
 * 上限，base64 decode 后超限的图**静默 skip 不建附件**（请求仍 200）→ 多图被丢只剩 1 张
 * （lab-tester 真 cloud 实锤）。根治杠杆 = 有损重编码：2560px WebP/JPEG ≈ 1-2MB，远低于 8MB。
 *
 * 按上报目标分格式（调用方传 targetMime 决定）：
 * - **webhook/cloud → image/webp**（q0.9 最清晰，cloud MIME 白名单含 webp）
 * - **禅道 → image/jpeg**（q0.9，老版本禅道不一定支持 webp，jpeg 通吃）
 *
 * 关键点：
 * - **JPEG 无 alpha**：targetMime==='image/jpeg' 时先填白底再 drawImage，否则透明区变黑。
 *   WebP 保 alpha 不用填。
 * - **不缩尺寸**（宽高保持原样）—— 降采样是 downscaleToMaxWidth 的事，这里只换编码。
 * - 非 data:image / 解码失败 → 返回原 dataUrl（宁可大也别丢图，跟 downscaleToMaxWidth 同款兜底）。
 *
 * createImageBitmap / OffscreenCanvas / convertToBlob('image/webp') 在 MV3 service worker 可用。
 */
export async function reencodeImage(
  dataUrl: string,
  targetMime: 'image/webp' | 'image/jpeg',
  quality = 0.9
): Promise<string> {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return dataUrl

  try {
    const resp = await fetch(dataUrl)
    const blob = await resp.blob()
    const bitmap = await createImageBitmap(blob)
    const w = bitmap.width
    const h = bitmap.height
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return dataUrl
    }
    // JPEG 无 alpha 通道：透明像素 convertToBlob 会落成黑底。先铺白再画图，跟浏览器
    // 「另存为 JPEG」一致。WebP 保留 alpha，不填。
    if (targetMime === 'image/jpeg') {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, w, h)
    }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const outBlob = await canvas.convertToBlob({ type: targetMime, quality })
    return await blobToDataUrl(outBlob)
  } catch (e) {
    console.warn('[Moo] reencodeImage failed', (e as Error).message)
    return dataUrl
  }
}

/**
 * Blob → data URL（base64）。SW / content world 通用：FileReader 在 SW 不可用，
 * 故手动 arrayBuffer → 分块 fromCharCode → btoa。SubmitDialog 粘贴图片 → File →
 * 这里转 dataUrl 后走 emit 落 shots（与截屏图同一 dataUrl 链路）。
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  // 大 ArrayBuffer 不能一次性 String.fromCharCode(...bytes)，超出参数上限。分块拼。
  let binary = ''
  const chunkSize = 32768
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return `data:${blob.type};base64,${btoa(binary)}`
}

/**
 * data URL → Blob，**刻意不走 fetch(dataUrl)**：宿主页 CSP `connect-src 'self'` 不含 data:
 * scheme 时 fetch(dataUrl) 会 Failed to fetch（content world 跑的 downscaleToMaxWidth 在
 * 粘贴图片场景会撞上）。atob 同步解析 base64 不受宿主 CSP 影响。type 取自 dataUrl 头部，
 * 保住 downscaleToMaxWidth 的「保留源格式」判断。非 data: / 解析失败 → null（调用方兜底返原图）。
 */
function dataUrlToBlob(dataUrl: string): Blob | null {
  if (!dataUrl.startsWith('data:')) return null
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  const header = dataUrl.slice(0, comma)
  const data = dataUrl.slice(comma + 1)
  const isB64 = /;base64$/i.test(header)
  const mime = header.slice(5).replace(/;base64$/i, '') || 'application/octet-stream'
  try {
    if (isB64) {
      const bin = atob(data)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return new Blob([bytes], { type: mime })
    }
    return new Blob([decodeURIComponent(data)], { type: mime })
  } catch {
    return null
  }
}
