import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { crx } from '@crxjs/vite-plugin'
import { resolve } from 'node:path'
import manifest from './manifest.json' with { type: 'json' }

// v0.7.9：release.mjs 跑 build 时设 MOO_RELEASE_BUILD=1，排除 3 个 E2E harness entry。
// 默认（pnpm build / pnpm test:e2e）仍包含 harness — 不破现有 e2e 流程。
// 生产 zip 不再带 harness HTML / harness 注入脚本，避免 CWS 评审追问「测试 mock 进生产」。
const IS_RELEASE_BUILD = process.env.MOO_RELEASE_BUILD === '1'

const harnessEntries = {
  // BodyViewer 的 E2E 测试 harness。只在 Playwright 测里访问，prod 不引用。
  // 体积 <2KB，并入 dist 不影响发布；release.mjs 也不依赖它存在
  bodyViewerHarness: resolve(__dirname, 'src/devtools/body-viewer-harness.html'),
  // Panel.vue + 4 Tab 的 E2E harness。Panel.vue setup 顶层就 sync 读
  // chrome.devtools.inspectedWindow.tabId，真 DevTools iframe 外没法挂载，
  // 所以做 harness 页面 mock chrome.devtools.* 让 Playwright 能驱动 4 Tab 渲染断言。
  panelHarness: resolve(__dirname, 'src/devtools/panel-harness.html'),
  // content 世界 dialog（SubmitDialog / Annotator cancel-guard）的 E2E harness。
  // 这两条交互链路涉及悬浮球 click → 截图 → Annotator → SubmitDialog 全链路 + 真宿主页
  // content script 注入，Playwright 跨边界驱不动。harness 在 chrome-extension:// 页面里
  // 复现同款 shadow root 外壳 + mock chrome.runtime.sendMessage，让 ESC / mask click /
  // Tab 焦点循环 / 1.5s 成功保护期都能被自动化锁住。
  dialogHarness: resolve(__dirname, 'src/content/dialog-harness.html')
}

export default defineConfig({
  plugins: [vue(), crx({ manifest })],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5273,
    strictPort: true,
    hmr: { port: 5273 }
  },
  // 生产构建剥所有 console.* / debugger —— 关键诉求：避免 token / 内部状态
  // 通过 console.warn 落到 service worker / 宿主页 console 被偷窥（v0.1.6 之前
  // [Moo submit-fail] 那条 warn 含完整 Authorization header 是真实泄漏面）。
  // dev (pnpm dev) 不受影响，仍保留所有日志便于调试。
  esbuild: {
    drop: ['console', 'debugger']
  },
  build: {
    target: 'esnext',
    // 生产关 sourcemap：release.mjs 用 `zip -r .` 把 dist 全部打包，
    // 开了 sourcemap 会让发布 zip 同时携带源码（包体积 2-4 倍 + 等价源码外发）。
    // 需要调试线上问题时临时改 true 再 build 即可。
    sourcemap: false,
    rollupOptions: {
      input: {
        offscreen: resolve(__dirname, 'src/offscreen/index.html'),
        // devtools panel.html 不是 manifest 入口（由 devtools.ts 里
        // chrome.devtools.panels.create() 动态注册），必须显式声明 input，
        // 否则 build 不会把它写到 dist，DevTools 打开 Moo 面板会报
        // “该文件可能已被移至别处、修改或删除。”
        devtoolsPanel: resolve(__dirname, 'src/devtools/panel.html'),
        // v0.7.4：options page —— popup 「⚙ 完整配置」按钮弹 chrome.windows.create
        // 浮窗显示，复用 Environment / Settings / History 三个 Tab 组件。
        options: resolve(__dirname, 'src/options/index.html'),
        // v0.7.9：harness 只在非 release build 进 entry（默认带，release.mjs 排除）
        ...(IS_RELEASE_BUILD ? {} : harnessEntries)
      }
    }
  }
})
