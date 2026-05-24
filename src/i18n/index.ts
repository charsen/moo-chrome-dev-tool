/**
 * i18n 入口：暴露 t() 查表 + 简单 {param} 插值。
 *
 * 详细设计动机见 src/i18n/zh-CN.ts 顶部注释。
 *
 * 当前只导出 zh-CN，未来加 en-US 时 ① 加 src/i18n/en-US.ts ②
 * 这里 import + 切表逻辑。t() 签名保持不变。
 */

import { messages, type MessageKey } from './zh-CN'

/**
 * 查表 + 插值。
 *
 * @param key 文案 key，编译期约束在 zh-CN.ts messages 的 key union 内
 * @param params 简单 {paramName} 插值的参数表
 * @returns 渲染后的文案；key 缺失时返 key 自身（让漏迁的能在 UI 一眼看见）
 *
 * @example
 *   t('record.start.no-tab')
 *   // → '没找到要录的标签页。请确保焦点在网页上...'
 *
 *   t('record.start.gesture', { reason: 'NotAllowedError' })
 *   // → '浏览器拒绝了录屏请求：NotAllowedError。建议...'
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const tpl = messages[key]
  if (typeof tpl !== 'string') {
    // 编译期类型保证不会到这分支；运行时兜底返 key 自身
    return key
  }
  if (!params) return tpl
  return tpl.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name]
    return v !== undefined ? String(v) : `{${name}}`
  })
}

export type { MessageKey } from './zh-CN'
