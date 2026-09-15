import { describe, it, expect } from 'vitest'
import { remoteStatusLabel, remoteStatusTitle } from '@/utils/remoteStatus'

/**
 * 这组用例锁的是「两个入口同一状态给同一文案」这个契约 —— 抽 utils/remoteStatus.ts
 * 的直接原因就是 popup 与 History 各写一份后漂成了「完成」/「已完成」。
 * 改文案时如果只改一处，popup 和 History 的 e2e 断言会分开报错，但这里会先报错。
 */
describe('remoteStatusLabel', () => {
  it('四个已知状态各有稳定中文', () => {
    expect(remoteStatusLabel('open')).toBe('待处理')
    expect(remoteStatusLabel('in_progress')).toBe('处理中')
    expect(remoteStatusLabel('done')).toBe('已完成')
    expect(remoteStatusLabel('deleted')).toBe('已删除')
  })

  it('undefined（后端未回查 / 不支持状态回查）→「已提交」而不是回显英文原值', () => {
    // 旧 History.vue 的实现是 `[s] ?? s`，遇到未知值会把 'done' 这种英文原样显示给用户
    expect(remoteStatusLabel(undefined)).toBe('已提交')
  })

  it('文案不再出现「完成」/「已删」这类缩写（popup 旧版口径，已废弃）', () => {
    expect(remoteStatusLabel('done')).not.toBe('完成')
    expect(remoteStatusLabel('deleted')).not.toBe('已删')
  })
})

describe('remoteStatusTitle', () => {
  it('每个已知状态都有非空提示，且与 label 不重复', () => {
    for (const s of ['open', 'in_progress', 'done', 'deleted'] as const) {
      expect(remoteStatusTitle(s).length).toBeGreaterThan(0)
      expect(remoteStatusTitle(s)).not.toBe(remoteStatusLabel(s))
    }
  })

  it('undefined 的提示说明「尚未回查或不支持」，不谎报后端状态', () => {
    expect(remoteStatusTitle(undefined)).toContain('尚未回查')
  })
})
