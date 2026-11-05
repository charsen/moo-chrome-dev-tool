import { defineConfig } from '@playwright/test'

// 真机（可见窗口）测试专用配置：
// - 用 Chrome for Testing（Playwright 自带 chromium，headed）加载真 MV3 扩展。
//   不用系统 Google Chrome：Chrome 137+ 已在正式渠道移除 --load-extension。
// - 不走 harness 页面，全部用 dist-real（mandatory host_permissions）对真网页跑。
// - 单 worker 串行，测试里会真的打开窗口、点鼠标、敲键盘。
export default defineConfig({
  testDir: './tests-real',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 180_000,
  expect: { timeout: 10_000 },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
})
