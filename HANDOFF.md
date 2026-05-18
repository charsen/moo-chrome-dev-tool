# 交接

> 写给明天接班的同事。读完知道现在到哪、有什么坑、下一步该干嘛。

## 一句话现状

v0.1.11 已发。最后一版做了一次架构纠偏：**token 从 header 移到 POST body，扩展退回 webhook 客户端的本分**。之前十个版本一直用 `Authorization: Bearer` + `X-Scaffold-Token` 两个 header，把扩展跟 scaffold 后端绑死了；其实 token 走 body 字段就够，跟 webhook 一样——扩展不该假设后端长啥样。**这是 BREAKING 变更**，详见 CHANGELOG.md。

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

## 现在最值得做的下一件事

按价值排序：

1. **按钮样式系统化**（欠了三版的债）。`.moo-btn` 在 `src/styles/tokens.css` 有正规一套，但 `Environment.vue`、`Overview.vue`、`History.vue` 还各自留着 `.btn` / `.danger-btn` / `.icon-btn` 旧类，命名不一致。建议单 PR 统一到 `.moo-btn` + 修饰符。
2. **暗色硬编码扫尾**。Batch 3-B 把 brand 和 halo 都 token 化了，但各 Tab 内还可能有零散硬编码颜色。建议实机走一遍深色模式截图回看，把剩下的 hex 替换成 token。
3. **录屏失败恢复 UX**。Pass 4 加了重试队列，但录屏失败的提交仍需用户手动到「历史」点重新提交。可以做一个明显的失败提示 + 一键重试，少一步用户认知成本。

不急的：
- 多 server 时附件元素 × 删除按钮加二次确认（故意没加，可重新评估）
- `<MooCloseBtn>` Vue 组件（关闭按钮现在只统一了 CSS）
- Settings 和 Environment 走同一个自动保存范式（Environment 用 draft 中间层，Settings 直接 v-model）

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
