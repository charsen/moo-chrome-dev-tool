import { describe, it, expect } from 'vitest'
import {
  templateMissingMultiImage,
  insertScreenshotsField,
  DEFAULT_PAYLOAD_TEMPLATE
} from '@/types/config'

/**
 * 多图字段检测 + 一键补（v0.8.11）。EnvironmentWebhook.vue「补多图字段」按钮 +
 * storage/config migrateServerTemplate 共用这两个纯函数。
 */
describe('templateMissingMultiImage', () => {
  it('含 {{image}} 但缺 {{imagesJson}} → true（只发首图）', () => {
    expect(templateMissingMultiImage('{"screenshot":"{{image}}"}')).toBe(true)
  })

  it('已含 {{imagesJson}} → false', () => {
    expect(templateMissingMultiImage('{"screenshot":"{{image}}","shots":{{imagesJson}}}')).toBe(false)
  })

  it('默认模板（已自带 screenshots）→ false', () => {
    expect(templateMissingMultiImage(DEFAULT_PAYLOAD_TEMPLATE)).toBe(false)
  })

  it('完全不含截图占位 → false（不该提示无关模板）', () => {
    expect(templateMissingMultiImage('{"title":"{{title}}"}')).toBe(false)
  })

  it('只有 {{imagesJson}} 没 {{image}} → false（已是多图）', () => {
    expect(templateMissingMultiImage('{"shots":{{imagesJson}}}')).toBe(false)
  })

  it('非字符串 → false', () => {
    expect(templateMissingMultiImage(null as unknown as string)).toBe(false)
  })
})

describe('insertScreenshotsField', () => {
  it('标准 screenshot 行 → 其后插入 screenshots（同缩进）', () => {
    const tpl = '{\n  "screenshot": "{{image}}",\n  "url": "{{url}}"\n}'
    const out = insertScreenshotsField(tpl)
    expect(out).toContain('"screenshots": {{imagesJson}},')
    expect(out!.indexOf('"screenshot": "{{image}}"')).toBeLessThan(out!.indexOf('"screenshots"'))
    // 插入后整体仍是默认模板结构的合法前缀
    expect(out).toContain('  "screenshots": {{imagesJson}},')
  })

  it('已含 {{imagesJson}} → 原样返回（幂等）', () => {
    const tpl = '{"screenshot":"{{image}}","shots":{{imagesJson}}}'
    expect(insertScreenshotsField(tpl)).toBe(tpl)
  })

  it('匹配不到标准行（自定义结构 / 无 trailing 逗号）→ null（调用方提示手动）', () => {
    expect(insertScreenshotsField('{"img":"{{image}}"}')).toBeNull()
    expect(insertScreenshotsField('{\n  "screenshot": "{{image}}"\n}')).toBeNull() // 末字段无逗号
  })

  it('非字符串 → null', () => {
    expect(insertScreenshotsField(123 as unknown as string)).toBeNull()
  })
})
