# Changelog

> 时间倒序。**BREAKING** 表示装新版后老服务器（或反过来）会跑不动，需要同步升级两侧。

## v0.1.13

体验加速 + 护栏加厚 + 收口债务清理。**无 BREAKING**——任何后端接收侧无需配套升级。

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
