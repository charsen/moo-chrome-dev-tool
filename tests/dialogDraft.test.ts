import { beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_SHOTS,
  clearDialogDraft,
  saveDialogDraft,
  takeDialogDraft,
  type DialogDraft
} from '@/content/dialogDraft'

// dialogDraft 模块级单例草稿：save / take（读后不清）/ clear 三端语义 +
// v0.8.11 新增 dialogPos 字段的 round-trip。
//
// 覆盖：纯模块状态机语义（跨 SubmitDialog 卸载重挂的摆渡正确性靠这里锁）。
// 不覆盖：真实卸载/重挂时序（e2e dialog-ux-real-flow / multi-shot-real-flow 负责）。

function makeDraft(over: Partial<DialogDraft> = {}): DialogDraft {
  return {
    title: '草稿标题',
    description: '复现步骤',
    serverId: 's1',
    zentaoFields: null,
    selectedReqIds: ['r1', 'r2'],
    selectedErrIds: ['e1'],
    pickedElements: [],
    ...over
  }
}

describe('dialogDraft', () => {
  beforeEach(() => {
    clearDialogDraft()
  })

  it('初始（clear 后）take 返回 null', () => {
    expect(takeDialogDraft()).toBeNull()
  })

  it('save → take round-trip：所有字段原样返回（含 dialogPos）', () => {
    const d = makeDraft({ dialogPos: { x: -120, y: 64 } })
    saveDialogDraft(d)
    const got = takeDialogDraft()
    expect(got).not.toBeNull()
    expect(got!.title).toBe('草稿标题')
    expect(got!.serverId).toBe('s1')
    expect(got!.selectedReqIds).toEqual(['r1', 'r2'])
    expect(got!.dialogPos).toEqual({ x: -120, y: 64 })
  })

  it('take 读后不清 —— 同一流程多次重挂每次都能恢复', () => {
    saveDialogDraft(makeDraft({ dialogPos: { x: 10, y: 20 } }))
    expect(takeDialogDraft()).not.toBeNull()
    expect(takeDialogDraft()).not.toBeNull()
    expect(takeDialogDraft()!.dialogPos).toEqual({ x: 10, y: 20 })
  })

  it('dialogPos 可为 null（没拖过 = 居中语义）/ 可缺省（向后兼容旧 draft shape）', () => {
    saveDialogDraft(makeDraft({ dialogPos: null }))
    expect(takeDialogDraft()!.dialogPos).toBeNull()

    clearDialogDraft()
    saveDialogDraft(makeDraft()) // 不带 dialogPos 字段
    expect(takeDialogDraft()!.dialogPos).toBeUndefined()
  })

  it('clear 后 take 回 null（取消/提交完流程结束 → 下个流程复位居中）', () => {
    saveDialogDraft(makeDraft({ dialogPos: { x: 1, y: 2 } }))
    clearDialogDraft()
    expect(takeDialogDraft()).toBeNull()
  })

  it('后 save 覆盖前 save（最后一次卸载的状态胜出）', () => {
    saveDialogDraft(makeDraft({ title: '第一次', dialogPos: { x: 1, y: 1 } }))
    saveDialogDraft(makeDraft({ title: '第二次', dialogPos: { x: 9, y: 9 } }))
    const got = takeDialogDraft()!
    expect(got.title).toBe('第二次')
    expect(got.dialogPos).toEqual({ x: 9, y: 9 })
  })

  it('MAX_SHOTS 契约值 = 5（SubmitDialog 按钮 + ContentApp append 守卫共用）', () => {
    expect(MAX_SHOTS).toBe(5)
  })
})
