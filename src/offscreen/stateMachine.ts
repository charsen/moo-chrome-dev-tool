/**
 * Offscreen 录屏状态机（纯函数版）。
 *
 * 从 `src/offscreen/index.ts` 抽出来，方便单测覆盖。原版 transition 闭包了
 * module-level state 变量，这里把 state 作为参数显式传入，无副作用。
 *
 * 合法迁移表（从 index.ts 反推，每条都有用例）：
 *   idle      → starting    : handleStart 入口
 *   starting  → recording   : handleStart 末尾，recorder.start 后
 *   starting  → idle        : handleCancel 在 starting 时直接置位，等 handleStart 自清场
 *   starting  → stopping    : handleStop 在 starting 时置位，等 handleStart 自清场
 *   recording → stopping    : handleStop / handleCancel / track-ended 三处入口
 *   stopping  → idle        : cleanup('idle') 收尾
 *   idle      → idle        : handleCancel 在 idle 态 no-op
 *   stopping  → idle        : handleCancel 在 stopping 态 no-op cleanup
 *
 * 不合法的（拒绝）：
 *   idle      → recording / stopping        : 必须先 starting
 *   recording → idle / starting             : 必须先 stopping 释放 recorder
 *   recording → recording / starting → starting / stopping → stopping
 *                                           : 重复进同一态都拒绝（除 idle 自反）
 *   stopping  → starting / recording        : stopping 是单向收尾
 */

export type State = 'idle' | 'starting' | 'recording' | 'stopping'

const ALLOWED: ReadonlyArray<readonly [State, State]> = [
  ['idle', 'starting'],
  ['idle', 'idle'],          // handleCancel 在 idle 态：no-op cleanup
  ['starting', 'recording'],
  ['starting', 'idle'],      // CANCEL during starting
  ['starting', 'stopping'],  // STOP during starting
  ['recording', 'stopping'],
  ['stopping', 'idle']
]

/**
 * 判断从 from 迁到 to 是否合法。纯函数，无副作用。
 * 非法迁移返回 false（不 throw，跟原 transition 的错误处理偏好一致）。
 */
export function canTransition(from: State, to: State): boolean {
  return ALLOWED.some(([f, t]) => f === from && t === to)
}
