# moo-chrome-dev-tool

前后端业务调试 Chrome 扩展（Manifest V3）。

调试时发现 bug → 悬浮球一键截图 → 画红框标注 → 自动附带页面 URL/UA/视口 等现场信息 → 提交到可配置的服务端（按项目 / 多环境）。

## 技术栈

- Vite 5 + Vue 3 + TypeScript
- @crxjs/vite-plugin（MV3 打包 + HMR）
- pnpm

## 目录结构

```
.
├── manifest.json
├── vite.config.ts
├── scripts/mock-server.mjs   # 本地联调用 mock 服务端
└── src/
    ├── popup/                # 点图标的小弹窗
    ├── devtools/             # F12 "Moo" 面板（4 个 Tab）
    │   ├── Panel.vue
    │   └── tabs/
    │       ├── Environment.vue   # 项目 / 服务器 CRUD（已实现）
    │       └── Placeholder.vue   # 概览 / 历史 / 设置（Phase 2+）
    ├── content/              # 注入页面的悬浮球 + 标注 + 提交对话框（Shadow DOM）
    │   ├── ContentApp.vue
    │   ├── FloatingBall.vue
    │   ├── Annotator.vue
    │   ├── SubmitDialog.vue
    │   ├── styles.ts
    │   └── index.ts
    ├── background/           # Service Worker：截图、模板渲染、上报、匹配项目
    ├── composables/useConfig.ts
    ├── storage/config.ts     # chrome.storage.sync 封装 + URL 匹配
    ├── utils/template.ts     # {{var}} / {{varJson}} 渲染
    └── types/
        ├── config.ts         # Project / BugServer / Capture / Redact
        └── messages.ts
```

## 开发

```bash
pnpm install
pnpm dev          # 启动 Vite，产物输出到 dist/
```

打开 Chrome → `chrome://extensions` → 开发者模式 → "加载已解压的扩展程序" → 选择 `dist/`。

修改源码 @crxjs 会自动重载。

## Phase 1 体验流程

1. **启动本地 mock 服务端**：
   ```bash
   pnpm mock
   # → http://localhost:8787/bugs
   ```

2. **配置项目**：随便打开一个网页，按 F12 → "Moo" 面板 → "环境" Tab
   - 点 `+` 新建项目，命名比如"测试"
   - 在"URL 匹配"框填一行：`https://*/*`（或精确到你要调试的域名）
   - 点"+ 新建服务器"，endpoint 填 `http://localhost:8787/bugs`，方法 `POST`
   - payload 模板保持默认即可

3. **使用悬浮球**：刷新页面 → 右下角出现 `M` 悬浮球（可拖动）
   - 点击 → 截图 → 进入标注界面 → 拖拽画红框 → 下一步
   - 填标题描述 → 选服务器 → 可点"预览 payload"查看渲染结果 → 提交
   - mock 服务端控制台会打印收到的内容，截图会存到 `mock-uploads/`

## 构建

```bash
pnpm build        # dist/ 可直接打包发布
```

## 已实现

### Phase 1 — MVP 主流程
- ✅ 项目级配置：URL 匹配 + 多个上报服务器（`chrome.storage.local`，无 8KB 单项限制）
- ✅ 配置导入/导出 JSON（团队共享 / 跨设备迁移）
- ✅ 悬浮球（拖拽、位置记忆、按项目匹配显示）
- ✅ 可视区截图（`chrome.tabs.captureVisibleTab`）
- ✅ 红框标注（拖拽绘制、撤销、清空）
- ✅ 提交对话框（标题、描述、服务器选择、payload 预览）
- ✅ payload 模板渲染（`{{var}}` + `{{varJson}}`）
- ✅ JSON / multipart 两种上报格式
- ✅ 从 background 发起请求，绕过 CORS

### Phase 2 — 现场抓取
- ✅ MAIN world 注入：monkey-patch `fetch` + `XMLHttpRequest`
- ✅ 抓取 method / URL / 请求体 / 响应体 / 状态 / 耗时
- ✅ 环形缓冲（默认 50 条，可在项目配置中调整）
- ✅ Header / Body 脱敏（按项目 redact 配置）
- ✅ SubmitDialog 内"附带请求"区，支持时间窗口、URL 过滤、批量勾选
- ✅ 默认勾选打开对话框前 5 秒内完成的请求
- ✅ DevTools "概览" Tab：实时请求列表（可展开看 headers / body）+ URL 过滤 + 自动刷新 + 清空

> ⚠️ MAIN world 脚本只能抓注入之后发起的请求。每次重新加载扩展后，需要刷新目标页面才能开始捕获。

### Phase 3 — 体验与历史
- ✅ 快捷键 `⌘/Ctrl + Shift + B` 触发截图（等同点悬浮球）
- ✅ Console 错误抓取：`window.onerror` / `unhandledrejection` / `console.error`
- ✅ SubmitDialog "附带错误"区，与请求一起可勾选附带
- ✅ DevTools 概览 Tab 切换"请求/错误"两种视图，错误支持展开看 stack
- ✅ payload 模板新增 `{{errorsJson}}` 变量
- ✅ 历史记录（chrome.storage.local，最近 30 条）：
  - 缩略图 + 标题 + 项目/服务器 + 状态徽章 + 时间
  - 展开看描述 / 响应 / 请求列表 / 错误列表
  - **重新提交**：可选择重新发到任意服务器
  - 单条删除 / 一键清空 / 模糊搜索

## 后续计划

- **Phase 4** 高级：
  - 标注增强（箭头 / 文字 / 马赛克）
  - element picker（在页面上选中元素自动带 selector + 上下文截图）
  - 视频录制（MediaRecorder 短录屏）
  - localStorage / sessionStorage 白名单快照

## 图标

`manifest.json` 暂未引用图标。需要时把 PNG 放在 `public/icons/` 并在 manifest 补 `icons` 字段即可。
