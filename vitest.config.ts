import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// 测试只跑纯函数（normalize / template / header 白名单 / parseRemoteId 这类无副作用模块），
// 不挂浏览器环境。chrome.* 用 vi.stubGlobal 在单测内部按需 mock。
export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      // 只统计真正测得到的纯函数模块 —— .vue / chrome.* 依赖的 background SW
      // 跑不起来，统计进去只会让分数没意义。把目标聚焦在 utils + types.
      include: ['src/utils/**', 'src/types/config.ts'],
      // 排除模板默认值之类的常量声明 —— 不算"逻辑"
      reporter: ['text', 'html'],
      reportsDirectory: './coverage'
    }
  }
})
