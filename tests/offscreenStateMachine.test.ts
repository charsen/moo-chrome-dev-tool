import { describe, it, expect } from 'vitest'
import { canTransition, type State } from '@/offscreen/stateMachine'

/**
 * 纯函数单测 —— 不覆盖 cleanup / tabCapture / MediaRecorder（那些得 E2E 或手测）。
 * 这里只验状态机本身的迁移表是否符合 Batch 8-G 修过 race 之后的契约。
 */
describe('offscreen stateMachine.canTransition', () => {
  it('正常生命周期：idle → starting → recording → stopping → idle 全合法', () => {
    expect(canTransition('idle', 'starting')).toBe(true)
    expect(canTransition('starting', 'recording')).toBe(true)
    expect(canTransition('recording', 'stopping')).toBe(true)
    expect(canTransition('stopping', 'idle')).toBe(true)
  })

  it('cancel 路径：starting → idle 合法（绕过 recording，handleCancel 在启动中调用）', () => {
    expect(canTransition('starting', 'idle')).toBe(true)
  })

  it('starting 期间 STOP：starting → stopping 合法（handleStop 兜底，让 handleStart 自清场）', () => {
    expect(canTransition('starting', 'stopping')).toBe(true)
  })

  it('idle 自反合法（handleCancel 在 idle 态：no-op cleanup）；其他态自反全部拒绝', () => {
    expect(canTransition('idle', 'idle')).toBe(true)
    expect(canTransition('starting', 'starting')).toBe(false)
    expect(canTransition('recording', 'recording')).toBe(false)
    expect(canTransition('stopping', 'stopping')).toBe(false)
  })

  it('跨级非法：idle 不能直接跳到 recording 或 stopping（必须先 starting）', () => {
    expect(canTransition('idle', 'recording')).toBe(false)
    expect(canTransition('idle', 'stopping')).toBe(false)
  })

  it('recording 必须经 stopping 才能释放 recorder：recording → idle / starting 拒绝', () => {
    expect(canTransition('recording', 'idle')).toBe(false)
    expect(canTransition('recording', 'starting')).toBe(false)
  })

  it('stopping 是单向收尾：stopping → starting / recording 拒绝', () => {
    expect(canTransition('stopping', 'starting')).toBe(false)
    expect(canTransition('stopping', 'recording')).toBe(false)
  })

  it('同一 from 多候选 to 覆盖：starting 合法目标恰好是 {recording, idle, stopping}', () => {
    const states: State[] = ['idle', 'starting', 'recording', 'stopping']
    const reached = states.filter((to) => canTransition('starting', to))
    expect(new Set(reached)).toEqual(new Set<State>(['recording', 'idle', 'stopping']))
  })
})
