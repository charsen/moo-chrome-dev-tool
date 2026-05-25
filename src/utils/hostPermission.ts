/**
 * v0.5.3 #128：host_permissions 改 optional 后的 router-layer check helper。
 * 在 handler / retryQueue 入口调，adapter 内 fetch 不做（架构决策见 PLAN_v1.0 决策 2）。
 */
export function hasHostPermission(): Promise<boolean> {
  return chrome.permissions.contains({ origins: ['<all_urls>'] }).catch(() => false)
}
