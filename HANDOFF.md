# 交接

> 写给明天接班的同事。读完知道现在到哪、有什么坑、下一步该干嘛。

## 一句话现状

v0.1.11 已发；v0.1.12 在 master 累积了一**大批**体验增量（染色升级 / Alt+Shift+M / JSON viewer / 错误 stack 染色 / popup 最近提交区 / toolbar badge / 按钮系统化 / 暗色硬编码扫尾 / 录屏失败 UX / `<MooCloseBtn>` / `useAutoSave` 范式统一 / 元素清空两步确认 / 几条文案 fix），未发版。v0.1.11 是上一版的架构纠偏：**token 从 header 移到 POST body，扩展退回 webhook 客户端的本分**。之前十个版本一直用 `Authorization: Bearer` + `X-Scaffold-Token` 两个 header，把扩展跟 scaffold 后端绑死了；其实 token 走 body 字段就够，跟 webhook 一样——扩展不该假设后端长啥样。**v0.1.11 是 BREAKING 变更**，v0.1.12 纯 UX 增量，详见 CHANGELOG.md。

往前看，过去两周主线是收口：上 CI、上 pre-commit、补单测、给录屏换底盘、把所有"边界 case 不崩"的功夫都补完。当前没有大特性堆在路上，状态适合稳一段时间或做样式系统化这种欠了很久的事。

## 这两周做了什么

按版本时间线：

**v0.1.7（Batch 3）** — UX 收尾：focus ring 改 token、暗色 brand + 状态点 halo、文案再去黑话动词统一、z-index/窄宽溢出/popup a11y、模板防御性兜底。

**v0.1.8（Batch 4-5-6）** — 安全 + 数据健壮性大扫除：
- normalize/import 边界硬化，applyAuthHeaders 大小写敏感修，sanitizeHeaders 拦 CRLF
- parseRemoteId 字符集校验，renderTemplate JSON-escape
- storageKeys 白名单 + Unicode 同形字符防御
- ElementPicker 抹 password、dataUrlToBlob guard、sender.id 校验
- 卡顿优化 4 项、消息协议契约 4 项、JSON.parse null 防御、XHR url 非 string 防崩
- pickTokenHeaders defense-in-depth、ElementPicker mousemove 改 rAF coalesce
- release/打包安全收口

**v0.1.9（Batch 7-8）** — 工程基础设施 + 录屏底盘：
- **CI**：GitHub Actions 跑 `type-check + test + build`（`.github/workflows/ci.yml`）
- **Pre-commit**：simple-git-hooks 跑 `pnpm type-check && pnpm test`
- **单测**：vitest + 100+ case，覆盖 clone/redact/submitMessage/history/normalizeProject/parseRemoteId/template（`test/*.test.ts`）
- **类型严**：开 `noUncheckedIndexedAccess`，修 108 处
- **录屏重构**：`src/offscreen/` 状态机重构修了多个 race；rec-bar 任意 tab 都能显示；视频预览改 atob 绕宿主 CSP
- **权限窄化**：`tabCapture` 改 optional permission（按需 request）
- 撤掉 `console.error` monkey-patch（之前会污染扩展错误页）
- Settings.vue 移除 `(Switch as any).props` 反 pattern
- messages.ts 强类型 dispatch

**v0.1.10** — 一堆边缘 case 补完 + 换 logo：
- 录屏中切 tab 悬浮球不消失（`refreshProject` fallback 保留旧 matches）
- 录屏边缘 case 全覆盖（Chrome 停止共享条、同 tab navigation 恢复）
- 悬浮球 onMounted 也 clamp，不再被推到视口外；clamp 用对了尺寸常量
- 录像视频预览黑屏修（dataUrl 超 Chrome 上限，改用 blob URL）
- useRequests 用 `DEFAULT_REDACT` 兜底，修早期请求未脱敏漏洞
- logo 换成 f44 黑鹰头 + 黄色 reticle 眼（这一版稳了，别再换）

**v0.1.11（BREAKING）** — webhook 化纠偏 + scaffold 配套：
- 删 `applyAuthHeaders` 函数及全部调用；fetch 不再注 `Authorization` / `X-Scaffold-Token` 任何 header
- 默认 Payload 模板顶部加 `"token": "{{token}}"`（用户在模板里直接渲染）
- `buildRequestBody` 不再吃 `project` 参数，纯粹根据 server.headers + 渲染后的 body 出请求
- 状态回查也走 POST + body token：路径 `/status-public` 还在，但 method 改 POST，URL 完全不沾 token
- 删 `BugHistoryEntry.remoteHeaders` 字段（type + storage normalize）；老 entry 落盘的字段会被静默丢
- 删 `utils/remoteHeaders.ts` 的 `pickPropagatedHeaders`（保留 `parseRemoteId`）
- 配套 scaffold 后端改：`authenticateWithReason` 改读 `$req->json('token')`；路由 `/status-public` GET → POST；webhook 接口拆出独立 group 不沾用户 `$middleware`（修 `['web']` 配置撞 419 CSRF 的坑）；rate limiter 注册时机修对（之前用 `app->resolving(Router)` 永远不 fire，请求 500）
- `docs/SERVER_INTEGRATION.md` 整段重写为 webhook 风格，Node 骨架例子全换
- 文档侧 9 个文件同步：scaffold `CLAUDE.md` / `09-accounts.md` / `12-security.md` / `07-todo-inbox.md`；ext `Environment.vue` UI 提示、`config.ts` token 字段注释

**升级现网部署的事项**（口头跟同事说）：
1. 后端必须配套升到本次 scaffold commit，`composer update` + `php artisan optimize:clear`
2. 配自定义后端（非 scaffold）的同事：参照新版 `docs/SERVER_INTEGRATION.md` 把鉴权改成从 body 读 token

**v0.1.12（持续累积，未 release，纯 UX 增量）**：

- **请求列表染色升级**：行级失败左色条（4xx 橙、5xx 红）+ 慢请求 duration 染色（≥1s 橙、≥3s 红）。Overview Tab + 提交弹窗两边同步。代码位置：`src/devtools/tabs/Overview.vue` + `src/content/styles.ts` + `src/content/SubmitDialog.vue` 三处共用 `failClass` / `durClass` helper
- **新增 `Alt+Shift+M` 快捷键**：直接调起 toolbar popup（webhook 时代追加的「轻量控制面板」入口）。manifest commands 注册 + background `chrome.action.openPopup()`。⚠️ Chrome MV3 限制：API 没法直接打开 DevTools 或跳 DevTools 内某面板——快捷键开的是 popup，**不是** DevTools 的 Moo 面板，那个只能 F12 手动开
- **Overview Tab 错误信息人话化**：之前 `Could not establish connection. Receiving end does not exist.` stock 错误原文直接展示给用户（其实就是「扩展刚重载、宿主页没刷新」）。新版翻成「扩展刚重载过……刷新一下当前页面就好」+ 顺手把另一条 message port closed 也翻了
- **Popup「F12 → Moo 面板」提示直接显示**：之前要点 `如何打开 DevTools 面板 ▾` 才展开，现在 footer 里直接 inline 一行，删了折叠按钮 + 死掉的 `helpOpen` ref / `.link` CSS
- **录屏开关保留在 popup**：`tabCapture` 是 optional permission，必须有 user gesture 触发 `chrome.permissions.request()`，popup 是唯一能放这开关的地方。考虑过授权后隐藏，但首次发现性 trade-off 不值，保持现状
- **NEW · Overview body 区彻底改版（JSON viewer）**：Request/Response Body 段从裸 `<pre>` 升级成 `BodyViewer` 组件（`src/devtools/components/BodyViewer.vue`），三件套：① JSON 自动检测 + 「格式化/原文」toggle；② 语法染色（key/string/number/bool/null 配色，token regex 一次性 escape 出 HTML 走 `v-html`）；③ 大 body 折叠（>3K 字符默认只渲染前 2K，>200K 不尝试 parse）。新工具：`src/utils/jsonHighlight.ts`（15 单测）。复制按钮 + size chip 顺手补上
- **NEW · 错误 stack 染色**：`src/utils/stackFormat.ts`（6 单测）按行解析 `at fn (file:line:col)` / `at file:line:col` / `fn@file:line:col`，分别给函数名加粗、文件路径中灰、`:line:col` 弱灰。Overview 错误行展开后的 Stack 段套上
- **NEW · Popup 加「最近提交」区**：底部新 section（`src/popup/App.vue`），第 1 条 prominent 卡 + 第 2-3 条 compact 行。点击都是「在新 tab 打开当时出 bug 那个页面」（`entry.url`，不是 `remoteBase/remoteId`——后者不一定是可访问 web 页）。状态 chip 8 种：失败/重试中/已提交/待处理/处理中/完成/已删/已删除
- **NEW · Toolbar 图标 badge**：扩展图标右下角红 badge 显示最近 24h 失败提交数。新工具 `src/utils/badge.ts`，触发点 = `submitBug` 后 + SW 启动 + `onHistoryChanged`。>99 显示 `99+`，超 24h 老数据自动衰减
- **NEW · 按钮样式系统化**：Environment / Overview / History 三个 Tab 各自的 `.btn` / `.danger-btn` / `.icon-btn`（高度 26 / 22px 也不统一）全迁到 tokens.css 的 `.moo-btn` + `.moo-icon-btn`。新增 `.moo-icon-btn` 基类（28×28 SVG 方形）+ `--toggle-on` / `--danger` / `.moo-icon-btn-pulse` 装饰
- **NEW · 暗色硬编码扫尾**：ConfirmModal / PayloadEditorModal 的 modal scrim、Settings 行 hover（含手写的 light/dark 两套）、History 视频缩略图占位的 4 处 hex 都换 token；新增 `--moo-c-scrim` / `--moo-c-row-hover` / `--moo-c-bg-inverse`（含 dark mode 变体）
- **NEW · 录屏失败恢复 UX**：SubmitDialog 失败时除了 toast 还在 footer 上方挂持久横幅（含失败原因 + 重试按钮 + 录像专用提示「关窗后只能去 历史 重提」）。判定 cannotAutoRetry = `!!video && !res.queued`（复用 background 的 multipart / >1MB 排除规则信号）
- **NEW · `<MooCloseBtn>` 组件**：3 处关闭 X 按钮统一封装。`src/components/MooCloseBtn.vue` 不带 scoped CSS，`.moo-close-btn` 类在 tokens.css 和 content/styles.ts 都已定义
- **NEW · Settings / Environment 自动保存范式统一**：新 composable `src/composables/useAutoSave.ts`（debounce + saveState 状态机 + onError 回调 + onBeforeUnmount 自清 timer）。Environment 800ms 防抖 + draft 中间层；Settings 0 ms 立刻保存。**Settings 顺手改用 `useConfig()`，补上之前直接 `loadConfig`/`saveConfig` 漏的 onConfigChanged 多 tab 同步**（隐藏 bug 修了）
- **NEW · 附带元素「清空」加两步确认**：第一次点击 → 按钮红色 + 「再点一下确认清空」+ 1s 节奏脉动；3 秒内再点才真清。单个 × 删除不加（重选一个成本低）

测试覆盖：v0.1.12 单测 126 全过 + type-check + build 干净。**新增 Playwright E2E**（13 case 全过）覆盖 popup 最近提交区 / badge 真 SW 跑 / BodyViewer 真 Chrome 染色折叠，详见后面「Playwright E2E」段。`docs/RELEASE_TEST_CHECKLIST.md` § v0.1.12 已补到 #15（JSON viewer / 折叠 / stack 染色 / popup 最近提交 / badge 都进了）。

注：本批 6 个 refactor / feat（按钮 / hex / 失败 UX / MooCloseBtn / useAutoSave / 两步确认）的 RELEASE_TEST_CHECKLIST 场景**还没补**——下一批人发版前要手测：① 三个 Tab 按钮视觉一致 ② 深色模式下 modal scrim / Settings 行 hover / History 视频缩略图都正常 ③ SubmitDialog 故意造一次失败看横幅 ④ Settings 改个 toggle 看是否触发 Environment 同步刷新 ⑤ 多挑几个元素后点「清空」走两步确认

**MV3 限制·只能人眼核**：toolbar badge 视觉、`Alt+Shift+M` 真触发、DevTools 面板内嵌渲染——这三件事 Playwright 也做不了（global shortcut / native toolbar / chrome:// 页都驱不动），发版前自己手点 1-2 分钟过一下

## Playwright E2E（v0.1.12 新增基础设施）

之前测试只到 vitest 单测层；v0.1.12 配套加了 Playwright，**真起 chromium、真加载 dist 当 extension、真跑 SW**。位置：

- `playwright.config.ts` + `tests-e2e/fixtures.ts`（launchPersistentContext + 抓 extensionId + 抓 SW worker）
- `tests-e2e/popup-recent.spec.ts`（3 case：状态 chip / 8 种枚举 / 空 history）
- `tests-e2e/badge.spec.ts`（4 case：计数 / 24h 外排除 / >99 显示 / 衰减跟随 history 变化）
- `tests-e2e/body-viewer.spec.ts`（6 case：JSON 检测 / toggle / 折叠 / 非 JSON / XSS / search mark）
- `src/devtools/body-viewer-harness.{html,ts}`：BodyViewer 单独挂的 harness 页面，已并入 vite build 进 dist（<2KB，按 `?case=xxx` 切场景）

跑法：`pnpm test:e2e`（自动 build 后跑 13 case，约 15s）

为啥要 harness：BodyViewer 平时挂在 DevTools panel 里，chrome:// 内的 devtools UI 外部驱不动；做个独立 chrome-extension://EXT_ID/.../harness.html 页面 mount 它，Playwright 直接开就能截图 + DOM 断言。

`pnpm test:e2e` 之前要确保 `pnpm exec playwright install chromium` 跑过（本机已装）。

## 你最该知道的 3 个坑

老坑没变（前任 HANDOFF 提的 3 个仍然成立），这里只补**新增/演化**的部分。

### 1. 录屏的入口仍然必须是键盘快捷键

老规矩：`tabCapture.getMediaStreamId` 必须在用户键盘手势上下文里调，content script 里 click 经消息转一手手势就丢了。悬浮球的"录屏"按钮只显示 `⌥⇧R` kbd 提示。

**v0.1.9 之后新增的事**：录屏实际跑在 offscreen document（`src/offscreen/`）里，状态机刚重构过修了一批 race。改这块前先把 `src/offscreen/index.ts` 看完——里头每个状态迁移都有原因，不要凭直觉简化。

另：`tabCapture` 现在是 **optional permission**（v0.1.9 Batch 8-F），首次录屏会触发权限弹窗。装包测试时记得清掉 chrome://extensions 里的 site access 再试一遍首次流程。

### 2. 抓请求是同源 postMessage，假数据仍能塞进来

Pass 3 的三重防御（origin 限定、收端 origin 校验、payload shape 校验）仍在。固有缺陷没变：同源恶意脚本可以精心构造合法 shape 的假请求。新增字段时**必须**同步更新 `isValidRequestPayload` / `isValidErrorPayload`。

补强：`useRequests.ts` 现在用 `DEFAULT_REDACT` 兜底（cec6294），修了"用户配置脱敏规则之前就抓到的请求"那段空窗期。

### 3. chrome.storage.local 仍只有 10MB

老约束没变。新规矩：

- `noUncheckedIndexedAccess` 已开，新代码访问数组/对象索引必须处理 `undefined`。Batch 7-D 改了 108 处，别又写回去。
- pre-commit 会跑 `type-check + test`，过不了就 commit 不上。**不要 `--no-verify` 绕**——hooks 是这一版才刚立起来的，绕一次就废一半。

### 隐藏的第 4 个：扩展错误页污染

之前 background 里 `console.error` 被 monkey-patch 包过一层（为了上报 SW 错误），结果**所有**插件错误都被吃掉/重写，扩展错误页全是噪声。Batch 7-A 已撤（abf1124）。如果你想再上报 SW 错误，**不要**重新 monkey-patch console；走显式 `reportError(err)` 函数。

### 隐藏的第 5 个：unpacked 扩展的 SW 不会随 dist 文件变更自动 reload

调试 background 代码（如 v0.1.12 加 badge 那次）很容易踩：`pnpm build` 后 chrome 里 popup / panel 那些**页面端**代码确实会刷新，但 **service worker 的代码不会**——SW 在 chrome 进程里跑着，dist 文件变了它不知道，继续跑老 bundle。

表现：你以为新代码生效了，结果 SW 注册的 `chrome.storage.onChanged` listener 是老的（甚至不存在），新功能不响应任何事件。这次 badge 验证就是这么炸的——MCP 验证发现 badge 不更新，怀疑了半天代码逻辑，最后 `chrome.runtime.reload()` 一下就好了。

**修法（任选）**：
- chrome://extensions → Moo → 点 🔄 重新加载按钮
- popup / panel DevTools console 跑 `chrome.runtime.reload()`
- 改 manifest.json（连版本号 / description 任何字段都行）会让 chrome 强制重载整个扩展

**不要**指望关闭再开 chrome 能解决——`chrome.runtime.onStartup` 触发也不会重读 SW 代码（SW 是缓存在 Chrome 的 extension 进程里的）。开发期间养成「改 SW 后立刻去 chrome://extensions 点 🔄」的肌肉记忆。

## 现在最值得做的下一件事

按价值排序：

原本列的「优先 3 件」+「不急 3 件」都做完了（v0.1.12 攒完批量改动均已 commit / push，未 release）：

| # | 事项 | 落地 commit |
|---|---|---|
| ✅ | 按钮样式系统化（`.btn / .danger-btn / .icon-btn` → canonical `.moo-btn` + `.moo-icon-btn`） | ff88ba7 |
| ✅ | 暗色硬编码扫尾（4 处散落 hex → `--moo-c-scrim` / `--moo-c-row-hover` / `--moo-c-bg-inverse`） | 73de398 |
| ✅ | 录屏失败恢复 UX（SubmitDialog 失败时显示持久横幅 + 一键重试 + 录像专用提示） | d28c0dc |
| ✅ | `<MooCloseBtn>` 共享组件 | 513df72 |
| ✅ | Settings/Environment 自动保存范式统一（`useAutoSave` composable + Settings 改用 `useConfig`，顺手补多 tab 同步隐藏 bug） | 531a659 |
| ✅ | 附带元素「清空」加两步确认（避免误点丢光辛苦挑的元素） | c7aa9ce |

**下一批可以挑的（接班自己定优先级）**：

- **`useAutoSave` 加单测**：本次没补，组件 lifecycle 跨边界 mock 有点烦，但 inflight / saved 切换状态机值得单测护一道
- **content world 走 token.css**：`src/content/styles.ts` 重复定义了一套 `--c-brand` 等 token（因为 shadow DOM 隔离），跟 tokens.css 完全平行；如果 vite 能做 shadow root style 注入，可以收口到一处
- **悬浮球分组**：多个 server 同时匹配时悬浮球点击会跳"项目选择"小弹窗，列表长了不好看，可以加分组 / 搜索
- **History tab 性能**：30 条 entry + 每条带 base64 缩略图，滚动有微卡，可以 virtual list
- **CI 接入 Playwright E2E**：本地 `pnpm test:e2e` 跑过，CI 上要加 chromium 安装步骤 + 跑 13 case 当 PR gate

旧 HANDOFF 提的「悬浮球默认位置避让宿主 fixed 元素」已经做了（c852992，5 候选角落 + `elementsFromPoint` 探测），从清单划掉。

## 干活之前先看几个文件

| 你要碰这个 | 先读这个 |
|---|---|
| 上报 / 重试 / 状态回查 | `src/background/index.ts` |
| 抓 fetch/XHR 的钩子 | `src/injected/main-world.ts` + `src/content/useRequests.ts` |
| 录屏状态机 | `src/offscreen/index.ts`（v0.1.9 重构过，每个状态迁移都有原因）|
| 截图标注 | `src/content/Annotator.vue` |
| DevTools 4 个 Tab | `src/devtools/tabs/{Overview,Environment,History,Settings}.vue` |
| 消息协议 | `src/types/messages.ts`（强类型 dispatch）|
| 字段语义、模板变量 | `docs/SERVER_INTEGRATION.md` |
| logo / 品牌 | `docs/LOGO_BRIEF.md`（鹰图腾来自团队身份，**不要**换）|
| CI / pre-commit | `.github/workflows/ci.yml` + `package.json` 的 `simple-git-hooks` |

## 工程约束（新规矩，必须遵守）

- **不绕 hook**：`pnpm type-check && pnpm test` 是 pre-commit 跑的，过不了就修，不要 `--no-verify`。
- **不关 `noUncheckedIndexedAccess`**：写数组/对象索引时显式处理 `undefined`。
- **改 `src/types/messages.ts` 要看清下游**：dispatch 走强类型，新增 message 要把所有 handler 补齐才能过编译。
- **改 `injected/main-world.ts` 的 payload shape 必同步改 validator**：见上面坑 #2。

## 几条沟通备忘

- 团队名 **mooeen（沐恩）**，基督教背景，鹰图腾呼应「如鹰展翅上腾」。身份核心，不要改。
- 发版节奏：成批了再发。这次 Batch 3-8 累积发了 4 个版本，节奏对。
- 文档风格：「不要堆术语，用人话」。所有 commit message / 文档都按这个标准写。
- Logo 不要再换。f44 黑鹰头 + 黄 reticle 这版定稿（v0.1.10）。
