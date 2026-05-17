import { describe, it, expect } from 'vitest'
import { renderTemplate } from '@/utils/template'

describe('renderTemplate', () => {
  it('插入字符串变量并保持模板剩余部分原样', () => {
    expect(renderTemplate('hi {{name}}', { name: 'Alice' })).toBe('hi Alice')
  })

  it('未提供的变量保留 {{xxx}} 原样输出（便于调试）', () => {
    expect(renderTemplate('hi {{name}}, age {{age}}', { name: 'Alice' })).toBe('hi Alice, age {{age}}')
  })

  it('null / undefined 渲染为空串', () => {
    expect(renderTemplate('[{{a}}][{{b}}]', { a: null, b: undefined })).toBe('[][]')
  })

  it('数字 / 布尔走 String()', () => {
    expect(renderTemplate('{{n}}/{{b}}', { n: 42, b: true })).toBe('42/true')
  })

  it('{{varJson}} 走 JSON.stringify（对象、数组、字符串都加引号）', () => {
    expect(renderTemplate('{{xJson}}', { x: { a: 1 } })).toBe('{"a":1}')
    expect(renderTemplate('{{xJson}}', { x: [1, 2] })).toBe('[1,2]')
    expect(renderTemplate('{{xJson}}', { x: 'hi' })).toBe('"hi"')
  })

  it('{{varJson}} 没找到变量时保留原样（不输出 undefined）', () => {
    expect(renderTemplate('{{missingJson}}', {})).toBe('{{missingJson}}')
  })

  it('字符串 {{var}} 自动 JSON-escape，防破坏宿主 JSON', () => {
    // 用户在 SubmitDialog 输入 "\n 之类，渲染后必须能直接放进 `"..."` 字面量
    expect(renderTemplate('"title":"{{t}}"', { t: 'a"b\nc' })).toBe('"title":"a\\"b\\nc"')
  })

  it('字符串 {{var}} 的反斜杠也被 escape', () => {
    expect(renderTemplate('"x":"{{p}}"', { p: 'C:\\path' })).toBe('"x":"C:\\\\path"')
  })

  it('{{var}} 数字插值到数字字段保持合法 JSON（slice(1,-1) 不破坏）', () => {
    // {{n}} → 42 (无引号)，放在 "x": {{n}} 仍是合法 JSON
    expect(renderTemplate('"x":{{n}}', { n: 42 })).toBe('"x":42')
  })

  it('点路径 {{a.b}} 当 plain key 用，不做属性访问', () => {
    // 当前实现 [\w.] 允许点，但 expr in ctx 走整 key 查找，所以 a.b 不会展开 ctx.a.b
    expect(renderTemplate('{{a.b}}', { a: { b: 1 }, 'a.b': 'flat' })).toBe('flat')
  })

  it('多次替换不互相影响', () => {
    expect(renderTemplate('{{a}}{{a}}{{a}}', { a: 'x' })).toBe('xxx')
  })
})
