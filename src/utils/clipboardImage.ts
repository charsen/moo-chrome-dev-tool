/**
 * 从一次 paste 的 DataTransfer 里挑出第一张图片 File。
 *
 * 为啥抽成纯函数：jsdom 对 ClipboardEvent / DataTransfer 支持很差，直接 dispatch
 * 'paste' 事件难以可靠构造剪贴板内容。把「取第一张图」这步从 DOM 事件里剥离成
 * 纯函数后，单测只喂一个 DataTransfer-like 对象即可全覆盖分支（有图 / 只有文本 /
 * 多 item 含一张图 / 空），SubmitDialog 那层的事件接线交给 e2e harness 观测。
 *
 * 取第一项 `type.startsWith('image/')` 的 item，用 getAsFile() 拿 Blob/File。
 * 没有图片（纯文本粘贴）返回 null —— 调用方据此决定不 preventDefault，让文本
 * 正常进 textarea。
 */
export function imageFileFromClipboard(data: DataTransfer | null): File | null {
  if (!data || !data.items) return null
  for (const item of Array.from(data.items)) {
    // kind 'file' + image/* MIME 才是粘贴进来的图片（截图 / 复制的图片文件）。
    // 纯文本 item 的 kind 是 'string'，type 是 text/plain，跳过。
    if (item.kind === 'file' && typeof item.type === 'string' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return file
    }
  }
  return null
}
