import { describe, it, expect } from 'vitest'
import { parseRemoteId } from '@/utils/remoteHeaders'

describe('parseRemoteId', () => {
  it('合法 JSON + 字符串 id 字段时返回 id', () => {
    expect(parseRemoteId('{"id":"abc123"}')).toBe('abc123')
  })

  it('支持下划线和短横线', () => {
    expect(parseRemoteId('{"id":"ulid_01H-XYZ"}')).toBe('ulid_01H-XYZ')
  })

  it('id 含特殊字符（路径注入尝试）→ undefined', () => {
    expect(parseRemoteId('{"id":"../../admin"}')).toBeUndefined()
    expect(parseRemoteId('{"id":"abc?token=x"}')).toBeUndefined()
    expect(parseRemoteId('{"id":"a b"}')).toBeUndefined()
  })

  it('id 是数字 / null / 缺失 → undefined（要求严格 string）', () => {
    expect(parseRemoteId('{"id":42}')).toBeUndefined()
    expect(parseRemoteId('{"id":null}')).toBeUndefined()
    expect(parseRemoteId('{}')).toBeUndefined()
  })

  it('JSON.parse(\'null\') 不会让 obj.id 抛 TypeError', () => {
    expect(parseRemoteId('null')).toBeUndefined()
  })

  it('非 JSON → undefined', () => {
    expect(parseRemoteId('<html>500</html>')).toBeUndefined()
    expect(parseRemoteId('')).toBeUndefined()
  })

  it('id 超过 128 字符 → undefined', () => {
    const big = 'a'.repeat(129)
    expect(parseRemoteId(`{"id":"${big}"}`)).toBeUndefined()
  })

  it('id 正好 128 字符 → 返回（边界）', () => {
    const ok = 'a'.repeat(128)
    expect(parseRemoteId(`{"id":"${ok}"}`)).toBe(ok)
  })

  it('响应体 >64KB → undefined（防超大 HTML 错误页卡 JSON.parse）', () => {
    // 构造 65KB 字符串但 id 部分合法 —— 应被尺寸守卫拦下
    const padding = ' '.repeat(65 * 1024)
    expect(parseRemoteId(`{"id":"ok"}${padding}`)).toBeUndefined()
  })
})
