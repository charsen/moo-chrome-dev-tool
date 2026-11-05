import { describe, it, expect } from 'vitest'
import { formatSubmitResult } from '@/utils/submitMessage'

describe('formatSubmitResult — 成功路径', () => {
  it('普通成功', () => {
    const r = formatSubmitResult({ ok: true, status: 200 })
    expect(r.ok).toBe(true)
    expect(r.message).toContain('200')
    expect(r.message).not.toContain('⚠')
  })

  it('成功但 historyAllDropped → ⚠ 显式告知没本地存', () => {
    const r = formatSubmitResult({ ok: true, status: 200, historyAllDropped: true })
    expect(r.ok).toBe(true)
    expect(r.message).toContain('⚠')
    expect(r.message).toContain('没保存到本地')
  })

  it('成功但 trimmedHistory > 0 → 自然语言提示丢了几条旧的', () => {
    const r = formatSubmitResult({ ok: true, status: 200, trimmedHistory: 3 })
    expect(r.ok).toBe(true)
    expect(r.message).toContain('3 条')
  })

  it('historyAllDropped 优先于 trimmedHistory（前者更严重）', () => {
    const r = formatSubmitResult({ ok: true, status: 200, historyAllDropped: true, trimmedHistory: 5 })
    expect(r.message).toContain('⚠')
    expect(r.message).not.toMatch(/丢弃了 \d+ 条/)
  })
})

describe('formatSubmitResult — 失败路径', () => {
  it('fetch 抛错 → res.error 优先', () => {
    const r = formatSubmitResult({ ok: false, error: 'Network failed' })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('Network failed')
  })

  it('queued 时附带"加入重试队列"提示', () => {
    const r = formatSubmitResult({ ok: false, error: 'timeout', queued: true })
    expect(r.message).toContain('重试队列')
  })

  it('5xx 不再预设「已加入重试队列」（是否能入队由 queued 决定）', () => {
    const r = formatSubmitResult({ ok: false, status: 503, queued: false })
    expect(r.message).toContain('503')
    expect(r.message).not.toContain('已自动加入重试队列')
    expect(r.message).toContain('不会自动重试')
  })

  it('入队但队列满被 FIFO 淘汰 → 明确告知丢了几条', () => {
    const r = formatSubmitResult({ ok: false, error: 'timeout', queued: true, retryQueueTrimmed: 2 })
    expect(r.message).toContain('最早的 2 条被丢弃')
  })

  it('queued=false 不加重试提示', () => {
    const r = formatSubmitResult({ ok: false, error: 'CORS', queued: false })
    expect(r.message).not.toContain('重试队列')
  })

  it('HTTP 401 — token 提示', () => {
    const r = formatSubmitResult({ ok: false, status: 401 })
    expect(r.message).toContain('401')
    expect(r.message).toContain('Token')
  })

  it('HTTP 404 — URL 写错提示', () => {
    const r = formatSubmitResult({ ok: false, status: 404 })
    expect(r.message).toContain('404')
    expect(r.message).toContain('请求 URL')
  })

  it('HTTP 422 — 字段对不上提示', () => {
    const r = formatSubmitResult({ ok: false, status: 422 })
    expect(r.message).toContain('422')
    expect(r.message).toContain('Payload 模板')
  })

  it('HTTP 500 — 不是用户问题', () => {
    const r = formatSubmitResult({ ok: false, status: 500 })
    expect(r.message).toContain('500')
    expect(r.message).toContain('不是你的问题')
  })

  it('HTTP 0 — 服务端没响应', () => {
    const r = formatSubmitResult({ ok: false, status: 0 })
    expect(r.message).toContain('没响应')
  })

  it('body 是 JSON 且含 error 字段 → 拼到 toast', () => {
    const r = formatSubmitResult({ ok: false, status: 400, body: '{"error":"邮箱已存在"}' })
    expect(r.message).toContain('邮箱已存在')
  })

  it('body 是 JSON 且含 message 字段 → 同样', () => {
    const r = formatSubmitResult({ ok: false, status: 400, body: '{"message":"非法 token"}' })
    expect(r.message).toContain('非法 token')
  })

  it('body 是 JSON.parse(\'null\') 不让 (null).error 抛 TypeError 误导', () => {
    const r = formatSubmitResult({ ok: false, status: 500, body: 'null' })
    // body 是 'null' 字符串，extract 走到 fallback: body 原文截断
    expect(r.message).toContain('500')
    // 错误原因不该是字面 "null"
    expect(r.message.toLowerCase()).not.toContain('null"')
  })

  it('body 不是 JSON → 截断 160 字符', () => {
    const longBody = 'X'.repeat(300)
    const r = formatSubmitResult({ ok: false, status: 500, body: longBody })
    expect(r.message).toContain('…')
    expect(r.message.length).toBeLessThan(longBody.length + 100)
  })

  it('body 短 HTML → 原样附在 toast 后', () => {
    const r = formatSubmitResult({ ok: false, status: 502, body: '<html>nginx error</html>' })
    expect(r.message).toContain('nginx error')
  })
})
