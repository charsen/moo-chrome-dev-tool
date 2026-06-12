# 发版前真机实测清单

> 每次 BREAKING / 大改提交链路的版本，**push 之前**走一遍。
> 自动化覆盖不了的部分：CORS 预检、真实 chrome-extension 跨域、multipart 上传、SW fetch 重试、UI toast 文案。

## 🤖 自动化护栏（已落地，正常 push 都会过）

`pre-commit` 跑：`pnpm check:versions && pnpm type-check && pnpm test`
`CI` 跑：版本一致 / type-check / 单测 / build / bundle size / pnpm audit (warn-only)
`pnpm release --publish` 自动跑：**e2e**（v0.5.1 加 — 默认必跑，紧急 hotfix 可 `--skip-e2e`）+ build + zip + sha256 + tag + push + Gitee API

这些**机械问题**（版本号漂移 / 依赖漏洞 / bundle 爆涨 / e2e 回归）由脚本守门。下面 checklist 聚焦**机器逮不到的真功能问题**。

## 📅 dogfood 节奏（v0.5.1 明文）

prerelease 流程 v0.4.6 已废。当前节奏：

- **每个 minor 版本**（v0.5.x / v0.6.x …）发版后，同事 dogfood 一周内反馈，hotfix 累成下个 patch 一起发
- **每天最多 2 个 patch**（防同事升级疲劳；v0.4.x 一天 7 版是清 debt 高峰，不是常态）
- **紧急 fix**（同事真踩 bug）可立即发 patch，commit message 明示「dogfood hotfix」
- **重大变更**（架构 / 权限变化）必走 dogfood ≥ 几天，详见 `docs/PLAN_v1.0.md`

## 🧑‍🤝‍🧑 大团队 review（每次发版必跑）

**v0.4.4 后立项**：发版前必跑一次 `/full-team-review` —— 3 个 agent 并行（mv3-pro / vue-craft / general-purpose）扫整仓库找问题。

```
（在 Claude Code 里）
/full-team-review
```

Agent 会出按严重度排序的问题清单。**任何 🔴 严重问题必修才能发版**。
🟡 中等可选修；🟢 小问题列 backlog。

v0.4.4 首跑战绩：4 严重 + 7 中等 + 一堆小问题，全修后单测 339 → 356，发现 MV3 安全漏洞 / dark mode 硬编码 / 文档版本误导 / setTimeout leak 等单靠 dogfood 看不出的问题。

## 怎么用

- MCP 能测大半，但**user gesture 触发的 API（permissions.request / tabCapture）驱不了**（分工见 `docs/MCP_TESTING.md`：chrome-devtools MCP 连 `--remote-debugging-port=9222` 的真 Chrome 可以驱真扩展 + SW）——本清单聚焦 MCP 也兜不住的那部分，人肉跑
- 人肉跑：把 `pnpm build` 出的 `dist/` 重新加载到 Chrome（`chrome://extensions` → Moo → 「重新加载」）
- 全绿才 `pnpm release` + push；任何一条红就回去修
- SW DevTools 路径：`chrome://extensions` → Moo 卡片底部「service worker」蓝字 → 打开 → console / 网络 Tab

## dogfood / 测试装扩展的两条路（重要）

**路 A — 装 release zip（推荐 dogfood 长期使用）**

每次发版后从 gitee releases 下 `moo-chrome-dev-tool-x.y.z.zip` → 解压到**独立目录**（不要解压到项目内）→ chrome://extensions 「加载已解压的扩展程序」指向解压目录。

✓ 优点：chunk hash 与该次 release 永久对齐，不会被后续 `pnpm build` 覆盖。
✗ 缺点：每次想升级要重下 zip + 删旧装新。

**路 B — 装项目 dist/ 目录（仅短期开发）**

chrome://extensions 「加载已解压的扩展程序」指向 `<repo>/dist`。

✗ **陷阱**：vite 每次 `pnpm build` 会**重生成 chunk hash**（`assets/index.ts-XXXX.js`），旧文件被删。已经打开的 page 上 content script 引用的是 build 时刻的 chunk URL，build 之后老 page 一刷新就 `Failed to fetch chrome-extension://.../assets/index.ts-OLDHASH.js` → host 不创建 → 悬浮球消失。

**症状识别**：DevTools console 出现 `TypeError: Failed to fetch dynamically imported module: chrome-extension://...assets/index.ts-<hash>.js` 且 `__moo_dev_tool_host__` 不在 DOM。

**修复**：chrome://extensions Moo 「重新加载」+ 所有已打开 tab 刷新。或干脆走路 A 用 release zip。

## v0.7.x 必走的 fresh install 手测链路（自动化驱不了）

v0.7.0 dynamic register + v0.6.0 optional_host_permissions 之后，**fresh install 流程靠 e2e 验不了**（playwright 给不出 user gesture 让 chrome.permissions.request work，lab-tester 8 审 5 路径调研已确认）。已有 e2e：
- E1/E2/E3（API 契约层）：验 chrome.scripting.registerContentScripts 调用契约
- R1/R2（真链路层，v0.7.4）：用 mandatory manifest cpSync 绕 user gesture 验 grant 后全链路

**仍需手测**（每次涉及 popup banner / host_permission / content script 注入 链路变更必跑）：

1. 移除 chrome 里旧的 Moo unpacked 实例（防权限缓存干扰）
2. 解压新版 zip → chrome://extensions 「加载已解压的扩展程序」装
3. **预期**：popup 弹「升级 — 上报功能需要重新启用」banner（红色）
4. 点 banner「一键启用上报功能」按钮
5. **预期**：chrome 原生弹窗问「Moo Dev Tool 想要：在所有网站上读取和更改您的数据」
6. 点「允许」
7. **预期**：banner 消失，popup「✓ 已启用」（绿 dot）
8. 访问任意配过 matchPatterns 的页面 → F5 刷新
9. **预期**：右下角悬浮球出现（黑色雕鸟 + 截图按钮 + 录屏按钮）
10. F12 console 看：无 `Denying load` / `chrome-extension://invalid/` / `Failed to fetch dynamically imported`

**任何一步偏离预期 = 红 = 不能发版**。v0.7.1 装上即炸 P0 就是这条链路上的 silent 回归（自动化没覆盖到，dogfood 时才撞）。

### v0.7.4+ 手测项追加（涉及 popup / 工作区 / 更新链路必跑）

11. **悬浮球当前页 toggle（v0.7.4）**：popup footer「悬浮球（host）」开关点击 → 当前页悬浮球立即消失 / 恢复（< 50ms）。chrome:// 等无 host 页 → toggle 显「(当前页面不支持)」disabled。
12. **工作区浮窗（v0.7.4）**：popup「⚙ 打开工作区（独立浮窗）」按钮 → 弹独立 760×720 chrome window → 4 Tab（概览/历史/环境/设置）可切，brand-meta 显「📍 host」。
13. **popup 4 角圆角（v0.7.4）**：macOS chrome 113+ popup 4 角圆角对齐内部 dark 块，Windows/Linux chrome 方角时内部块仍圆。
14. **版本检查 chip + 工作台「检查更新」（v0.7.5）**：popup 头部版本号 `v0.x.x` chip 点击 → 600ms spinner →「✓ 已是最新」高亮 2.5s → 回原。工作台 brand 区「⟳ 检查更新」按钮同款。
15. **chrome.runtime.reload() 升级链路（v0.7.5）**：人工模拟「有新版」场景（手动写 `chrome.storage.local.set({mooLatestVersionInfo: {...}})` 或回滚到老版本让 SW alarm 触发）→ popup banner 出现「3 步升级」+ 点「③ 重新加载」按钮 → 扩展真重启（manifest 重读 + SW 重启）。**录屏中点 reload 应弹 confirm 防丢**（mv3-pro P0 修过）。

### v0.7.6 必走手测（lab-tester 14 审建议）

playwright e2e 物理驱不动的真用户场景，必须手测兜底：

16. **🔴 旗舰 P0：配 matchPatterns 后已开 tab 立即出悬浮球**（v0.7.6 backfill 闭环）：
   - 装 v0.7.6 → 任意业务页已经开着 → 工作台「环境」配 matchPatterns
   - **不刷新 tab + 不 reload extension** → 悬浮球 ≤ 3s 内出现
   - 反 case：reload extension 后**也不刷新 tab** → 悬浮球**重新**出现（孤儿 host 重建链路）
17. **popup 版本 chip 检查更新真链路**：点 chip → spinner ≥ 600ms → 「✓ 已是最新」绿色高亮 2.5s →（实测真 fetch Gitee API，不是 mock）
18. **录屏涟漪 + 点击标记**：⌥⇧R 启录 → 真鼠标点击 → 视频里看红圈涟漪 + 落点
19. **工作台浮窗 brand-meta 「📍 host」**：popup 点「⚙ 完整配置」→ 浮窗 brand-meta 显示当前 chrome 主窗口 active tab 的 host（不是浮窗自身 chrome-extension）
20. **popup「悬浮球（host）」toggle 跨 tab 一致性**：popup 点 toggle → 当前 tab 悬浮球消失，**另开一个 host 不同的 tab** → 悬浮球出现（toggle 只藏当前 host）
21. **升级闭合「✓ 已升级到 vX.Y.Z」toast**：手动设 `chrome.storage.local.set({mooUpgradeIntent:{expected:'0.7.6',at:Date.now()}})` → reload extension → popup 开 → 看到绿色「✓ 已升级到 v0.7.6」3s 自动消

## 自动化测试（chrome-devtools MCP / playwright MCP）注意

- 悬浮球用 pointer 事件自实现 click 判定（防 drag 误触）。CDP `click` / `click_at` 合成事件**可能触发不了**截图按钮 —— v0.3.0+ 已加 dragEndedAt 时间窗（250ms 之外的合成 click 放过），但极快连击仍有打架。如自动化遇「click 报 success 但 Annotator 不弹」，先确认 host 已创建、再尝试隔 300ms 重试。
- CDP `fill` 对 closed shadow root 内 textbox 设置 `input.value` **不触发 Vue v-model input event** → Vue 内部 state 不更新 → 提交时拿到的是 v-model 原值。解决：自动化需用 `dispatchEvent(new Event('input', { bubbles: true }))` 显式触发。

## v0.1.x 时代发版 checklist（历史 reference，v0.4.x 已不按此跑）

> ⚠️ **下面的 v0.1.11 / v0.1.12 表格化 checklist 是 v0.1.x 时代逐项手填的发版护栏**。v0.4.x 起实际发版走「pre-commit 自动化 + `/full-team-review` + 双 MCP 分断面（上面段已规定）」，不再按下面表格逐项核对。
>
> 保留只作 ① 历史参照 ② 极端情况下需要回归到「逐项手填」时仍能照抄表格结构。

## v0.1.11 BREAKING — webhook 化基线

| # | 场景 | 操作 | 期望 | ☐ |
|---|---|---|---|---|
| 1 | 默认模板 happy path | 业务站 A 新建项目 + 新建 server + 默认模板 → 悬浮球截图 → 写标题 → 提交 | toast「提交成功 (HTTP 200)」；历史多一条；scaffold todos UI 能看到 | ☐ |
| 2 | 带录屏 JSON 提交 | 同 #1 但 `⌥⇧R` 录 5 秒再截图提交 | 200；后端能解出 video（dataUrl 形态）| ☐ |
| 3 | multipart 模式 | 把 server 切到 `multipart`，重提一遍 #1 | 200；scaffold 收到的 token 在顶层 form 字段；截图是 file 字段 | ☐ |
| 4 | 状态回查 POST | 提交一条 → 在 scaffold todos UI 把状态改成「处理中」→ 回扩展「历史」Tab 点「同步状态」 | toast「已更新 N 条」（N≥1）；条目状态变成「处理中」| ☐ |
| 5 | 登录态下提交不撞 CSRF | 浏览器**先**登录 `app.example.com/scaffold`（拿到 session cookie），**然后**在同域页面用扩展提交 | 200，不出现 419；证明 webhook 接口拆出 group 生效 | ☐ |
| 6 | 跨 engine 后端 | 业务站 B 对应 accounts.yaml 加你账号 token → 重启站 B 后端 → 扩展项目 endpoint 改 `app2.example.com/scaffold/todos/intake` → 提交 | 200；证明同份 moo-scaffold 在不同 engine 都跑通 | ☐ |
| 7 | 网络异常 + 重试 | 关掉后端进程 → 提交一条（无录屏）→ 等 toast → 等 5 分钟后看 SW console 是否自动重试 | toast 形态是「提交失败：Failed to fetch」，加一行「已加入重试队列」；5 分钟后 console 看到重试动作 | ☐ |

## v0.1.12 — 染色 + 快捷键

| # | 场景 | 操作 | 期望 | ☐ |
|---|---|---|---|---|
| 8 | 失败行左色条 | 故意触发一个 404（比如改前端请求路径） + 一个 500（后端 throw） → DevTools Moo 面板 Overview Tab 看那两行；再开提交弹窗看请求列表 | 404 那行左 3px 橙色条；500 那行左 3px 红色条；status chip 颜色不变 | ☐ |
| 9 | 慢请求 duration 染色 | 后端故意 `sleep(2)` 跑一个接口 → Overview 看那行；同样去提交弹窗看 | duration `2000ms` 显示橙色加粗；如果 `sleep(4)` 则红色加粗 | ☐ |
| 10 | `Alt+Shift+M` 开 popup | 任意网页焦点下按 `Alt+Shift+M` | toolbar popup 弹出来，显示项目匹配状态 + 录屏开关；第二次按再开会失败（已打开），SW console 有一行 warn | ☐ |
| 11 | JSON viewer · 格式化 + 染色 | 触发一个返回 JSON 的请求 → Overview 展开行 → 看 Response Body 段 | toolbar 显示「JSON」chip + 「格式化/原文」按钮；默认 pretty + 染色（key 蓝 / string 绿 / number 橙 / bool 加粗 / null 灰斜体）。点切到原文 = 单行紧凑。复制按钮可复制当前显示态文本 | ☐ |
| 12 | JSON viewer · 大 body 折叠 | 触发一个返回 >3KB JSON 的请求（比如 list API 一次拉 100 条） | body 区只显示前一段 + 底部出现「展开剩余 X K 字符」按钮；点了展开全文 | ☐ |
| 13 | 错误 stack 染色 | 在页面 console 跑 `setTimeout(() => { throw new Error('boom') })` → Overview 错误行展开 → 看 Stack 段 | 函数名加粗、文件路径中灰、`:line:col` 弱灰；不是平的一坨等宽字 | ☐ |
| 14 | popup 最近提交区 | 至少做过一次提交后开 popup（点扩展图标 / 按 `Alt+Shift+M`） | 底部出现「最近提交」section，第 1 条是 prominent 卡，往下最多 2 条 compact 行；状态 chip 颜色与含义匹配；点任意一条 → 新 tab 打开当时所在页面 url | ☐ |
| 15 | toolbar 图标 badge | 故意制造一次失败提交（endpoint 填错 / 401 token） | 扩展图标右下角出现红色 badge 数字 `1`；再失败一次变 `2`；去 History tab 删掉这两条，badge 应该消失（依赖 `onHistoryChanged`） | ☐ |

## v0.1.12 第二批 — refactor / 体验补完

| # | 场景 | 操作 | 期望 | ☐ |
|---|---|---|---|---|
| 16 | 按钮样式系统化（视觉一致） | 走一遍 Environment / Overview / History 三个 Tab，看所有按钮 | 同尺寸（普通 28px / 小号 24px）、同字号、同 hover 反馈；Environment 「+ 新建项目」「↓」「↑」按钮跟「+ 新建服务器」一套视觉；Overview toolbar 自动刷新 toggle 开启时品牌色软底；History 「清空」红字 | ☐ |
| 17 | 深色模式硬编码扫尾 | 系统偏好切到深色 → 打开 DevTools Moo 面板：① 删除项目时看 ConfirmModal 背景半透明 ② Settings 鼠标悬浮某一行 ③ History 提交带录像的条目看视频缩略图 | ① 黑色半透明 backdrop（不是纯黑 / 透明 / 过亮）② 行 hover 极轻提亮（不刺眼）③ 视频缩略图块是 slate-600 灰（不是纯黑融进背景，能看清是个「视频块」） | ☐ |
| 18 | 提交失败横幅 + 一键重试 | 故意把 endpoint 改成假 URL → 提交（不带录像）→ 看 dialog；按 footer「重试」（不改任何字段）；再把 endpoint 改对，按 footer「重试」 | 失败后 footer 上方出现红色横幅：「⚠ 提交失败」+ 失败原因（横幅纯信息，无操作按钮——避免跟 footer 重复）；footer「提交」按钮文字变「重试」；按重试时正确再发请求；改对后重试成功 → 横幅消失走成功视图。**再带录像跑一次**：横幅多一行明确提示「关窗后只能去 历史 Tab 重提」 | ☐ |
| 19 | Settings ↔ Environment 多 Tab 同步 | 打开 DevTools Moo 面板 → Settings Tab 看一下当前项目；切到 Environment Tab 改一下项目名（比如加个空格）；等 1 秒；切回 Settings | Settings 那边显示的项目名 = Environment 改后的；以前 Settings 读 loadConfig 一次性，不监听变化，会显示旧名（这一版应已修） | ☐ |
| 20 | 元素「清空」两步确认 | 提交弹窗里 → 「📍 选元素」挑 ≥2 个 DOM → 点「清空」一次 | 按钮文字变「再点一下确认清空」+ 变红 + 微弱脉动；3 秒不点 → 自动复位；3 秒内再点 → 真清；**单个元素时**直接清不走二步（避免单元素 friction） | ☐ |

## 失败处理

任何一条挂掉，**先抓现场再回退**：

1. SW console 截图：`chrome://extensions` → Moo → service worker → console → 截图后两屏（含 `[Moo submit-fail]` 那行）
2. 失败那条请求的「标头」+「响应」全文复制
3. 当时的网址（host page URL）和扩展 endpoint URL

把这三样给我，我能定位 90% 的问题。**不要**靠"再试一次也许就好了"——BREAKING 的失败往往可复现。

## 加新场景的时机

下次再有 BREAKING / 提交链路改动，往表里加新行。比如：

- 改了消息协议 → 加一条"老 history entry 反序列化不崩"
- 改了请求头 / CORS 策略 → 加一条"不同 chrome-extension origin 都通"
- 改了重试规则 → 加一条对应新规则的现场验证
- 改了字段约束（id 长度、status 枚举等） → 加一条边界 case

不要往里塞每版功能小改，那是单测的活；这表只关心**跨进程 / 跨域 / 真用户操作链路**的回归。
