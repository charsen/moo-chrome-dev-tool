import { describe, it, expect } from 'vitest'
import { highlightStack } from '@/utils/stackFormat'

describe('highlightStack', () => {
  it('V8 风格：at fn (file:line:col) 拆出函数名 + 文件 + 行列', () => {
    const html = highlightStack('    at doStuff (http://localhost/app.js:42:8)')
    expect(html).toContain('class="st-fn">doStuff</span>')
    expect(html).toContain('class="st-file">http://localhost/app.js</span>')
    expect(html).toContain('class="st-loc">:42:8</span>')
  })

  it('V8 匿名：at file:line:col', () => {
    const html = highlightStack('    at http://localhost/app.js:42:8')
    expect(html).toContain('class="st-file">http://localhost/app.js</span>')
    expect(html).toContain('class="st-loc">:42:8</span>')
    expect(html).not.toContain('class="st-fn"')
  })

  it('Firefox 风格：fn@file:line:col', () => {
    const html = highlightStack('doStuff@http://localhost/app.js:42:8')
    expect(html).toContain('class="st-fn">doStuff</span>')
    expect(html).toContain('class="st-file">http://localhost/app.js</span>')
  })

  it('Error 消息行（不匹配任何 frame）按原文 escape', () => {
    const html = highlightStack('TypeError: Cannot read property "x" of undefined')
    expect(html).toContain('TypeError')
    expect(html).toContain('&quot;x&quot;')
    expect(html).not.toContain('class="st-')
  })

  it('多行 stack 整体处理', () => {
    const stack = [
      'Error: boom',
      '    at a (file.js:1:1)',
      '    at b (file.js:2:2)'
    ].join('\n')
    const html = highlightStack(stack)
    expect(html.split('\n')).toHaveLength(3)
    expect(html).toContain('Error: boom')
    expect(html.match(/st-fn/g)?.length).toBe(2)
  })

  it('不会让 HTML 注入逃逸（恶意函数名含 <script>）', () => {
    const html = highlightStack('    at <script> (file.js:1:1)')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
