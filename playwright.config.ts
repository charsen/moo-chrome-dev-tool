import { defineConfig } from '@playwright/test'

// E2E 配置：直接挂 dist 当 chrome extension，不依赖任何 MCP。
// 关键约束：fullyParallel=false —— 多个 test 同时打开 persistent context 会
// 共享 storage.local 状态，串成假阳性。
export default defineConfig({
  testDir: './tests-e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  timeout: 30_000
})
