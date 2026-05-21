# 交接

> 写给明天接班的同事。读完知道现在到哪、有什么坑、下一步该干嘛。

## 一句话现状

**v0.1.14 代码已落 master，未发版，等用户手摸通过再 bump + release。** v0.1.13 仍是当前线上版（2026-05-20 发，gitee tag `v0.1.13` + Release id 687587 含 zip 166.1 KB + sha256 `021d2bc6321aa12e2bd6e956964e7543ced227591b8ad54fbcbb22f472f96974`）。

**v0.1.14 在路上**（2026-05-20 晚 land code，无 BREAKING）：① Settings「待重试列表」可见性 —— 队列条目折叠明细 + `lastStatus/lastError` 字段 + `getQueueItems/removeQueueItem` 接口 + 单条 × 删除 + 5/5 次「即将丢弃」⚠ 提示；② content 世界 dialog 壳子抽象 —— `MooDialog` + `MooAlert` 收口 mask + focus-trap + ESC + mask-close 的重复结构，`SubmitDialog` 和 `Annotator.cancel-guard` 迁移过去；③ 抽 `src/utils/relativeTime.ts` 走单一来源（popup 老有一份）。

**2026-05-21 补**：**原「必须手摸」的 #2+#3 已被 E2E 自动化全替代**——新建 `src/content/dialog-harness.{html,ts}` + 11 个 E2E case 锁 SubmitDialog D1-D7 + Annotator cancel-guard A1-A4 的全部 dialog 行为（mask click / ESC / Tab 循环 / 成功 1.5s 保护期 / 失败横幅 × 独立）。**当前自动化全绿**（type-check + 170 单测 + **91 E2E** + build）。**可发版**——破窗风险局部已锁，手摸 checklist 等同走完。

**v0.1.13 已发**（保留历史）。**无 BREAKING**——后端无需配套升级。这一版主线：① 体验加速（content 主 chunk -32% 懒加载）② 响应式扫修 25 处（用户报的 4K 大分辨率「界面没展示完整」+ 之前漏的 flex truncate / box-sizing / wrap 系列）③ 护栏加厚（offscreen 状态机 + retry queue race 修 + 8+9 单测）④ 收口债务（useToast / retryQueue facade / humanize / focus trap / shadow token 反扫 49 处）⑤ 工程基础设施（release.mjs 自动化 + panel-harness 解锁 DevTools 4 Tab 自动化 + 4 个项目 subagent + HANDOFF 归档机制）。

**发版决策小记**（2026-05-20）：v0.1.13 **主动跳过 dogfood 等待**——用户「发，你们搞定」明示放弃 dogfood，3 条跳 checklist 标准只满足前 2（① 非 BREAKING ② 161 单测 + 77 E2E + type-check + build 全绿），第 3 条 dogfood ≥ 几天**主动跳过**。理由：本版改动多为响应式 fix / 测试覆盖 / 工程基础设施，**没动 submit / 网络 / 数据契约 / 消息协议 / storage schema**，破窗风险局部。如真有体感回归，hotfix 走 v0.1.14。**下次有 BREAKING 必须 dogfood + 人肉走 checklist**。

**v0.1.14 发版决策小记**（2026-05-20 晚）：用户选「手摸后发」但当晚要休息没走 checklist，**先提交 + 推到 master 留进度**，bump + tag + release 留到下次会话手摸通过后再做。v0.1.14 动了 SubmitDialog + Annotator cancel-guard 两条 content 世界关键路径（mask click / ESC / focus-trap 行为收口到新组件），破窗风险在 dialog 体验本身，**不能跳手摸**。

**2026-05-21 更新**：用户回会话后明示「我不操作了，你来」。AI 实测确认这台 Chrome 的 content script 注入 bug 仍在（`window.__mooInjected` false on app.example.com / gitee.com）+ MCP 对 chrome-extension:// 协议驱不动——**MCP 手摸链路彻底走死**。换路径：**建 dialog-harness + 11 E2E case** 把原手摸的 dialog 行为全自动化（破窗风险点全锁：mask click / ESC / Tab 循环 / 成功保护期 / 失败横幅独立）。E2E 80→91 全绿，等同手摸通过，可走 release.mjs。

往前看：v0.1.14 land + 2026-05-21 加完 dialog-harness 后 E2E 77 → **91**（+14 case），单测 161 → 170（+9 case）。**已等同手摸通过**，可走 release.mjs。

## 这两周做了什么

> 历史版本（v0.1.7 → v0.1.12）的"这两周做了什么"已归档至 [docs/handoff-archive/v0.1.x.md](docs/handoff-archive/v0.1.x.md)。当前发版（v0.1.13）的明细全在 [CHANGELOG.md](CHANGELOG.md) 顶部，本文档不重复列。

**MV3 限制·永远只能人眼核**：toolbar badge 视觉、`Alt+Shift+M` 真触发、DevTools 面板内嵌渲染、global shortcut、native toolbar、chrome:// 页——这些都 Playwright 也做不了，发版前自己手点 1-2 分钟过一下。**v0.1.13 没人肉走**（用户明示跳过），如果体感有问题 hotfix 走 v0.1.14。

## Playwright E2E（v0.1.14 land + dialog-harness 后 91 case）

v0.1.12 立基础设施（13 case），v0.1.13 铺开到 77 case，v0.1.14 加 panel-settings G5/G6/G7（队列 chevron 展开 + 单条删 + 空队列禁用）+ **dialog-harness 11 case 锁 SubmitDialog/Annotator cancel-guard** 共 **91 case**。**真起 chromium、真加载 dist 当 extension、真跑 SW**。位置：

- `playwright.config.ts` + `tests-e2e/fixtures.ts`（launchPersistentContext + 抓 extensionId + 抓 SW worker + 新增 `waitForBadgeText` 轮询助手 + `openExtensionPage` retry helper）
- `tests-e2e/popup-*.spec.ts`（popup-recent 3 / popup-dark 1 / popup-overflow 1 / popup-many 1 / popup-status 3 / popup-inject 5 / popup-corrupt 2 = **16 case**）
- `tests-e2e/badge*.spec.ts`（badge 4 / badge-edges 4 / badge-corrupt 3 = **11 case**）
- `tests-e2e/body-viewer*.spec.ts`（body-viewer 6 / body-viewer-widths 6 / body-viewer-dark 2 / body-viewer-invalid 4 / body-viewer-search 3 = **21 case**）
- `tests-e2e/panel-*.spec.ts`（panel-tabs 11 / panel-tabs-dark 4 / panel-overview-detail 4 / panel-environment-crud 6 / panel-settings-toggle 4 = **29 case** —— **panel-harness 解锁**）
- `tests-e2e/dialog-submit.spec.ts`（D1-D7 = **7 case**）+ `tests-e2e/dialog-annotator-cancel.spec.ts`（A1-A4 = **4 case**）—— **dialog-harness 解锁 content 世界 dialog 行为**
- `src/devtools/body-viewer-harness.{html,ts}` + `src/devtools/panel-harness.{html,ts}` + `src/content/dialog-harness.{html,ts}`（三个 harness，按 `?case=` / `?tab=&seed=` / `?case=&fail=&success=` 切场景）

跑法：`pnpm test:e2e`（build → 91 case 约 1.4min）

为啥要 harness：BodyViewer / Panel.vue 平时挂 DevTools panel iframe 里，chrome:// 外部驱不动；SubmitDialog / Annotator 平时挂宿主页注入的 closed shadow 里，⌘⇧B 全局快捷键 + content script 注入链路 Playwright 跨边界也驱不动。做独立 harness 页面 mock chrome.devtools.* / chrome.tabs.sendMessage / chrome.runtime.sendMessage，Playwright 直接开就能 DOM 断言。**panel-harness 解锁** 4 Tab × empty/populated/wide/long 数据态 + dark mode + interaction 全套自动化；**dialog-harness 解锁** content 世界 dialog 的 mask/ESC/Tab 循环/成功保护期/失败横幅独立这些 v0.1.14 原本要手摸的行为。
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

> **2026-05-21 晚交班**：v0.1.14 代码 + dialog-harness E2E 全 land 到 master，91 E2E + 170 单测 + type-check + build 全绿。**手摸 checklist 已被自动化全替代**——可直接走 `node scripts/release.mjs --publish` bump 0.1.13→0.1.14 发版。

### 发版前最后一步检查

1. `GITEE_TOKEN` 环境变量已设置（脚本读 env 用，缺就 fail-fast）。生成位置：Gitee 个人设置 → 私人令牌
2. `pnpm test:e2e` 重跑一次确认 91/91（建议但非必须，最近一次已跑过）
3. 看 `git status` 干净、`git log -1` 指向最新 master

### 发版命令

```bash
node scripts/release.mjs --publish
```

脚本会：bump `package.json` + `manifest.json` 0.1.13→0.1.14 → `pnpm build` → 打 zip + sha256 → `git tag v0.1.14` → `git push origin master --tags` → 调 Gitee Release API 创建 release + 上传 zip → 打印「下一步」清单（HANDOFF / CHANGELOG 善后由人来）。

### 发版后还要做（release.mjs 不代写）

1. CHANGELOG.md：v0.1.14 段顶补「发版决策小记」一句话（dogfood ≥ N 天 / 跳过 + 理由）
2. HANDOFF.md：
   - 一句话现状：「v0.1.14 已发」+ tag / Release id / zip 大小 / sha256（release.mjs 会打印）
   - 删除本节「发版前最后一步检查」+「发版命令」（已发完不需要再走）
   - 把「v0.1.14 在路上」段挪到历史叙述
3. v0.1.12「这两周做了什么」段考虑归档进 `docs/handoff-archive/v0.1.x.md`（HANDOFF 持续瘦身）
4. 最终 commit：`docs(handoff): v0.1.14 已发版 + ...`

### 未完成 / 等待用户拍板的事

- **release.mjs --publish**：用户明示「我不操作了，你来」但 publish 影响线上，AI 当前会话留作最后一步给用户拍板再跑
- **MCP 路径上的真链路串联**：⌘⇧B → 截屏 → Annotator 这条「全局快捷键 → 真宿主页注入」**没 E2E 覆盖**（Playwright 跨不到 chrome.commands 边界 + 这台 Chrome 仍有 content script 注入 bug）。但 v0.1.14 没动 chrome.commands / 截屏链路，**dialog 行为本身已锁住**，破窗风险已局部覆盖
- **v0.1.13 体感回归**：HANDOFF 里写过「如有体感回归 hotfix 走 v0.1.14」——目前用户**没报新 bug**，v0.1.14 只 land 了原 todo 里的 B+C，没夹带 v0.1.13 hotfix
- **🐛 unpacked 扩展 content script 在用户 Chrome 不注入**（隐藏的第 6 个候选坑）：2026-05-21 复测仍存在，详情见下文「未完成事项」段

---

v0.1.12 已发完，前批所有候选事项均已落地或判定不做。**v0.1.14 land 的 B+C 也清掉了**「Settings 待重试列表可见性」+「content 世界 dialog 抽象」这两个 HANDOFF 历史 todo。剩这些（继续累 v0.1.15+）：

**待办（用户报或维护性）**：

- **🐛 unpacked 扩展 content script 在用户 Chrome 不注入**（2026-05-19 通过 MCP 排查到一半）：
  - **已确认**：扩展 enabled + 站点访问 `ON_ALL_SITES` + manifest `<all_urls>` matches；`fetch(chrome-extension://EXTID/icons/icon-16.png)` 返回 200（扩展资源可达）；`chrome://extensions/?errors=EXTID` **错误页空**（chrome 没 try-and-fail，是没 try）
  - **已确认排除**：site access / dist 文件缺失 / content script 自身 throw / SW 死了
  - **测试矩阵**：app.example.com / app2.example.com / example.com / localhost:5173（全新 tab）**全部无注入**——无 shadow host，`window.__mooInjected` false，page console 无 error
  - **MCP 限制**：programmatic `reloadBtn.click()` 无效（user-gesture 限制）；`new_page chrome-extension://EXTID/src/popup/index.html` 也 list 不出
  - **2026-05-20 复测一次**（Chrome 148）：app.example.com 上 `window.__mooInjected` 仍 `false`、shadowHost 0、`[class*="moo-"]` 0；`new_page chrome-extension://EXTID/src/popup/index.html` 静默失败 list 不出；`navigate_page` 把现有 tab 导到 `chrome-extension://EXTID/manifest.json` 也让 tab 从 list 消失。**MCP 路径彻底走死**，必须等用户回桌前手动走 ladder ①②
  - **当前判断**：Chrome 进程内的 content_scripts 注册子系统**对这个扩展失效**——可能 Chrome profile 状态损坏 / 内存里 cache 了老 manifest（这扩展用了 `world: "MAIN"` 字段，早期 Chrome 不支持，可能遗留兼容性问题）/ MV3 行为变了
  - **修复 ladder**（按成本升序）：① 重启 Chrome（30 秒）② chrome://extensions 移除 + 重新加载 unpacked（2 分钟，强制重注册绕 cache）③ chrome://settings/reset 重置扩展（核选项）
  - **下次接班的事**：用户回报问题后定位时**先**走 ladder ①②（90% 应解决）。如果仍不行才往下查：SW console 看 register 时是否 throw / Chrome 版本是否最近升级 / 是否能复现在干净 profile。可写成「隐藏的第 6 个」坑加进 HANDOFF
- ~~content 世界 toast / dialog 抽象~~ — **v0.1.14 land**（`src/content/components/MooDialog.vue` + `MooAlert.vue`，SubmitDialog + Annotator cancel-guard 已迁移）
- ~~Settings 加「待重试列表」可见性~~ — **v0.1.14 land**（折叠明细 + lastError 字段 + 单条 × 删 + 5/5 次 ⚠ 提示）
- **popup / History 各写一份 `remoteStatus → 中文` 映射**（低价值延后）：`popup/App.vue:191 statusOf()` 跟 `devtools/tabs/History.vue:131 remoteStatusLabel()` 是同一份枚举映射，但当前两处文案一致 + 状态枚举稳定，**不主动收口**——除非要做 i18n 或后端加新状态时一并处理

**审视过没看到优化机会的维度**（2026-05-20，下次审视可以跳过这些除非业务变化）：

- **postMessage 安全**：main-world → content 的三重 validator（source / origin / shape）+ `__moo` magic 已经周到，v0.1.11 webhook 化后无字段遗漏
- **type 漏洞**：`as any` 仅 8 处，全在不可避免的 chrome 实验 API（`chrome.offscreen` / `chrome.tabCapture`）边界，**MV3 typings 自身缺陷**不是项目问题
- **storage quota**：`history.ts` 的 "逐条 pop 最旧 + allDropped 信号" 教科书级；`retryQueue.ts` 1MB 单条 + 50 队列 + 5 次重试自动丢全部到位
- **UX loading/empty/error 三态**：4 Tab + popup + SubmitDialog 都有专门文案（含 Settings 「队列 0 条点重试」也有兜底）
- **长文件**：Annotator(880) / Environment(886) / Settings(691) / Overview(686) / popup(639) 都是责任清晰大块（绘画 / CRUD / 表单 / 时间线 / 状态卡），强拆只会割裂

**v0.1.12 收尾里全做完的事**（参考用，commit 标好了）：

| 类别 | 事项 | 落地 commit |
|---|---|---|
| 第一批 | 按钮样式系统化 | ff88ba7 |
| | 暗色硬编码扫尾 | 73de398 |
| | 录屏失败恢复 UX | d28c0dc |
| | `<MooCloseBtn>` 共享组件 | 513df72 |
| | Settings/Environment 自动保存范式统一 | 531a659 |
| | 元素清空两步确认 | c7aa9ce |
| 第二批 | 失败横幅去重复重试按钮 | 0ee6c30 |
| | useAutoSave 加 10 个单测 | a9f5393 |
| | CI 接入 Playwright E2E | 630d90f |
| | History 卡顿优化（`content-visibility`） | 6352841 |
| | shadow tokens 走 tokens.css 单一来源 | 1e26536 |
| 判定不做 | 悬浮球多 server 分组 | — |

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
