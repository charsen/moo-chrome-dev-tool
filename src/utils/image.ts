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
