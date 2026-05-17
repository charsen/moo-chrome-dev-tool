import { describe, it, expect } from 'vitest'
import { clone } from '@/utils/clone'

describe('clone (JSON deep)', () => {
  it('深拷贝 plain object，原对象不受影响', () => {
    const src = { a: { b: { c: 1 } } }
    const dup = clone(src)
    dup.a.b.c = 999
    expect(src.a.b.c).toBe(1)
  })

  it('深拷贝数组', () => {
    const src = [1, 2, [3, 4]]
    const dup = clone(src)
    ;(dup[2] as number[])[0] = 999
    expect((src[2] as number[])[0]).toBe(3)
  })

  it('null / undefined / primitive 各种简单 case', () => {
    expect(clone(null)).toBeNull()
    expect(clone(42)).toBe(42)
    expect(clone('hi')).toBe('hi')
    expect(clone(true)).toBe(true)
  })

  it('undefined 在 JSON 序列化里丢失（已知限制）', () => {
    const r = clone({ a: 1, b: undefined as unknown as number })
    expect('b' in r).toBe(false)
  })

  it('Date 会被序列化成 ISO 字符串（JSON 限制）', () => {
    const d = new Date('2026-01-01')
    const r = clone({ d })
    expect(typeof r.d).toBe('string')
  })
})
