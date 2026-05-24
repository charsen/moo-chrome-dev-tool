/**
 * 简体中文文案集中口子（v0.5.2 PLAN_v1.0 留口子）。
 *
 * 这是文案 → 字典的「过渡阶段」：
 *   - **不接 chrome.i18n API**：CWS 上架 + 同事英文 OS 痛感低，v1.2+ 再做
 *   - **不强制全仓库迁**：先建框架 + 高频/外可见的迁过来做 PoC，新加文案优先走 t()
 *   - **不抽 plural / 复杂语法**：当前需求只是 key→string 查表 + 简单 {param} 插值
 *
 * 何时迁某条文案到这里：
 *   ✅ 用户可见的报错 toast / dialog 文案（i18n 价值高）
 *   ✅ 高频出现的标签 / 按钮文案（多处复用避免改一改十）
 *   ❌ 单次内部 console.warn（用户看不到不值得迁）
 *   ❌ 测试 mock 数据
 *   ❌ 项目名 / 用户配置项（不是产品文案）
 *
 * key 命名约定：`<domain>.<event>` 或 `<domain>.<event>.<variant>`
 *   - record.start.no-tab         「没找到要录的标签页」
 *   - record.start.permission     「录屏功能尚未启用」
 *   - submit.project.not-found    「找不到对应项目」
 *
 * 使用：
 *   import { t } from '@/i18n'
 *   return { ok: false, error: t('record.start.no-tab') }
 *
 * 加新 key：
 *   1. 在 messages 里加一条
 *   2. （可选）src/i18n/index.ts 的 MessageKey union 类型自动推出来
 *   3. 写测试时直接 import t 用真实文案，不需要 mock
 */

export const messages = {
  // ── 录屏相关 ────────────────────────────────────────
  'record.start.no-tab': '没找到要录的标签页。请确保焦点在网页上（不要在 DevTools 内）再按 ⌥⇧R',
  'record.start.permission': '录屏功能尚未启用。请点击浏览器右上角的 Moo 图标 → 启用录屏后再试',
  'record.start.gesture': '浏览器拒绝了录屏请求：{reason}。建议直接按 ⌥⇧R（不要通过点击悬浮球），否则用户手势会失效',
  'record.start.offscreen-fail': '录屏后台进程启动失败，请稍后重试',
  'record.start.stream-fail': '获取屏幕流失败',
  'record.start.offscreen-unsupported': '当前 Chrome 版本不支持 offscreen documents（需要 109+）',
  'record.stop.no-response': '录屏后台没响应，可能已经被浏览器卸载。请重新开始录制',

  // ── 提交相关 ────────────────────────────────────────
  'submit.project.not-found': '找不到对应项目（可能项目刚被删除）。请回到 DevTools → Moo → 环境 重新选择',
  'submit.server.not-found': '找不到选中的上报服务器（可能刚被删除）。请回到 DevTools → Moo → 环境 重新选择',
  'submit.server.no-endpoint': '上报服务器「{name}」还没填请求 URL。请去 DevTools → Moo → 环境 → 上报服务器，在「请求 URL」那一行填上后端地址后再试',
  'submit.payload.missing': 'SUBMIT_BUG payload 缺失',
  'submit.project.deleted-placeholder': '(项目已被删除)',
  'submit.server.deleted-placeholder': '(服务器已被删除)',

  // ── 禅道相关 ────────────────────────────────────────
  'zentao.modules.no-project-id': 'projectId 必填',

  // ── 预览相关 ────────────────────────────────────────
  'preview.payload.no-server': 'PREVIEW_PAYLOAD payload 缺 server',

  // ── host_permission 相关（v0.5.3 #128 改 optional）─────
  'host-permission.required': '上报功能尚未启用。请点击浏览器右上角的 Moo 图标 → 打开「允许向上报服务器发送请求」开关后再试',
} as const

export type MessageKey = keyof typeof messages
