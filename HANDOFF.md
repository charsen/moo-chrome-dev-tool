# 交接

> 写给明天接班的同事。读完知道现在到哪、有什么坑、下一步该干嘛。

## 一句话现状

**v0.1.14 已发**（2026-05-21，gitee tag `v0.1.14` + Release id 687941 含 zip 172.6 KB + sha256 `b8d77d8914332678b90dd64b42be4d88a69e5d794b6af51b6aaeaeed733537a3`）。**无 BREAKING**——后端无需配套升级。这一版主线：① Settings「待重试列表」可见性（折叠明细 + `lastStatus/lastError` + `getQueueItems/removeQueueItem` + 单条 × + 5/5 次 ⚠ 提示）② content 世界 dialog 壳子抽象（`MooDialog` + `MooAlert` 收口 mask/focus-trap/ESC/mask-close 的重复结构，`SubmitDialog` 和 `Annotator.cancel-guard` 迁移）③ 抽 `src/utils/relativeTime.ts` 单一来源 ④ **悬浮球拖动两个底层 bug 修**：lost-pointerup race + iframe 跨界吞 pointer events（用户明确报「卡 + 跟随鼠标」）⑤ 工程基础设施：dialog-harness + FloatingBall 锁 11 + 6 个新 E2E（77→97），原本「必须手摸」的 v0.1.14 checklist 全自动化替代。

**发版决策小记**（2026-05-21）：v0.1.14 **主动跳过 dogfood 等待**——用户因悬浮球 bug 急用 hotfix，明示「全包了」推动直接发。3 条跳 checklist 标准只满足前 2（① 非 BREAKING ② 170 单测 + 97 E2E + type-check + build 全绿，dialog-harness 完成原手摸 #2+#3 自动化），第 3 条 dogfood ≥ 几天**主动跳过**。**iframe 跨界 fix 在禅道页人工验证过过**（用户报「ok」体感通过）。如真有其他场景体感回归，hotfix 走 v0.1.15。

**v0.1.13 已发**（保留历史）。**无 BREAKING**——后端无需配套升级。这一版主线：① 体验加速（content 主 chunk -32% 懒加载）② 响应式扫修 25 处（用户报的 4K 大分辨率「界面没展示完整」+ 之前漏的 flex truncate / box-sizing / wrap 系列）③ 护栏加厚（offscreen 状态机 + retry queue race 修 + 8+9 单测）④ 收口债务（useToast / retryQueue facade / humanize / focus trap / shadow token 反扫 49 处）⑤ 工程基础设施（release.mjs 自动化 + panel-harness 解锁 DevTools 4 Tab 自动化 + 4 个项目 subagent + HANDOFF 归档机制）。

往前看：v0.1.14 把 dialog 抽象 + 队列可见性 + 悬浮球两条 race fix 一波打完。E2E 77 → **97**（+20 case，含 dialog-harness 11 + FloatingBall 6 + panel-settings G5-G7 3），单测 161 → 170（+9 case）。当前没有强迫性 todo，等用户反馈 v0.1.14 体感再说。

## 这两周做了什么

> 历史版本（v0.1.7 → v0.1.12）的"这两周做了什么"已归档至 [docs/handoff-archive/v0.1.x.md](docs/handoff-archive/v0.1.x.md)。当前发版（v0.1.13 / v0.1.14）的明细全在 [CHANGELOG.md](CHANGELOG.md) 顶部，本文档不重复列。

**MV3 限制·永远只能人眼核**：toolbar badge 视觉、`Alt+Shift+M` 真触发、DevTools 面板内嵌渲染、global shortcut、native toolbar、chrome:// 页——这些都 Playwright 也做不了，发版前自己手点 1-2 分钟过一下。**v0.1.13 / v0.1.14 都没走 dogfood**（用户明示跳过），v0.1.14 的悬浮球 iframe 跨界 fix 在禅道页面人工验证过过（用户「ok」），其他场景如有体感回归 hotfix 走 v0.1.15。

## Playwright E2E（v0.1.14 + dialog-harness + FloatingBall 后 97 case）

v0.1.12 立基础设施（13 case），v0.1.13 铺开到 77 case，v0.1.14 加 panel-settings G5/G6/G7（队列 chevron 展开 + 单条删 + 空队列禁用）+ **dialog-harness 11 case 锁 SubmitDialog/Annotator cancel-guard** + **FloatingBall 6 case 锁拖动（iframe 跨界 + lost-pointerup race + 阈值后 setPointerCapture 契约 + 纯点击不 capture 契约）** 共 **97 case**。**真起 chromium、真加载 dist 当 extension、真跑 SW**。位置：

- `playwright.config.ts` + `tests-e2e/fixtures.ts`（launchPersistentContext + 抓 extensionId + 抓 SW worker + 新增 `waitForBadgeText` 轮询助手 + `openExtensionPage` retry helper）
- `tests-e2e/popup-*.spec.ts`（popup-recent 3 / popup-dark 1 / popup-overflow 1 / popup-many 1 / popup-status 3 / popup-inject 5 / popup-corrupt 2 = **16 case**）
- `tests-e2e/badge*.spec.ts`（badge 4 / badge-edges 4 / badge-corrupt 3 = **11 case**）
- `tests-e2e/body-viewer*.spec.ts`（body-viewer 6 / body-viewer-widths 6 / body-viewer-dark 2 / body-viewer-invalid 4 / body-viewer-search 3 = **21 case**）
- `tests-e2e/panel-*.spec.ts`（panel-tabs 11 / panel-tabs-dark 4 / panel-overview-detail 4 / panel-environment-crud 6 / panel-settings-toggle 4 = **29 case** —— **panel-harness 解锁**）
- `tests-e2e/dialog-submit.spec.ts`（D1-D7 = **7 case**）+ `tests-e2e/dialog-annotator-cancel.spec.ts`（A1-A4 = **4 case**）+ `tests-e2e/dialog-floating-ball-drag.spec.ts`（F1-F6 = **6 case**）—— **dialog-harness 解锁 content 世界 dialog + 悬浮球拖动行为**
- `src/devtools/body-viewer-harness.{html,ts}` + `src/devtools/panel-harness.{html,ts}` + `src/content/dialog-harness.{html,ts}`（三个 harness，按 `?case=` / `?tab=&seed=` / `?case=&fail=&success=` 切场景；dialog-harness 还覆盖 `?case=floating-ball` 锁拖动行为）

跑法：`pnpm test:e2e`（build → 97 case 约 1.5min）

为啥要 harness：BodyViewer / Panel.vue 平时挂 DevTools panel iframe 里，chrome:// 外部驱不动；SubmitDialog / Annotator / FloatingBall 平时挂宿主页注入的 closed shadow 里，⌘⇧B 全局快捷键 + content script 注入链路 Playwright 跨边界也驱不动。做独立 harness 页面 mock chrome.devtools.* / chrome.tabs.sendMessage / chrome.runtime.sendMessage，Playwright 直接开就能 DOM 断言 + dispatch 合成 pointer events 锁拖动契约。

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

v0.1.14 已发完。**当前没有强迫性 todo**——稳一段时间也成。剩这些（继续累 v0.1.15+）：

**待办（用户报或维护性）**：

- ~~🐛 unpacked 扩展 content script 不注入~~（2026-05-19 排查的「第 6 个候选坑」）—— **2026-05-21 撤销诊断**：所谓的 `window.__mooInjected: false` 是**误诊**。这个 flag 根本没在代码里 set 过（`grep __mooInjected src/` 0 结果），所以永远 false。真实信号是 `document.getElementById('__moo_dev_tool_host__')` 在 yourcompany.chandao.net / app.example.com / gitee.com 全部 `true`——**content script 一直正常注入**。之前以「injected 为 false」为前提的所有判断作废，相关 ladder ①②③ 也不需要走。下次排查疑似不注入的问题，**只能查 host id 是否存在 + shadow root 是否有 mount 元素**，别再依赖那个 flag。
- ~~content 世界 toast / dialog 抽象~~ — **v0.1.14 land**（`src/content/components/MooDialog.vue` + `MooAlert.vue`，SubmitDialog + Annotator cancel-guard 已迁移）
- ~~Settings 加「待重试列表」可见性~~ — **v0.1.14 land**（折叠明细 + lastError 字段 + 单条 × 删 + 5/5 次 ⚠ 提示）
- ~~悬浮球拖动卡 / 跟随鼠标~~ — **v0.1.14 land**（iframe 跨界吞 pointer events + lost-pointerup race 双修：跨 4px 阈值后 setPointerCapture 强制路由所有事件回 row + 多渠道 endDrag 收口 pointerup/pointercancel/blur）
- **popup / History 各写一份 `remoteStatus → 中文` 映射**（低价值延后）：`popup/App.vue:191 statusOf()` 跟 `devtools/tabs/History.vue:131 remoteStatusLabel()` 是同一份枚举映射，但当前两处文案一致 + 状态枚举稳定，**不主动收口**——除非要做 i18n 或后端加新状态时一并处理

**审视过没看到优化机会的维度**（2026-05-20，下次审视可以跳过这些除非业务变化）：

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
