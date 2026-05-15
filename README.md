# moo-chrome-dev-tool

前后端业务调试 Chrome 扩展（Manifest V3）。

调试时发现 bug → 一键截图 + 录屏 → 自动附带页面 URL/UA/视口、现场抓的网络请求 / Console 错误 / 选中的 DOM 元素 / localStorage 快照 → 提交到可配置的服务端（按项目 / 多环境）→ 在 DevTools 里继续跟进状态。

> 想接自家后端？看 [`docs/SERVER_INTEGRATION.md`](docs/SERVER_INTEGRATION.md)。

---

## 技术栈

- Vite 5 + Vue 3 + TypeScript
- `@crxjs/vite-plugin`（MV3 打包 + HMR）
- pnpm

---

## 目录结构

```
.
├── manifest.json
├── vite.config.ts
├── scripts/                    # 本地联调用 mock 服务端 + 图标生成
├── docs/
│   └── SERVER_INTEGRATION.md   # 后端接入协议规范 + 示例
└── src/
    ├── popup/                  # 点扩展图标的小弹窗（仅状态展示）
    ├── devtools/               # F12 "Moo" 面板（4 个 Tab）
    │   ├── Panel.vue
    │   └── tabs/
    │       ├── Overview.vue        # 实时请求 + Console 错误
    │       ├── Environment.vue     # 项目 / 服务器 / token CRUD
    │       ├── History.vue         # 提交历史 + 远端状态同步 + 重试
    │       └── Settings.vue        # 全局开关 / 抓取 / 脱敏 / 存储
    ├── content/                # 注入页面的悬浮球 + 标注 + SubmitDialog（Shadow DOM）
    │   ├── ContentApp.vue
    │   ├── FloatingBall.vue
    │   ├── Annotator.vue           # 截图标注（矩形/圆/箭头/文字/马赛克）
    │   ├── ElementPicker.vue       # 选元素
    │   ├── SubmitDialog.vue
    │   ├── useRecorder.ts          # 录屏控制
    │   ├── useRequests.ts          # 收 main-world 推来的请求
    │   ├── useErrors.ts            # 收 main-world 推来的错误
    │   ├── passwordMask.ts         # 截图前遮密码框
    │   └── styles.ts               # shadow DOM CSS（独立 token）
    ├── injected/               # 注入到 MAIN world 的 fetch/XHR/console hooks
    ├── offscreen/              # MediaRecorder 跑在 offscreen document（录屏需要）
    ├── background/             # Service Worker：上报 / 重试队列 / 录屏编排 / 状态回查
    ├── storage/                # config + history（自动迁移、自动写回）
    ├── utils/                  # template 渲染、redact 脱敏、submitMessage 格式化
    ├── styles/tokens.css       # 设计令牌（popup + devtools 共享）
    └── types/                  # 共享类型
```

---

## 快速开始

```bash
pnpm install
pnpm dev          # 启动 Vite，产物输出到 dist/
```

加载扩展：`chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」→ 选 `dist/`。

源码改动 @crxjs 会自动重载；改 manifest 或 commands 后需要在扩展页点重新加载。

### 本地联调

```bash
pnpm mock         # 起一个收 intake 的 mock 服务，默认 http://localhost:8787/bugs
```

在 DevTools「环境」Tab 新建项目 → URL 匹配 `https://*/*` → 新建服务器 endpoint 填 `http://localhost:8787/bugs` → 默认模板即可。

刷新页面 → 右下角出现 `M` 悬浮球（可拖动） → 点开菜单选「截图」/「录屏 ⌥⇧R」 → 标注 → 填标题 → 提交。mock 控制台会打印收到的内容，附件落到 `mock-uploads/`。

### 构建

```bash
pnpm build        # dist/ 可直接打包发布
```

---

## 功能现状

### 现场捕获

- **可视区截图** — `chrome.tabs.captureVisibleTab`
- **截图标注** — 矩形 / 圆 / 箭头 / 文字 / 马赛克 / 撤销 / 清空
- **录屏** — 快捷键 `⌥⇧R` 触发；走 `chrome.commands` → `chrome.tabCapture.getMediaStreamId` → offscreen `MediaRecorder`；webm/vp9，3.5 Mbps，最长 30s 自动停
- **元素选择** — 在 SubmitDialog 里点「选元素」，hover 高亮，点击记录 selector / outerHtml / attributes，可多选
- **网络请求** — MAIN world hook `fetch` + `XMLHttpRequest`，记录 method / URL / headers / body / status / 耗时，环形缓冲（默认 50 条可调）
- **Console 错误** — hook `window.onerror` / `unhandledrejection` / `console.error`
- **localStorage 快照** — 按项目白名单 key 抓取（优先 localStorage，找不到尝试 sessionStorage）

### 触发与界面

- 悬浮球：拖拽 / 位置记忆 / 按项目匹配显示
- 快捷键截图：`⌘/Ctrl + Shift + B`
- 快捷键录屏：`⌥⇧R`（可在 `chrome://extensions/shortcuts` 改键）
- 扩展 popup：展示当前 tab 是否匹配项目 + 配置项目列表

### DevTools 面板

| Tab | 能力 |
|---|---|
| **概览** | 实时请求 / Console 错误两种视图；时间窗口（5/15/30/60s/全部）；URL / message 过滤；自动刷新；展开看 headers / body / stack |
| **环境** | 项目 / 服务器 CRUD；URL 匹配（通配 `*`）；token；脱敏配置（header / body 黑名单）；password 输入框遮罩开关；localStorage 白名单；配置导入导出 JSON |
| **历史** | 最近 30 条提交记录；缩略图 + 录屏角标；模糊搜索；展开看响应 / 请求 / 错误；**重新提交**到任意服务器；**同步远端状态** |
| **设置** | 全局开关；项目级抓取 / 脱敏 / storage 白名单；存储管理（清空历史 / 重试队列） |

### 配置 + 上报

- **多项目 / 多环境** — 每项目可配多个服务器（dev / staging / prod 等）
- **URL 通配匹配** — `*` 匹配任意字符
- **payload 模板** — `{{var}}` / `{{varJson}}` 双语法；JSON / multipart 两种 Content-Type 编码
- **自动迁移** — 默认模板演进时（如新增 video 字段），旧项目自动补齐
- **token 鉴权** — 项目级 token 自动注入 `Authorization: Bearer` + `X-Scaffold-Token` header
- **脱敏** — 提交前按项目配置抹除敏感 header / body 字段
- **绕过 CORS** — 上报请求从 service worker 发起

### 可靠性

- **重试队列** — 5xx / 网络错误自动入队，`chrome.alarms` 每 5 分钟扫一次（仅 JSON body，multipart 不重试）
- **远端状态同步** — DevTools 历史 Tab 点同步，扩展 GET `{base}/{id}/status-public` 更新本地 `open/in_progress/done/deleted` 状态
- **历史超出存储** — 自动按 FIFO 丢老的，不报错

---

## 推荐后端：moo-scaffold

如果你用 Laravel，最快的接入方式是装 `moo-scaffold` 包——自带 intake + 后台 UI + 开发账号管理 + 截图视频展示：

```bash
composer require charsen/moo-scaffold
```

其它语言 / 框架想自己实现 intake：→ [`docs/SERVER_INTEGRATION.md`](docs/SERVER_INTEGRATION.md)（含协议规范 + Node/Python 示例 + 字段语义表）

---

## 已知设计取舍

- **录屏入口必须是快捷键**：Chrome MV3 要求 `tabCapture.getMediaStreamId` 在 user gesture 上下文里被调，content script 的 click 经消息转手后手势就丢了。悬浮球的「录屏」按钮只显示提示。
- **截图前自动遮密码框**：默认开启，可在项目级关闭
- **MAIN world 抓取**：只能抓注入之后发起的请求；扩展安装/刷新后需刷新目标页才会开始捕获
- **重试队列不接 multipart**：multipart body 含二进制 Blob 不易序列化进 storage
- **popup 不能 alert**：MV3 popup 屏蔽原生对话框，已改 inline 展开
- **跨上下文时间**：devtools panel 和网页 main-world 的 `performance.now()` 不是同一个 origin，所有时间窗口判断用 `startedAt` ISO 字符串

---

## 改进 / 调整记录

参考 `git log`——commit 信息维护得比较细。

