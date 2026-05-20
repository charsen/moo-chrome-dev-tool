import { onBeforeUnmount, ref, type Ref } from 'vue'

/**
 * 顶部一行式 toast：showToast(msg, kind?, durationMs?) → 自动 N 秒后清空。
 *
 * 抽出来前 4 个 tab 各写了一份，timer 都没在 onBeforeUnmount 里清——切 tab
 * 后 setTimeout 回调还会写到已销毁组件的 ref 上（这就是泄漏修复点）。
 *
 * duration 故意做成调用方传，不在 composable 里写死 error=5000 / info=2600
 * 的策略——因为 4 个使用点各有微调（History/Settings/Env 是 5000/2600；
 * Content 是 6000/2800）。让调用方自己决定，composable 只管"显示 + 到点
 * 清空 + unmount 清 timer"这三件事。
 *
 * kind 用泛型：默认 `'success' | 'error' | 'info'`；ContentApp 模板里用
 * `:class="[toastKind]"`（不带 `moo-toast--` 前缀），空态需要传空串清掉
 * 残留 class，所以那处显式传 `'' | ...`。
 */
export type DefaultToastKind = 'success' | 'error' | 'info'

export interface UseToastReturn<K extends string = DefaultToastKind> {
  toast: Ref<string>
  toastKind: Ref<K>
  /**
   * 显示一条 toast。
   * @param msg 文案
   * @param kind 类型；不传默认 'info'（仅当默认 union 时；自定义 union 必须传）
   * @param durationMs 显示毫秒数；不传默认 2600
   */
  showToast: (msg: string, kind?: K, durationMs?: number) => void
}

export interface UseToastOptions<K extends string> {
  /** 初始 kind；自定义带空态 union 时通常传 ''。默认 'info' */
  initialKind?: K
  /** 自动清空时把 toastKind 重置成什么；不传则保留上次 kind。Content 需要重置成 '' */
  resetKindOnHide?: K
}

export function useToast<K extends string = DefaultToastKind>(
  opts: UseToastOptions<K> = {}
): UseToastReturn<K> {
  // initialKind 不传时落到 'info'——只在默认 union 下成立，自定义 K 时调用方
  // 必须传 initialKind 才能保证类型安全（如 ContentApp 传 ''）
  const toast = ref('') as Ref<string>
  const toastKind = ref(opts.initialKind ?? ('info' as K)) as Ref<K>
  let timer: number | undefined

  function showToast(msg: string, kind?: K, durationMs?: number): void {
    toast.value = msg
    if (kind !== undefined) toastKind.value = kind
    if (timer) clearTimeout(timer)
    const ms = durationMs ?? 2600
    timer = window.setTimeout(() => {
      toast.value = ''
      if (opts.resetKindOnHide !== undefined) toastKind.value = opts.resetKindOnHide
    }, ms)
  }

  // 泄漏修复点：切 tab / 卸载组件时清掉 pending timer，否则回调还会触发
  // setState 到已销毁组件的 ref 上
  onBeforeUnmount(() => {
    if (timer) { clearTimeout(timer); timer = undefined }
  })

  return { toast, toastKind, showToast }
}
