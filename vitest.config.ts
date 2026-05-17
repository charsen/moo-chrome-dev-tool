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
    globals: false
  }
})
