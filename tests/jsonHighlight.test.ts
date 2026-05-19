import { describe, it, expect } from 'vitest'
import {
  escapeHtml,
  tryParseJson,
  prettyPrintJson,
  highlightJson,
  overlayBodySearch
} from '@/utils/jsonHighlight'

describe('tryParseJson', () => {
  it('解析 object / array', () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 })
    expect(tryParseJson('[1,2,3]')).toEqual([1, 2, 3])
  })
  it('容忍前后空白', () => {
    expect(tryParseJson('  { "a": 1 }  ')).toEqual({ a: 1 })
  })
  it('非 { 或 [ 起头不解析（fast reject）', () => {
    expect(tryParseJson('"hi"')).toBeUndefined()
    expect(tryParseJson('42')).toBeUndefined()
    expect(tryParseJson('plain text')).toBeUndefined()
  })
  it('空串返 undefined', () => {
    expect(tryParseJson('')).toBeUndefined()
    expect(tryParseJson('   ')).toBeUndefined()
  })
  it('JSON 不合法返 undefined', () => {
    expect(tryParseJson('{a:1}')).toBeUndefined() // 没引号
    expect(tryParseJson('{')).toBeUndefined()
  })
})

describe('prettyPrintJson', () => {
  it('两格缩进', () => {
    expect(prettyPrintJson({ a: 1 })).toBe('{\n  "a": 1\n}')
  })
})

describe('highlightJson', () => {
  it('key / string / number / bool / null 各自带 class', () => {
    const html = highlightJson('{"k":"v","n":1,"b":true,"x":null}')
    expect(html).toContain('class="jx-key"')
    expect(html).toContain('class="jx-str"')
    expect(html).toContain('class="jx-num"')
    expect(html).toContain('class="jx-bool"')
    expect(html).toContain('class="jx-null"')
  })

  it('string 值里的 < > 被 escape，不能注入 HTML', () => {
    const html = highlightJson('{"x":"<script>alert(1)</script>"}')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('非 JSON 输入也能跑（按 token 染、剩余作纯文本 escape）', () => {
    const html = highlightJson('hello "world" 42')
    expect(html).toContain('class="jx-str"')
    expect(html).toContain('class="jx-num"')
    expect(html).toContain('hello ')
  })

  it('& 字符在键值之间也 escape', () => {
    const html = highlightJson('{"a":"x&y"}')
    expect(html).toContain('x&amp;y')
  })
})

describe('overlayBodySearch', () => {
  it('在已 highlight 的 HTML 上叠 mark', () => {
    const html = highlightJson('{"foo":"bar"}')
    const out = overlayBodySearch(html, 'foo')
    expect(out).toContain('<mark>foo</mark>')
  })

  it('空 query 直接返回原 HTML', () => {
    const html = highlightJson('{"a":1}')
    expect(overlayBodySearch(html, '')).toBe(html)
    expect(overlayBodySearch(html, '   ')).toBe(html)
  })

  it('不在 <span class="..."> 这种标签内匹配（避免破坏标签）', () => {
    const html = '<span class="jx-key">"abc":</span>'
    // 搜索 "span"——不能 mark 进 tag 内部
    const out = overlayBodySearch(html, 'span')
    expect(out).toBe(html)
  })

  it('大小写不敏感', () => {
    const html = highlightJson('{"FOO":1}')
    const out = overlayBodySearch(html, 'foo')
    expect(out).toMatch(/<mark>FOO<\/mark>/)
  })
})

describe('escapeHtml', () => {
  it('转义 & < > " \'', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
  })
})
