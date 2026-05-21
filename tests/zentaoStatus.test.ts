import { describe, it, expect } from 'vitest'
import { mapZentaoStatus } from '@/background/zentaoStatus'
import type { ZentaoBugDetail } from '@/background/zentao/client'

function mkBug(overrides: Partial<ZentaoBugDetail> = {}): ZentaoBugDetail {
  return { id: 1, status: 'active', deleted: false, ...overrides }
}

describe('mapZentaoStatus — v0.3.0 状态回查映射', () => {
  it('deleted=true 优先于 status（被彻底删的 bug 即便 status 是 active 也算 deleted）', () => {
    expect(mapZentaoStatus(mkBug({ status: 'active', deleted: true }))).toBe('deleted')
    expect(mapZentaoStatus(mkBug({ status: 'closed', deleted: true }))).toBe('deleted')
    expect(mapZentaoStatus(mkBug({ status: 'resolved', deleted: true }))).toBe('deleted')
  })

  it('status=active → open（待处理）', () => {
    expect(mapZentaoStatus(mkBug({ status: 'active' }))).toBe('open')
  })

  it('status=resolved → in_progress（处理中）', () => {
    expect(mapZentaoStatus(mkBug({ status: 'resolved' }))).toBe('in_progress')
  })

  it('status=closed → done（已完成）', () => {
    expect(mapZentaoStatus(mkBug({ status: 'closed' }))).toBe('done')
  })

  it('未知 status → undefined（refreshHistoryStatus 据此跳过写库，不覆盖原 remoteStatus）', () => {
    expect(mapZentaoStatus(mkBug({ status: 'wontfix' }))).toBeUndefined()
    expect(mapZentaoStatus(mkBug({ status: '' }))).toBeUndefined()
    expect(mapZentaoStatus(mkBug({ status: 'unknown_future_status' }))).toBeUndefined()
  })

  it('deleted=false + 未知 status → undefined（不被 deleted 短路）', () => {
    expect(mapZentaoStatus(mkBug({ status: 'pending', deleted: false }))).toBeUndefined()
  })
})
