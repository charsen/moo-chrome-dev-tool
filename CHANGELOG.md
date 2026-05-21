# Changelog

> 时间倒序。**BREAKING** 表示装新版后老服务器（或反过来）会跑不动，需要同步升级两侧。

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
  openedBy: '13800000000',       // ✓ 真账号不是 system
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

**发版决策小记**（2026-05-21）：v0.2.0 是 feature 大版本，**主动跳过 dogfood ≥ 几天**——禅道集成已在 yourcompany.chandao.net 真实环境 dogfood 过完整流程（用户实测发现并修复 7+4 个 dogfood fix，见下文），全部场景闭环。3 条跳 checklist 标准只满足前 2（① 无 BREAKING ② 249 单测 + type-check + vite build 全绿），第 3 条 dogfood ≥ 几天**用户明示放行**。后续如有其他禅道版本回归，hotfix 走 v0.2.1。

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
- 真实环境 dogfood 通过：yourcompany.chandao.net 项目 26（测试项目，已清干净）

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
