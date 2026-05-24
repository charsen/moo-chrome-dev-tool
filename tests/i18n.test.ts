import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'

/**
 * v0.5.2 PLAN_v1.0 i18n 留口子 PoC 单测。覆盖 t() 查表 + 插值边界。
 */

describe('t() 文案查表', () => {
  it('已知 key → 返字典文案', () => {
    const s = t('record.start.no-tab')
    expect(s).toContain('没找到要录的标签页')
  })

  it('带 {param} 插值 → 替换为 params 值', () => {
    const s = t('record.start.gesture', { reason: 'NotAllowedError' })
    expect(s).toContain('NotAllowedError')
    expect(s).not.toContain('{reason}')
  })

  it('插值缺 param → 保留 {param} 占位让漏传可见', () => {
    const s = t('record.start.gesture', {})
    expect(s).toContain('{reason}')
  })

  it('多 param 插值 → 全部替换', () => {
    const s = t('submit.server.no-endpoint', { name: 'svr-1' })
    expect(s).toContain('svr-1')
    expect(s).not.toContain('{name}')
  })

  it('params=number → 自动 String 转换', () => {
    // 当前字典里没纯 number 占位 case，借 reason 测语义即可
    const s = t('record.start.gesture', { reason: 500 as unknown as string })
    expect(s).toContain('500')
  })

  it('不传 params → 不替换原模板（无插值场景 fast path）', () => {
    const s = t('preview.payload.no-server')
    expect(s).toBe('PREVIEW_PAYLOAD payload 缺 server')
  })
})
