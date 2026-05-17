import { describe, it, expect } from 'vitest'
import { pickPropagatedHeaders, parseRemoteId } from '@/utils/remoteHeaders'

describe('pickPropagatedHeaders', () => {
  it('保留白名单内的 token 类 header', () => {
    expect(pickPropagatedHeaders({
      'Authorization': 'Bearer abc',
      'X-Scaffold-Token': 'token123',
      'X-Submitter-Name': 'alice',
      'X-Submitter-Id': '7'
    })).toEqual({
      'Authorization': 'Bearer abc',
      'X-Scaffold-Token': 'token123',
      'X-Submitter-Name': 'alice',
      'X-Submitter-Id': '7'
    })
  })

  it('过滤非 token 类 header（Content-Type / 自定义 X-Foo）', () => {
    expect(pickPropagatedHeaders({
      'Authorization': 'Bearer abc',
      'Content-Type': 'application/json',
      'X-Custom-Foo': 'bar',
      'Accept': '*/*'
    })).toEqual({ 'Authorization': 'Bearer abc' })
  })

  it('白名单匹配不区分大小写', () => {
    expect(pickPropagatedHeaders({
      'authorization': 'Bearer abc',
      'x-scaffold-token': 'token123',
      'X-SUBMITTER-FOO': 'v'
    })).toEqual({
      'authorization': 'Bearer abc',
      'x-scaffold-token': 'token123',
      'X-SUBMITTER-FOO': 'v'
    })
  })

  it('空对象返回空对象', () => {
    expect(pickPropagatedHeaders({})).toEqual({})
  })

  it('幂等：对已过滤过的输入再过一次不变', () => {
    const once = pickPropagatedHeaders({ 'Authorization': 'x', 'Content-Type': 'y' })
    expect(pickPropagatedHeaders(once)).toEqual(once)
  })

  it('保留原始 key 拼写（不强行转小写）', () => {
    expect(pickPropagatedHeaders({ 'AuThoRiZation': 'Bearer abc' })).toEqual({ 'AuThoRiZation': 'Bearer abc' })
  })
})

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
