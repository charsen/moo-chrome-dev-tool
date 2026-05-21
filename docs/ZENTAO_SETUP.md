# Moo × 禅道接入手册

把 Moo 截图录屏的网页 bug 一键转成禅道 bug，自带附件（截图 / 录像 / 请求 / 错误 / 复现 curl）。

适用版本：Moo **v0.2.0+**；实测禅道版本：**云禅道 biz12**（yourcompany.chandao.net）。自建禅道理论上同样支持（用 v2.0 API），如遇问题来 issue 报。

---

## TL;DR（30 秒上手版）

1. DevTools → Moo → **环境 Tab**，新建或编辑项目
2. 「上报方式」选 **禅道**，填四个字段：禅道地址、账号、密码、项目 ID
3. 点「测试连接」，看到「✓ 已登录为 你的名字」就 OK
4. 任意页 `⌘⇧B`（Mac）/ `Ctrl⇧B`（Win）截图 → 标题 → 提交 → SubmitDialog 显示「禅道里看 →」点跳

---

## 一、你需要准备什么

### 1.1 一个能登录禅道的账号

跟你**平时浏览器里登录禅道用的账号 / 密码**完全相同。Moo 不需要管理员权限，普通成员账号就能用（前提是该账号对目标项目有「提 bug」权限）。

### 1.2 项目 ID

两种姿势拿：

**方式 A · 自动（推荐）**：Moo 里填好账号密码后，点「📋 从禅道拉列表」，下拉里挑你的项目，projectId 自动填。

**方式 B · 手动**：浏览器进禅道 → 打开项目首页 → 看 URL，数字就是 projectId：

```
https://你的禅道.com/project-index-26.html
                              ↑↑
                       这个 26 就是项目 ID
```

### 1.3 模块 ID

通常**填 0**（默认模块）。除非你的禅道项目有多个模块、你想让 Moo 提的 bug 默认进某个特定模块，那填那个模块的数字 ID。

---

## 二、在 Moo 里配置（一次性）

### 2.1 打开环境配置

按 Moo 图标 → F12 打开 DevTools → 切到 **Moo 面板** → **环境 Tab**

### 2.2 新建项目（或编辑已有）

- **项目名**：随便起，比如「绘家科技禅道」
- **URL 匹配**：你常用的开发站点，每行一个，比如：
  ```
  https://*.mooeen.com/*
  http*://localhost:*/*
  ```
- **上报方式**：选 **「禅道」**

### 2.3 填禅道字段（5 必填 + 高级折叠）

| 字段 | 示例 | 必填 |
|---|---|---|
| 禅道地址 | `https://yourcompany.chandao.net`（带 https，不带末尾 /） | ✓ |
| 账号 | `13800000000`（手机号 / 邮箱 / 用户名） | ✓ |
| 密码 | 你的禅道密码 | ✓ |
| 项目 ID | `26`（数字） | ✓ |
| 模块 ID | `0`（默认） | ✓ |

**高级折叠**（可不动用默认值）：
- 类型：默认 `codeerror`（禅道的 bug type 字段）
- 严重度：1 致命 / 2 严重 / 3 一般（默认） / 4 提示
- 优先级：1 紧急 / 2 高 / 3 中（默认） / 4 低
- 指派给：留空则按禅道项目规则自动分派；填具体禅道账号则每条 bug 都指派给那人

### 2.4 「测试连接」拍板

字段填齐后点「测试连接」按钮：

- ✓ **成功**：显示「✓ 已登录为 你的真名」—— 接好了
- ✗ **失败**：显示 `✗ 登录失败，请检查您的用户名或密码是否填写正确。` —— 账号 / 密码错；改了重试

### 2.5 「📋 从禅道拉列表」帮你选项目

如果你忘了项目 ID，点这个按钮 → 拉一份你能访问的项目下拉 → 选你要的那个，projectId 自动填进去。

---

## 三、提交一条 bug 看链路是否通

### 3.1 截图 → 标注 → 提交

1. 在你的开发页 ⌘⇧B（Mac）或 Ctrl⇧B（Win）→ 截图 → Annotator 标几笔
2. 「下一步」→ SubmitDialog 弹出
3. 填**标题**（必填，一句话描述问题）+ 描述（可选，更详细的复现 / 预期 / 实际）
4. 点「提交」

### 3.2 看回执

成功后 SubmitDialog 显示：

```
✓ 提交成功
已记录为 #9999
[禅道里看 →]  ← 点这个直接跳禅道 bug 详情
```

链接停留 4 秒后自动关 dialog（给你时间点链接）。

### 3.3 禅道里看到啥

去禅道项目的 bug 列表，你会看到一条新 bug：

- **标题**：你在 Moo 里填的标题
- **描述（steps）**：HTML 富文本，包含 你的描述 + URL/UA/视口/时间 + 附件清单
- **附件**（6 个 / 视情况）：
  - `moo-screenshot.png` — 你的截图（带 Annotator 标注）
  - `moo-recording.webm` — 录像（如果你录了的话）
  - `moo-requests.json` — 抓到的网络请求 raw 数据
  - `moo-requests.curl.sh` — 把请求转成 curl 命令的复现脚本（**走过 redact 脱敏**，Authorization / Cookie / password / token 等字段已 \*\*\*）—— 禅道会把 .sh 自动重命名 .txt
  - `moo-errors.json` — 抓到的 console.error / unhandled rejection raw
  - `moo-context.json` — URL / UA / viewport / 时间戳 / 各种 metadata

---

## 四、密码 / 隐私 / 安全 — 你应该知道

### 4.1 密码存哪？

存 **chrome.storage.local**（你的 Chrome 本地存储），按用户隔离：

- 不会上 Chrome Sync 同步到你的别的设备
- 不会上传到任何 Moo 服务器（Moo 没服务器）
- 其他 Chrome 扩展读不到（扩展间 storage 隔离）

### 4.2 为什么不加密？

**Moo 选择不做用户态加密。** 理由：

- chrome.storage.local 本身已经按用户隔离 + 其他扩展读不到，已经是 Chrome 给的最小信任面
- 二次加密的密钥也要存某处（你想存 keychain？你想要 master password？），增加复杂度，**实际安全没改善**
- 与其加密让你"感觉安全"，不如坦白告诉你「就存本地明文」更诚实，让你自己判断

如果你不接受本地存密码，**不要用禅道模式**，等 Moo 将来加 webhook 中继方案（路径 D，暂未排期）。

### 4.3 导出配置时密码会被剥掉

你在 Moo 里点「导出配置」时，所有禅道项目的 `password` 字段会被自动剥成空串，导出的 JSON 文件可以放心丢给同事 / 上传 git，不会泄密。

导出的 JSON 同事拿到后用「导入配置」，Moo 会显示警告「这个配置带了 N 个项目的禅道密码 / 你导入后会用配置作者的身份提 bug」让用户决定要不要导入。

### 4.4 想从 Moo 里删密码？

环境 Tab → 找到那个项目 → 把密码字段清空 → 保存。Moo 在 chrome.storage 里的密码字段就空了。

### 4.5 Token 缓存在哪？

Moo SW（Service Worker）内存里缓存了禅道返的 session token（用 account+password 换的）。这个**只在内存里，不进 storage**，SW 重启（Chrome 关掉 30 秒不用 Moo / 或浏览器重启）自动失效，下次提交时用密码重新换。

---

## 五、常见问题 / 故障排查

### Q1: 「测试连接」失败「登录失败，请检查您的用户名或密码」

账号或密码错。可能：
- 你最近改了禅道密码忘了同步
- 账号填成了别名（试试用手机号 / 邮箱 / 完整用户名）
- 禅道服务端要求二次验证（云禅道某些套餐有）—— 这种情况当前 Moo 不支持

### Q2: 「测试连接」成功，但提交 bug 显示「认证持续失败（重 login 后仍 401）」

你的账号对该项目没有「提 bug」权限。找禅道管理员加。

### Q3: 「该项目未关联任何 product」

禅道里「项目」必须关联至少一个「产品」才能提 bug（禅道的产品矩阵）。让管理员去禅道里给项目绑定一个 product。

### Q4: 提交失败「网络错误：...」

baseUrl 不对（域名打错？）、网络断了、或禅道服务挂了。Moo 会自动把这条提交进重试队列，下一次 SW 唤醒 / 5 分钟后的 alarm 会自动重试（最多 5 次）。

你也可以去 DevTools → Moo → 设置 Tab → 「重试队列」手动点 flush 立即重试。

### Q5: 录像没传上禅道

录像如果 > 1 MB（基本都会），Moo **不会**入重试队列（multipart 太大 storage 装不下），只会一次尝试。失败了你得去 历史 Tab 手动重提，或下次录短一点。

云禅道账号有附件大小上限（一般 10-50MB / 文件），超了禅道服务端会拒。

### Q6: 「测试连接」按钮一直不亮

填齐 baseUrl + 账号 + 密码三个必填，按钮才解禁（避免空字段去打浪费一来回）。

### Q7: 想关掉某个禅道项目，但又不想删配置

环境 Tab 里把项目的「启用」开关关掉。匹配规则照样存着，但悬浮球不显示、提交链路不走。

### Q8: 怎么切回 webhook 模式？

环境 Tab → 该项目顶部「上报方式」radio → 切回「Webhook」。zentao 字段保留着（防你又想切回来），但提交不再走禅道。如果你彻底不要禅道，可以同时清空 password 字段。

### Q9: 一个项目能同时上报到禅道**和** webhook 吗？

不能。一个项目只能一个 kind。如果你需要双发，可以新建两个 Moo 项目，URL 匹配相同；提交时 Moo 会让你选用哪个项目（多匹配场景）。

### Q10: 重试队列里的 zentao 条目长什么样？

设置 Tab → 重试队列 → 展开看明细。zentao 条目显示「禅道 + bug 标题」（不像 webhook 显示 method+URL）。可以点 × 手动删除单条。

---

## 六、已知限制 / 不支持

- **多禅道实例**：当前每个 Moo 项目只能配一个禅道实例。如果你跨 3 个公司禅道，得建 3 个 Moo 项目
- **二次验证 / SSO**：用账号密码登录失败的禅道（启用了 SAML / OIDC / 手机短信二次验证）当前不支持
- **REST API 提 bug**：禅道 REST `/api.php/v1/projects/{id}/bugs POST` 200 但 bug 没建（原因待查），Moo **不走 REST**，走 legacy form 端点
- **bug 状态回查**：当前只能提，没法在 Moo 里看「这条提了的 bug 现在状态是什么」。要查就去禅道里看
- **附件类型 / 大小限制**：禅道服务端限制走它的，Moo 这边不预检
- **批量重提**：失败的 zentao 条目目前只能一条一条手动重试，没批量重提

---

## 七、技术细节（深度好奇向，可跳过）

### 7.1 Moo 怎么跟禅道对话？

走两层：
1. **登录**：`POST {baseUrl}/api.php/v2/users/login` body=`{account, password}` → 拿临时 token
2. **提交**：`POST {baseUrl}/bug-create-0-all-projectID={pid},moduleID={mid}.html` header=`Token: ${token}` + `X-Requested-With: XMLHttpRequest` body=multipart（含 product / type / severity / pri / title / steps / files[]）

token 在 SW 内存缓存，401 时自动重换。

### 7.2 为什么是 account+password 不是 PAT？

禅道**没有**「在 UI 里点按钮自助生成永久 token」这条路（与 GitHub PAT 不同）。所谓 token 是用 account+password 换的临时 session token。详见 [PLAN_v0.2.0.md 决策 2](./PLAN_v0.2.0.md)。

### 7.3 product 字段怎么自动拿？

Moo SW 调 `GET /api.php/v1/products?project={pid}` 取 `products[0].id`，缓存 24 小时。不走 form HTML 解析（biz12 zin SPA 没有 form 标签）。

### 7.4 为什么 form 端点返「200 + 空 body」算成功？

实测：cookie session 路径返 `{result:'success', load:'/bug-view-N'}`；Token header 路径返 200 + 空 body（bug 已写入数据库）。Moo 兼容两种，遇空 body 时调 `GET /api.php/v1/projects/{pid}/bugs?limit=1` 拿最新 bugId 给 SubmitDialog 显示链接用。

---

## 八、反馈渠道

- 找 bug / 想要新功能：[Moo issue tracker](https://gitee.com/Charsen/moo-chrome-dev-tool/issues)
- 安全问题（账号 / 密码 / token 处理 bug）：先私聊 Moo 维护者，给 7 天修复窗口
