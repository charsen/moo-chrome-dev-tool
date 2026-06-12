# 交接

> 写给明天接班的同事。读完知道现在到哪、有什么坑、下一步该干嘛。

## 一句话现状

**v0.8.10 已发**（2026-06-12）。[下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.8.10/moo-chrome-dev-tool-0.8.10.zip)（sha256 待回填）。无 BREAKING — ✨ 提交弹窗 UX 三件（轻遮罩 0.18 / 标题栏可拖拽防出视口 / 缩小成右下角药丸）+ 多图截图（上限 5 张，单张重截/重标/删，提交端全链路）；🔴 表单草稿跨重挂真保留（`dialogDraft` 模块级单例，修旧 confirm「保留」实际全丢的撒谎）+ focusTrap 恢复焦点从未生效（nextTick + 双守卫）；📝 全量文档脱敏修订。808 单测 + 176 e2e 两遍零 flake。**dogfood 不足，用户明示放行；留观：多图+草稿真禅道链路、拖拽/缩小在重 CSS 站点。** 详情见 CHANGELOG v0.8.10 段。

**v0.8.9 已发**（2026-06-11）。[下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.8.9/moo-chrome-dev-tool-0.8.9.zip)（sha256 `65eeb6c6a2ba3df09ca6e4f5cd2ccd94c66837e1030c39774f453b1e170e43ac`）。无 BREAKING — 🔴 **dogfood 真修：普通账号禅道指派人/模块拉不到**（users/modules API 是管理员权限端点，新增 tier-3「建单页视图数据」兜底，v2→v1→tier-3 只加层不换轨）；✨ 历史 Tab 自动同步放宽到所有有单号记录（webhook/cloud 不用手动点）+ inflight 锁/60s 冷却/force 三保护；🟠 五轮 review 记账 8 项全清（multipart 大小写 / Settings 队列跨上下文锁 / cookie 复查空转 / urlMatches Chrome 语义 / useConfig 回声泄漏 / ElementPicker HOST_ID / recorder.start 裸抛 / BodyViewer 劈实体）+ 审计 2 项。+71 单测/+3 e2e 全红→绿，768 单测 + 155 e2e 零 flake。**手测点留 dogfood：普通账号指派人下拉 + 元素选取 hover。** 详情见 CHANGELOG v0.8.9 段。

**v0.8.8 已发**（2026-06-10）。[下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.8.8/moo-chrome-dev-tool-0.8.8.zip)（sha256 `46604ff803c5756e8ccbcbdacfd7a07c2c0d7d45f00921093c62176b67ba85e9`）。无 BREAKING — **三轮主动 review 累计 9 个真 bug 全修**：🔴 录屏数据丢失三连（双 START 销毁文档 / 30s 自动停 interval 重复发 STOP 丢视频 / tripwire 残留 timer 掐死重录）；🟠 重试成功不回填 history+badge（看着失败手动重提 = 重复单）+ flush 三态结果（cooldown/无权限跳过不再谎报「都还在失败」）；🟠 提交弹窗开着时保存配置致表单丢+tab 卡死（refreshProject 非 idle 推迟）+ History 双订阅泄漏；🟠 禅道 v2 建单 id 字符串判失败致重复单（宽容解析 + success 必按成功收）+ 用户清空脱敏 keys 被迁移打回。+29 红→绿 case，697 单测 + 152 e2e 全绿。**用户明示放行。** 详情见 CHANGELOG v0.8.8 段。

**v0.8.7 已发**（2026-06-09）。[下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.8.7/moo-chrome-dev-tool-0.8.7.zip)（sha256 `be4fd72dcad3a65bfb23cbc8c8117221e4eb6941b1890f2f7a07a1d1c03fe0dd`）。无 BREAKING — **两轮主动 review 抓出 6 个真 bug 全修**：🔴 历史重提丢禅道 5 字段（normalizeHistoryEntry 漏列，v0.7.6 P1-1 修不全 + 状态回查写回抹磁盘）；🔴 redactBody 非 JSON 体贪婪 key 漏脱敏（隐私）；🟠 retryQueue 无共享写锁致 flush 期间入队条被吞；🟠 header 改名撞键丢数据；🟠 backfill 重注入双 patch 致请求重复采集（MAIN world 加 window flag 守卫 + ISOLATED 句柄清旧，reload 不破 v0.7.6）；status 回查 GET→POST 注释。+9 红→绿 case，664 单测 + 151 e2e 全绿。**当天提交未 dogfood，用户明示放行。** 详情见 CHANGELOG v0.8.7 段。

> **v0.8.6 及更早「一句话段」已批量归档**：v0.5.0 → v0.8.6 见 [docs/handoff-archive/v0.5.x-v0.8.x.md](docs/handoff-archive/v0.5.x-v0.8.x.md)；更早 v0.1.x → v0.4.x 见下方「早期版本简介」。本文「一句话现状」只保留最近 4 个发版（v0.8.7 → v0.8.10）。

**早期版本简介**：v0.1.x → v0.4.3 见 [docs/handoff-archive/v0.1.x.md](docs/handoff-archive/v0.1.x.md)；v0.4.4 → v0.4.9 见 [docs/handoff-archive/v0.4.4-v0.4.9.md](docs/handoff-archive/v0.4.4-v0.4.9.md)。

**往前看**：当前路线 + 待办见下方「现在最值得做的下一件事」+「Backlog」两段（早期 v0.7.x 路线项多已落地或被取代，不再逐条留）。**CWS 上架物料就绪**（`docs/cws/`），等用户截图 + 后台填表。

## 这两周做了什么

> 当前发版的明细全在 [CHANGELOG.md](CHANGELOG.md) 顶部，本文档不重复列；更早的版本时间线 + 历次发版决策记录见 [docs/handoff-archive/](docs/handoff-archive/)。

**MV3 限制·永远只能人眼核**：toolbar badge 视觉、`Alt+Shift+M` 真触发、DevTools 面板内嵌渲染、global shortcut、native toolbar、chrome:// 页——这些 Playwright 也做不了，发版前自己手点 1-2 分钟过一下。

## Playwright E2E

> **最新 case 数看顶部「一句话现状」**（v0.8.10 时 176 case），本段只讲结构和原因，不再回填具体数字。

**真起 chromium、真加载 dist 当 extension、真跑 SW**。跑法：`pnpm test:e2e`（先 build，全量约 2min）；首次要先 `pnpm exec playwright install chromium`（本机已装）。

结构：

- `playwright.config.ts` + `tests-e2e/fixtures.ts`（launchPersistentContext + 抓 extensionId + 抓 SW worker + `waitForBadgeText` 轮询助手 + `openExtensionPage` retry helper）
- `tests-e2e/*.spec.ts` 按面分组：popup / badge / body-viewer / panel（4 Tab）/ dialog（SubmitDialog、Annotator、悬浮球拖动）/ 动态注册与注入幂等 / 升级链 / 录屏控制
- `src/devtools/body-viewer-harness.{html,ts}` + `src/devtools/panel-harness.{html,ts}` + `src/content/dialog-harness.{html,ts}`（三个 harness，按 `?case=` / `?tab=&seed=` / `?case=&fail=&success=` 切场景）

为啥要 harness：BodyViewer / Panel.vue 平时挂 DevTools panel iframe 里，chrome:// 外部驱不动；SubmitDialog / Annotator / FloatingBall 平时挂宿主页注入的 closed shadow 里，⌘⇧B 全局快捷键 + content script 注入链路 Playwright 跨边界也驱不动。做独立 harness 页面 mock chrome.devtools.* / chrome.tabs.sendMessage / chrome.runtime.sendMessage，Playwright 直接开就能 DOM 断言 + dispatch 合成 pointer events 锁拖动契约。

> 禅道集成**没有 E2E**——禅道 API 跨域 + cookie session + 真实 WAF 在 Playwright headless chromium 里没法可靠复现（mock 价值不大）。禅道侧回归保护走 `tests/` 里 client.ts / submit.ts 的纯单测（schema fuzz + 真实 fixture，覆盖主要分支）。

## 你最该知道的几个坑

按「碰对应代码前必读」排：#0 禅道集成；#1-#3 是立项早期就在的老坑（仍然成立）；#4-#5 是开发期最常踩的。

### 0. 禅道集成的硬依赖 + 4 条架构事实（v0.2.0 立、随版本演化，下次碰禅道代码必看）

**硬依赖**（用户视角）：**「环境」里配账号 / 密码 / 项目 ID**。v0.2.3 起 Moo 用这套凭证自动登录（`POST /api.php/v2/users/login` 同时拿 token + 往 cookie jar 写 session），**不再需要用户手动在浏览器登录禅道页面**。早期（v0.2.0-v0.2.2）依赖浏览器登录态 cookie、否则 `openedBy=system` 的问题已成历史。

**关键架构事实**（接下来改禅道代码前**必须**先理解）：
1. **直连，不中转**：`src/background/zentao/client.ts` + `submit.ts` 直接打禅道 REST API（**v2 优先 + v1 fallback 双轨**，见 CLAUDE.md 🟣 段；普通账号拉不到 users/modules 时还有 tier-3「建单页视图数据」兜底，v0.8.9 加），**不依赖中间适配层**。改 endpoint 直接看 client.ts，不要去找「Moo B 服务器」之类的中间件
2. **读写走 token，唯独附件上传走 cookie session**：login / listProjects / listUsers / 建单（`POST /api.php/v2/bugs`）都带 `Token` header（失效自动重登）；附件上传走老 zui editor 端点 `/file-ajaxUpload.html`，只认 cookie——cookie 由 login 同一调用写入 jar（`ensureCookieSession()` 走 trust 路径，失效靠上传失败 + reLogin 重写）。endpoint 全表见 `docs/ZENTAO_SETUP.md` 附录
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

录屏实际跑在 offscreen document（`src/offscreen/`）里，状态机修过一批 race。改这块前先把 `src/offscreen/index.ts` 看完——里头每个状态迁移都有原因，不要凭直觉简化。

另：`tabCapture` 是 **optional permission**，首次要在 popup 开「录屏功能」授权。装包测试时记得先撤掉已授的权限，再把首次授权流程过一遍。

### 2. 抓请求是同源 postMessage，假数据仍能塞进来

三重防御（origin 限定、收端 origin 校验、payload shape 校验）仍在。固有缺陷没变：同源恶意脚本可以精心构造合法 shape 的假请求。新增字段时**必须**同步更新 `isValidRequestPayload` / `isValidErrorPayload`。

补强：`useRequests.ts` 用 `DEFAULT_REDACT` 兜底，修了「用户配置脱敏规则之前就抓到的请求」那段空窗期。

### 3. chrome.storage.local 仍只有 10MB

老约束没变。新规矩：

- `noUncheckedIndexedAccess` 已开，新代码访问数组/对象索引必须处理 `undefined`。存量代码已全量改过，别又写回去。
- pre-commit 会跑 `type-check + test`，过不了就 commit 不上。**不要 `--no-verify` 绕**——绕一次 hook 就废一半。

### 隐藏的第 4 个：扩展错误页污染

早期 background 里 `console.error` 被 monkey-patch 包过一层（为了上报 SW 错误），结果**所有**插件错误都被吃掉/重写，扩展错误页全是噪声，后来撤掉了。如果你想再上报 SW 错误，**不要**重新 monkey-patch console；走显式 `reportError(err)` 函数。

### 隐藏的第 5 个：unpacked 扩展的 SW 不会随 dist 文件变更自动 reload

调试 background 代码很容易踩：`pnpm build` 后 chrome 里 popup / panel 那些**页面端**代码确实会刷新，但 **service worker 的代码不会**——SW 在 chrome 进程里跑着，dist 文件变了它不知道，继续跑老 bundle。

表现：你以为新代码生效了，结果 SW 注册的 `chrome.storage.onChanged` listener 是老的（甚至不存在），新功能不响应任何事件。实测踩过：MCP 验证发现 badge 不更新，怀疑了半天代码逻辑，最后 `chrome.runtime.reload()` 一下就好了。

**修法（任选）**：
- chrome://extensions → Moo → 点 🔄 重新加载按钮
- popup / panel DevTools console 跑 `chrome.runtime.reload()`
- 改 manifest.json（连版本号 / description 任何字段都行）会让 chrome 强制重载整个扩展

**不要**指望关闭再开 chrome 能解决——`chrome.runtime.onStartup` 触发也不会重读 SW 代码（SW 是缓存在 Chrome 的 extension 进程里的）。开发期间养成「改 SW 后立刻去 chrome://extensions 点 🔄」的肌肉记忆。

## 现在最值得做的下一件事

v0.8.10 已发完。**当前没有强迫性 todo**。本版弹窗 UX 三件 + 多图 + 草稿是这两天新做的、dogfood 不足（用户明示放行跳 checklist，理由见 CHANGELOG v0.8.10「发版决策小记」）。**留观的手测点**：① 多图 + 草稿在真禅道实例提交链路 ② 弹窗拖拽/缩小在重 CSS 站点表现 ③ 沿袭 v0.8.9 的普通账号禅道指派人下拉 + 元素选取 hover。等用户继续真实 dogfood 反馈，再决定 hotfix 还是新 feature。

> **版本检查链路复盘速记**（这块连撞两次，下次改先看）：v0.8.1 hotfix 修「fetch fail 谎报已是最新」（三态返值），v0.8.5 修「stale flag 谎报旧版当新版」（读取时 live 重比）。核心 lesson：**版本检查 flag 写入时刻缓存的 current 不可信，必须读取时刻用 live manifest 重比** —— 因为用户实际升到的版本未必等于当初被提示的版本。`src/utils/versionCheck.ts` 的 `readValidStoredVersionInfo()` 是唯一收口点，任何「读 VERSION_CHECK_FLAG 判断要不要弹 banner」都该走它，别再内联 `age < 7d` 裸判定。

> **动态注入链路复盘速记**（连撞三次，碰注入先看）：v0.7.2 修「WAR `use_dynamic_url` 让 content lazy chunk 加载失败、悬浮球出不来」；v0.7.6 修「dynamic register 不向已 navigated tab 注入 → backfill executeScript 回填 + 孤儿 host 重建」；v0.8.7 修「backfill 对**已注入** tab 重复 executeScript 致重复采集」。核心 lesson：**`chrome.scripting.executeScript` 不去重（去重只对 declarative `registerContentScripts` 在同一 navigation 内成立）** —— `syncContentScripts → backfillExistingTabs` 在 config 变化 / SW spin-up 都会对已注入 tab 再注入一次，所以注入端必须自己幂等：MAIN world（`main-world.ts`）用 `window.__mooMainPatched` flag 挡重复 patch（MAIN world 是页面世界、reload 不重置，老 patch 仍工作所以重注入跳过是安全的）；ISOLATED（`content/index.ts`）把 onMessage listener + Vue app 句柄存 window、重建前清旧。**改 `dynamicScripts.ts` / 两个注入入口前必看这条。**

**Backlog（被动等待 / 非阻塞）**：

- **3 个 npm 依赖漏洞**（rollup / esbuild / vite）：都是 dev-time only 不影响用户运行；需要 vite 5→6 + @crxjs 2.0-beta→2.4 major bump，单独升级波
- **等禅道补 v2 Module 章节后收口 listModules**（被动等待）：当前唯一保留的 v1 endpoint
- **knip / ts-prune 死代码扫**（手动定期跑）：v0.4.4 试过两个工具 false positive 严重，标 backlog，未来如果有更好工具再上 CI
- **popup / History 各写一份 `remoteStatus → 中文` 映射**（低价值延后）：当前两处文案一致 + 状态枚举稳定，不主动收口
- **可能的禅道实例兼容跟进**（dogfood 反馈再说）：① 其他禅道版本（开源版 12 / 老版本）兼容回归 ② 附件大小阈值校准 ③ multipart 重试 IndexedDB blob 过期清理 ④ 自签证书 SSL 场景

**审视过没看到优化机会的维度**：v0.4.5 大复盘验证过 postMessage 安全 / type 漏洞 / storage quota / UX 三态 / 长文件拆分 5 个维度无优化空间（除非业务变化，下次审视可跳过），明细已归档至 [docs/handoff-archive/v0.4.4-v0.4.9.md](docs/handoff-archive/v0.4.4-v0.4.9.md)。

## 干活之前先看几个文件

| 你要碰这个 | 先读这个 |
|---|---|
| 上报 / 重试 / 状态回查 | `src/background/index.ts` |
| 抓 fetch/XHR 的钩子 | `src/injected/main-world.ts` + `src/content/useRequests.ts` |
| 录屏状态机 | `src/offscreen/index.ts`（每个状态迁移都有原因，别凭直觉简化）|
| 截图标注 | `src/content/Annotator.vue` |
| DevTools 4 个 Tab | `src/devtools/tabs/{Overview,Environment,History,Settings}.vue` |
| 消息协议 | `src/types/messages.ts`（强类型 dispatch）|
| 字段语义、模板变量（B 路径） | `docs/SERVER_INTEGRATION.md` |
| **禅道集成** | `src/background/zentao/{client,submit}.ts` + `docs/ZENTAO_SETUP.md`（用户手册）|
| logo / 品牌 | `docs/LOGO_BRIEF.md`（鹰图腾来自团队身份，**不要**换）|
| CI / pre-commit | `.github/workflows/ci.yml` + `package.json` 的 `simple-git-hooks` |

## 工程约束（必须遵守）

- **不绕 hook**：`pnpm type-check && pnpm test` 是 pre-commit 跑的，过不了就修，不要 `--no-verify`。
- **不关 `noUncheckedIndexedAccess`**：写数组/对象索引时显式处理 `undefined`。
- **改 `src/types/messages.ts` 要看清下游**：dispatch 走强类型，新增 message 要把所有 handler 补齐才能过编译。
- **改 `injected/main-world.ts` 的 payload shape 必同步改 validator**：见上面坑 #2。

## 几条沟通备忘

- 团队名 **mooeen（沐恩）**，基督教背景，鹰图腾呼应「如鹰展翅上腾」。身份核心，不要改。
- 发版节奏：成批了再发；非 BREAKING + 全绿 + 用户明示放行可跳 dogfood ≥ 几天那条（v0.8.2/3/5/6/7 直到 v0.8.10 都是这么跳的，有红→绿单测/e2e 锁回归）。
- 文档风格：「不要堆术语，用人话」。所有 commit message / 文档都按这个标准写。
- Logo 不要再换。f44 黑鹰头 + 黄 reticle 这版定稿（v0.1.10）。
