/**
 * `<all_urls>` host permission 检查 + 引导文案集中点。
 *
 * v0.5.3 #128 — host_permissions 从 mandatory 改成 optional：
 *   - manifest.json: optional_host_permissions: ["<all_urls>"]
 *   - 用户在 popup 主动开关授权（参考 popup/App.vue rec-toggle 同模式）
 *   - 所有 fetch / scripting.executeScript 调用前在 router 层（handlers / retryQueue）check
 *
 * 不在 adapter 内 check —— 因为：
 *   1. adapter 是业务抽象，不应该知道权限模型
 *   2. router 层 check 一次比 adapter 内 N 次 fetch 都 check 简单
 *   3. 测试 mock 量更小（handler 单测 + retryQueue 单测 mock chrome.permissions 即可）
 *
 * CWS 上架审核要求：mandatory `<all_urls>` host_permission 是评审员逐字盯的风险点；
 * 改 optional + 用户主动启用流程是友好做法（PLAN_v1.0 决策 2）。
 */

/** 同步 check `<all_urls>` host permission 是否已授权 */
export async function hasHostPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: ['<all_urls>'] })
  } catch {
    return false
  }
}
