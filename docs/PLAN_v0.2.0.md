# v0.2.0 计划 · 禅道集成

> 2026-05-21 探测会话产出。下一个会话直接读本文档接手即可，不用重复探禅道接口。
> 测试用禅道实例：https://yourcompany.chandao.net （用户已登录）
> 测试用项目：**ID 26**（用户已建好）

## 用户拍板的 5 个决策

| # | 决策 | 含义 |
|---|---|---|
| 1 | **只做禅道**（不抽 Tracker adapter interface） | 单分支 if/else 即可，未来加 Jira/GitHub 时再抽象 |
| 2 | **Token 直配**（不存密码） | 用户在禅道生成 token，贴进 Moo Settings。Moo SW 用 `Token: xxx` header |
| 3 | **请求 / 错误转禅道附件 + curl** | 上传 `requests.json` + `requests.curl.sh` + `errors.json` 三个附件，附 `moo-screenshot.png` + 可选 `moo-recording.webm` |
| 4 | **一个 Moo 环境绑一个禅道项目**，**product 不让用户配** —— 自动从禅道 form HTML 解析 | 用户只配 projectId |
| 5 | **Token header 走路径 A**（form 端点直接吃 Token header） | P1 第一天验证；若不通走路径 B（password→cookie），但路径 B 违反决策 2，需回头报 |

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

```
GET {baseUrl}/bug-create-0-all-projectID={projectId},moduleID=0.html
Header: Token: {user_token}
```

→ 返回 84KB HTML，里头 `<input name="product" type="hidden" value="X">` 的 X 就是默认产品 ID

→ Moo SW 内存缓存 24h（避免每次提交都 fetch 84KB）

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
5. **product 必填但不让用户配** — 自动 form HTML 解析（hidden input value）
6. **`.sh` 附件被禅道改名 `.txt`** — 安全策略，attach 时 `requests.curl.sh` 或 `requests.curl.txt` 都行

## P0 / P1 优先验证（开干第一天必做）

### 验证 #1：Token header 在 legacy form 端点是否工作

Moo SW 跨 origin 没有 cookie session。从 BG SW 跨域 fetch `/bug-create-*.html` 带 `Token: xxx` header：
- ✅ 200 + `{result:'success'}` → 路径 A 通，按本文档实现
- ❌ 401/403/不识别 → **路径 A 失败，回头报**
  - 路径 B（不推荐）：用户配 account+password，SW POST `/api.php/v1/tokens` 拿 zentaosid → 转 cookie → 调 form 端点
  - 路径 C：尝试用 REST API 重新探（之前 200 空 body 的原因可能是字段问题）

### 验证 #2：禅道 token 生成入口（写用户手册用）

本次会话探测未找到明确的 token UI 入口（`my-token.html` / `personal-token.html` 等返 200 但 zin shell 渲染失败，需要 iframe load）。下次会话：

1. 打开 yourcompany.chandao.net 用户菜单（顶栏头像点开）
2. 找「个人设置」/「应用」/「Tokens」/「API 访问」入口
3. 截图记录路径
4. 写进 `docs/ZENTAO_SETUP.md` 用户手册

可能的入口（按禅道 biz 12 文档）：
- `/my-profile.html` → 「应用」tab → 个人 Token
- 或 `/personal-token-edit.html`
- 或后台 `/admin-systemMode.html` 里开 API 模式后才有

## 数据契约（Project schema 加 kind + zentao）

```ts
interface Project {
  // ...原字段不动
  kind: 'webhook' | 'zentao'     // 新增；normalize 时无 kind 默认 'webhook' 兼容老数据
  servers: Server[]              // kind='webhook' 时用
  zentao?: {
    baseUrl: string              // e.g. "https://yourcompany.chandao.net"
    token: string                // 用户在禅道生成贴进来
    projectId: number            // 必填
    moduleId: number             // 默认 0
    defaultSeverity: 1|2|3|4     // 默认 3
    defaultPri: 1|2|3|4          // 默认 3
    defaultType: string          // 默认 'codeerror'
    defaultAssignedTo?: string   // 可选
  }
}
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
| **P1** | `src/utils/curlGenerator.ts` + 单测（走现有 redact 脱敏 Authorization / Cookie / X-API-Key） / `src/background/zentao/client.ts` 四个方法（submitBug + discoverProduct + ping + listProjects） / **验证 #1（Token header）** | 1.5 天 |
| **P2** | Project schema 加 `kind` + `zentao` / `normalizeProject` 兼容老数据 / 单测 | 0.5 天 |
| **P3** | Environment Tab UI：kind 切换器 + ZenTao 字段表单 + 「测试连接」按钮 + 「从禅道拉列表」下拉 + 高级折叠 | 1.5 天 |
| **P4** | background `submitBug` 加 kind 分支 → zentaoSubmit / SubmitDialog 成功回调显示禅道链接 | 0.5 天 |
| **P5** | retryQueue 适配：整条 multipart POST 作为一个重试单位 / 单测 cover token 失效 / discoverProduct 失败 / 200-fail / 网络失败 | 1 天 |
| **P6** | `host_permissions` 动态申请（baseUrl 填好时一次性 chrome.permissions.request，类似 v0.1.9 tabCapture） | 0.5 天 |
| **P7** | E2E（zentao-harness mock form 端点）+ dogfood ≥ 2 天 + 写 `docs/ZENTAO_SETUP.md` 用户手册 | 1 天 |

## 用户手册大纲（docs/ZENTAO_SETUP.md，P7 写）

```markdown
# Moo × 禅道接入手册

## 1. 拿你的禅道 Token
   - 打开禅道 → 顶栏头像 → 个人设置（或「应用」标签）
   - 找「Token」/「API 令牌」/「个人访问令牌」入口
   - 点「生成新 Token」+ 给个名字（如「Moo 扩展」）
   - 复制 token 字符串（**只显示一次，关了页面再也看不到，必须立即复制**）
   - [插图：禅道 token 生成页面截图]

## 2. 拿你的项目 ID（两种姿势）
   方式 A · 自动（推荐）：
     - Moo Settings 里填好「禅道地址」+「Token」后，点「📋 从禅道拉列表选」
     - 下拉里挑你的项目，自动填 projectId
   方式 B · 手动：
     - 浏览器进禅道 → 打开你的项目首页
     - 看 URL：`https://你的禅道/project-index-26.html`，数字 26 就是项目 ID

## 3. 在 Moo 里配
   - chrome.action 点 Moo 图标 → F12 DevTools → Moo 面板 → 环境 Tab
   - 新建项目（或编辑已有），URL 规则填你常用站点
   - 上报方式选「禅道」
   - 填四个字段：
     - 禅道地址（带 https://，不带 trailing /）
     - Token（步骤 1 复制的）
     - 项目 ID（步骤 2 拿到的）
     - 模块 ID（一般 0）
   - 点「测试连接」→ 看到「已登录为 {你的名字}」就好了

## 4. 第一次提交时会弹权限申请
   - Chrome 会问你是否允许 Moo 访问 yourcompany.chandao.net（或你填的禅道地址）
   - 点「允许」就好。这是 Chrome MV3 的最小权限模型，扩展不会偷偷访问其他网站

## 5. 提交一条 bug 试试
   - 任意页 ⌘⇧B 截图 → 画几笔 → 「下一步」
   - 填标题（这条是必填）
   - 「提交」
   - 成功后 SubmitDialog 显示「禅道里看 → /bug-view-9999.html」点击直接跳禅道看

## 常见问题
   - **「测试连接」失败「401 未授权」**：Token 失效或填错，回步骤 1 重生成
   - **提交失败「权限不足」**：你的禅道账号没有这个项目的「提 bug」权限，找管理员加
   - **附件录像没传上**：录像 > 50M 时超禅道账号上限，下次缩短录制时间
```

## 接力清单（下次会话开干前）

1. ✅ 切到新会话
2. ✅ `cd /Volumes/dev/wwwroot/moo-chrome-dev-tool && git pull`
3. ✅ 读本文档（PLAN_v0.2.0.md）
4. ✅ 起分支 `git checkout -b feat/v0.2.0-zentao`
5. ✅ P1 第一刀：先验证 #1（Token header）→ 不通的话回头报
6. ✅ P1 第二刀：写 `src/utils/curlGenerator.ts` + 单测（这部分跟禅道无关，纯函数好测）

## 本次会话清理状态

- 探测过程产生的两条测试 bug 已删除：
  - id 9272「[Moo 探 v4-B] trunk」
  - id 9273「[Moo 探 v5] 附件上传链路验证」
- 测试项目 ID 26 干净（0 bug）
- chrome-devtools MCP tabs 没清，下次会话照常用
