# 交接

> 写给明天接班的同事。读完知道现在到哪、有什么坑、下一步该干嘛。

## 一句话现状

**v0.7.1 已发**（2026-05-25）。[下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.7.1/moo-chrome-dev-tool-0.7.1.zip)（sha256 `3bab09370f975a19a167b026a099a96edf9322869cd4007e18857c2b70d6c9bc`）。无 BREAKING — v0.7.0 BREAKING 升级 UX 改进。新功能：① addProject 自动填当前 inspected tab URL 进 matchPatterns[0]（小白友好）② suggestPattern banner — 当前 URL 不命中任何 enabled 项目时顶部弹引导追加 + session 级 dismiss。测试：+14 单测（urlToMatchPattern helper 边界）+ 3 e2e（C1b/C1c/C1d 锁新功能）+ 3 e2e（dynamic register E1/E2/E3 锁 SW 契约）。601 单测 + 112 e2e 全绿。

**v0.7.0 已发**（2026-05-25）。[下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.7.0/moo-chrome-dev-tool-0.7.0.zip)（sha256 `7592872093d3e7dc58187fe56ef02078faf6dae7fa1c6e2d1a5ee28fac7395a9`）。**⚠️ BREAKING** —— content_scripts 改成动态注册（CWS 上架友好，manifest 不再 `<all_urls>` 全站注入）。matchPatterns 规则严格收敛（chrome MV3 要求 `https?://host/path`，单 `*` / 无 scheme / file/ftp 不再支持）+ minimum_chrome_version 109 → 111。translator drop 老 patterns 时 popup 弹 `.dropped-banner` 引导改。4 波 agent review + 主动复盘 3 遗漏全闭环。582 单测 + 106 e2e 全绿。

**v0.6.3 已发**（2026-05-25）。[下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.6.3/moo-chrome-dev-tool-0.6.3.zip)（sha256 `e0e0d463ee1c8c3017036f2dc5bea2d7e738da368221874b22be2de1f77f7194`）。16 commit 累积 + 4 波 agent review 闭环。新功能：版本检查提示（SW 每天 fetch Gitee latest release，新版 popup 弹 banner — CWS 上架前替代自动更新）。修复：getBug 漏 cookie cascade / uploadEditorFile + ping 403 文案 / e2e fixture race（v0.6.1 silent 回归同款防护）/ popup 跨 SW 同步 VERSION_CHECK_FLAG / badge surface 冲突。+5 onInstalled-upgrade-chain e2e（A2 直挡 v0.6.1 类回归）+ 5 cascade 单测。CWS 物料就绪（docs/cws/）。`.release-pii-deny` 黑名单建立。568 单测 + 105 e2e 全绿。

**v0.6.2 已发**（2026-05-25）。[下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.6.2/moo-chrome-dev-tool-0.6.2.zip)（sha256 `046c9d0bc2392594b32c68691615e50ac59ba1bdc31416b0e5ed7fedfb3d10c4`）。**🔴 dogfood hotfix** —— 同事撞到禅道 v1 endpoint 403 错，本版修：v1 撞 403 自动 cookie cascade 兜底（带浏览器登录态 cookie + Token 共发，禅道服务器自选）+ 403 错误文案改友好让用户知道是禅道侧问题。无 BREAKING。551 单测 + 100 e2e 全绿。

**v0.6.1 已发**（2026-05-25）。[下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.6.1/moo-chrome-dev-tool-0.6.1.zip)（sha256 `9634e5ee62d9f03990623bfbbea88220aa3130e56667207f8cecec42e4f91c09`）。v0.6.0 后 mv3-pro 二审 + code-simplifier review 抓出的 patch：badge 升级提示链路 hotfix（P0 × 2：onInstalled `!` 被 SW IIFE 覆盖 / popup dismiss 误清失败计数）+ 跨 popup storage.onChanged 同步 banner + onInstalled 'install' 路径也写 flag + 4 项简化。546 单测全绿。

**v0.6.0 已发**（2026-05-24）。[下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.6.0/moo-chrome-dev-tool-0.6.0.zip)（sha256 `c49ce7b062eb14a5fd72886fb835357c4cca70acf8019d5a344d771ff3265521`）。**⚠️ BREAKING** —— host_permissions 改 optional（CWS 关键单点），升级后 popup 自动弹 banner 引导一键启用。21 commit 累积 PLAN_v1.0 推进：P0 router 化（bg/index 1000 → 254 行 / onMessage 18 case 下放 6 handler）+ IssueAdapter 实装（4 adapter + dispatch）+ P1 Environment.vue 拆（1206 → 582 行 + 3 composable + 2 子组件）+ P3 retryQueue 多轨 + #128 host_permissions optional + i18n 留口子 + 单测 +135（406 → 541）。用户明示放行跳手测。541 单测 + 100 e2e。

**v0.5.1 已发**（2026-05-24）。[下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.5.1/moo-chrome-dev-tool-0.5.1.zip)（sha256 `6bafb1570c31316cf5eac113428852ad23a89fc829e5f1ef0b757c4a5a944a6f`）。**第 8 波 review** —— 换 3 个新视角 agent（**release-captain + Plan + vue-craft 三审**）。修 3 严重 release.mjs 工程漏洞 + 6 UI 同款漏扫 + 5 工程改进 + 发 docs/PLAN_v1.0.md。399 单测 + 90 e2e。

**v0.5.0 已发**（2026-05-24）。[下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.5.0/moo-chrome-dev-tool-0.5.0.zip)（sha256 `6589763d24a13ddb66d8a7c24cddece19dbc2523d13031e3ca285c46a1840f5d`）。第 7 波 review — 换 lab-tester + code-simplifier + mv3-pro 二次找出测试 debt + 代码重复 + MV3 深陷阱。399 单测（366 → 399 = +33） + 90 e2e。

**早期版本简介**：v0.1.x → v0.4.3 见 [docs/handoff-archive/v0.1.x.md](docs/handoff-archive/v0.1.x.md)；v0.4.4 → v0.4.9 见 [docs/handoff-archive/v0.4.4-v0.4.9.md](docs/handoff-archive/v0.4.4-v0.4.9.md)。

**往前看**：v0.7.1 把 v0.7.0 BREAKING UX 小白化（自动填 URL + suggestPattern banner）+ 测试覆盖补齐（587 → 601 单测 + 109 → 112 e2e）。**剩 v0.7.2+ 工作**：① 自托管 telemetry collector（PLAN 决策 5） ② web_accessible_resources `<all_urls>` 收窄（CWS 评审风险） ③ i18n 全量迁移（v1.2+） ④ 同事 dogfood v0.7.x 反馈。**CWS 上架物料就绪**（docs/cws/）等用户截图 + 后台填表。

## 这两周做了什么

> 历史版本（v0.1.7 → v0.1.14 + v0.2.0 → v0.2.3 简介）已归档至 [docs/handoff-archive/v0.1.x.md](docs/handoff-archive/v0.1.x.md)。当前发版的明细全在 [CHANGELOG.md](CHANGELOG.md) 顶部，本文档不重复列。

**MV3 限制·永远只能人眼核**：toolbar badge 视觉、`Alt+Shift+M` 真触发、DevTools 面板内嵌渲染、global shortcut、native toolbar、chrome:// 页——这些都 Playwright 也做不了，发版前自己手点 1-2 分钟过一下。**v0.1.13 / v0.1.14 / v0.2.0 / v0.3.1 / v0.4.0 都没走 dogfood ≥ 几天**（用户明示跳过）：v0.2.0 的禅道集成在 真禅道实例 真实环境完整 dogfood 过（11 个 dogfood fix 出自实测），v0.3.1 4 修一捆「文档+单测+悬浮球时间窗+流程文档」均非生产行为变更（P3 250ms 时间窗对真用户 0 影响），**v0.4.0 重型重构** dogfood 同事截图证明 ensureCookieSession + discoverProduct 核心路径 work 用户明示放行。后续 v0.4.x 体感回归 hotfix 走 v0.4.1。

## Playwright E2E（v0.1.14 立基线 90 case，v0.4.x 加了 SubmitDialog 复制/收起 spec 持平 90）

> v0.2.0 的禅道集成 dogfood 是在真实环境（真禅道实例）走的，**没补 E2E**——禅道 API 跨域 + cookie session + 真实 WAF 在 Playwright headless chromium 里没法可靠复现（mock 价值不大）。如果后续要做禅道侧的回归保护，更现实的方向是在 `tests/` 里加 client.ts / submit.ts 的纯单测（已有 zentao client 71 + retryQueue multipart 11，覆盖了主要分支）。

v0.1.12 立基础设施（13 case），v0.1.13 铺开到 77 case，v0.1.14 加 panel-settings G5/G6/G7（队列 chevron 展开 + 单条删 + 空队列禁用）+ **dialog-harness 11 case 锁 SubmitDialog/Annotator cancel-guard** + **FloatingBall 6 case 锁拖动（iframe 跨界 + lost-pointerup race + 阈值后 setPointerCapture 契约 + 纯点击不 capture 契约）** 共 97 case；v0.4.x 期间删减若干并加 SubmitDialog 复制/收起 spec，**实测 90 case**。**真起 chromium、真加载 dist 当 extension、真跑 SW**。位置：

- `playwright.config.ts` + `tests-e2e/fixtures.ts`（launchPersistentContext + 抓 extensionId + 抓 SW worker + 新增 `waitForBadgeText` 轮询助手 + `openExtensionPage` retry helper）
- `tests-e2e/popup-*.spec.ts`（popup-recent 3 / popup-dark 1 / popup-overflow 1 / popup-many 1 / popup-status 3 / popup-inject 5 / popup-corrupt 2 = **16 case**）
- `tests-e2e/badge*.spec.ts`（badge 4 / badge-edges 4 / badge-corrupt 3 = **11 case**）
- `tests-e2e/body-viewer*.spec.ts`（body-viewer 6 / body-viewer-widths 6 / body-viewer-dark 2 / body-viewer-invalid 4 / body-viewer-search 3 = **21 case**）
- `tests-e2e/panel-*.spec.ts`（panel-tabs 11 / panel-tabs-dark 4 / panel-overview-detail 4 / panel-environment-crud 6 / panel-settings-toggle 4 = **29 case** —— **panel-harness 解锁**）
- `tests-e2e/dialog-submit.spec.ts`（D1-D7 = **7 case**）+ `tests-e2e/dialog-annotator-cancel.spec.ts`（A1-A4 = **4 case**）+ `tests-e2e/dialog-floating-ball-drag.spec.ts`（F1-F6 = **6 case**）—— **dialog-harness 解锁 content 世界 dialog + 悬浮球拖动行为**
- `src/devtools/body-viewer-harness.{html,ts}` + `src/devtools/panel-harness.{html,ts}` + `src/content/dialog-harness.{html,ts}`（三个 harness，按 `?case=` / `?tab=&seed=` / `?case=&fail=&success=` 切场景；dialog-harness 还覆盖 `?case=floating-ball` 锁拖动行为）

跑法：`pnpm test:e2e`（build → 90 case 约 1.5min）

为啥要 harness：BodyViewer / Panel.vue 平时挂 DevTools panel iframe 里，chrome:// 外部驱不动；SubmitDialog / Annotator / FloatingBall 平时挂宿主页注入的 closed shadow 里，⌘⇧B 全局快捷键 + content script 注入链路 Playwright 跨边界也驱不动。做独立 harness 页面 mock chrome.devtools.* / chrome.tabs.sendMessage / chrome.runtime.sendMessage，Playwright 直接开就能 DOM 断言 + dispatch 合成 pointer events 锁拖动契约。

`pnpm test:e2e` 之前要确保 `pnpm exec playwright install chromium` 跑过（本机已装）。

## 你最该知道的 3 个坑

老坑没变（前任 HANDOFF 提的 3 个仍然成立），这里只补**新增/演化**的部分。

### 0. 禅道集成的两条硬依赖 + 4 条架构事实（v0.2.0 新加，下次碰禅道代码必看）

**硬依赖**（用户视角缺一不可）：
1. **浏览器里手动登录禅道页面**——`zentao.submitBug` 真正提交时走的是 `chrome.cookies.get` 拿的浏览器登录态 cookie，不是 v2 API token。**没登录 = 拿不到 cookie = 提交 `openedBy=system`**（禅道当机器人，bug 不归属真人）
2. **Moo Settings 配账号 / 密码 / 项目 ID**——`/user-login` 用来拉 token + 调 `/user-getList` 拉成员（指派人下拉）+ multipart upload 也用 token

只满足 #1 不行（没账号 Moo 不知道往哪个项目提）；只满足 #2 也不行（cookie 拿不到提交会变 system）。**两条必须同时满足**。

**关键架构事实**（接下来改禅道代码前**必须**先理解）：
1. **B' 路径，不中转**：`src/background/zentao/client.ts` + `submit.ts` 直接打禅道 v2.0 REST API（`/api.php?m=user-login` / `/user-getList` / `/project-getList` / `/file-ajaxUpload.html` / submit-bug 等），**不依赖中间适配层**。改 endpoint 直接看 client.ts，不要去找「Moo B 服务器」之类的中间件
2. **写操作 cookie session / 读操作 token**：login + listProjects + listUsers + ensureToken 走 v2 API + token（无副作用，token 失效自动 refresh）；**真正 submitBug 必须走浏览器 cookie**（修 `openedBy=system`）。这是规则，不要图省事统一改成都走 token
3. **附件走 zui editor 链路，不走 v2 API attach_files**：v2 API 的 attach_files 端点不支持 inline 渲染，必须点附件下载才能看。改走 `/file-ajaxUpload.html` 拿 `fileID`，再把 `<img src="/file-read-{fileID}.html">` inline 拼到 bug `steps` 字段的 HTML 里 —— 这样**截图直接在 bug 详情页渲染**。录像 / curl.sh / 错误信息也走同一端点，但只挂附件不 inline
4. **inline curl 必须 ZWS 污染，curl.sh 附件不能**：禅道服务器 WAF 会把裸 curl URL 当 SSRF 拦截。inline 渲染版的 URL 关键字符之间插 zero-width space (U+200B)，渲染视觉无差异 + zsh/bash 复制粘贴执行无差异，但 WAF 字符串匹配失效。**curl.sh 附件保留干净版**（保证用户下载下来直接执行不带不可见字符）。改 `src/utils/curlGenerator.ts` 别一刀切

**已穷举的「做不到」事项**（下次别再花时间重探）：
- **视频 inline 渲染**：禅道 HTML sanitizer 是 strict 白名单，`<video>` / `<embed>` / `<object>` 整段剥成空，`<iframe>` 字母被改全角 + `<>` 转义成纯文本；上传的 .webm 被禅道强制改名 .txt + 返 `application/octet-stream`。webm → GIF + `<img>` 理论可行但 GIF 体积 5-10 倍膨胀必超 50M 禅道上限。**现状下载链接是终局**（2026-05-21 实测穷举过 video/iframe/embed/object 标签 + pi.php content-type）

**入口位置**：
- `src/background/zentao/client.ts` —— 所有禅道 API 调用（login / ensureToken / ping / listProjects / discoverProduct / 用户列表）
- `src/background/zentao/submit.ts` —— submitBug 主入口（cookie session + 附件 upload + steps HTML 拼接）
- `src/background/index.ts` —— SUBMIT_BUG handler 按 `project.kind` 分支
- `src/devtools/tabs/Environment.vue` —— kind 切换 + 禅道 4 字段表单 + 测试连接 + 拉项目下拉
- `src/content/SubmitDialog.vue` —— 禅道项目下隐藏「服务器选择 / 预览请求体」+ 显 4 字段可改 + cookie 预检 + 录像 50M 预警 + 「禅道里看 →」
- `docs/ZENTAO_SETUP.md` —— 用户手册（8 节，给安装用户看的）

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

v0.4.5 已发完。**当前没有强迫性 todo**。v0.4.x 系列业务闭环完整，等用户继续真实 dogfood 反馈，再决定 hotfix 还是新 feature。

**Backlog（被动等待 / 非阻塞）**：

- **`host_permissions: <all_urls>` 改 optional_host_permissions**（Chrome 商店审核红牌，但当前 gitee 发版没上 Web Store 暂不阻塞）：需要 Settings UI 加权限请求按钮 + 配置保存时 `chrome.permissions.request`，单独 mini-feature v0.5.x 做
- **3 个 npm 依赖漏洞**（rollup / esbuild / vite）：都是 dev-time only 不影响用户运行；需要 vite 5→6 + @crxjs 2.0-beta→2.4 major bump，v0.5.x 单独升级波
- **等禅道补 v2 Module 章节后收口 listModules**（被动等待）：当前唯一保留的 v1 endpoint
- **knip / ts-prune 死代码扫**（手动定期跑）：v0.4.4 试过两个工具 false positive 严重，标 backlog，未来如果有更好工具再上 CI
- **popup / History 各写一份 `remoteStatus → 中文` 映射**（低价值延后）：当前两处文案一致 + 状态枚举稳定，不主动收口
- **可能的禅道实例兼容跟进**（dogfood 反馈再说）：① 其他禅道版本（开源版 12 / 老版本）兼容回归 ② 附件大小阈值校准 ③ multipart 重试 IndexedDB blob 过期清理 ④ 自签证书 SSL 场景

**审视过没看到优化机会的维度**（v0.4.5 大复盘已验证，下次审视可以跳过这些除非业务变化）：

- **postMessage 安全**：main-world → content 的三重 validator（source / origin / shape）+ `__moo` magic 已经周到，v0.1.11 webhook 化后无字段遗漏
- **type 漏洞**：`as any` 仅 8 处，全在不可避免的 chrome 实验 API（`chrome.offscreen` / `chrome.tabCapture`）边界，**MV3 typings 自身缺陷**不是项目问题
- **storage quota**：`history.ts` 的 "逐条 pop 最旧 + allDropped 信号" 教科书级；`retryQueue.ts` 1MB 单条 + 50 队列 + 5 次重试自动丢全部到位
- **UX loading/empty/error 三态**：4 Tab + popup + SubmitDialog 都有专门文案（含 Settings 「队列 0 条点重试」也有兜底）
- **长文件**：Annotator(880) / Environment(886) / Settings(691) / Overview(686) / popup(639) 都是责任清晰大块（绘画 / CRUD / 表单 / 时间线 / 状态卡），强拆只会割裂

## 干活之前先看几个文件

| 你要碰这个 | 先读这个 |
|---|---|
| 上报 / 重试 / 状态回查 | `src/background/index.ts` |
| 抓 fetch/XHR 的钩子 | `src/injected/main-world.ts` + `src/content/useRequests.ts` |
| 录屏状态机 | `src/offscreen/index.ts`（v0.1.9 重构过，每个状态迁移都有原因）|
| 截图标注 | `src/content/Annotator.vue` |
| DevTools 4 个 Tab | `src/devtools/tabs/{Overview,Environment,History,Settings}.vue` |
| 消息协议 | `src/types/messages.ts`（强类型 dispatch）|
| 字段语义、模板变量（B 路径） | `docs/SERVER_INTEGRATION.md` |
| **禅道集成** | `src/background/zentao/{client,submit}.ts` + `docs/ZENTAO_SETUP.md`（用户手册）|
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
