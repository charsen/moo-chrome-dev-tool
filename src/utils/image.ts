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
    const resp = await fetch(dataUrl)
    const blob = await resp.blob()
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

async function blobToDataUrl(blob: Blob): Promise<string> {
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
