import { describe, expect, it } from 'vitest'
import {
  collectEndpoints,
  countProjectsWithToken,
  countProjectsWithZentaoPassword
} from '@/composables/useConfigImportExport'

/**
 * v0.5.3 P1 第一步：Environment.vue 拆分。导入安全提示用的 3 个纯函数
 * 从 .vue 抽到 composable 后就能单测（之前 vitest 覆盖率排除 .vue 拿不到）。
 *
 * 覆盖核心：
 *   - collectEndpoints 去重 / 非法 URL / Unicode 同形 / @ 凭证形式
 *   - countProjectsWithToken/ZentaoPassword 空串 / 非字符串 / 数空
 */

describe('collectEndpoints', () => {
  it('多 project 多 server → 去重保序', () => {
    const projects = [
      { servers: [{ endpoint: 'https://a.example.com/intake' }, { endpoint: 'https://b.example.com/intake' }] },
      { servers: [{ endpoint: 'https://a.example.com/intake' }] }  // 重复
    ]
    const r = collectEndpoints(projects)
    expect(r).toHaveLength(2)
    expect(r[0]).toContain('a.example.com')
    expect(r[1]).toContain('b.example.com')
  })

  it('非法 URL → 加 ⚠ 前缀展示', () => {
    const projects = [{ servers: [{ endpoint: 'not-a-url' }] }]
    const r = collectEndpoints(projects)
    expect(r[0]).toContain('⚠')
    expect(r[0]).toContain('not-a-url')
  })

  it('endpoint 含 @ 凭证形式（潜在钓鱼）→ 加 ⚠', () => {
    const projects = [{ servers: [{ endpoint: 'https://trusted.com@evil.com/x' }] }]
    const r = collectEndpoints(projects)
    expect(r[0]).toContain('⚠')
  })

  it('IDN 域名（中文）→ punycode + ⚠', () => {
    const projects = [{ servers: [{ endpoint: 'https://例子.com/intake' }] }]
    const r = collectEndpoints(projects)
    expect(r[0]).toContain('⚠')
    // 应含 xn-- punycode 形式
    expect(r[0]).toMatch(/xn--/)
  })

  it('servers 不是数组 → skip', () => {
    const projects = [{ servers: 'not-array' }, { servers: [{ endpoint: 'https://ok.com/x' }] }]
    const r = collectEndpoints(projects)
    expect(r).toHaveLength(1)
  })

  it('endpoint 是空串 → skip', () => {
    const projects = [{ servers: [{ endpoint: '' }, { endpoint: 'https://ok.com/x' }] }]
    const r = collectEndpoints(projects)
    expect(r).toHaveLength(1)
  })

  it('完全没 servers → 空数组', () => {
    expect(collectEndpoints([])).toEqual([])
    expect(collectEndpoints([{}])).toEqual([])
  })

  it('正常 endpoint 不加 ⚠', () => {
    const projects = [{ servers: [{ endpoint: 'https://api.example.com/intake' }] }]
    const r = collectEndpoints(projects)
    expect(r[0]).not.toContain('⚠')
  })
})

describe('countProjectsWithToken', () => {
  it('多个 project 含 .token → 数对', () => {
    const projects = [
      { token: 'abc' },
      { token: '   ' },  // 空白 token → 不算
      { token: 'def' },
      { token: '' },
      { /* 无 token 字段 */ },
      { token: 123 as unknown }  // 非字符串
    ]
    expect(countProjectsWithToken(projects)).toBe(2)
  })

  it('空数组 → 0', () => {
    expect(countProjectsWithToken([])).toBe(0)
  })
})

describe('countProjectsWithZentaoPassword', () => {
  it('含 zentao.password → 数对', () => {
    const projects = [
      { zentao: { password: 'pwd1' } },
      { zentao: { password: '' } },  // 空字符串不算
      { zentao: { password: 'pwd2' } },
      { zentao: null },  // null 不算
      { zentao: {} },    // 无 password 字段
      { /* 无 zentao */ }
    ]
    expect(countProjectsWithZentaoPassword(projects)).toBe(2)
  })

  it('password 非字符串（数字）→ 不算', () => {
    const projects = [{ zentao: { password: 123 as unknown } }]
    expect(countProjectsWithZentaoPassword(projects)).toBe(0)
  })
})
