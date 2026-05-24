/**
 * v0.6.0 升级引导 storage flag key 常量。
 *
 * 之前在 popup / background / badge 3 处复制 'mooNeedsHostPermUpgrade' 字面量，
 * 改名时容易漏一处（code-simplifier review #4）。
 *
 * flag 含义：用户从 v0.5.x 升级到 v0.6.0 时若没授权 <all_urls>，写 true 触发：
 *   - popup 顶部 upgrade-banner 显示
 *   - badge 显 '!' 替代失败计数（utils/badge.ts 优先级 check）
 *   - 用户授权 / dismiss 后清掉
 */
export const UPGRADE_FLAG_KEY = 'mooNeedsHostPermUpgrade'
