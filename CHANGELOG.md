# Changelog

> 时间倒序。**BREAKING** 表示装新版后老服务器（或反过来）会跑不动，需要同步升级两侧。

## v0.1.12

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
