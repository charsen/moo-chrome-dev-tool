import { describe, it, expect } from 'vitest'
import { redactHeaders, redactUrl, redactBody, redactRequest } from '@/utils/redact'
import type { CapturedRequest } from '@/types/requests'

const MASK = '***'

describe('redactHeaders', () => {
  it('命中 key（大小写无关）→ 替换为 ***', () => {
    expect(redactHeaders({ Authorization: 'Bearer x', 'X-Foo': 'y' }, ['authorization']))
      .toEqual({ Authorization: MASK, 'X-Foo': 'y' })
  })

  it('保留原 key 拼写', () => {
    expect(redactHeaders({ 'X-Auth-Token': 'secret' }, ['x-auth-token']))
      .toEqual({ 'X-Auth-Token': MASK })
  })

  it('空 keys → 不动', () => {
    expect(redactHeaders({ a: 'b' }, [])).toEqual({ a: 'b' })
  })

  it('keys 中含原 header 不存在的 → 不抛', () => {
    expect(redactHeaders({ a: 'b' }, ['cookie'])).toEqual({ a: 'b' })
  })
})

describe('redactUrl', () => {
  it('命中 query 参数 → 值替换为 ***', () => {
    expect(redactUrl('https://x.com/api?token=secret&user=foo', ['token']))
      .toBe('https://x.com/api?token=' + MASK + '&user=foo')
  })

  it('多个命中', () => {
    const r = redactUrl('https://x.com/api?token=a&password=b&user=foo', ['token', 'password'])
    expect(r).toContain('token=' + MASK)
    expect(r).toContain('password=' + MASK)
    expect(r).toContain('user=foo')
  })

  it('大小写不敏感', () => {
    expect(redactUrl('https://x.com/?TOKEN=abc', ['token']))
      .toBe('https://x.com/?TOKEN=' + MASK)
  })

  it('没 query → 原样返回', () => {
    expect(redactUrl('https://x.com/api', ['token'])).toBe('https://x.com/api')
  })

  it('空 keys → 原样返回', () => {
    expect(redactUrl('https://x.com/?token=x', [])).toBe('https://x.com/?token=x')
  })

  it('相对路径走 fallback regex（URL 构造器抛错）', () => {
    expect(redactUrl('/api/x?token=secret&u=1', ['token']))
      .toBe('/api/x?token=' + MASK + '&u=1')
  })

  it('query 参数命中为 0 时 → 原样返回（避免 unnecessary serialize 改变 URL 形态）', () => {
    expect(redactUrl('https://x.com/?a=1&b=2', ['token'])).toBe('https://x.com/?a=1&b=2')
  })
})

describe('redactBody', () => {
  it('JSON body 命中字段 → 字符串字面 *** 替换', () => {
    expect(redactBody('{"username":"alice","password":"secret"}', ['password']))
      .toBe('{"username":"alice","password":"' + MASK + '"}')
  })

  it('嵌套对象递归脱敏', () => {
    expect(redactBody('{"user":{"name":"alice","token":"x"}}', ['token']))
      .toBe('{"user":{"name":"alice","token":"' + MASK + '"}}')
  })

  it('数组里的对象也走', () => {
    expect(redactBody('[{"token":"a"},{"token":"b"}]', ['token']))
      .toBe('[{"token":"' + MASK + '"},{"token":"' + MASK + '"}]')
  })

  it('非 JSON 走 form-urlencoded 形态正则', () => {
    expect(redactBody('username=alice&password=secret', ['password']))
      .toBe('username=alice&password=' + MASK)
  })

  it('空 body → 原样', () => {
    expect(redactBody(null, ['x'])).toBeNull()
    expect(redactBody('', ['x'])).toBe('')
  })

  it('空 keys → 原样', () => {
    expect(redactBody('{"password":"x"}', [])).toBe('{"password":"x"}')
  })

  it('大小写不敏感', () => {
    expect(redactBody('{"Password":"secret"}', ['password']))
      .toBe('{"Password":"' + MASK + '"}')
  })
})

describe('redactRequest', () => {
  it('headers/url/body 三处都过', () => {
    const req: CapturedRequest = {
      id: '1',
      kind: 'fetch',
      method: 'POST',
      url: 'https://x.com/?token=t',
      requestHeaders: { Authorization: 'Bearer x' },
      requestBody: '{"password":"p"}',
      status: 200,
      ok: true,
      responseHeaders: { 'Set-Cookie': 'sid=abc' },
      responseBody: '{"token":"x"}',
      responseSizeBytes: 0,
      startTime: 0,
      duration: 0,
      startedAt: ''
    }
    const out = redactRequest(req, {
      headerKeys: ['authorization', 'set-cookie'],
      bodyKeys: ['token', 'password'],
      maskPasswordInputs: true
    })
    expect(out.requestHeaders.Authorization).toBe(MASK)
    expect(out.responseHeaders['Set-Cookie']).toBe(MASK)
    expect(out.url).toContain('token=' + MASK)
    expect(out.requestBody).toContain('"password":"' + MASK + '"')
    expect(out.responseBody).toContain('"token":"' + MASK + '"')
    // 非敏感字段保留
    expect(out.id).toBe('1')
    expect(out.status).toBe(200)
  })
})
