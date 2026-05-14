# moo-chrome-dev-tool

前后端业务调试 Chrome 扩展（Manifest V3）。

## 技术栈

- Vite 5 + Vue 3 + TypeScript
- @crxjs/vite-plugin（MV3 打包 + HMR）
- pnpm

## 目录结构

```
.
├── manifest.json             # MV3 清单
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── popup/                # 点击图标的弹窗（辅入口）
    ├── devtools/             # F12 中的 "Moo" 面板（主入口）
    │   ├── devtools.ts       # 注册 panel
    │   └── Panel.vue         # 面板 UI
    ├── background/           # Service Worker（消息总线）
    ├── content/              # 注入到页面的内容脚本（页面 <-> 扩展 桥接）
    ├── utils/                # 通用工具（消息收发等）
    └── types/                # 共享类型
```

## 开发

```bash
pnpm install
pnpm dev          # 启动 Vite，产物输出到 dist/
```

然后打开 Chrome：`chrome://extensions` → 打开"开发者模式" → "加载已解压的扩展程序" → 选择 `dist/` 目录。

修改源码会自动重载扩展（@crxjs HMR）。

## 构建

```bash
pnpm build        # 产物在 dist/，可直接打包发布
```

## 图标

`manifest.json` 暂未引用图标。需要时把 PNG 放在 `public/icons/`（如 `icon16.png`、`icon48.png`、`icon128.png`），然后在 manifest 中补：

```json
"icons": {
  "16": "public/icons/icon16.png",
  "48": "public/icons/icon48.png",
  "128": "public/icons/icon128.png"
}
```

## 消息流向

```
页面 (window.postMessage)
  ↕
content script
  ↕  (chrome.runtime.sendMessage)
background (service worker, 路由中心)
  ↕
devtools panel / popup
```
