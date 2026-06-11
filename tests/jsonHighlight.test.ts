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

// v0.8.9 Fix C 回归：overlayBodySearch 重写为「明文匹配」。
// 旧实现直接在转义后 HTML 上跑 regex，会把 &lt; 这类实体从中间劈开（搜 't' 命中
// &lt; 里的 t → 输出 `&l<mark>t</mark>;` 渲染损坏），且 'amp'/'lt' 等查询在无明文
// 命中的 body 上产生假高亮。
describe('overlayBodySearch — v0.8.9 明文匹配重写', () => {
  it('① body `if a<b && c>d` 搜 `t` → 无假高亮（实体 &lt;/&gt; 不被劈开）', () => {
    const html = escapeHtml('if a<b && c>d')   // 'if a&lt;b &amp;&amp; c&gt;d'
    const out = overlayBodySearch(html, 't')
    expect(out).not.toContain('<mark>')        // 明文里根本没有 't'
    expect(out).toBe(html)
  })

  it('② 搜 `<` → &lt; 实体整体被 mark（明文语义：搜的是字符本身）', () => {
    const html = escapeHtml('a<b')             // 'a&lt;b'
    const out = overlayBodySearch(html, '<')
    expect(out).toContain('<mark>&lt;</mark>')
  })

  it('②b 搜 `lt`：只命中明文里的 lt，不劈 &lt; 实体', () => {
    const html = escapeHtml('result < 5')      // 'result &lt; 5'
    const out = overlayBodySearch(html, 'lt')
    // 明文 'result < 5' 里 'lt' 只出现一次（resu**lt**）
    expect(out.match(/<mark>/g)).toHaveLength(1)
    expect(out).toContain('<mark>lt</mark>')
    // 实体必须完整存活，不能出现 `&l<mark>t</mark>;` 这种劈开产物
    expect(out).toContain('&lt;')
    expect(out).not.toContain('&l<mark>')
  })

  it('③ 搜 `amp`：body 无明文 amp → 0 个 mark（旧版命中 &amp; 内部假高亮）', () => {
    const html = escapeHtml('a && b')          // 'a &amp;&amp; b'
    const out = overlayBodySearch(html, 'amp')
    expect(out).not.toContain('<mark>')
    expect(out).toBe(html)
  })

  it('④ 正常 ASCII 搜索不回归（含大小写不敏感）', () => {
    const html = highlightJson('{"foo":"BAR"}')
    expect(overlayBodySearch(html, 'foo')).toContain('<mark>foo</mark>')
    expect(overlayBodySearch(html, 'bar')).toMatch(/<mark>BAR<\/mark>/)
  })

  it('⑤ mark 不破坏标签段：highlightJson 的 span 结构完整', () => {
    const html = highlightJson('{"k":"v<1>"}')
    const out = overlayBodySearch(html, 'v<1')
    // 明文跨实体匹配：字符串 token "v<1>" 的明文是 `"v<1>"`，搜 `v<1` 应整体命中
    expect(out).toContain('<mark>v&lt;1</mark>')
    // 标签段原样保留 —— span 开闭数量不变，mark 不会插进 <...> 内部
    expect(out.split('<span').length).toBe(html.split('<span').length)
    expect(out.split('</span>').length).toBe(html.split('</span>').length)
    expect(out).not.toMatch(/<[^>]*<mark>/)
  })
})

describe('escapeHtml', () => {
  it('转义 & < > " \'', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
  })
})
