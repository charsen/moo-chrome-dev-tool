# Changelog

> 时间倒序。**BREAKING** 表示装新版后老服务器（或反过来）会跑不动，需要同步升级两侧。

## v0.5.1

2026-05-24 发版。无 BREAKING。**第 8 波 review** —— 换 3 个新视角 agent：**release-captain（首次）+ Plan（首次）+ vue-craft 三审**。挖出之前 7 波都没碰的工程层 + 战略层维度。修 3 严重 + 11 中等 + 发 docs/PLAN_v1.0.md。

**🔴 3 严重（release.mjs 工程漏洞）**：
- **Step 4 push 失败无 rollback** — 之前本地 tag + zip 已建，重跑撞「tag 已存在跳过」 → Gitee release 关联到远端不存在的 tag。补 `git tag -d` rollback + 清 release/
- **attach_files 部分失败不阻塞 Step 6** — 之前 545 行 `return false`，同事按提示更新 HANDOFF 但 zip 没传完。改 `process.exit(1)` + 给手动补救链接
- **`pnpm release --publish` 自动跑 e2e** — 之前「发版前必跑 e2e」是人脑承诺无机器化。加 `--skip-e2e` 紧急 hotfix 可跳

**🟡 6 UI 同款漏扫（vue-craft 三审）**：
- `PayloadEditorModal` 漏 `useFocusTrap`（v0.4.9 给其他 3 个 modal 都加了漏这个）
- `popup .rec-err` 加 `role="alert"` / `aria-live="assertive"`（v0.4.9 4 处 toast 补了漏 popup）
- `popup .rh-fail` vs `.rh-open` token 区分 — open 改 `--moo-c-warn-fg/-soft`（之前用 danger 跟 fail 完全同色，用户分不清「失败」vs「待处理」）
- `History.vue KeepAlive` 下 `onHistoryChanged` 订阅 `onActivated/onDeactivated` 暂停（之前别窗口提交触发不可见 list 重 diff 30 条缩略图行）
- `Overview.vue visibilitychange` listener `onActivated/onDeactivated` 暂停（v0.4.9 timer 暂停了但 listener 漏）
- `Panel.vue setTimeout(focus, 0)` → `nextTick(() => focus)`（Vue3 microtask 时序更准）

**🟡 5 release-captain 工程改进**：
- 工作区脏树报错时加文案「如果你刚做完 PII 脱敏出现脏树，先 commit 再重跑」
- PII 黑名单扫描 `grep -rEn` → `git grep -nE`（respect .gitignore，不扫 release/ / dist/ / .test-output/ 等 ignored 路径假阳）
- `.claude/commands/full-team-review.md` 沉淀 8 波 review 元教训（专家清单 / 节奏建议 / 「换视角找新维度」）
- `docs/RELEASE_TEST_CHECKLIST.md` 明文 dogfood 节奏（prerelease 流程废后改成什么）
- `pnpm release --publish` 自动跑 e2e（详见严重 3）

**📋 写 `docs/PLAN_v1.0.md`** — Plan agent 给出的 v0.5.0 → v1.0 路线：
- 5 关键决策（CWS 上架 / `<all_urls>` 改 optional / IssueAdapter 抽象 / 团队范围 / release 节奏）
- P0-P4 架构债务排序（onMessage MessageRouter 最高 ROI）
- 测试 / 运维 / i18n 路线
- v0.5.x → v1.0 6-9 个月规划

**🟡 8 波 review 元教训沉淀**：换 agent 视角 = 找新维度，比反复跑 general-purpose ROI 高。可用专家清单：mv3-pro / vue-craft / lab-tester / code-simplifier / release-captain / Plan。建议改「每 feature PR 1 波专项 + 每月 1 次全量轮换」。

**测试**：399 单测全绿 + 7 skipped + 90 e2e + vue-tsc 0 报错。

## v0.5.0

2026-05-24 发版。无 BREAKING。**第 7 波 review** —— 换 3 个新视角 agent（**lab-tester + code-simplifier + mv3-pro 二次**）找出之前 6 波完全没碰的维度：**测试 debt + 代码重复 + MV3 深陷阱**。修 11 + 5 backlog。

**🔴 5 MV3 深陷阱（前 6 波都没找出）**：
- `offscreen` 35s tripwire 改 **`chrome.alarms` 双保险**（SW 端 alarm + offscreen 端 setTimeout）— OS 级 cron 不受节流影响，inactive tab + 系统睡眠时也保险
- `offscreen.handleStart` 加 keep-alive video 元素撑活 — getUserMedia 2-3s 期间防 chrome 130+ 回收 offscreen
- `retryQueue` cooldown **30s → 90s** — 禅道 multipart 上传可能 60s+，旧值不够覆盖
- `redactUrl` hash fragment **+7 单测**（v0.4.9 新加但裸奔，OAuth implicit flow `#access_token=` 等 3 种 hash 形式）
- `withWriteMutex` **+3 并发单测**（v0.4.7→v0.4.9 跨 3 版本核心 fix，之前 0 测试锁住）

**🟡 4 测试 debt 补**：
- `isPermanentFailure` **+20 用例**全 keyword 回归（14 永久错 + 6 临时错；之前只测「登录失败」1 个）
- `mergeRedactDefaults` **+3 用例**（v0.4.9 老用户 bodyKeys migration）
- `history.ts withWriteMutex` **+3 并发用例**（add + remove / update + remove / 5 并发 add）
- redact fragment **+7 用例**（同上）

**🟡 5 代码简化**：
- 删 3 处真死代码：`utils/messaging.ts onMessage` + `types/messages.ts MessageResponseMap` + `MessageResponse`
- `useToast` 加 `durationByKind` 选项（4 处 wrapper 可统一）
- 其他 3 项 refactor（withZentaoSession / runZentaoOp / countProjectsMatching）工作量大收益边际，标 backlog v0.5.x 单独做

**📋 5 chrome.* API 未来坑文档化**（memory `feedback_chrome_api_future_traps`）：
- chrome 130+ `getContexts` 错参不 throw 返空
- `setBadgeBackgroundColor` per-session 跨 SW 失色
- `alarms periodInMinutes` low-power throttle 到 15min+
- `tabCapture.getMediaStreamId` chrome 131+ 加 `consumerTabId`
- content_scripts MAIN world chrome 134+ CSP 行为变更

**第 7 波元教训**：**换 agent 视角 = 找出新维度**。lab-tester / code-simplifier 首次用，挖出之前 6 波都没碰的维度（测试覆盖 + 代码重复 + chrome 未来 API）。比起重复跑同款 general-purpose review，**换专家断面更高 ROI**。

**测试**：**399 单测全绿**（366 → 399 = +33）+ 7 skipped + 90 e2e + vue-tsc 0 报错。

## v0.4.9

2026-05-24 发版。无 BREAKING。**第 6 波 review** —— 跑「业务复盘 v3」3 agent 聚焦**回归 + a11y/i18n + 性能**找出 13 个问题，**5 个是 v0.4.8 修复未修干净的隐藏漏**。全修。

**🔴 严重 5（回归修）**：
- **`offscreen` 35s tripwire 不通知 content rec-bar** — v0.4.8 加 tripwire 但既不 resolve stopResolver 也不发 OFFSCREEN_AUTO_STOPPED → inactive tab 用户看 rec-bar 还亮但已停。补 `chrome.runtime.sendMessage` + `mooOffscreenAutoStopped` storage flag
- **`addHistoryEntry` 不在 withWriteMutex 内** — v0.4.8 修了 remove/clear/update **漏了 add**，tab A 提交时 tab B 删 entry → A 写回让 X 复活。**v0.4.7 修的 4 个月 bug 路径仍开**。补 mutex
- **`ConfirmModal.vue` 没 focus trap/还原** — onMounted 钩子只剩注释，confirmBtn ref 声明却没 `.focus()`。改用 `useFocusTrap`
- **`redactUrl` 不脱敏 URL fragment** — OAuth implicit flow `#access_token=...&id_token=...` 整条原文之前进 history/webhook/禅道（v0.4.8 只动 searchParams）。加 `redactFragmentString` 处理 `#k=v&` 和 `#!/route?k=v` 两种形式
- **老用户 redact.bodyKeys/headerKeys 不会自动补 v0.4.8 新加 7 keys** — normalize 看老 storage 原样保留，v0.1.x → v0.4.9 直跳用户实际仍按 2 key 脱敏。`applyMigrations` 加 `mergeRedactDefaults` step：检测 v0.1.x 默认 superset 时合并新 DEFAULT

**🟡 中等 5**：
- `manifest.json` 加 `minimum_chrome_version: "109"`（Edge/Brave 旧版用户装上不再静默崩）
- `Overview.vue` filter 加 150ms debounce（跟 History.vue 拉齐）
- `Overview.vue` KeepAlive 下 1.5s timer 切 tab 暂停（onActivated/onDeactivated）
- 4 处 toast 加 `role="status"`/`role="alert"` + `aria-live="polite"`（屏幕阅读器能听到「提交成功」「重试中」）
- `Panel.vue` 完整 ARIA tabs pattern — roving tabindex + ← / → / Home / End 键盘导航 + `role="tabpanel"` + `aria-controls`/`aria-labelledby`

**🟢 小问题 3**：
- Overview/History NaN timestamp 防（`new Date('bad').getTime()` 返 NaN → fallback 0 让损坏条目沉底）
- `tokens.css` 加 `@media (prefers-reduced-motion: reduce)` 全局降级动画/过渡
- `scripts/release.mjs` 加 SSH 连通性预检（v0.4.8 切 SSH 后才有意义；之前 push 失败已经 build+zip 完污染 release/）

**第 6 波元数据**：找出 13 vs v0.4.8 的 24 — 边际效用真在递减，但「上波修复不完整」类发现（5 个回归）仍是 review 的核心价值。

**测试**：366 单测 + 7 skipped + 90 e2e + vue-tsc 0。

## v0.4.8

2026-05-24 发版。无 BREAKING。**第 5 波 review** —— v0.4.7 后再跑「业务复盘 v2」3 agent 并行**回归测试 + 找同款 + 长尾维度 + 数据隐私链路**，找出 **24+ 个问题**，其中 **4 个隐私洞 + 1 个 4 个月 bug 复活路径**。

**🔴 严重 12 / 12 主修 + 3 标 backlog**：

**回归 + 同款（v0.4.7 漏扫）**：
- **`History.vue` isZentaoEntry 复活路径** — 用户删过禅道项目后 `projects.find()` 返 undefined 导致 isZentaoEntry false → fallback webhook → v0.4.7 修的 4 个月 bug 复活。改用 `e.serverId === 'zentao'` marker
- **`stripSensitive` 漏 server.headers** — webhook bearer token 塞 Authorization header 不被剥，导出 JSON 仍泄。加 `SENSITIVE_HEADER_PATTERN` 剥 7 类 header
- **`offscreen` 50MB cap 仍卡 IPC** — base64 dataUrl 1.37× 膨胀，50MB blob ≈ 68MB dataUrl 仍超 64MB。降到 46MB

**4 个隐私洞**：
- 🚨 **`capture.requests` / `capture.consoleErrors` 开关是死配置** — Settings UI 显示开关 + storage 保存 + normalize 都对，**但代码全文无读点**！用户关了开关以为没抓实际全程在抓 + 提交时全部附上。`useRequests` / `useErrors` 加 `captureEnabled` gate + setConfig 切 off 清 buffer
- 🚨 **`location.href` 提交时不脱敏** — SPA 常把 `?access_token=` 放 URL 整条原文落 History/webhook/禅道。调 `redactUrl(location.href, redact.bodyKeys)`
- **main-world 在所有 URL 注入未匹配 tab 也抓** — `ContentApp.refreshProject` 加 `matches.length===0` 显式 disable capture + clear buffer
- **重试队列禅道条目存 1080p PNG** — `enqueueZentaoRetry` 入队前 `thumbnailize`（跟 webhook 路径拉齐）

**数据完整性**：
- `storage/history.ts` 加 `withWriteMutex` 防多窗口并发 last-write-wins 让已删 entry 复活
- `offscreen` 录屏加独立 35s tripwire 兜底 content 端 30s timer（inactive tab 节流可绕到 1-2 分钟）

**其他**：
- `retryQueue.isPermanentFailure` 加 3 类禅道错（`返非 JSON` / `未返响应体` / `缺 user`）
- `popup quickEnableHostPattern` 加 chrome:// / file:// / about: protocol 黑名单防生成非法 wildcard
- `popup quickEnable` 按钮 v-if 守 `quickEnableHostPattern` 非空
- `SubmitDialog canSubmit` 加二次确认重新截图（标题/描述填了时）
- `background windows.onRemoved` 关窗紧急 STOP 录屏 best-effort

**🟡 中等 9 / 12 主修**：
- `Panel.vue` 用 `<KeepAlive>` 包 4 Tab（切换不丢 filter / openId / scroll 状态）
- `popup onMounted` 5 步串行 IO → `Promise.all` 并行
- `submitMessage` 用 `navigator.onLine` 区分「网络断」vs「服务器挂」文案
- `SubmitDialog .req-item` 加 `content-visibility: auto`（50+ 请求滚动卡）
- `background submit-fail` console.warn bodyPreview 缩短到 200 + 显式 ⚠ 警告
- `DEFAULT_REDACT` 加宽 7 keys（`proxy-authorization` / `x-api-key` / `refresh_token` / `id_token` / `client_secret` 等常见敏感字段）
- `storage/config.ts detectCustomTemplateMissingVideo` 加 `warnedMissingVideo` Set 防 SW spin-up 重复 warn

**📋 backlog 8 项**（v0.5.x 单独）：
- 跨 origin iframe 密码框遮罩（技术无解，需文档警告）
- RECORD_GLOBAL_STARTED 广播（双 tab 协作）
- saveConfig merge / Environment 多窗口编辑覆盖（需 mutex + UI 协议）
- 跨窗口录屏文案 / readPageStorage 敏感 key 警告 / useRequests listener 等

**测试**：366 单测 + 7 skipped + 90 e2e + vue-tsc 0 报错。

## v0.4.7

2026-05-24 发版。无 BREAKING。**业务专项 review 一波** —— v0.4.6 后跑「拉团队，所有业务复盘」3 agent 并行审，模拟真用户场景找出 28 个业务问题，**修了 19 个，9 个 mini-feature 标 backlog**。

**🔴 严重业务漏洞 8 / 8 全修**：

- **`History.vue:264`：禅道历史「重新提交」错发到 webhook server**（同事真踩 bug）— zentao entry serverId='zentao' 但下拉只渲染 webhook servers → reload 时 fallback 到首个 webhook → 重提把禅道 bug 错发到无关 webhook。改：zentao entry 隐藏「换服务器」下拉 + resubmit 强制走原 zentao project
- **`popup/App.vue:38-61`：未匹配态完全无截图入口** — 新部署域名 / chrome://newtab 时悬浮球/快捷键/popup 三路全断。改：popup 加「+ 在此页面也启用『XXX 项目』」一键按钮，把当前 host wildcard 加进首个 enabled 项目
- **`retryQueue.ts:277` drop 正则漏永久错** — 「未关联 product / 项目不存在 / WAF 拦截 / 认证持续失败 / 响应都不识别 / bug 不存在」全漏 → 重试 5x 浪费。抽 `isPermanentFailure` helper 覆盖全部分类
- **`Environment.vue` 改密码不清 token 缓存** — envKey=baseUrl::account 不变（只改 password）→ 老 token 复用，用错误身份提交。加 MSG.ZENTAO_CLEAR_CACHE message + watch zentao.{baseUrl/account/password/projectId} 变化触发清
- **`SubmitDialog.vue` canSubmit cookie 'unknown' 不放行** — 之前 race 期间放行让用户等 2-5s 才回错。改：unknown 也禁用提交 + 显式「⏳ 正在检查禅道登录状态…」状态行
- **`types/config.ts:352` payloadTemplate >64KB 静默 fallback** — 老用户大模板被悄悄替换 → 422 但无提示。加 console.warn
- **`storage/config.ts` migrateServerTemplate 漏自定义模板** — 自定义模板用户升级后永远拿不到 {{video}} 字段 → 录屏发不出。加 detectCustomTemplateMissingVideo + console.warn
- **`offscreen/index.ts:146` 录 50MB+ 视频卡 IPC** — chrome IPC ~64MB 上限被 dataUrl 撑爆崩 offscreen。加 hard cap，超 50MB 显式返「录像过大」错误

**🟡 中等 11 / 14 修，3 标 backlog**：

- 模块/指派下拉拉列表前显式 loading 占位
- 错误 N>0 时默认 open（之前默认收起用户漏看）
- 失败 footer 加「✓ 已加入重试队列」/「⚠ 不会自动重试」信号
- cookie 预检 setInterval 每 2 分钟刷一次（防长时间挂着 dialog 时 cookie 真过期）
- Environment「📋 从禅道拉列表」改名「📋 拉项目列表」（之前文案让用户误以为也拉用户/模块）
- stripSensitiveProjectFields 加剥 project.token（webhook token 也是敏感字段）
- SubmitDialog defaultType 不在 ZENTAO_TYPE_OPTIONS 时 fallback 第一个合法 option
- loadZentaoModules/Users 失败时 inline 错误显示（之前静默下拉空）
- background 4xx 显式 result.queued = false + appendQueued 区分文案
- 缩略图 overlay 默认 35% opacity 露出按钮（之前默认 0 → 触屏/不知 hover 用户找不到）

**📋 backlog（v0.5.x 单独做）**：
- adoptRemoteRecording 监听 RECORD_GLOBAL_STARTED 广播（tab B 看到 tab A 新开始的录屏）
- chrome.windows.onRemoved 注册录屏紧急 STOP（best-effort 防关窗丢录像）
- clearHistory/clearQueue 加 24h undo 机制（mini-feature）
- 重新截图二次确认 / discoverProduct manual invalidate / schemaVersion step ladder（小问题 4 项标 backlog）

**测试**：366 单测 + 7 skipped + 90 e2e + vue-tsc 0 报错。**modify 1 test 期望**（stripSensitive 现在总返新对象，不再保引用）。

## v0.4.6

2026-05-24 发版。无 BREAKING。**文档专项 review 一波** —— v0.4.5 后跑「拉团队，所有文档优化」3 agent 并行审，找出 22 个文档问题全清 + filter-repo 清 git history PII。**纯文档/工程，无运行时代码改动**（runtime 0 行变化）。

**🔴 严重 5 项**：
- `docs/MCP_TESTING.md:38` 真公司禅道域名 hardcode（**hard rule 违反**）→ filter-repo --replace-text + --replace-message 双管清整个 git history + force push（v0.4.0/v0.4.4 同款处理）
- HANDOFF.md 大段 stale + 归档严重滞后：v0.3.0 → v0.4.4 简介迁到 `docs/handoff-archive/v0.1.x.md`，主文件「一句话现状」只留 v0.4.6 + v0.4.5
- HANDOFF.md 「现在最值得做的下一件事」段从 v0.3.1 视角更新到 v0.4.5 视角；老 ✓/~~~~ todo 替换成当前 backlog（host_permissions / 依赖漏洞 / listModules / knip 等）
- HANDOFF.md E2E 数字内部冲突：line 37/47 「97 case」→ 90 case（v0.4.x 实际数）
- `docs/handoff-archive/PLAN_v0.2.0.md` 加归档 banner + 清 ⌘⇧B 残留 + 项目 ID 26 加注释

**🟡 中等 10 项**：
- `docs/UX_REVIEW.md` 加 banner 标记多条 v0.1.12 / v0.1.14 已 land（dark theme / useAutoSave / hostname fallback / MooCloseBtn aria）
- `docs/COVERAGE_MATRIX.md:116` 「已 ✓ 195 case」加 banner 说明是 v0.1.x 时代基线（当前 456 case）
- `docs/RELEASE_TEST_CHECKLIST.md` v0.1.11/12 表格化 checklist 加 banner 说明 v0.4.x 不再按此跑
- `README.md` mock endpoint `/bugs/intake` 统一成 `/bugs`（跟 mock-server.mjs 自报一致）
- README.md 「配一个项目」加禅道接入分流（指向 ZENTAO_SETUP.md）
- `ONBOARDING.md` 加 banner 说明「How We Use Claude」是 v0.1.x 快照 + 修测试数 136→366 / 13→90
- `CHANGELOG.md` v0.2.0 段 `kind:'b'` → `'webhook'` 注脚说明
- `CLAUDE.md` v0.4.5 lesson 抽象化（去掉具体文件名，改通用模式表）+ 复盘案例独立段
- `CLAUDE.md` 双 MCP 规则集中到 `docs/MCP_TESTING.md`（其他位置用指针）
- `.claude/commands/full-team-review.md` 「3-4 agent」vs「3 agent 合并」矛盾统一

**🟢 小问题 7 项**：
- `docs/ZENTAO_SETUP.md:11` 不点具体版本号（v0.4.0/v0.4.3）→ 「v0.4.x 系列持续加固」永远不过期
- `docs/MCP_TESTING.md:36` 「dogfood 仪表上有 token」措辞 → 「自己搭的 dogfood 禅道实例」
- 其他小润色

**测试**：366 单测 + 7 skipped + 90 e2e + vue-tsc 0 报错。**runtime 代码 0 改动**。

## v0.4.5

2026-05-24 发版。无 BREAKING。**v0.4.4 大复盘后跑 `/full-team-review` 找出「我刚做的就有同款 bug」+ 累积漏扫的 24 个问题，全修一波**。

讽刺：**3 agent 大团队 review 发现 v0.4.4 修补里有 4 处同款漏扫** —— sender 校验只补了 background+offscreen 漏了 content+ContentApp；dark mode token 只修 Overview 漏了 Environment；setTimeout leak 只清 SubmitDialog 漏了 BodyViewer；写检查脚本时正则硬编码 `v0.x.x` 1.0 自废。证明 CLAUDE.md「主动扩展清单」第一版强度不够。

**🔴 严重（7）**：
- content/index.ts + ContentApp.vue sender 校验补齐（v0.4.4 漏的同款）
- check-version-consistency.mjs 正则改通用 `v\d+\.\d+\.\d+`（1.0 之后仍能用）
- Environment.vue dark mode token（用了不存在的 `--moo-c-ok-fg` → 改 `-success-fg`）
- HANDOFF.md 「100 e2e」→ 实际 90，纠正 + 31 行 stale 段更新
- broadcastAutoStopped 读 `chrome.runtime.lastError`（防 80+ tabs 时 console 噪音）

**🟡 中等（12，含 race/leak/CSP 防御）**：
- 第二批 dark token：popup `.rec-err` / Environment+Settings `.is-error` 改 `-fg` 变体（AA 对比度）
- BodyViewer copied timer 加 onBeforeUnmount 清（跟 SubmitDialog copyHintTimer 同款 leak）
- alarm 加 `alarms.get` 先判断（防 onInstalled+onStartup 同名覆盖重置周期）
- main-world.ts window.error 加 100ms 同 message 去重（防 React loop 卡死宿主）
- offscreen track-ended sendMessage 加 50ms 重试 + storage flag fallback（SW 回收时不丢）
- SW spin-up 时 `checkOffscreenAutoStoppedFlag` 读 flag 兜底
- captureVisibleTab catch 内显式 void lastError（Chrome 109-115 边缘行为）
- retryQueue cooldown 30s（防 SW 回收 inflight 重发，flushPromise 改 IIFE 同步设防 race）
- SubmitDialog+Overview 重复 6 函数抽到 `utils/requestRowFormat.ts`
- release.mjs PII_INCLUDE_EXTS 加 yml/yaml/html/sh/css/txt（之前 .github/workflows 完全没扫）
- release.mjs 邮箱 allowlist 去掉 gmail/qq/163/126/sina（free-mail provider 全 allowlist 让真名邮箱绕过）

**🟢 小问题（5）**：
- 删 4 个真死 type（CaptureScreenshotReq / RecordExternalStartedMsg / RecordAutoStoppedMsg / QueuedRequest）
- content/index.ts mounted log 加 DEV 门控（防污染所有宿主 console）
- check-bundle-size.mjs exclude 加 svg/webp/gif/woff2/视频等
- storage/config migration 加 10 单测（之前 0 单测，最高风险 dead zone）

**CLAUDE.md「主动扩展清单」加固**：新增 5 条 v0.4.5 lesson —— 修一个 X 应该 grep 这些（不只扫直接命中位置）。

**测试**：单测 366 + 7 skipped（+10 config migration） + 90 e2e + vue-tsc 0 报错。

## v0.4.4

2026-05-24 发版。无 BREAKING。**v0.4.3 后大团队复盘 + 全面加固一波**。

3 个 agent 并行审（mv3-pro / vue-craft / general-purpose）找出 4 严重 + 7 中等 + 一堆小问题。全修。

**🔴 严重修复**：

- **MV3 安全加固**：`background/index.ts` + `offscreen/index.ts` 的 `onMessage` 把 `sender.id && sender.id !== runtime.id` 改成严格 `sender.id !== runtime.id`（短路 bug：undefined 时不 reject）。同扩展发的 sender.id 必须 === runtime.id，外部/未知来源直接拒
- **dark mode 颜色硬编码**：`Overview.vue` link-btn 用了不存在的 `--moo-c-link` / `--moo-c-primary` token，fallback 到 hardcode `#4f8df9`，dark 切换不变色。改用现成的 `--moo-c-brand` / `--moo-c-brand-hover`
- **文档误导同事**：`docs/ZENTAO_SETUP.md` 还写「当前 latest = v0.3.0」（实际 v0.4.3+），同事按链接下错版本。改成「永远去 releases 页拉最新」
- **`copyHintTimer` leak**：v0.4.1 SubmitDialog 复制反馈 1.5s setTimeout 在 onBeforeUnmount 没清

**🟡 中等修复**：

- **SW spin-up 同步 offscreen 录屏状态**：SW 30s 闲置回收后 currentRecording 丢但 offscreen 自带 keep-alive 仍在录。offscreen 加 `QUERY_STATE` 消息 + 记录 `recordingMeta: { tabId, startedAt }`，SW spin-up 时调 `getContexts` + 查 offscreen state 回填 `currentRecording`
- **submit.ts 加单测**：之前 464 行编排层零单测。加 `tests/zentaoSubmitBuilders.test.ts` 17 用例覆盖 `buildZentaoEnv` 5 + `buildZentaoStepsHtml` 12（含 ZWS 绕 WAF / XSS escape / 二进制响应 / 截断 1.5KB / 上传失败 cookie 提示等）
- **`⌘⇧B` 文档误导清干净**：v0.3.1 没清完的 5 处（README / PLAN_v0.2.0 / MCP_TESTING / ContentApp 注释 / dialog-harness 注释）全清。manifest 实际只有 `Alt+Shift+R / Alt+Shift+M`
- **`docs/PLAN_v0.2.0.md` 归档**：v0.2.0 实施计划早完成，移到 `docs/handoff-archive/`
- **`tsconfig.tests.json` 加宽松版**：让 `vue-tsc -p tsconfig.tests.json` 覆盖 tests/ + tests-e2e/。修了累积 8 个类型错（unused @ts-expect-error / globalThis cast / QueuedItem narrow / vi.fn 类型签名）
- **`README.en.md` 占位清理**：从 Gitee 默认模板写成真内容，给非中文读者入口

**🟢 顺手清**：

- 删 6 个真死的 export（`MAX_BODY_SIZE` / `isMediaDevicesAvailable` / `unavailableReason` / `sendToBackground` / `updateConfig` / `matchProject`）
- `COVERAGE_MATRIX.md` 单测数 161 → 356 更新，并标明 v0.3.x 后单元格未回填

**📋 backlog（不在本波）**：

- `host_permissions: <all_urls>` 改 `optional_host_permissions`（Chrome 商店审核红牌，但当前 gitee 发版没上 Web Store 暂不阻塞，需要 Settings UI 加权限请求按钮，mini-feature v0.5.0 单独做）
- 3 个 npm 依赖漏洞（rollup / esbuild / vite 都是 dev-time only 不影响用户运行，需要 vite 5→6 + @crxjs 2.0-beta→2.4 major bump，break 风险大，v0.5.0 单独升级波）

**测试**：单测 356 全绿 + 7 skipped（fixture 等同事数据） + 100 e2e + vue-tsc 0 报错（含 src + tests 宽松版）。

## v0.4.3

2026-05-24 发版。无 BREAKING。

**主线 · 禅道 v2 endpoint 全部双轨化加固**：

dogfood 阻塞复盘：v0.4.0 hard 切 v2 后连炸 3 次（v0.4.2 ping / v0.4.3 discoverProduct）。根因：真禅道实例 v2 响应 schema 跟我自己实例不一致，单实例 dogfood 测不出方差。

加固 5 个 v2 endpoint（v2 拿不到自动 fallback v1）：
- **discoverProduct**：v2 `/projects/{id}` 拿不到 products → fallback v1 `/products?project=`（修同事提交 bug 阻塞）
- **listProjects**：v2 schema 不识别 → fallback v1 `/projects?limit=`
- **listUsers**：v2 schema 不识别 → fallback v1 `/users?limit=`
- **getBug**：v2 schema 不识别 → fallback v1 `/bugs/{id}` 平铺
- **ping**：v0.4.2 已加 fallback cached

错误文案标 path 便于同事反馈定位（例：「HTTP 500（v1 projects fallback）」）。

**支线 · 测试方法论加固**：

测试断面同源（单测/e2e/双 MCP 都跑同一份 mock）是根本缺陷。三层加固防下次连炸：

- **schema fuzz** — `tests/zentaoV2SchemaFuzz.test.ts` 8 异常变体 × 5 endpoint = 40 用例。验证「任何 v2 异常都 degrade 优雅」，不依赖外部样本
- **真实 fixture 库** — `scripts/dump-zentao-fixtures.sh` 同事一次性 dump 真实响应 + `anonymize-fixtures.mjs` 自动脱敏 + `zentaoV2RealFixture.test.ts` 回放（graceful skip 不阻塞 CI）
- **双 MCP 分断面** — `docs/MCP_TESTING.md`：chrome-devtools MCP 专测 SW 行为，playwright MCP 专测 harness，能 playwright 跑就别用 chrome-devtools MCP

**硬规则立法**：`CLAUDE.md` 新增「禅道 v2 API 改造硬规则」段（模板代码 + 错误文案标 path + 单测必备清单）。memory 加 `feedback_zentao_v2_dual_track_rule`。

**累积体感小改**：
- SubmitDialog inline body URL row 横排（不浪费上方空间）
- Overview empty state 区分「真没数据」vs「被时间窗/过滤词隐藏」+ 一键切「全部」/ 清空过滤词

**测试**：339 单测全绿 + 7 skipped（fixture 等同事数据） + 100 e2e。vue-tsc 0 报错。

## v0.4.2

2026-05-22 发版。无 BREAKING。**dogfood hotfix**。

- **fix(zentao)**: `ping()` 在 v2 `/users/{id}` 返非标 schema 时 fallback cached（不再 abort 报「v2 用户详情响应格式不对」）。
  - 起因：dogfood 同事在真禅道实例点「测试连接」卡在此报错。本地复现：禅道 v2 `/users/{id}` 在某些 instance 返简化对象（缺 id / realname 字段名不同），但 token 真有效。
  - 修法：解析成功 → 更新 cache 返新数据；解析失败 + token 有效（res.ok + 非 v2AuthExpired）→ 用 cached（login 拿的 user 必齐）返成功。
  - 不影响：v2 鉴权失效 retry 链不变；listProjects / listUsers / getBug / submitBug 严格 schema 不变（只放宽 ping）

加 2 单测覆盖 fallback 路径（缺 id 字段 / 业务错响应）+ 1 旧用例从「strict 报错」改成「fallback 成功」。292 单测全绿。

**发版决策小记**：dogfood hotfix 紧急程度高（同事卡在测试连接用不了），3 条 checklist ① ② 满足 ③ 用户明示放行立即发。

## v0.4.1

2026-05-22 发版。无 BREAKING。

发版工程化 + 体感小改：

- **feat(submit)**: SubmitDialog 附带请求 inline body 旁加 📋 复制按钮（复完整原文，不是 1500 字截断版）+ req-controls 加「收起全部 (N)」按钮（v-if expandedReqIds.size > 0）
- **chore(release)**: pre-flight 改读 `.release-pii-deny`（gitignored，本地词表）+ 加模式扫描 warn 段（手机号 / 邮箱 / 私网 IP / 身份证 4 类 regex）。env 控制：`MOO_RELEASE_SKIP_PII_CHECK=1` 跳黑名单 / `MOO_RELEASE_SKIP_PII_PATTERN=1` 跳模式 / `MOO_RELEASE_PII_VERBOSE=1` 看完整命中
- **chore(history)**: `git filter-repo` 5 轮清整 git history（file content + commit message + tag annotation + reflog + unreachable objects，22 类系统扫 0 PII 命中）+ 21 个 tag SHA 重指（Gitee zip / 下载链接 / sha256 不动）
- **docs**: 禅道手册加 v2 鉴权失效非标响应陷阱章节（HTTP 200 + `{result:false}` 不是 401）+ CLAUDE.md 加「发版前 PII 自检 10 问」+「filter-repo 关键陷阱（--replace-text 不动 commit message 必须 --replace-message 同跑）」
- **test**: 加 3 个 e2e 覆盖复制 / 收起（COPY-1 完整原文 + COPY-2 req/res 独立 + COLLAPSE-1 v-if 出现消失），harness 加 `?requests=N` 注入 mock。100 e2e 全绿

无 BREAKING。290 单测 + 100 e2e 全绿。

**发版决策小记**（2026-05-22）：3 条跳 checklist 标准前 2 条满足（① 非 BREAKING ② 全绿），第 3 条「dogfood ≥ 几天」**用户明示放行**——D 改动是 UI 体感不影响行为，pre-flight 是发版工具不影响 production。同事 dogfood v0.4.0 时碰的 HTTP 403 留到 v0.4.2 等 SW log 诊断。

## v0.4.0

2026-05-22 发版。无 BREAKING。

### 改了什么

- **禅道 API 全面 v2 化**：6 个读 endpoint 中 5 个收口到 v2.0（`ping` / `listProjects` / `listUsers` / `getBug` / `discoverProduct`）。`listModules` 保留 v1（禅道 v2 RESTful 21 章节无 Module 章节）。新增 `userCache` 让 ping 走 v2 详情端点
- **v2 鉴权失效非标响应处理**：实测发现 v2 endpoint 未授权返 HTTP 200 + `{result:false, message:"登录已超时"}`（不是 401），新增 `isV2AuthExpired` helper 命中触发 retry login
- **删除 probeCookieSession + ensureCookieSession 简化**：v2 RESTful 设计只接受 token 鉴权，改 trust login + userCache 取 realname 的正规路径
- **`envKey` trim 一致性 bug 修**：baseUrl 末尾 `/` 导致 userCache miss 的潜在严重 bug
- **SubmitDialog 4 改**（同事反馈）：附带请求 / 错误默认只勾最新一条（之前 14/14 偷偷全选）+ 请求 row inline 可展开看 request/response body 对照字段 + Environment URL 匹配 textarea 换行被吃 bug 修

### 测试

290 单测（266 → +24 v2 路径 + v2 鉴权失效 retry / login user 解析 / getBug 嵌套响应 / discoverProduct products shape / listModules 保留 v1）+ 97 playwright e2e + type-check + vite build + chrome-devtools MCP 真机 SW 0 error 全绿。

### 发版决策

重型重构按规矩不能跳 checklist。实际：① 非 BREAKING ② 全绿 ③ 同事 dogfood 截图证明核心路径 work + 用户明示放行 → 跳过「dogfood ≥ 几天」时间要求。

## v0.3.1

**质量补强 + 文档优化**。v0.3.0 发版后全面验收发现 4 个真问题一捆修，**无 BREAKING + 无生产行为变更**（P3 时间窗对真用户操作 0 影响，仅自动化测试受益）。

### 用户视角

- 禅道使用文档大改：删 `⌘⇧B` / `Ctrl+Shift+B` 误导（manifest 没注册这个快捷键），改成「悬浮球截图按钮 / popup 触发截图」；inline curl 解释从「零宽空格」开发者术语改成「禅道 XSS 防护改字符」白话版；加「悬浮球被挡 / 跑屏幕外」常见问题（含清 `moo-ball-pos` localStorage 兜底）；加「怎么知道我提的 bug 现在禅道里是什么状态？」v0.3.0 状态回查 Q&A + 4 状态对应表
- 悬浮球行为更鲁棒：drag 防御从「moved flag 跨 pointer 周期残留」改成「dragEndedAt 250ms 时间窗」—— 极端 case 下「上一次 drag 完隔很久才点截图按钮」不再被误拦

### 实现

- `src/background/zentaoStatus.ts` 新文件，抽 `mapZentaoStatus` 出 `background/index.ts`（原 file 有 `chrome.runtime.onInstalled.addListener` 等 top-level 副作用，vitest 无法直接 import；抽出后纯函数 + import type 零依赖）
- `tests/zentaoStatus.test.ts` 新增 6 用例，覆盖 5 分支 + deleted 优先于 status + deleted=false+未知 status 的边界
- `src/content/FloatingBall.vue` 加 `let dragEndedAt = 0`；`endDrag` 末尾 `if (moved) dragEndedAt = Date.now()`；onLogoClick / onTriggerCapture / onTriggerRecord 的 `if (moved) return` → `if (Date.now() - dragEndedAt < 250) return`。`moved` 变量保留（位置落盘判定仍用）
- `docs/RELEASE_TEST_CHECKLIST.md` 加「dogfood 装扩展的两条路」（路 A release zip 推荐 / 路 B dist/ 陷阱 + chunk hash 漂移症状识别 + 修复）+ 「自动化测试 caveat」（pointer-only click 兼容 + closed shadow fill 不触发 v-model input event 的 fix 提示）
- `.gitignore` 加 `.test-output/` + `.playwright-mcp/` 防 MCP 测试中间产物（含敏感截图）误入仓库

### 测试统计

**266 单测**（260 + 6 新 mapZentaoStatus）+ type-check + vite build 全绿。

## v0.3.0

**feature · 历史 Tab 显示禅道 bug 实时状态**。提了 bug 后 Moo 里直接能看到禅道里这条 bug 的当前处理结果，闭环完整。**无 BREAKING**。

### 用户视角

- 「历史」Tab 每条 bug 显示状态 badge：**待处理 / 处理中 / 已完成 / 已删除**
- 进 Tab 时如果有禅道项目的 history，自动同步一次状态（webhook 项目仍要手动点「同步远端状态」按钮）
- 状态显示后 Moo 跟禅道流程闭环：「提一条 → 看到禅道里处理状态」不用切到禅道

### 实现

- `src/background/zentao/client.ts` 新增 `getBug(env, bugId)` → `GET /api.php/v1/bugs/{id}` 返 `{status, subStatus, deleted, assignedTo, resolution, ...}`（v1 平铺字段，v2 嵌套一层 `{status, bug}` 不必要绕）
- `src/background/index.ts` `refreshHistoryStatus` 加 kind 分支：zentao 走 `fetchZentaoBugStatus` 调 `getBug` + `mapZentaoStatus`；webhook 走原 `fetchWebhookBugStatus`（POST `/{remoteId}/status-public` body.token 鉴权）
- 状态映射 `mapZentaoStatus(bug)`：active → open / resolved → in_progress / closed → done / deleted → deleted（兼容 v0.1.x webhook 路径的 remoteStatus 枚举）
- `src/devtools/tabs/History.vue` onMounted：检测到 kind=zentao 项目的 history 时自动调一次 `syncRemoteStatus`（避免对未配的 webhook 后端做无意义 ping）

### 端到端实测

用户真实 bug 9279/9285（status="active"）→ 映射 → mooStatus="open" → label「待处理」✓

### 测试统计

260 单测 + type-check + vite build 全绿。

## v0.2.3

**hotfix · 大重写**：用户提醒 v0.2.0 dogfood 时**用错 v1 / form 端点**，应该用 v2 REST API。彻底重新探完 v2 API 文档（zentao.net/book/api/2142）+ 实测后重构。**无 BREAKING**。

### 用户视角变化（最重要）

- **不再需要手动登录禅道页面**——Moo SW 用你配的账号密码自动调 v2 login 同时拿 token + 写 cookie，提交时无感。
- 之前 v0.2.0-0.2.2 的「硬依赖：先登录禅道」彻底消除。
- bug 创建走 v2 REST API token 路径，openedBy 自动绑到真账号（之前以为只能走 cookie，是 v0.2.0 用错 v1 路径误判）。

### 实测确认（重新探完 v2 API 后）

| 操作 | v0.2.0-0.2.2 路径 | v0.2.3 新路径 | 实测 |
|---|---|---|---|
| login | v2 + credentials:'omit'（拿 token，扔掉 cookie） | v2 + **credentials:'include'**（同时拿 token + 写 cookie） | ✓ |
| bug 创建 | form `/bug-create-N.html` + cookie + 18 字段 multipart | **v2 `POST /api.php/v2/bugs`** + Token header + JSON | ✓ 200 + openedBy 正确 |
| 附件上传 | `/file-ajaxUpload.html` + cookie | 同（v2 `/files` 端点账号权限 deny） | ✓ |
| WAF 绕开 ZWS | 必须 | 必须（v2 端点也走同 WAF） | 实测 v2 + 3 段域名 → 566 |

### 代码改动

- `src/background/zentao/client.ts`:
  - `login()` credentials:'omit' → **'include'**（一次拿两样：token + cookie）
  - 新增 `ensureCookieSession(env)`：probe `/api.php/v1/user` 失败时自动 login 重 probe
  - **完全重写 `submitBug()`**：丢掉 form 端点 + multipart + 18 字段 hidden values，改成 v2 JSON POST + Token header + 14 字段（productID/title/openedBuild/project/module/severity/pri/type/steps/assignedTo/os/browser/keywords + 隐式可选）
  - 401 自动 refresh token 重 submit 一次
  - 566 WAF 明确报错
- `src/background/zentao/submit.ts` `submitToZentao`：第一步 `ensureCookieSession` 自动登录；网络错 vs 认证失败分流让 retryQueue drop 规则只 drop 永久性错误
- `src/background/index.ts` `ZENTAO_PING_COOKIE` handler 改成调 `ensureCookieSession`（payload 含账号密码自动 login）
- `src/types/messages.ts` `ZentaoPingCookieReq = ZentaoCredsReq`（payload 加账号密码）
- `src/content/SubmitDialog.vue` cookie 预检文案「检查禅道登录」→「正在登录禅道」，传账号密码给 BG
- `docs/ZENTAO_SETUP.md`「30 秒开始 — **3 步 → 2 步**」（删登录禅道整段），FAQ 「未登录」段重写

### 端到端实测（user 已签退状态下，bug 9343 自清）

```
step1_loggedOut: true            // 未登录确认
step2_loginGotBoth: true         // login 同时拿 token + 写 cookie
step3_cookieWritten: true        // cookie 真的在 jar 里
step4_attachmentUploaded: true   // /file-ajaxUpload.html cookie 路径工作
step5_bugCreated: true           // v2 /bugs token 路径 200 + id
step6_fields: {
  openedBy: '真账号',       // ✓ 真账号不是 system
  assignedTo: 'uicml', severity: 1, pri: 2,
  type: 'performance', os: 'osx', browser: 'chrome', keywords: 'Moo',
  stepsHasImg: true, stepsHasZWS: true, stepsHasResponseCard: true
}
allPass: true
```

### 测试统计

260 单测 + type-check + vite build 全绿。retryQueue zentao 路径 mock 适配新 v2 endpoint。

## v0.2.2

**hotfix · UI 优化**：v0.2.1 加的 Response inline 只是普通 `<p>` + `<pre>`，同事
反馈「视觉上跟 curl 块没区分，看不出来是 response」。改成卡片样式让一眼能认出。

### 修复

- `buildResponseBlock`：从 `<p>` + `<pre>` 改成 `<div>` 卡片包裹
  - 左侧 3px 色条，按 status 着色：2xx 绿 `#16a34a` / 4xx 红 `#dc2626` / 5xx 深红 `#991b1b` / 其他灰
  - 浅灰背景 `#f8fafc` + 内 padding 让卡片视觉分离
  - 标头改用 `📥` emoji + `<b>Response</b>` 加粗 + content-type 用 `<code>` 风格突出
  - body `<pre>` 白背景 `#fff` 在浅灰卡片里反白显眼
- 实测禅道 sanitizer 保留 `<div>` + background / border-left / padding inline style（之前没专门测过，本次实测 9337/9338/9339 三色卡片三种状态码全部保留）

### 测试统计

260 单测全过，type-check + vite build 全绿。端到端实测 bug 9339 三色卡片渲染正常。

## v0.2.1

**hotfix**：v0.2.0 发版后立刻发现的 curl URL 缺 origin 问题——用户写 `fetch('/api/foo')` 这种相对路径时 captured-request 的 url 字段是 `/api/foo`，导致 SubmitDialog inline curl + 禅道 bug 详情页 curl 代码块 + `moo-requests.curl.sh` 附件里的 URL **全都缺 origin**，复制到终端 `curl: (3) URL using bad/illegal format`。**无 BREAKING**。

### 修复

- `src/utils/url.ts` 新增 `absolutize(url, base?)`：用 URL 构造器 base=`location.href` 把相对路径补成完整 URL，URL 构造失败兜底返原值不抛
  - 绝对 URL（`https://...`）：原样
  - 绝对路径（`/foo`）：补 origin
  - 相对路径（`foo` / `../foo`）：按 base path resolve
  - protocol-relative（`//host/path`）：补 protocol
  - 其他 scheme（`ws://` / `file:` / 等）：原样不改
- `src/injected/main-world.ts` fetch / XHR hook 调用 absolutize 把 url 字段统一 normalize；内联实现（main-world 严格自包含不引 @/ 模块），但与 utils/url.ts 同步
- `tests/url.test.ts` +11 单测覆盖：绝对 URL / 绝对路径 / 相对路径 / protocol-relative / `../` / 空串 / 带 query / 带 port / 非法 base 兜底 / 其他 scheme

### 测试统计

249 → **260 单测**（+11 url），type-check + vite build 全绿。

## v0.2.0

**禅道集成**——把 Moo 上报通道从「只支持自建 B 路径接口」扩成「自建 B / 禅道（云禅道 biz12 + 自建禅道，v2.0 API）」二选一。同一份截图 / 录像 / 请求 / 错误 / curl 复现，可以直接一键开成禅道 bug，自带附件。**无 BREAKING**——老项目（无 `kind` 字段）一律按 `kind: 'b'` 走原路径，行为不变。

> 注：下文 `kind: 'b'` 是 v0.2.0 当时的命名；后续重命名为 `kind: 'webhook'`（代码中 `src/types/config.ts` / `retryQueue.ts` 均用 `'webhook'`）。changelog 段保留原叙述作历史记录。

**发版决策小记**（2026-05-21）：v0.2.0 是 feature 大版本，**主动跳过 dogfood ≥ 几天**——禅道集成已在 真禅道实例 真实环境 dogfood 过完整流程（用户实测发现并修复 7+4 个 dogfood fix，见下文），全部场景闭环。3 条跳 checklist 标准只满足前 2（① 无 BREAKING ② 249 单测 + type-check + vite build 全绿），第 3 条 dogfood ≥ 几天**用户明示放行**。后续如有其他禅道版本回归，hotfix 走 v0.2.1。

### 关键架构（接下来的会话要直接看懂）

**B' 路径拍板**：禅道集成不走「禅道服务器 → 适配层 → Moo B 接口」的中转方案，而是 background 内部根据 `project.kind` 分支，**直接打禅道 v2.0 REST API**（`/api.php?m=user-login` → cookie session → multipart 附件 → submit-bug）。优势：① 不需要部署中间适配服务 ② 用户填的就是禅道本身的账号 / 密码 / 项目 ID ③ 后端字段语义按禅道原生（type / severity / pri / assignedTo）。

**实际写操作走 cookie session**：login 用 v2 API 拿 token + sid，但**真正提交 bug 走浏览器 cookie session**——background 调 `chrome.cookies.get` 拿用户**在浏览器里已登录禅道页面的** session cookie 直接提交。理由：纯 API token 提交的 bug `openedBy` 会变成 `system`（禅道把它当机器人），用 cookie 提交才能正确归属到真人账号。**因此硬依赖**：用户必须先在同一浏览器里**手动登录过禅道页面**，Moo 才能用那份 cookie 提交。Moo Settings 里配的账号密码只用来跑 `/user-login` 拉 token + 拉用户列表（指派人下拉）。

**附件走 zui editor 链路**：禅道附件不能用 v2 API 的 attach_files 端点（不支持 inline 渲染），改走 zui editor 用的 `/file-ajaxUpload.html` —— 上传后拿到 `fileID`，再把 `<img src="/file-read-{fileID}.html">` 拼到 bug steps HTML 字段里，**截图直接 inline 渲染在 bug 详情页**，不用点附件。录像 / curl.sh / 错误信息也走同一端点拿 fileID，但只挂附件不 inline。

**ZWS 绕禅道 WAF**：禅道服务器侧有 WAF 规则会把 bug body 里**裸 curl 命令的 URL** 当作 SSRF / 攻击 payload 直接拦截（400 + 误报日志）。绕法：在 inline 渲染的 curl 代码块里给 URL 关键字符之间插 zero-width space（U+200B），渲染视觉无差异、复制粘贴执行无差异（zsh/bash 接受），但 WAF 的字符串匹配规则失效。**curl.sh 附件没有 ZWS 污染**（保证用户复制 curl 文件直接执行可用）。

### 主线功能（P1-P5 + docs）

#### P1 — zentao client 骨架（`4e9d51c`）

`src/background/zentao/client.ts` 新模块：
- `login(baseUrl, account, password)`：v2 API 拿 token + sid（`/api.php?m=user-login`）
- `ensureToken(project)`：token 缓存 + 过期自动 refresh，所有写操作前调
- `ping(project)`：测试连接，返回登录用户名
- `listProjects(project)`：拉项目列表，给 Environment Tab「📋 从禅道拉列表」用
- `discoverProduct(project)`：根据 projectId 反查 productId（禅道 bug schema 必需）
- `submitBug(project, payload)`：cookie session 提交 + 附件 upload + steps HTML 拼接

`src/background/zentao/curlGenerator.ts`：把 captured request 转成 curl.sh 文件内容（headers / body / method 全保留），同时生成 inline 渲染版（ZWS 污染）。

#### P2 — Project schema 加 kind（`4d5e411`）

`src/types/project.ts`：
- `Project.kind?: 'b' | 'zentao'`（缺省 = 'b'，老数据自动归类）
- `Project.zentao?: { baseUrl, account, password, projectId, moduleId, productId? }`
- login 切到 v2 API（`/api.php?m=user-login`）
- 71 个新单测（zentao client + schema 兼容性）

#### P3 — Environment Tab 加禅道表单（`af66512`）

`src/devtools/tabs/Environment.vue`：
- 「上报方式」下拉切 `kind`，B / 禅道二选一
- 禅道侧 4 字段表单 + 「测试连接」按钮 + 「📋 从禅道拉列表」按钮（拉 listProjects 填下拉）
- 导入导出：导出时 `zentao.password` 字段**剥掉**（避免 git / 共享文件泄密），导入时该字段为空，提示用户重新填密码

#### P4 — SUBMIT_BUG kind 分支 + SubmitDialog 链接（`5021cbf`）

`src/background/index.ts`：SUBMIT_BUG handler 按 `project.kind` 分支，'zentao' 走 `zentao.submitBug`，其他原路径。

`src/content/SubmitDialog.vue`：提交成功后显示「在禅道里看 →」链接（`{baseUrl}/bug-view-{bugId}.html`），点击新 tab 跳。

#### P5 — retryQueue zentao multipart 重试（`bbaad7b`）

`src/background/retryQueue.ts`：原本只支持 JSON POST 重试，现在加 multipart 分支——`QueuedRequest` 里存 `kind: 'zentao' | 'b'`，flush 时按 kind 重新拼 FormData（附件 blob 从 IndexedDB 恢复，避免 chrome.storage 1MB 限制）。11 个新单测。

#### docs — ZENTAO_SETUP.md 用户手册（`3a31be6`）

`docs/ZENTAO_SETUP.md` 8 节 251 行：TL;DR / 准备账号 + projectId / Moo 配置 / 一键提 bug / 字段映射 / 重试 / 常见问题 / 自建禅道注意。

### 修复（dogfood 阶段——用户实测 + 自测发现）

- **SubmitDialog 适配 kind=zentao**（`a75077a`）：禅道项目下 SubmitDialog 隐藏「服务器选择」（禅道无多 server 概念）和「预览请求体」（multipart 没意义），换成「禅道项目 / 模块 / 指派给」可改字段
- **附件改走 zui editor 链路**（`e3db4e8`）：原本走 v2 API attach_files，截图必须点附件下载才能看；改走 `/file-ajaxUpload.html` + steps HTML inline `<img>`，截图直接显示在 bug 详情页
- **选中请求 inline 渲染 curl 代码块**（`7df47b4`）：原本 curl 只作为 curl.sh 附件挂着，bug 详情看不到 endpoint；改成 steps HTML 里 inline `<pre><code>curl ...</code></pre>` + 同时挂 curl.sh 附件（双备份）
- **提交改走 cookie session**（`849ed60`）：根因 `openedBy=system`——纯 token 提交禅道当机器人。改用 `chrome.cookies.get` 拿浏览器登录态 cookie 提交，bug 正确归属真人
- **4 字段提交时可改 + 指派人下拉**（`0aac1f4`）：type / severity / pri / assignedTo 原本只能在 Environment Tab 配死，现在 SubmitDialog 里可逐 bug 调整；指派人下拉调 `/user-getList` 拉项目成员
- **绕开禅道 WAF**（`18cccf1`）：inline curl 的 URL 加 zero-width space，渲染 + 复制粘贴无差异，绕过 WAF 字符串匹配；curl.sh 附件保留无污染版本
- **cookie 预检 + 录像 50M 预警**（`b5b9dcf`）：SubmitDialog 打开时预检 `chrome.cookies.get` 是否拿得到禅道 cookie，没有就提示「请先在浏览器里登录禅道页面」；录像 > 50MB 时提示用户可能超禅道附件大小限制

### 修复（dogfood-late——发版前最后一批 UI / 字段补全）

- **补全禅道字段：os / browser 自动解析 + 默认 keywords + 模块下拉**（`53bb9f8`）：之前禅道 bug 详情 16 个字段 Moo 只填 5 个；这批加 `parseUserAgent` 自动填 os/browser（走禅道 enum：osx/win10/ios/android + chrome/safari/firefox/edge/opera）+ 默认 keywords='Moo'（团队能按关键词搜全部 Moo 上报）+ 「所属模块」下拉（调禅道 `/v1/modules?type=bug` 拉项目模块树）。`src/utils/ua.ts` 11 个新单测覆盖主流 UA 组合
- **环境「提交默认值」UI 优化 + 抽共享常量**（`d042135`）：`<details>` 折叠改默认展开 + 卡片样式；「类型」从 input 改 select（与 SubmitDialog 一致）；删项目级「指派给默认」（每条 bug 情况不同）；加「默认关键词」配置项；新建 `src/utils/zentaoOptions.ts` 抽共享 `ZENTAO_TYPE_OPTIONS / SEVERITY / PRI`，避免 Environment 和 SubmitDialog 各自维护一份分叉。`sanitizeKeywords` 加 trim + 拒 CRLF/控制符 + 长度上限 200 + 空兜 'Moo'
- **环境配置布局拆行**（`687374d`）：用户反馈「项目 ID / 模块 ID」和「严重度 / 优先级」挤一行 + label 被甩到右侧空缺位；都拆成独立 row，每个字段一行一个 label + input/select
- **SubmitDialog label + ↻按钮微调**（`47c8d70`）：「类型/严重/优先」label 11 字超 64px label 宽换行成两行丑 → 改「分级」2 字（select 自带「类型：/严重度/优先级」前缀已说明含义）；↻ 按钮 height 24px 跟 select ~32px 对不齐 → `align-self:stretch + height:auto + min-width:36px`

### 硬依赖（用户视角）

1. **浏览器里手动登录禅道页面**（提交走 cookie session）
2. **Moo Settings 配账号 / 密码 / 项目 ID**（login + 拉用户列表 + multipart upload）

只满足 #1 不行（没账号密码 Moo 不知道往哪个项目 / 用谁的身份提交）；只满足 #2 也不行（cookie 拿不到，提交会 `openedBy=system`）。两条都必须满足。

### 测试

- 249 单测全绿（v0.1.14 是 170 → +79：zentao client 71 + retryQueue multipart 11 + UA parser 11 + sanitizeKeywords 5 -19 老 mock 调整 + 拆 assignedTo）
- type-check 全绿
- vite build 全绿
- 真实环境 dogfood 通过：真禅道实例 项目 26（测试项目，已清干净）

## v0.1.14

待重试队列可见性 + content 世界 dialog 壳子抽象 + 悬浮球拖动 lost-pointerup race 修。**无 BREAKING**——后端无需配套升级。

**发版决策小记**：用户报「悬浮球不好拖动 / 跟着鼠标跑 / 乱跑」明确严重 bug，需 hotfix。dialog 行为通过 E2E 95 case 等同手摸（含新加的 dialog-harness 11 case + 悬浮球 4 case）。三条跳 checklist 标准前两条满足（非 BREAKING + 全绿），第 3 条 dogfood ≥ 几天**主动跳过**——bug 修复有时效压力且改动局部（FloatingBall + dialog 行为锁），不动 submit / 网络 / 数据契约。

### 悬浮球拖动两个底层 bug 修（用户报「卡 / 跟鼠标跑 / 乱跑」）

#### iframe 跨界吞事件（用户在禅道这类页报「卡 + 跟随鼠标」的根治）

根因：宿主页内嵌 iframe（禅道 / 子任务面板 / 编辑器…）时，用户拖球过程中鼠标跨过 iframe 区域，pointermove 会**路由到 iframe 的 window**，主框架 listener 收不到 → 球**卡住不动**。鼠标松手如果还在 iframe 区，pointerup 也不到主框架 listener，stay 监听挂着；之后回主框架移鼠标，球**追着鼠标跑**。

修：跨 4px drag 阈值后 `rowEl.setPointerCapture(pointerId)` 把所有后续 pointermove/up/cancel 强制送回 row，**不管鼠标在哪都收得到**（含 iframe 区）。纯点击（< 4px）不 capture，子按钮 click 派发不受干扰。

#### pointerup 不送达 window 的多渠道 race

`onDown` 只挂 window `pointermove` + `pointerup({once:true})`，三个场景下 pointerup 不到 window：
1. 用户把球拖出视口外松手（指针离开浏览器窗口）
2. 浏览器在系统通知 / alt-tab 期间发 `pointercancel` 不发 `pointerup`
3. 上一次 pointerup 丢了，pointermove 一直挂着继续跟鼠标；下一次 `onDown` 把 `downAt/originPos` 覆盖但 stale move 监听共用一个 → 球乱跳

修复 4 个口子兜底（`src/content/FloatingBall.vue`）：
- 抽 `endDrag(save)` 统一收口，idempotent，移除所有 drag 监听 + 重置内部状态 + release pointer capture
- `pointerup / pointercancel` 走同一个 `onUpOrCancel` → `endDrag(true)` 落盘
- `window blur` 兜底：alt-tab 时 `endDrag(false)` 清 listener + 释放 capture 不落盘
- `onDown` 起手先 `endDrag()` 防御性扫尾，即使前一轮丢了 pointerup 这一轮也能恢复

E2E 锁 F1-F6 case：正常路径 / lost pointerup + 下次 down 扫尾 / pointercancel 等同 pointerup / window blur 兜底 / **跨 4px setPointerCapture 被调（iframe 跨界根治）** / **纯点击 <4px 不 capture（保子按钮 click 派发）**。

### Settings「待重试列表」可见性

之前「重试队列」一行只有 `N 条` + [立即重试] + [清空]，**用户看不见这 N 条是哪些 bug / 上次为什么失败 / 第几次重试**。后端挂半天用户回头想知道「我那个 bug 到底发出去没」目前完全没信号；5 次后被静默丢弃也无提示。

新加可折叠明细列表。默认收起、空队列时 chevron 禁用、展开后每条按 request 视角显示（**不重复 History 的 bug 视角**）：

- `method` chip（POST / PUT / DELETE 各色）
- `endpoint` truncate（hover title 看全）
- `relativeTime(enqueuedAt)`（刚刚 / N 分钟前 / N 小时前 / N 天前 / 月-日，抽 `src/utils/relativeTime.ts`——之前 popup 也有一份本地拷贝，本次收口走单一来源）
- `第 X/5 次`（`X >= 4` 时红字 + ⚠「下次失败将被丢弃」横幅）
- `上次：{lastError}`（5xx 的 statusText / 网络层 error.message；statusText 空兜底「HTTP {code}」）
- 单条「×」删除按钮（按 `enqueuedAt` 时间戳定位，避免 UI/storage 时差误删邻居）

**retryQueue 数据层配套加 3 字段 + 2 接口**：

- `QueuedRequest.lastStatus?` / `lastError?`：`doFlush` 每次失败时落盘，给 UI 显示用
- `getQueueItems(): Promise<QueuedRequest[]>`：暴露完整列表
- `removeQueueItem(enqueuedAt: number): Promise<boolean>`：按时间戳删单条
- `RETRY_MAX_ATTEMPTS` 改 export，UI 走单一来源（之前是 internal const）

**老数据兼容**：v0.1.13 留下的队列条目没有 `lastError` 字段，flush 一次后自动补齐；单测覆盖。

### content 世界 dialog 壳子抽象（MooDialog + MooAlert）

`SubmitDialog` 的 mask + container + role=dialog + focus-trap + ESC + mask 关，跟 `Annotator` cancel-guard 那套 mask + card + role=alertdialog + focus-trap + ESC + mask 关，**结构高度重复**。抽两个壳：

- `src/content/components/MooDialog.vue`：常规 dialog。props: `title` / `labelledBy` / `maskClosable` / `initialFocus`。slots: `head`（默认 title + MooCloseBtn）/ default（body）。@close 钩子由 ESC + mask click 触发，consumer 决定真关动作
- `src/content/components/MooAlert.vue`：alertdialog 二次确认。props: `title` / `message` / `confirmText` / `cancelText` / `danger`（默认 true）。@confirm + @cancel 双向 emit
- 两个组件**不引入新 CSS**——延用 MooCloseBtn 模式：内容世界 shadow DOM stylesheet（`src/content/styles.ts`）已经覆盖 `.moo-dialog*` / `.moo-cancel-guard*`，组件只出标准 markup

**SubmitDialog**：mask + dialog 外壳 + header 全部塞进 `<MooDialog>`，本地 `useFocusTrap` 调用收口（initialFocus='container' 保持原行为）；onKeydown 的 Esc 分支移除（MooDialog 统一接管），保留 ⌘/Ctrl+Enter 提交快捷键。`onMaskClick` 仍由 SubmitDialog 自己控（成功视图期间禁止关闭的逻辑）。

**Annotator** cancel-guard 整块换成 `<MooAlert>`，移除本地 `useFocusTrap` 调用 + `cancelGuardEl` ref。

### E2E 97 case（v0.1.13 是 77 → +20）

**panel-settings 跟齐重试队列明细 +3**：

- panel-settings G5：展开重试队列 chevron → 列表渲染 N 条 + method/endpoint/attempts/lastError 文案
- panel-settings G6：单条「×」删除 → mooRetryQueue 减 1 + 列表条数减 1
- panel-settings G7：队列为空时 chevron 禁用 + 无明细列表

**dialog-harness 解锁 content 世界 dialog 行为 +11**（**替代原本写在「v0.1.14 必须手摸」的 checklist 第 2+3 步**）：

- `src/content/dialog-harness.{html,ts}`：仿 panel-harness 模式，在 chrome-extension:// 页内复现同款 shadow root + mock `chrome.runtime.sendMessage`。`?case=submit&fail=true/?case=submit&success=true/?case=annotator` 切场景。emit 收集到 `window.__mooHarnessEmits` 给 spec 断言用
- SubmitDialog D1-D7（7 case）：初始焦点在标题输入框 / ESC → cancel / mask click → cancel / Tab 在 dialog 内循环 / 成功 1.5s 保护期 ESC 不关 / 同保护期 mask click 不关 / 失败横幅 × 只关横幅 dialog 仍在
- Annotator cancel-guard A1-A4（4 case）：画 2 笔后点取消 → MooAlert 含「已有 2 处」 / ESC → dismiss + 不 emit cancel / mask click → 等同 ESC / 点「放弃标注」红按钮 → emit cancel
- FloatingBall 拖动 F1-F6（6 case，**对应悬浮球 iframe 跨界 + lost-pointerup race 修**）：正常 down/move/up / lost pointerup + 下次 down 扫尾 / pointercancel 等同 pointerup / window blur 兜底 / 跨阈值后 setPointerCapture 调 / 纯点击不 capture

工程要点：harness 用 `mode: 'open'` shadow（Playwright locator 不穿透 closed shadow）；ESC 走 useFocusTrap 的 case 通过 `pressKeyInShadow` helper 用 `dispatchEvent` 绕过 CDP 路由到 shadow host 的限制（注释里写明 why）。

单测 170 case（v0.1.13 是 161 → +9）：retryQueue 加 5xx/网络错 lastError 写入 / statusText 空兜底 / 老数据兼容 / getQueueItems / removeQueueItem 找到 + 找不到 / storage 异常返空。

**MooDialog / MooAlert 不补单测**：项目惯例 Vue 组件走 E2E（SubmitDialog / Annotator 当前也无单测），加 happy-dom + @vue/test-utils 是测试架构变动超出本版范围。dialog-harness 那 11 个 E2E case 已经把 MooDialog/MooAlert 的所有公开行为（mask close / ESC / focus trap / Tab 循环 / consumer 决定真关）锁住了，相当于壳子的契约测试。

## v0.1.13

体验加速 + 响应式扫修 + 护栏加厚 + 收口债务清理。**无 BREAKING**——任何后端接收侧无需配套升级。

**发版决策小记**：本版 dogfood 期 < 1 天，**用户明示「发，你们搞定」放弃 dogfood 等待**——三条跳 checklist 标准只满足前 2 条（非 BREAKING + 全绿），第 3 条 dogfood ≥ 几天**主动跳过**。如真有体感回归，hotfix 走 v0.1.14。

### 响应式扫修 25 处（大分辨率 + 窄宽场景）

用户报告大分辨率（4K / DevTools docked 1428×1230 DPR 2）下 DevTools 面板「界面没展示完整」。深度审视找到 25 处真 bug：

- **flex truncate 缺 `min-width: 0`**：`Overview.row-head .url` / `Environment .name` / `History .sub-list .u` / popup `.rh-title` / `.rh-row-title` 等共 5 处——长 URL/标题永不截断，反而把同行 dur/time 列**挤出可视区**。`Panel.tabs` / `Panel.content > *` / `Environment.template-row-head label` 同款病
- **box-sizing 撑爆**：`Overview.body-search` / `Overview.toolbar .filter` / `Environment.project-search input` / `Settings.taginput` / `PayloadEditorModal .payload-textarea/.var-btn`——width: 100% + padding 没 box-sizing 引发横向滚动
- **PayloadEditorModal grid**：`1fr 240px` 改 `minmax(0,1fr) 240px`（grid item 等价 min-width: 0）
- **窄宽 wrap**：Overview / Environment / History / Settings 四 Tab 的 toolbar 加 `flex-wrap: wrap`，配合合理 flex-basis
- **content 世界 7 处**：`.req-item .url` / `.moo-ball-action .lab` / picker `.lab` / `.moo-ball-menu` max-width 改 `min(280px, calc(100vw - 32px))` / `.moo-preview` 加 `overflow-wrap: anywhere` 防长 token 横向滚 / `.moo-submit-fail-msg` 同款 / `.moo-rec-bar` 加 `max-width: calc(100vw - 16px)`

设计取舍（不强加）：大宽度 ≥ 1600px 不加 panel 级 max-width（Settings 已自带 760，其他 Tab 是时间线/sidebar 性质受益于宽）。tab bar 左聚集保留（参考 Chrome DevTools 原生 Network/Elements）。

### content 主 chunk -32%（懒加载 Annotator / SubmitDialog / ElementPicker）

注入到每一个 `<all_urls>` tab 的 content script 从 99.56 KB → **69.06 KB（gzip 32.74 → 22.20 KB）**。Annotator(880 行 canvas) / SubmitDialog(637 行) / ElementPicker(223 行) 三个重组件只在用户截图 / 选元素 / 提交那一刻才用到——但之前打死进首注入。改 `defineAsyncComponent(() => import(...))` 后拆三个独立 chunk（14.84 + 14.41 + 3.56 KB），按需加载。

代价：首次按 ⌘⇧B 截图 → Annotator 弹出多 50-100ms（CRX 本地拉 chunk 无跨域）。多 tab 用户内存占用直降。manifest.json `web_accessible_resources` 加 `assets/*.js + *.css`（`use_dynamic_url: true` 防 chunk URL 被宿主页缓存）。

**配套兜底**（发版前 review 找出来的 P0 修复）：`defineAsyncComponent` 加 `onError`——chunk 加载失败（场景：扩展 reload 后老 tab 仍持有旧 chunk hash 引用 / SW 重启 race / 离线）时自动 retry 1 次，仍败 → toast「扩展刚重载，请刷新当前页面（⌘R / F5）」+ state 退回 idle。**没这个兜底用户截图会静默卡死**——悬浮球已 hidden，无任何 UI 提示，必须刷页面才能恢复。SubmitDialog 的 ElementPicker 同款。

### Service Worker retry queue race 修 + 9 个新单测

`flushRetryQueue` 没 inflight 锁，并发场景（SW spin-up `onStartup` + 底部 IIFE + `onHistoryChanged` 同时触发）下两个 flush 都读到同一份队列、各自 fetch、最后 `set(remaining)` 互相覆盖——**成功的重试可能被覆盖回原状**。SW 30s 闲置回收+频繁唤醒，触发概率不低。

抽 `src/background/retryQueue.ts` + 加模块级 `flushPromise` 锁（`finally` 清，throw 也清避死锁）+ 9 个单测覆盖：并发共享 inflight / 4xx 丢 / 5xx attempts++ / ≥5 丢 / >1MB 不入队 / multipart 不入队 / >50 条 FIFO 裁旧 / QUOTA 降级 / throw 后锁释放。

### offscreen 录屏状态机抽纯函数 + 8 个新单测护栏

录屏链路 Playwright 也驱不动（chrome:// + tabCapture 手势），之前**完全没有自动化护栏**——这块代码改一行 race 就回来。把 `transition(from, to)` 抽到 `src/offscreen/stateMachine.ts` 导出 `canTransition` 纯函数，8 个 case 锁住合法迁移（idle→starting→recording→stopping→idle / cancel 路径 / 跨级非法拒绝 / stopping 单向）。

### shadow DOM token 反扫（49 hex/rgba 命中 → 18 转 / 10 新 / 21 注释）

v0.1.12「暗色硬编码扫尾」只扫了 4 处已知点。这次全 src/ rg 反扫 49 命中：

- **18 处转 token**：玻璃面板 ball/menu / `#fff` → `var(--moo-c-brand-fg)` / scrim / focus ring / success halo / 3 处不必要的 `var(..., fallback)` 兜底
- **10 个新 glass token**（`--g-bg-deep/-light` + `--g-border-deep/-light` + `--g-sh-deep/-hover/-drag` + `--g-sh-light/-hover/-drag`）加在 `src/content/styles.ts` 的 `.moo-root` 本地，**不进 tokens.css**——shadow 世界专属 + 不跟随 `prefers-color-scheme`（content 叠任意宿主页跟着系统切深色会跟宿主主题打架）
- **21 处故意硬编码全加/补注释**：Annotator 画笔色 + canvas 像素色 + 品牌 logo 渐变 + chrome.action badge API + passwordMask 宿主页 inline 等

下次再扫到「这个 hex 为啥不走 token」的时候，注释会直接说明 why。

### `useToast` composable 收口 4 处 toast + 修 timer 泄漏

Settings / History / Environment / ContentApp 复制了同款 toast/toastKind/toastTimer/showToast 8 行壳子，且**都没 `onBeforeUnmount` 清 timer**——切 tab 时会泄漏。

抽 `src/composables/useToast.ts`（泛型 kind，默认 3 元 union；ContentApp 传含 `''` 的 4 元 union 兼容空态）+ 自清 timer。4 处使用点替换，视觉/CSS/duration **一行未改**。

### Annotator 小分辨率工具条变形修复

`.toolbar-row` 是 `display: flex` 但没 `flex-wrap`。工具行 6 工具按钮（带中文 label）+ 4 色板 + 3 线宽 ≈ 700px 最小宽度，窄屏（小笔电 / DevTools 半屏 / 高 DPR 缩放）直接撑爆 `.moo-toolbar` 的 `max-width: calc(100vw - 32px)`，被裁切看着像挤变形。

加 `flex-wrap: wrap + row-gap`（含 `.actions-right` 兜超窄屏 < 400px）+ `@media (max-width: 720px)` 藏掉工具按钮中文 label 只留 icon。

### MV3 消息错误"人话化"收口 + 文案 drift 修

`utils/messaging.ts` 的 `friendly` / `classify` 把 "Could not establish connection" 翻成中文，但只服务 `chrome.runtime.sendMessage`；devtools `Overview.vue` 用 `chrome.tabs.sendMessage`，逐字复制了一份——**且文案已经 drift**（messaging.ts 简版 vs Overview 带「⌘R / F5」提示）。

抽 export + Overview 复用，drift 收口到更具操作性的版本。`context-invalidated` 同步补「⌘R / F5」对齐风格。

### `retryQueue` facade 补全（storage key 字面量 4 处收口）

模块自己定义了 `RETRY_QUEUE_KEY = 'mooRetryQueue'`，但 Settings + background/index 都绕过直接读写这个字面量——4 处散落无编译期保护。补 `getQueueLength()` / `clearQueue()` 两个 facade export，所有调用点收口。`RETRY_QUEUE_KEY` 仍**不 export**，外部完全不知道 storage key 名。

### shadow 世界 dialog focus trap + ESC（a11y）

SubmitDialog + Annotator cancel-guard 都挂了 `role="dialog"`/`aria-modal="true"`，但没做 focus trap 也没 ESC 关闭，键盘用户 Tab 走得出 dialog 到宿主页。抽 `src/composables/useFocusTrap.ts`：

- 关键 helper `getActiveInShadowOrDoc()` 沿 `getRootNode().activeElement` + 嵌套 `shadowRoot.activeElement` 下钻——直接读 `document.activeElement` 在 shadow 内只返宿主 host，还原焦点会错位
- listener 挂 dialog 容器本身的 keydown 而非 document，**不污染宿主页**
- Tab/Shift+Tab 在 focusable 列表里循环；ESC 调 onEscape 不强制关（让组件决定）；unmount 恢复 previouslyFocused
- 应用到 SubmitDialog 主 dialog + Annotator cancel-guard 弹层

Annotator 主画布 toolbar 是 `role="toolbar"` 不是 dialog，**不加 trap**。

### release.mjs 全自动化（默认 --dry-run）

之前 `pnpm release` 只到打 zip + sha256，剩 tag/push/Gitee create-release/attach_files 全靠 release-captain.md 里贴 bash 让人复制。这次全吃进脚本：

- 默认 dry-run：build + zip + sha256 + 打印「会做啥」清单不真推
- `--publish`：真发；`--skip-build`：复用现有 dist；`MOO_RELEASE_FORCE=1` 旧逃生口保留
- Gitee 陷阱 1（POST 响应 JSON parse fail）封装：catch 后调 `list_releases` 按 tag 找 id 继续，不重 POST 避 400「该标签已经存在发行版」
- `GITEE_TOKEN` 全程仅 env 读取，不写盘 / 不进 commit / 不进 log；缺 token 时 `--publish` fail-fast
- owner/repo 从 `git remote get-url origin` 正则解析（兼容 https/ssh，fork 也能用）
- `package.json` / `manifest.json` 版本号强校验一致，不一致 fail-fast 而非默默改写
- Step 6/7（HANDOFF 同步 / 上上版归档 / 最终 commit）按 release-captain 约定**不代写**——是判断题，跑完打印「下一步」清单 + 提醒重置 token

下次发版：`pnpm release` 看 dry-run → `export GITEE_TOKEN=xxx && pnpm release --publish` 一条命令搞定。

**dry-run 后续 P1 修**：发版前 review 发现「dry-run」之前真跑 `pnpm build` + 真写 `release/*.zip` + `*.sha256`——名不副实代价高 + 污染 working tree。改完 dry-run 纯打印「会做啥」清单（含 build 命令、预期 zip 文件名、sha256 算法），耗时几十秒 → **0.18s**。同时加 git tag 已存在检查：dry-run 启动后立刻 `git tag -l v$VERSION` 看是否非空，非空 warn「⚠️ tag 已存在 → 先 bump package.json + manifest.json 再跑」——避免忘 bump 直接 `--publish` 撞 tag 已存在的 fail。

### 工程基础设施

- **4 个项目 subagent** 配置进 `.claude/agents/`：mv3-pro / vue-craft / lab-tester / release-captain，跟着 repo 走，每个 agent 各自带项目已知坑 + 工程约束，调用时不用每次提醒
- **HANDOFF 归档机制**：v0.1.7→v0.1.11 历史段挪到 `docs/handoff-archive/v0.1.x.md`，主文件只留当前未发 + 最近 1 版；release-captain Step 6 加约定下次发版自动归档
- **CHANGELOG 回补**：v0.1.7 / v0.1.8 / v0.1.9 / v0.1.10 四版历史从 HANDOFF 抠出补进 CHANGELOG（之前 HANDOFF 一旦 archive 历史就丢）
- **ONBOARDING.md** 团队入门指南补完：Team Tips（8 条规矩）+ Get Started（20 分钟跑通本地 + 报一条假 bug）

### 测试覆盖

136 → **161 单测**（+25 跨三批：retry queue 9 / offscreen state machine 8 / useToast composable 8）。Playwright E2E 13/13 全过（含 BodyViewer harness 走 file URL 加载不受新 `web_accessible_resources` 影响）。

## v0.1.12

### Shadow DOM token 走 tokens.css 单一来源

`src/content/styles.ts` 顶上原本硬编码一套 `--c-*` 跟 `tokens.css` 的 `--moo-c-*` 平行存在，已经偷偷 drift 两处（`--c-warn-fg` 一深一浅、`--sh-lg` 阴影 .12 vs .18）。

改造：vite `?raw` 把 `tokens.css` 当字符串导入 → 正则抓顶层 `:root {...}` 块嵌进 `.moo-root` → 144 处旧 `var(--c-*)` 用法通过 `--c-brand: var(--moo-c-brand)` 一族别名转新名，零业务改动。dark `@media` 块不抓——content 叠在任意宿主页上跟着系统切深色会跟主题打架，故意保持浅色。两处历史 drift 显式 override + 注释解释（shadow 叠在宿主页上需要更狠对比度）。代价：content script bundle 80→96 KB（tokens.css 全文嵌入），可接受。

### History 卡顿优化（不上虚拟列表库）

30 条 entry + 每条带 base64 缩略图，滚动时图片解码集中爆发卡。改造方法：CSS `content-visibility: auto` + `contain-intrinsic-size: 0 80px` 让浏览器跳过视口外行的 layout/paint/image-decode；open 行不约束高度（detail 区域高度变化大）。`<img>` 顺手加 `loading=lazy` + `decoding=async`。比上 virtual-list 库简单 10 倍，零 JS。

### Playwright E2E + CI 接入

之前测试只到 vitest 单测层；这版补 Playwright，**真起 chromium、真加载 dist 当 extension、真跑 SW**：

- `tests-e2e/popup-recent.spec.ts`（3 case）/ `badge.spec.ts`（4 case）/ `body-viewer.spec.ts`（6 case），13 case 14s 跑完
- BodyViewer 平时挂 DevTools panel 里测不到，做了独立 `body-viewer-harness.html` 给 Playwright 直接挂
- CI `.github/workflows/ci.yml` 新增并行 `e2e` job，`pnpm exec playwright install --with-deps chromium` 装好后 `pnpm test:e2e`，失败上传 trace artifact 保 7 天

⚠️ 仓库主在 gitee，workflow 仅在 mirror 到 github 副本时生效；CI 是为以后准备的基础设施

### `useAutoSave` 补 10 个单测

之前只靠 Settings / Environment 间接验证。补单测覆盖：inflight 计数防 saving↔saved 来回闪 / `savedDisplayMs` 衰减 / `flush()` 跳防抖 / error 路径 / debounceMs:0 走 doSave。Node 环境 + Vue lifecycle hack：`vi.mock('vue')` 把 `onBeforeUnmount` 换 no-op、`vi.stubGlobal('window', ...)` 转发 setTimeout、`flushMicrotasks` helper 处理 fake timer 不 flush microtask 的坑。测试总数 126 → 136。

### 失败横幅去重复重试按钮

横幅里塞了「重试」按钮，跟 footer 那个「重试 ⌘↵」视觉冗余——用户反馈截图直接指出来的。改：横幅纯信息态（⚠ + 原因 + 录像额外提示），操作一律走 footer。删 `.moo-submit-fail-actions` CSS。

### 附带元素「清空」按钮加两步确认

挑元素是有成本的工作（每个 DOM 节点要在页面里找到再点），整批一键清空丢光得不偿失。给「清空」按钮加两步确认：第一次点 → 按钮变红 + 文字「再点一下确认清空」+ 1s 节奏微弱脉动；3 秒内再点 → 真清；3 秒过期 → 自动复位。元素只有 1 个时直接清，不浪费 friction。单个 × 删除维持原状不加（重选一个成本低）。

### Settings / Environment 走同一个自动保存范式

抽出 `src/composables/useAutoSave.ts` 收口防抖 + saveState 状态机 + 错误回调，两个 Tab 不再各自维护 inflight 计数 / debounceTimer / savedHideTimer / onBeforeUnmount 清理这些样板代码。

- Environment 高频键入（payloadTemplate textarea）：`debounceMs: 800` + draft 中间层
- Settings 显式 commit（toggle click / blur）：`debounceMs: 0` 立刻保存但走统一状态机
- **顺手修了 Settings 没用 `useConfig()` 的隐藏 bug**：之前 Environment Tab 改了配置，Settings Tab 不跟着刷新；现在两边都监听 `onConfigChanged`

### `<MooCloseBtn>` 共享组件

3 处关闭 X 按钮（SubmitDialog dialog 关闭 / 元素移除、PayloadEditorModal 关闭）统一封装为 `src/components/MooCloseBtn.vue`。`.moo-close-btn` 类在 tokens.css 和 content/styles.ts 都已定义，组件只输出标准 markup。

### 录屏失败恢复 UX：内嵌持久横幅 + 一键重试

之前的失败 UX：dialog 不关，外层 toast 弹一闪——用户错过了消息就只能去 History tab 找记录手动重提，多一步上下文切换。带录像的更难：body 太大不进 background 重试队列，必须手动操作。

现在 SubmitDialog 失败时 footer 上方挂持久横幅：失败原因 + 重试按钮（等同 footer「提交」），footer 提交按钮文字也变「重试」。带录像 + 没入重试队列时多一行明确提示「关窗后只能去 历史 Tab 找记录重提」（`cannotAutoRetry = !!video && !res.queued`）。横幅可被 × 关闭；用户改完表单再点提交时也自动清掉。

### 暗色硬编码扫尾

4 处散落 hex 全部 token 化，新增 3 个 token（含 light + dark 变体）：
- `--moo-c-scrim` —— modal/dialog 背后的半透明 backdrop（替换 ConfirmModal / PayloadEditorModal 的 `rgba(15,23,42,.5)`）
- `--moo-c-row-hover` —— 列表行 hover 极轻底色（替换 Settings 手写的 light/dark 两套 rgba，删 prefers-color-scheme 媒体查询）
- `--moo-c-bg-inverse` —— 反相小色块（替换 History 视频缩略图占位 `#0f172a`，深色模式下从纯黑变 slate-600 避免融为一体）

### 按钮样式系统化（欠 3 版的债）

Environment / Overview / History 各自留着的 `.btn / .danger-btn / .icon-btn`（命名不一致、尺寸 26 / 22px 也不统一）全迁到 tokens.css 的 canonical `.moo-btn` + 修饰符（28 / 24px）。

新增 canonical 类：
- `.moo-icon-btn` —— 28×28 SVG 方形容器（给 Overview toolbar 真正的 svg 图标按钮）
- `.moo-icon-btn--toggle-on` —— toggle on 态，品牌色软背景
- `.moo-icon-btn--danger` —— 危险动作图标按钮
- `.moo-icon-btn-pulse` —— 状态指示小光点，定位在 icon-btn 右上角

视觉影响：Environment 按钮 +2px 高（26→28 / 22→24），属于「系统化」预期内的对齐。删干净三个 Tab 各自 scoped 的按钮 CSS 共 ~120 行。

### Overview body 区彻底改版（JSON viewer）

Request/Response Body 段原本只是个 `<pre>` + body 内搜框 + max-height 滚条。改成 `BodyViewer` 组件：

- **JSON 自动检测 + 格式化 toggle**：body 起头是 `{` / `[` 就尝试 `JSON.parse`；成功就默认 pretty-print 显示。toolbar 上「格式化 / 原文」可切，方便比较纯文本和 indented 形态
- **JSON 语法染色**：key / string / number / bool / null 各自颜色（key 蓝、string 绿、number 橙、bool 品牌色加粗、null 灰斜体）。靠 token regex + escape 出 HTML 走 `v-html`，性能比一堆 `<span v-for>` 好很多
- **大 body 折叠**：>3000 字符默认只渲染前 2000 字符 + 「展开剩余 X K 字符」按钮。>200KB 直接不尝试 JSON parse / highlight（避免主线程卡）
- **复制按钮**：toolbar 上一键复制（格式化态复制 pretty 文本，原文态复制原文）
- **size chip**：左上角始终展示 body 大小（B/KB/MB），响应体优先用抓包记录的 `responseSizeBytes`
- 注：body 内搜索框继续走 Overview 顶部那个，BodyViewer 通过 `:search` prop 接，叠在 JSON 染色之上不会破坏 span 边界

### 错误 stack 染色

错误行展开后 Stack 段原本是 raw 文本。新版按行解析 `at fn (file:line:col)` / `at file:line:col` / `fn@file:line:col` 三种主流形态：函数名加粗、文件路径中灰、`:行:列` 弱灰。一眼能找到调用栈的核心信息。

### Popup 新增「最近提交」区

popup 底部加一段 history 摘要：

- 第 1 条：prominent 卡（标题 + 项目 + 时间 + 状态 chip），点击在新 tab 打开当时出 bug 那个页面
- 第 2-3 条：compact 行，点击同上
- 状态 chip 覆盖：失败 / 重试中 / 已提交 / 待处理 / 处理中 / 完成 / 已删 / 已删除
- 没历史则整段不显示

### Toolbar 图标 badge

扩展图标右下角红色 badge，显示最近 24h 内提交失败的条数。失败 = `result.ok === false`（含网络错 + 4xx + 5xx）。>99 显示 `99+`，0 隐藏。

- 触发刷新：每次 `submitBug` 后、SW 启动时、history 任何变化时（`onHistoryChanged`）
- 24h 老数据会自然衰减，无需手动清

### 请求列表染色升级

请求/错误列表（Overview Tab + 提交弹窗）原本只有 method + status chip 颜色。这版加两维度，扫一眼就抓到坏请求：

- **行级失败强调**：4xx 整行左边 3px 橙色色条，5xx + 网络错红色色条。chip 标点、色条扫面，互补
- **慢请求 duration 染色**：≥1s 橙字加粗，≥3s 红字加粗。200 但 5s 也是问题，光看 chip 看不出来

实现位置：`src/devtools/tabs/Overview.vue`（DevTools 面板）+ `src/content/styles.ts` + `src/content/SubmitDialog.vue`（提交弹窗）。两边用同一套语义类（`is-warn` / `is-err` / `dur--slow` / `dur--xslow`）。

### Overview Tab 错误信息人话化

之前 `chrome.runtime.sendMessage` 失败时直接把 Chrome stock 错误原文塞到顶栏，比如 「Could not establish connection. Receiving end does not exist.」。99% 是扩展刚重载完、宿主页内容脚本还没注入。新版翻译为「扩展刚重载过，当前页面的内容脚本还没注入——刷新一下当前页面（⌘R / F5）就好」。顺手把另一条常见的 message port closed 也翻了。

### 新增快捷键：`Alt+Shift+M` 打开 Moo popup

之前打开 popup 必须点扩展图标。现在快捷键直接调起，键盘流不用碰鼠标。

- 注册在 `manifest.json` commands 里，描述：「打开 Moo 控制面板」
- 实现走 `chrome.action.openPopup()`（MV3 Chrome 99+ 可用）
- ⚠️ Chrome MV3 限制：**不能**用 API 直接打开 DevTools 或跳到 DevTools 里某个面板。这快捷键开的是 toolbar popup，不是 DevTools Moo 面板——后者只能 F12 手动开

## v0.1.11

### BREAKING：token 从 header 改 POST body

以前：扩展上报时自动注 `Authorization: Bearer {token}` + `X-Scaffold-Token: {token}` 两个 header，后端读 header 校验。

现在：token 走 POST body 的 `token` 字段（webhook 风格）。扩展不再注任何鉴权 header，后端从 body 读 token 校验。状态回查（`/status-public`）也从 GET 改 POST，token 同样在 body 里——URL 完全不沾 token。

**升级清单**：

1. **后端**：从 body 读 token（不是 header）。`moo-scaffold` 包需同步升级到本次配套版本（`authenticateWithReason` 改成读 `$req->json('token')`，状态回查路由从 GET 改 POST）。自写后端的同事改两行：
   - `req.body.token` 校验
   - `/status-public` 路由从 GET 改 POST，从 `req.body.token` 校验

2. **现有 history 条目**：老 entry 的 `remoteHeaders` 字段不再使用（已从类型删除），storage 里残留无害。

### 其它

- `src/utils/remoteHeaders.ts` 删除 `pickPropagatedHeaders`（保留 `parseRemoteId`）
- `src/background/index.ts` 删除 `applyAuthHeaders` 函数和所有调用
- 默认 Payload 模板（`DEFAULT_PAYLOAD_TEMPLATE`）顶部加 `"token": "{{token}}"`
- 服务端集成文档 `docs/SERVER_INTEGRATION.md` 整段重写为 webhook 风格
- UI 提示文案（环境 Tab 项目 token 字段下方）同步改写
- 单测 105 case 全过

## v0.1.10

### 一堆边缘 case 补完 + 换 logo

- 录屏中切 tab 悬浮球不消失：`refreshProject` fallback 保留旧 matches，避免短暂"没匹配项目"导致悬浮球闪掉
- 录屏边缘 case 全覆盖：Chrome 自带的"停止共享"条点击、同 tab navigation 后恢复录制状态
- 悬浮球 `onMounted` 也走 clamp，不再被推到视口外；clamp 算尺寸用对了常量（之前用错值会越界）
- 录像视频预览黑屏修：dataUrl 超 Chrome 上限改用 blob URL
- `useRequests` 用 `DEFAULT_REDACT` 兜底，修早期请求未脱敏漏洞（用户配置脱敏规则之前就抓到的那段空窗期）
- logo 换成 f44 黑鹰头 + 黄色 reticle 眼。这版定稿，**不要再换**

## v0.1.9

### 工程基础设施 + 录屏底盘重构

- **CI**：GitHub Actions 跑 `type-check + test + build`（`.github/workflows/ci.yml`）
- **Pre-commit**：simple-git-hooks 跑 `pnpm type-check && pnpm test`，commit 前自动 gate
- **单测**：vitest + 100+ case，覆盖 clone / redact / submitMessage / history / normalizeProject / parseRemoteId / template（`test/*.test.ts`）
- **类型严**：开 `noUncheckedIndexedAccess`，修 108 处
- **录屏重构**：`src/offscreen/` 状态机重构修了多个 race；rec-bar 任意 tab 都能显示；视频预览改 atob 绕宿主 CSP
- **权限窄化**：`tabCapture` 改 optional permission，首次录屏才 `chrome.permissions.request()` 弹窗
- 撤掉 background 里的 `console.error` monkey-patch（之前会污染扩展错误页，所有插件错误都被吃掉/重写）
- `Settings.vue` 移除 `(Switch as any).props` 反 pattern
- `messages.ts` 强类型 dispatch，新增 message 要把所有 handler 补齐才能过编译

## v0.1.8

### 安全 + 数据健壮性大扫除

- normalize / import 边界硬化，`applyAuthHeaders` 大小写敏感修，`sanitizeHeaders` 拦 CRLF 注入
- `parseRemoteId` 字符集校验，`renderTemplate` JSON-escape
- `storageKeys` 白名单 + Unicode 同形字符防御
- `ElementPicker` 抹 password、`dataUrlToBlob` guard、`sender.id` 校验
- 卡顿优化 4 项、消息协议契约 4 项、`JSON.parse` null 防御、XHR url 非 string 防崩
- `pickTokenHeaders` defense-in-depth、`ElementPicker` mousemove 改 rAF coalesce
- release / 打包安全收口

## v0.1.7

### UX 收尾（Batch 3）

- focus ring 改 token
- 暗色 brand + 状态点 halo 修
- 文案再去黑话动词统一
- z-index / 窄宽溢出 / popup a11y
- 模板防御性兜底
