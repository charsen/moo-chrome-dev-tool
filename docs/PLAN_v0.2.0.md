# v0.2.0 计划 · 禅道集成

> 2026-05-21 探测会话产出 +（同日）P1 接手会话事实纠正。下一个会话直接读本文档接手即可。
> 测试用禅道实例：https://yourcompany.chandao.net
> 测试用项目：**ID 26**（用户已建好）

## 用户拍板的决策（2026-05-21 P1 接手会话更新版）

| # | 决策 | 含义 |
|---|---|---|
| 1 | **只做禅道**（不抽 Tracker adapter interface） | 单分支 if/else 即可，未来加 Jira/GitHub 时再抽象 |
| 2 | ~~Token 直配（不存密码）~~ → **B'：account+password 换 token** | **重要纠正**：禅道**没有**「在 UI 里点按钮自助生成永久 token」这条路（官方文档 zentao.net/book/api/2309 + 实测 yourcompany.chandao.net 顶栏用户菜单 11 项无 token 入口）。所谓「Token」是 `POST /api.php/v1/tokens` 或 `/api.php/v2/users/login` 用 account+password 换的临时 session token。用户拍板：接受存密码代价走 B'，密码本地 chrome.storage 存储（加密策略 P2 阶段定）|
| 3 | **请求 / 错误转禅道附件 + curl** | 上传 `requests.json` + `requests.curl.sh` + `errors.json` 三个附件，附 `moo-screenshot.png` + 可选 `moo-recording.webm` |
| 4 | **一个 Moo 环境绑一个禅道项目**，**product 不让用户配** —— 自动从禅道 form HTML 解析 | 用户只配 projectId |
| 5 | ~~Token header 走路径 A~~ → **B' 单骑**：account+password → SW 内缓存 token → 401 自动重换 | 详见下方「B' 路径流程」 |

## B' 路径流程（决策 2 / 5 落地形态）

```
用户 Moo Settings 输入
  baseUrl / projectId / moduleId / account / password
       │
       ▼  ① SW 启动 / token 不存在 / token 失效
  POST {baseUrl}/api.php/v1/tokens
  Header: X-Requested-With: XMLHttpRequest
  Body: {"account":"...","password":"..."}
       │
       ▼ 成功 → 缓存 { token, expiresAt? } in SW 内存（不进 chrome.storage，防 token 泄露面扩大）
       ▼ 失败 → return { ok:false, error:'登录失败' } → Settings 「测试连接」按钮显红
       │
       ▼  ② 提交 bug 时复用缓存的 token
  POST {baseUrl}/bug-create-0-all-projectID={pid},moduleID={mid}.html
  Header: X-Requested-With: XMLHttpRequest
          Token: {cached_token}
  Body: multipart (所有字段 + files[])
       │
       ▼ 401/{result:fail,message:登录已超时} → 清缓存 → 自动 retry 一次（重新走 ①）
       ▼ {result:success} → 完成
```

**密码存储要点**（P2 阶段实施时确认）：
- chrome.storage.local（不进 sync，避免上云）
- 不做用户态加密（chrome.storage 本身按用户隔离，附加加密只增复杂度无实际收益）
- Settings UI 输入框 type=password + 不回显原值（再次显示时显示 `••••••••`）
- 导入 / 导出配置时 password 字段一律剥掉，避免误传给同事

## 已实测确认的禅道 API（直接抄）

### 提交 bug 端点

```
POST {baseUrl}/bug-create-0-all-projectID={projectId},moduleID={moduleId}.html
Header: X-Requested-With: XMLHttpRequest    ← 关键，让响应回 JSON
        Token: {user_token}                  ← P1 验证：form 端点是否吃 Token header
Body:   multipart/form-data
```

| 字段 | 必填 | 值 | 备注 |
|---|---|---|---|
| `uid` | ✓ | 13 位 hex | `crypto.randomUUID().replace(/-/g,'').slice(0,13)`，绑附件用 |
| `product` | ✓ | 项目关联的产品 ID | 不让用户配，每次提交 SW 自己拉表单 HTML 解析 `<input name="product">` |
| `module` | ✓ | 0 | 配置项 `moduleId` |
| `project` | ✓ | 项目 ID | 配置项 `projectId` |
| `execution` | (空) | `""` | 无须填 |
| `plan` | (空) | `""` | 无须填 |
| `allBuilds` | ✓ | `"on"` | 写死 |
| `openedBuild[]` | ✓ | `"trunk"` | **magic value**，即使 allBuilds=on 也必填，否则禅道返「『影响版本』不能为空」 |
| `allUsers` | ✓ | `"on"` | 写死 |
| `type` | ✓ | `"codeerror"` | 配置项 `defaultType`，默认 `codeerror` |
| `severity` | ✓ | `"3"` | 配置项 `defaultSeverity`，1-4 |
| `pri` | ✓ | `"3"` | 配置项 `defaultPri`，1-4 |
| `title` | ✓ | bug 标题 | Moo 原 title 字段直传 |
| `steps` | 推荐 | HTML 富文本 | Moo 拼接：描述 + 环境 + 附件说明 |
| `assignedTo` | (可空) | account | 配置项 `defaultAssignedTo` |
| `color` | (空) | `""` | 写死 |
| `fromCase / caseVersion / result / testtask` | (空) | `"0"` | 写死，hidden 字段 |
| `fileList` | (空) | `"[]"` | 写死 |
| `case / story / task / feedbackBy / notifyEmail / contactList / keywords` | (空) | `""` | 写死，hidden 字段 |
| `files[]` | (可选) × N | Blob | 附件 multipart 字段名固定 `files[]`，可多个 |

### 响应

```json
// 成功
{"result":"success","message":"保存成功","load":"/project-bug-26.html"}

// 失败
{"result":"fail","message":{"openedBuild[]":["『影响版本』不能为空。"]}}
```

### 自动拿 product（discoverProduct 工具）

**新版禅道走 REST**：

```
GET {baseUrl}/api.php/v1/products?project={projectId}
Header: Token: {user_token}
```

→ 返回 `{page, total, limit, products:[{id, name, ...}]}`，单条返回。`products[0].id` 即默认产品 ID

→ Moo SW 内存缓存 24h（按 baseUrl+projectId 复合 key）

**老 form HTML 路径已废弃**：原计划是抓 `/bug-create-*.html` 正则解析 `<input name="product">` hidden input。2026-05-21 实测云禅道 biz12 用 zin 框架 SPA 渲染，72KB form HTML 里**完全没有** `<form>` 标签和 product input —— 表单状态在 JS state 里 hydrate。改走 REST。

### 拉项目列表（Settings UI 用）

```
GET {baseUrl}/api.php/v1/projects?limit=50
Header: Token: {user_token}
```

→ 返 `{page, total, projects: [{id, name, type, model, status, ...}]}`

→ 在 Settings 「📋 从禅道拉列表选」按钮里用，自动填 projectId

### 测试连接 / token 有效性验证

```
GET {baseUrl}/api.php/v1/user
Header: Token: {user_token}
```

→ 200 + `{profile: {id, account, realname, ...}}` 表示 token 有效；401/403 表示无效

## 实测确认的「坑」（写代码注释）

1. **`openedBuild[]='trunk'` magic value** — 项目没构建时也必须填
2. **REST API `/api.php/v1/projects/{id}/bugs` POST 不可用** — 200 但 bug 没建，原因待查；**不走 REST**，走 legacy form
3. **`X-Requested-With: XMLHttpRequest` 是 JSON 响应开关** — 不加这 header，禅道返完整 84KB HTML 页面，没法解析
4. **uid 必填** — 13 位 hex 即可
5. **product 必填但不让用户配** — 走 REST `/api.php/v1/products?project={pid}` 取 `products[0].id`
6. **`.sh` 附件被禅道改名 `.txt`** — 安全策略，attach 时 `requests.curl.sh` 或 `requests.curl.txt` 都行
7. **🆕 zin SPA 渲染**：biz12 用 zin 框架，form HTML 不带 `<form>` 标签，正则抓 hidden input 全废 → 走 REST
8. **🆕 Token header 路径下 form 端点响应空 body**：cookie 路径返 `{result:'success',load:'/bug-view-N'}`；Token 路径返 200 + 空 body（bug 已写入数据库）。client.ts 要兼容两种 + 用 list 拿 bugId
9. **🆕 `GET /api.php/v1/projects/{pid}` 403 "Access not allowed"**：但 list `/api.php/v1/projects` 列里有这个 project — 这是禅道权限模型 quirk，project 详情比列表更严。所以 `listProjects` 走得通，`/projects/{id}` 单条不行
10. **🆕 `/api.php/v1/tokens` 返 HTTP 201**（不是 200）— 这是 REST 风格的 created 语义，response 检查时不要硬编码 200

## P1 验证状态（2026-05-21 接手会话已做）

### 验证 #1：Token header 是否工作（结论：会过）

- **fake token + form 端点**：3 个变体（无 cookie / 带 cookie / 无认证）都返 `{result:false, message:"登录已超时", load:"login"}`，三响应完全一致 → 说明 form 端点看到 Token header 后**忽略 cookie 进入 token-only 模式**，fake 让它走 "token 无效→请登录" 分支（消息文案误导）。
- **cookie session + form 端点（无 Token header）**：实测 200 + `{result:'success',message:'保存成功'}` 创建 bug 成功（已删 9274）。说明 form 端点同时支持 cookie auth。
- **真 token 端到端**：**待 P1-④ 拍板**（需用户提供 account+password 跑一次 /users/login + 用换到的 token POST form 端点）。但 fake token 的 token-only 模式行为已经几乎能确认真 token 会过。

### 验证 #2：Token 入口（结论：禅道无自助生成 token UI）

实测穷举：yourcompany.chandao.net 顶栏用户菜单完整 11 项 menu = [个人档案 / 修改密码 / 使用教程 / 帮助 / 个性化设置 / 主题 / Language / 下载移动端 / 关于禅道 / 艾体验设计 / 签退]。**无 Token / 应用 / API 入口**。普通账号访问 `/admin-index.html` 显示「在此登记」即无管理员权限。

官方文档（zentao.net/book/api/2309）+ v2.0 详细文档（post-users-login-2142）确认：禅道的 token 一律走 `POST /api.php/vN/users/login` 用 account+password 换。无 PAT 概念，无 UI 自助生成入口。这是决策 2 改成 B' 的根因。

## 数据契约（Project schema 加 kind + zentao）

```ts
interface Project {
  // ...原字段不动
  kind: 'webhook' | 'zentao'     // 新增；normalize 时无 kind 默认 'webhook' 兼容老数据
  servers: Server[]              // kind='webhook' 时用
  zentao?: {
    baseUrl: string              // e.g. "https://yourcompany.chandao.net"
    account: string              // B' 路径：用户禅道账号
    password: string             // B' 路径：禅道密码（chrome.storage.local，不进 sync）
    projectId: number            // 必填
    moduleId: number             // 默认 0
    defaultSeverity: 1|2|3|4     // 默认 3
    defaultPri: 1|2|3|4          // 默认 3
    defaultType: string          // 默认 'codeerror'
    defaultAssignedTo?: string   // 可选
  }
}
```

**SW 内存里另存**（不进 chrome.storage）：
```ts
// 按 projectId+account 复合 key 缓存，提交时取出来用
type ZentaoTokenCache = Map<string, { token: string; createdAt: number }>
```

## 提交流（最终版）

```
SubmitBugReq (Moo)
       │
       ▼ ① discoverProduct（SW 内存缓存 24h）
   缓存命中 → 直接拿 productId
   未命中  → GET form HTML → 正则解析 <input name="product"> → 缓存
       │
       ▼ ② buildAttachments
   moo-screenshot.png    (base64→Blob)
   moo-recording.webm    (如果有，注意 50M 上限)
   moo-requests.json     (raw captured requests)
   moo-requests.curl.sh  (新工具 src/utils/curlGenerator.ts 产物，走 redact 脱敏)
   moo-errors.json       (raw console errors)
   moo-context.json      (URL / UA / viewport / timestamp)
       │
       ▼ ③ buildStepsHtml
   <h3>描述</h3><p>{description}</p>
   <h3>环境</h3><ul><li>URL: ...</li>...</ul>
   <h3>附件</h3><p>截图见附件，请求/错误明细见 *.json，curl 复现见 *.curl.sh</p>
       │
       ▼ ④ 一发 multipart POST
   POST {baseUrl}/bug-create-0-all-projectID={pid},moduleID={mid}.html
   Header: X-Requested-With: XMLHttpRequest
           Token: {token}
   Body:   multipart (所有字段 + files[])
       │
       ▼ ⑤ 响应处理
   {result:'success'}        → { ok:true, url: '{baseUrl}/bug-view-{从 load 提取 id}.html' }
   {result:'fail', message}  → { ok:false, error: 拼接 message 里所有字段错误 }
```

## 阶段拆分（6.5 天）

| 阶段 | 内容 | 估时 |
|---|---|---|
| **P1** | ✅ `src/utils/curlGenerator.ts` + 13 单测全绿 / `src/background/zentao/client.ts` **5 个方法**（login + ensureToken + submitBug + discoverProduct + ping + listProjects） / **P1-④：真 token 端到端拍板验证 #1**（用户给 account+password） | 1.5 天 |
| **P2** | Project schema 加 `kind` + `zentao` / `normalizeProject` 兼容老数据 / 单测 | 0.5 天 |
| **P3** | Environment Tab UI：kind 切换器 + ZenTao 字段表单 + 「测试连接」按钮 + 「从禅道拉列表」下拉 + 高级折叠 | 1.5 天 |
| **P4** | background `submitBug` 加 kind 分支 → zentaoSubmit / SubmitDialog 成功回调显示禅道链接 | 0.5 天 |
| **P5** | retryQueue 适配：整条 multipart POST 作为一个重试单位 / 单测 cover token 失效 / discoverProduct 失败 / 200-fail / 网络失败 | 1 天 |
| **P6** | `host_permissions` 动态申请（baseUrl 填好时一次性 chrome.permissions.request，类似 v0.1.9 tabCapture） | 0.5 天 |
| **P7** | E2E（zentao-harness mock form 端点）+ dogfood ≥ 2 天 + 写 `docs/ZENTAO_SETUP.md` 用户手册 | 1 天 |

## 用户手册大纲（docs/ZENTAO_SETUP.md，P7 写）

```markdown
# Moo × 禅道接入手册

## 1. 拿你的项目 ID
   方式 A · 自动（推荐）：
     - Moo Settings 里填好「禅道地址 + 账号 + 密码」后，点「📋 从禅道拉列表选」
     - 下拉里挑你的项目，自动填 projectId
   方式 B · 手动：
     - 浏览器进禅道 → 打开你的项目首页
     - 看 URL：`https://你的禅道/project-index-26.html`，数字 26 就是项目 ID

## 2. 在 Moo 里配
   - chrome.action 点 Moo 图标 → F12 DevTools → Moo 面板 → 环境 Tab
   - 新建项目（或编辑已有），URL 规则填你常用站点
   - 上报方式选「禅道」
   - 填五个字段：
     - 禅道地址（带 https://，不带 trailing /）
     - 禅道账号（同浏览器登录用的）
     - 禅道密码（同上；Moo 只存本设备本浏览器，不上传 / 不 sync）
     - 项目 ID（步骤 1 拿到的）
     - 模块 ID（一般 0）
   - 点「测试连接」→ 看到「已登录为 {你的名字}」就好了

   **关于密码存储**：Chrome 扩展用 chrome.storage.local 存配置（按用户隔离 + 不上 Chrome Sync），跟其他扩展隔离开，外部代码读不到。Moo 选择不再做二次加密 —— 加密了真没说不存还是存了，对实际安全没改善，反而让用户以为更安全；坦白告诉你「就存本地明文」更诚实。

## 3. 第一次提交时会弹权限申请
   - Chrome 会问你是否允许 Moo 访问 yourcompany.chandao.net（或你填的禅道地址）
   - 点「允许」就好。这是 Chrome MV3 的最小权限模型，扩展不会偷偷访问其他网站

## 4. 提交一条 bug 试试
   - 任意页 ⌘⇧B 截图 → 画几笔 → 「下一步」
   - 填标题（这条是必填）
   - 「提交」
   - 成功后 SubmitDialog 显示「禅道里看 → /bug-view-9999.html」点击直接跳禅道看

## 常见问题
   - **「测试连接」失败「登录失败」**：账号 / 密码错，或禅道改了密码
   - **提交失败「权限不足」**：你的禅道账号没有这个项目的「提 bug」权限，找管理员加
   - **附件录像没传上**：录像 > 50M 时超禅道账号上限，下次缩短录制时间
   - **想从 Moo 里删密码**：环境 Tab 里清空密码字段保存即可。Moo 没在 chrome.storage 之外存任何凭据
```

## 接力清单（下次会话开干前）

1. ✅ 切到新会话
2. ✅ `cd /Volumes/dev/wwwroot/moo-chrome-dev-tool && git pull`
3. ✅ 读本文档（PLAN_v0.2.0.md）
4. ✅ 起分支 `git checkout -b feat/v0.2.0-zentao`（**已起，2026-05-21 P1 接手会话**）
5. ✅ P1-① 验证 #1：fake token 探到 form 端点 token-only 模式 + cookie 路径白送 success
6. ✅ P1-② `src/utils/curlGenerator.ts` + 13 单测 + type-check 全绿（未 commit）
7. ✅ 验证 #2：禅道无 PAT，token 必走 account+password 换。决策 2 改为 B'
8. ⏳ P1-③ `src/background/zentao/client.ts` 5 方法（login / ensureToken / submitBug / discoverProduct / ping / listProjects）
9. ⏳ P1-④ 真 token 端到端拍板（用户给 account+password 或浏览器手动 fetch 拿 token 贴过来）

## 本次会话清理状态（2026-05-21 探测会话）

- 探测过程产生的两条测试 bug 已删除：
  - id 9272「[Moo 探 v4-B] trunk」
  - id 9273「[Moo 探 v5] 附件上传链路验证」
- 测试项目 ID 26 干净（0 bug）
- chrome-devtools MCP tabs 没清，下次会话照常用

## 2026-05-21 P1 接手会话清理状态

- 探测过程产生的一条测试 bug 已删除：
  - id 9274「[Moo P1 验证 #1] 仅探不留」
- 测试项目 ID 26 干净（0 bug）
