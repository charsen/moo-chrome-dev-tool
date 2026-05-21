/**
 * data URL 解码 helpers。SW 跨多个调用点（submitBug / retryQueue flush /
 * zentao buildAttachments）都要把 base64 dataUrl 转 Blob，集中放这避免重复实现。
 */

/**
 * data: URL → Blob。
 * - 空串 / 非 data URL：返回空 Blob 而不是 atob(undefined) 抛 InvalidCharacterError。
 *   触发场景：multipart 提交但用户没截图（image 模板渲染为空串）。
 * - base64 损坏：catch 后返回空 Blob，不让整个 submitBug 链路因此崩。
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  if (!dataUrl || !dataUrl.startsWith('data:')) {
    return new Blob([], { type: 'application/octet-stream' })
  }
  const commaIdx = dataUrl.indexOf(',')
  if (commaIdx < 0) return new Blob([], { type: 'application/octet-stream' })
  const meta = dataUrl.slice(0, commaIdx)
  const b64 = dataUrl.slice(commaIdx + 1)
  const mime = meta.match(/data:(.*?);base64/)?.[1] ?? 'image/png'
  if (!b64) return new Blob([], { type: mime })
  let bin: string
  try {
    bin = atob(b64)
  } catch {
    return new Blob([], { type: mime })
  }
  const len = bin.length
  const buf = new Uint8Array(len)
  for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i)
  return new Blob([buf], { type: mime })
}
