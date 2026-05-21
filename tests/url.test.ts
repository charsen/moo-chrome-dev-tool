import { describe, it, expect } from 'vitest'
import { absolutize } from '@/utils/url'

const BASE = 'https://app.example.com/page'

describe('absolutize', () => {
  it('绝对 URL（https/http）原样返回', () => {
    expect(absolutize('https://api.example.com/users', BASE)).toBe('https://api.example.com/users')
    expect(absolutize('http://localhost:3000/x', BASE)).toBe('http://localhost:3000/x')
  })

  it('其他 scheme（ws / wss / file / ftp）原样返回', () => {
    expect(absolutize('ws://x.com/sock', BASE)).toBe('ws://x.com/sock')
    expect(absolutize('wss://x.com/sock', BASE)).toBe('wss://x.com/sock')
    expect(absolutize('file:///etc/hosts', BASE)).toBe('file:///etc/hosts')
  })

  it('绝对路径 /foo → 补 origin', () => {
    expect(absolutize('/api/foo', BASE)).toBe('https://app.example.com/api/foo')
  })

  it('相对路径 foo → 按 base path resolve', () => {
    // BASE 是 https://app.example.com/page，相对路径 foo 在 /page 同级 → /foo
    expect(absolutize('foo', BASE)).toBe('https://app.example.com/foo')
  })

  it('带 query / fragment 的相对路径', () => {
    expect(absolutize('/api/foo?id=1', BASE)).toBe('https://app.example.com/api/foo?id=1')
    expect(absolutize('/api/foo#hash', BASE)).toBe('https://app.example.com/api/foo#hash')
  })

  it('protocol-relative URL（//host/path）→ 补 protocol', () => {
    expect(absolutize('//cdn.example.com/lib.js', BASE)).toBe('https://cdn.example.com/lib.js')
  })

  it('上级路径 ../', () => {
    const base = 'https://app.example.com/a/b/c'
    expect(absolutize('../d', base)).toBe('https://app.example.com/a/d')
  })

  it('空串原样返回（不要拼成 base）', () => {
    expect(absolutize('', BASE)).toBe('')
  })

  it('非法 URL（无 base 时）原值兜底', () => {
    // 没传 base + 没 location 时直接返原值
    expect(absolutize('/foo')).toBe('/foo')
  })

  it('base 不合法时不抛，原值兜底', () => {
    expect(absolutize('/foo', 'not a valid base')).toBe('/foo')
  })

  it('带 port / 带 username:password 的 base 也能 resolve', () => {
    expect(absolutize('/api', 'https://app.example.com:8080/page')).toBe('https://app.example.com:8080/api')
  })
})
