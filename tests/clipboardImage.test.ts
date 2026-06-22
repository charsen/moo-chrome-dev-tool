import { describe, it, expect } from 'vitest'
import { imageFileFromClipboard } from '@/utils/clipboardImage'

/**
 * imageFileFromClipboard：从 paste 的 DataTransfer 取第一张图片 File。
 * jsdom 对真 ClipboardEvent/DataTransfer 支持差，这里喂 DataTransfer-like 假对象
 * 验四类分支（有图 / 只有文本 / 多 item 含一张图 / null·空），不 dispatch 真事件。
 */

/** 造一个 DataTransferItem-like：file 类型才有 getAsFile 返回 file，string 类型返回 null */
function item(kind: string, type: string, file: File | null): DataTransferItem {
  return {
    kind,
    type,
    getAsFile: () => file
  } as unknown as DataTransferItem
}

/** 造一个 DataTransfer-like，仅暴露 items（被测函数只读 items） */
function dt(items: DataTransferItem[]): DataTransfer {
  return { items } as unknown as DataTransfer
}

const pngFile = new File([new Uint8Array([0x89, 0x50])], 'shot.png', { type: 'image/png' })
const jpgFile = new File([new Uint8Array([0xff, 0xd8])], 'pic.jpg', { type: 'image/jpeg' })

describe('imageFileFromClipboard', () => {
  it('① 有 image/png file item → 返回该 File', () => {
    const out = imageFileFromClipboard(dt([item('file', 'image/png', pngFile)]))
    expect(out).toBe(pngFile)
  })

  it('② 只有 text/plain → 返回 null（让文本正常进 textarea）', () => {
    const out = imageFileFromClipboard(dt([item('string', 'text/plain', null)]))
    expect(out).toBeNull()
  })

  it('③ 多个 item 含一张图（文本在前）→ 返回那张图', () => {
    const out = imageFileFromClipboard(
      dt([
        item('string', 'text/plain', null),
        item('file', 'image/jpeg', jpgFile)
      ])
    )
    expect(out).toBe(jpgFile)
  })

  it('③b 多张图 → 返回第一张', () => {
    const out = imageFileFromClipboard(
      dt([
        item('file', 'image/png', pngFile),
        item('file', 'image/jpeg', jpgFile)
      ])
    )
    expect(out).toBe(pngFile)
  })

  it('④ null → null', () => {
    expect(imageFileFromClipboard(null)).toBeNull()
  })

  it('④b 空 items → null', () => {
    expect(imageFileFromClipboard(dt([]))).toBeNull()
  })

  it('⑤ image MIME 但 kind=string（非 file）→ 跳过返回 null', () => {
    // 防御：某些场景 item 标了 image/* 但 kind 不是 file（无法 getAsFile）
    const out = imageFileFromClipboard(dt([item('string', 'image/png', null)]))
    expect(out).toBeNull()
  })

  it('⑥ file 类型但 getAsFile 返回 null → 跳过，继续找下一项', () => {
    const out = imageFileFromClipboard(
      dt([
        item('file', 'image/png', null), // getAsFile 落空
        item('file', 'image/jpeg', jpgFile)
      ])
    )
    expect(out).toBe(jpgFile)
  })
})
