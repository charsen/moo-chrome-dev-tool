// 页面内 SubmitDialog 表单草稿（模块级单例）。
//
// 为什么需要：「重新截图 / 再截一张 / 重新标注」都会让 SubmitDialog 经 v-if 卸载重挂，
// 而 title/description/serverId/选中集合/zentaoFields/pickedElements 全是实例内 ref，
// 重挂即全丢 —— v0.8.9 之前「重新截图」确认文案承诺"已填内容保留"实际是在撒谎。
// 草稿放模块级，让同一页面生命周期内跨卸载/重挂保留。
//
// 边界（设计内，明确不做）：
// - 不跨硬导航 —— content 世界销毁即清。跨页草稿恢复是另一个量级的功能。
// - 不进 chrome.storage —— 只是截图循环里的临时摆渡，落盘反而引入脏草稿回放问题。
//
// 生命周期约定（写错任何一端草稿就会泄漏/丢失，改动时三端一起看）：
// - SubmitDialog onBeforeUnmount：save（仅当非提交成功、非用户主动取消）
// - SubmitDialog setup：take 恢复（读后不清 —— 同一流程可能多次重挂）
// - ContentApp reset()：clear（取消 / 提交完 / 出错退回 idle，流程真正结束才清）
import type { ZentaoFormFields } from './components/SubmitFormZentao.types'
import type { PickedElement } from './ElementPicker.vue'

/** 多张截图上限（SubmitDialog「再截一张」按钮 + ContentApp append 守卫共用） */
export const MAX_SHOTS = 5

export interface DialogDraft {
  title: string
  description: string
  serverId: string
  zentaoFields: ZentaoFormFields | null
  selectedReqIds: string[]
  selectedErrIds: string[]
  pickedElements: PickedElement[]
  /** 弹窗被头部拖拽挪到的位置（相对 flex 居中基准的 translate 偏移，MooDialog v-model:pos）。
   *  null / 缺省 = 没挪过（居中）。「再截一张/重新截图」重挂后弹窗回到用户挪过的位置；
   *  取消/提交走 clearDialogDraft，下个流程自然复位居中。 */
  dialogPos?: { x: number; y: number } | null
}

let draft: DialogDraft | null = null

export function saveDialogDraft(d: DialogDraft): void {
  draft = d
}

/** 读后不清 —— 截图循环里 SubmitDialog 可能多次重挂，每次都要能恢复 */
export function takeDialogDraft(): DialogDraft | null {
  return draft
}

export function clearDialogDraft(): void {
  draft = null
}
