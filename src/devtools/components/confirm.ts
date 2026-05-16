// 命令式 confirm 弹窗：替换 window.confirm。
// 返回 Promise<boolean>：用户确认 → true，取消/Esc/点遮罩 → false。
//
// 用法：
//   if (!(await confirmDialog({ title: '清空历史', message: '将删除 30 条记录，不可恢复。', danger: true }))) return
//
// 设计取舍：
// - 用 createApp 临时挂载（不是 Teleport 到根 App）——这样 confirm 可以在任何 setup 里直接 `await`，
//   不需要每个调用方都先 v-model 一个 ref 再 emit。代价是每次 confirm 创建/销毁一个 Vue app 实例。
//   并发场景（同时弹两个）极少见，且每个独立实例互不干扰，可接受。

import { createApp, h } from 'vue'
import ConfirmModal from './ConfirmModal.vue'

export interface ConfirmOptions {
  title: string
  /** 单段文字或多行列表（如"以下项目将被删除…"） */
  message?: string | string[]
  confirmText?: string
  cancelText?: string
  /** 不可逆操作（删除/清空）时设为 true，主按钮变实心红 */
  danger?: boolean
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      app.unmount()
      host.remove()
      resolve(ok)
    }

    const app = createApp({
      render: () =>
        h(ConfirmModal, {
          title: opts.title,
          message: opts.message,
          confirmText: opts.confirmText,
          cancelText: opts.cancelText,
          danger: opts.danger,
          onConfirm: () => finish(true),
          onCancel: () => finish(false)
        })
    })
    app.mount(host)
  })
}
