import { describe, it, expect } from 'vitest'
import {
  templateMissingMultiImage,
  insertScreenshotsField,
  DEFAULT_PAYLOAD_TEMPLATE
} from '@/types/config'
import { renderTemplate } from '@/utils/template'

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

  it('字段名自定义（非 "screenshot"）→ null（调用方提示手动）', () => {
    expect(insertScreenshotsField('{"img":"{{image}}"}')).toBeNull()
  })

  // ★ v0.8.14 修：screenshot 是末字段、无尾逗号（cloud 单图模板）—— 旧正则漏匹配 → 多图发不出去
  it('★ screenshot 末字段无尾逗号 → 也能插入，且产出合法 JSON', () => {
    const tpl = '{\n  "title": "{{title}}",\n  "screenshot": "{{image}}"\n}'
    const out = insertScreenshotsField(tpl)
    expect(out).not.toBeNull()
    expect(out).toContain('"screenshots": {{imagesJson}}')
    // 渲染后必须是合法 JSON（screenshots 成末字段、不带尾逗号，不撞 }）
    const rendered = renderTemplate(out!, { title: 't', image: 'data:1', images: ['data:1', 'data:2'] })
    const parsed = JSON.parse(rendered)
    expect(parsed.screenshot).toBe('data:1')
    expect(parsed.screenshots).toEqual(['data:1', 'data:2'])
  })

  it('★ screenshot 末字段无逗号 + 单行紧凑 JSON → 同样修复', () => {
    const out = insertScreenshotsField('{"title":"{{title}}","screenshot":"{{image}}"}')
    expect(out).not.toBeNull()
    const parsed = JSON.parse(renderTemplate(out!, { title: 't', image: 'data:1', images: ['data:1'] }))
    expect(parsed.screenshots).toEqual(['data:1'])
  })

  it('有尾逗号（后面还有字段）→ screenshots 带逗号，不回归', () => {
    const out = insertScreenshotsField('{\n  "screenshot": "{{image}}",\n  "url": "{{url}}"\n}')
    expect(out).toContain('"screenshots": {{imagesJson}},')
    const parsed = JSON.parse(renderTemplate(out!, { image: 'data:1', images: ['data:1'], url: 'u' }))
    expect(parsed.screenshots).toEqual(['data:1'])
    expect(parsed.url).toBe('u')
  })

  it('非字符串 → null', () => {
    expect(insertScreenshotsField(123 as unknown as string)).toBeNull()
  })
})
