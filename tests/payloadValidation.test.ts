/**
 * v0.7.9: postMessage 通道 payload shape 校验 fuzz 单测。
 *
 * 防 main-world 演化 / 同源脚本意外发送 null/undefined headers / body 把
 * redact 层 Object.entries(null) 整崩，污染 chrome://extensions 错误页。
 *
 * 不是防同源攻击 — 同源脚本能干更糟的事；是防意外 shape drift。
 */
import { describe, it, expect } from 'vitest'
import { isValidRequestPayload } from '@/content/useRequests'
import { isValidErrorPayload } from '@/content/useErrors'

const validReq = {
  url: 'https://example.com/api/x',
  method: 'GET',
  status: 200,
  duration: 12.3,
  startedAt: '2026-05-27T00:00:00.000Z',
  startTime: 1234,
  requestHeaders: { 'content-type': 'application/json' },
  responseHeaders: { 'server': 'nginx' },
  requestBody: null,
  responseBody: '{"ok":true}'
}

describe('isValidRequestPayload', () => {
  it('合法 payload 通过', () => {
    expect(isValidRequestPayload(validReq)).toBe(true)
  })

  it('null / undefined / 非对象 全拒', () => {
    for (const bad of [null, undefined, 0, '', false, 'string']) {
      expect(isValidRequestPayload(bad)).toBe(false)
    }
  })

  it('5 个 string/number 必填字段缺一拒一', () => {
    for (const key of ['url', 'method', 'startedAt'] as const) {
      const bad = { ...validReq, [key]: 123 } // 类型错
      expect(isValidRequestPayload(bad)).toBe(false)
    }
    for (const key of ['status', 'duration'] as const) {
      const bad = { ...validReq, [key]: 'oops' }
      expect(isValidRequestPayload(bad)).toBe(false)
    }
  })

  it('requestHeaders / responseHeaders null 必拒（防 Object.entries(null) throw）', () => {
    expect(isValidRequestPayload({ ...validReq, requestHeaders: null })).toBe(false)
    expect(isValidRequestPayload({ ...validReq, responseHeaders: null })).toBe(false)
    expect(isValidRequestPayload({ ...validReq, requestHeaders: undefined })).toBe(false)
  })

  it('headers 非对象（string / number）必拒', () => {
    expect(isValidRequestPayload({ ...validReq, requestHeaders: 'oops' })).toBe(false)
    expect(isValidRequestPayload({ ...validReq, responseHeaders: 42 })).toBe(false)
  })

  it('body 只允许 string 或 null', () => {
    expect(isValidRequestPayload({ ...validReq, requestBody: null })).toBe(true)
    expect(isValidRequestPayload({ ...validReq, requestBody: 'body string' })).toBe(true)
    expect(isValidRequestPayload({ ...validReq, requestBody: { json: true } })).toBe(false)
    expect(isValidRequestPayload({ ...validReq, responseBody: 42 })).toBe(false)
    expect(isValidRequestPayload({ ...validReq, responseBody: undefined })).toBe(false)
  })
})

const validErr = {
  id: 'err-1',
  level: 'error' as const,
  message: 'TypeError: foo',
  startedAt: '2026-05-27T00:00:00.000Z',
  startTime: 1234,
  stack: 'at foo:1:2',
  source: 'main.js',
  line: 1,
  col: 2
}

describe('isValidErrorPayload', () => {
  it('合法 payload 通过', () => {
    expect(isValidErrorPayload(validErr)).toBe(true)
  })

  it('null / undefined / 非对象 全拒', () => {
    for (const bad of [null, undefined, 0, '', false, 'string']) {
      expect(isValidErrorPayload(bad)).toBe(false)
    }
  })

  it('必填字段缺一拒一', () => {
    for (const key of ['id', 'level', 'message', 'startedAt'] as const) {
      const bad: Record<string, unknown> = { ...validErr }
      delete bad[key]
      expect(isValidErrorPayload(bad)).toBe(false)
    }
  })

  it('startTime 必须为 number', () => {
    expect(isValidErrorPayload({ ...validErr, startTime: '1234' })).toBe(false)
    const noStartTime: Record<string, unknown> = { ...validErr }
    delete noStartTime.startTime
    expect(isValidErrorPayload(noStartTime)).toBe(false)
  })

  it('可选字段（stack/source/line/col）defined 时类型必对，undefined OK', () => {
    expect(isValidErrorPayload({ ...validErr, stack: undefined })).toBe(true)
    expect(isValidErrorPayload({ ...validErr, stack: 123 })).toBe(false)
    expect(isValidErrorPayload({ ...validErr, line: '1' })).toBe(false)
    expect(isValidErrorPayload({ ...validErr, source: { url: 'x' } })).toBe(false)
  })

  it('可选字段全省略时合法', () => {
    const minimal = {
      id: 'err-2',
      level: 'rejection',
      message: 'x',
      startedAt: '2026-05-27T00:00:00.000Z',
      startTime: 0
    }
    expect(isValidErrorPayload(minimal)).toBe(true)
  })
})
