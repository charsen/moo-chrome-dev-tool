# Moo × 禅道 — 使用说明

把网页 bug 一键提到禅道。**不用截图传文件夹、不用粘 URL、不用手填环境信息**，点页面右下角悬浮球的截图按钮（或浏览器右上角 Moo 图标 → 弹窗「触发截图」），填个标题，bug 就进禅道了，自动带：

- 📸 截图（在 bug 详情页直接看，不用下载）
- 🎥 录像（如果你录了）
- 🌐 当时打开的网页、用什么浏览器、什么系统
- 🐞 当时发生了什么网络请求、报了什么 console 错
- 📋 一键可下载的 `curl` 复现脚本

**建议用 v0.3.0**（v0.3.0 起历史 Tab 显示禅道里 bug 当前处理状态，闭环完整；v0.2.3 起 Moo 自动登录无感）。[📦 拿最新版（gitee releases）](https://gitee.com/charsen/moo-chrome-dev-tool/releases)，当前 latest = **v0.3.0**：[直接下载](https://gitee.com/charsen/moo-chrome-dev-tool/releases/download/v0.3.0/moo-chrome-dev-tool-0.3.0.zip)。

---

## 30 秒开始 — 2 步

### 第 1 步：装 Moo 扩展

[下载最新 zip](https://gitee.com/charsen/moo-chrome-dev-tool/releases)（拿顶上那条 latest tag） → 解压

打开 Chrome → 地址栏输 `chrome://extensions` → 右上角打开「开发者模式」→ 点「加载已解压的扩展程序」→ 选解压的那个文件夹

装好后浏览器右上角能看到 Moo 图标。

> **v0.2.3+ 起不再需要手动登录禅道**。Moo 用你配的账号密码自动登录，提 bug 时无感。

### 第 2 步：在 Moo 里配一次禅道

任意网页 → 按 `F12` 打开开发者工具 → 顶部切到 `Moo` → 左下角切到「环境」

点左上角「+」新建一个项目，按顺序填：

| 字段 | 填什么 | 例子 |
|---|---|---|
| 项目名 | 随便起个让你记得住的 | 「公司禅道-企管平台」 |
| URL 匹配 | 你要在哪些网页用 Moo（每行一个，可用 `*` 当通配符） | `https://app.example.com/*` |
| 上报方式 | 选「**禅道**」 | — |
| 禅道地址 | 你公司的禅道首页地址 | `https://yourcompany.chandao.net` |
| 账号 | 你的禅道账号（手机号 / 邮箱都行） | `13800000000` |
| 密码 | 你的禅道密码 | — |
| 项目 ID | 数字。两种方法拿（见下） | `26` |

**项目 ID 怎么拿**：
- **方法 A**（推荐）：填完账号密码后，点「📋 从禅道拉列表」按钮，下拉里挑你要的项目，自动填上
- **方法 B**：浏览器打开禅道里那个项目，看地址栏，比如 `https://你的禅道/project-index-26.html`，数字 `26` 就是项目 ID

填完点「测试连接」按钮 → 看到「✓ 已登录为 你的名字」就配好了。

---

## 提一条 bug 试试

1. 在你正在调 bug 的网页上 → 找悬浮球（默认在**右下角**，是个横向小条 `[Moo][📷][🎬]`，3 个图标：拖动手柄 / 截图 / 录屏）→ 点中间「截图」按钮。也可以点浏览器右上角 Moo 图标 → 弹窗里的「触发截图」按钮
2. 用鼠标圈出 bug 所在区域（可以标好几处）
3. 点「下一步」→ 弹出提交窗口
4. 填**标题**（必填，写一句话说明问题）
5. （可选）填描述，更详细的复现步骤、预期、实际
6. （可选）选「分级」：类型 / 严重度 / 优先级
7. （可选）选「所属模块」（如果禅道里设了多个模块）
8. （可选）选「指派给」谁
9. 点「提交」

成功后窗口会显示「✓ 提交成功，已记录为 #9999」+ **「禅道里看 →」按钮**，点这个按钮直接跳到禅道里看刚提的 bug。

去禅道里看，bug 详情页会自动显示：

- 描述（你填的）
- 📸 截图（直接渲染出来，不用下载）
- 🎥 录像（如果你录了，给个下载链接）
- 🌐 网络请求：每条请求一组「curl 代码块 + 📥 Response 卡片」 —— 看哪些请求出错 + 直接看 server 返了啥（卡片左侧色条：绿 = 2xx / 红 = 4xx / 深红 = 5xx）。**注意**：bug 详情页里看到的 curl 代码**不要直接复制粘贴执行**（禅道为防 XSS 会改 URL 里的字符，复制出来 bash 跑不动）。要复现请求**下载最下面的 `moo-requests.curl.sh` 附件**，里面是干净的 curl 命令，能直接 `bash moo-requests.curl.sh` 跑
- 🔧 调试附件（完整的请求 raw / console 错误日志）
- 🌐 环境信息（URL / 浏览器 / 系统 / 时间 / 视口）

---

## 常见问题

### Q：装好后悬浮球没出现？

A：先检查浏览器右上角有没有 Moo 图标。没有就回第 1 步把扩展装好。有图标但悬浮球不出现：
- 检查你访问的网页 URL 是不是匹配 Moo 项目配置的「URL 匹配」规则（环境 Tab 看）。不匹配就不显示
- chrome://extensions → 找 Moo →「详情」→「站点访问」确认是「在所有网站上」
- 仍不行：点浏览器右上角 Moo 图标 → 弹窗里有「触发截图」按钮，悬浮球不响应时用这个

### Q：悬浮球被页面挡住 / 跑到屏幕外看不见了？

A：悬浮球默认贴右下角，遇到宿主页有 fixed 元素遮挡时会自动换角落（左下 / 右上 / 左上 / 中右候选）。如果还看不见：
- 鼠标拖一下浏览器窗口大小 → 悬浮球会被 clamp 回视口内
- 仍不行：清掉 localStorage 让它重选位置 — Chrome DevTools → Application → Local Storage → 找 `moo-ball-pos` 删掉 → 刷新页面，悬浮球会重新走「挑不冲突角落」逻辑
- 或者直接走 popup 路径（浏览器右上角 Moo 图标 → 「触发截图」）—— 完全绕开悬浮球

### Q：提交后禅道里没看到截图？

A：v0.2.3 起 Moo 用你 Settings 里的账号密码自动登录禅道，正常情况下截图都能上去。

打开 SubmitDialog 时左侧上方有个状态条告诉你当前状态：

- ✅ **绿色「✓ 已登录禅道（你的名字）」**——OK 可以提
- ❌ **红色错误消息**——账号或密码错了 / 网络问题。先去环境配置改密码 / 检查网络

### Q：提示「提交成功」但禅道里 bug 标记成「由 system 创建」？

A：可能你装的还是 v0.1.x 老版本。卸载老的、装 [最新版 zip](https://gitee.com/charsen/moo-chrome-dev-tool/releases)（v0.2.0+ 都修了这个问题，正常会显示你的真名）。

### Q：「测试连接」失败「登录失败，请检查您的用户名或密码」

A：账号或密码填错了。检查一下：
- 账号是不是手机号 / 邮箱别名 / 工号填错
- 密码最近改过没忘了同步
- 你公司禅道有没有强制要求绑定二次验证（短信 / 邮件验证码）—— 当前 Moo 不支持二次验证账号

### Q：「测试连接」成功，但提交后说「认证持续失败」？

A：你的账号在该禅道项目里没有「提 bug」权限。找禅道管理员加你进项目。

### Q：录像没传上禅道？

A：禅道默认附件上限 50 MB。录像 > 50 MB 会上传失败（bug 主体还是会建出来，只是录像附件丢）。

解决：录短一点。SubmitDialog 里如果你的录像超 49 MB 会有红色警告条提醒你。

### Q：截图 / 网络请求 / 录像都没了？

A：去 DevTools → Moo → **历史** Tab 找这条记录，里面所有数据都在本地存着，可以重新提交。

### Q：怎么知道我提的 bug 现在禅道里是什么处理状态？（v0.3.0+）

A：DevTools → Moo → **历史** Tab 自动显示每条 bug 的当前状态：

| 显示 | 对应禅道状态 | 含义 |
|---|---|---|
| 待处理（灰） | active | 还没人处理 |
| 处理中（黄） | resolved | 被解决，等验证 |
| 已完成（绿） | closed | 验证通过关单 |
| 已删除（红） | deleted | 在禅道里被彻底删了 |

打开历史 Tab 时禅道项目的 bug 状态自动同步一次（webhook 路径仍是手动点「同步状态」）。想强制刷新：关掉历史 Tab 再开。

### Q：我们公司多个禅道项目，每个项目都要配一遍？

A：是的，每个禅道项目对应 Moo 里一个「项目」。一个 Moo 项目只对应一个禅道项目 + 一种 URL 匹配规则。

### Q：导出配置时怕泄漏密码？

A：放心。Moo 导出配置时**自动把所有密码字段清空**，导出的 JSON 可以放心传给同事 / 上传 git 仓库。同事导入后 Moo 会提示他「这个配置带了 N 个项目的禅道密码」（你的清空了导入时也会显示 0），让他自己改成自己的密码。

---

## 进阶：让禅道里的 bug 信息更完整

### 默认值 vs 提交时改

Moo 环境配置里有「提交默认值」一栏（默认展开）：

- **类型**（代码错误 / 设计缺陷 / 性能问题 / ...）
- **严重度**（1 致命 / 2 严重 / 3 一般 / 4 提示）
- **优先级**（1 紧急 / 2 高 / 3 中 / 4 低）
- **默认关键词**（默认填 'Moo'）

每条 bug 提交时可单独改这些（除了关键词），不影响默认值。

### 关键词的作用

填好默认关键词（比如 `Moo, 前端bug, 企管`）后，禅道搜索框输入这些词就能搜出所有用 Moo 提的 bug —— 方便团队 leader 统计 / 复盘。

### 指派给

提交窗口的「指派给」下拉自动拉禅道里所有用户。第一次打开可能要等 1-2 秒拉数据。下次点 `↻` 按钮可以重新刷新。

留空不指派 → 禅道按项目规则自动分派。

### 所属模块

如果你公司禅道项目里建了多个模块（比如「前端」「后端」「移动端」），提交窗口的「所属模块」下拉里会自动列出来让你选。

没建模块就只能选「根模块（/）」。

---

## 隐私 / 安全

### 你的禅道密码存哪？

存在 Chrome 自己的本地存储里（chrome.storage.local），跟你的 Chrome 用户绑定。

- ✅ 不会上传到任何 Moo 服务器（Moo 没服务器）
- ✅ 不会同步到你的别的电脑 / 其他设备
- ✅ 其他 Chrome 扩展看不到 Moo 的存储
- ✅ 导出配置时自动清空密码字段

如果你不接受密码存浏览器本地，那别用 Moo 的禅道功能 —— 当前没有「不用密码也能提」的路径。

### 想删 Moo 里的密码？

DevTools → Moo → 环境 → 找到那个项目 → 把密码字段清空 → 自动保存。Moo 就忘了。

### 想完全退出？

chrome://extensions → 找到 Moo → 点「删除」。Moo 在你浏览器里的所有数据（配置、历史、密码）都跟着没了。

---

## 附录：禅道 v2 API 官方文档（想自己拓展看这里）

> 大部分人用 Moo 不用看这节。**只有当你想自己写脚本批量拉 bug / 拓展功能 / 对接其他系统时**，再翻官方文档。

### 官方总入口

**[禅道 RESTful API v2.0 文档](https://www.zentao.net/book/api/2142.html)**（中文）

Moo 跟禅道之间的所有对话都走这套 API。文档按禅道功能模块组织（user / bug / project / product / execution / task / story / build / release / module / file / testcase 等），每个模块下列出对应的 HTTP endpoint。

### 鉴权一句话

禅道 v2 API 有两条鉴权路径，**Moo 两条都用了**（按场景分）：

| 鉴权方式 | 怎么拿 | 用在哪 |
|---|---|---|
| **Token**（API 写操作主流） | `POST /api.php/v2/users/login` 拿到 | 创建 bug / 拉列表 / 拉 bug 状态 |
| **Cookie session**（兼容老 zui editor） | login 同一调用同时 set 进 cookie jar | 附件上传（`/file-ajaxUpload.html`） |

为啥要混用：附件 inline 渲染依赖禅道老的 `/file-ajaxUpload.html` 端点 —— v2 标准的 `/api.php/v2/files` 在我们实测的账号下权限 deny，且不支持详情页 inline 渲染。

### Moo 当前用到的 endpoint（对照代码 `src/background/zentao/`）

| 用途 | Endpoint | 方法 | 鉴权 | 所属 API |
|---|---|---|---|---|
| 登录拿 token + 写 cookie + user 对象 | `/api.php/v2/users/login` | POST | 账号密码 | v2.0（3.20.1 获取 Token）|
| ping 登录状态 / 拿真名 | `/api.php/v2/users/{cachedUserId}` | GET | token | v2.0（3.21.4 用户详情）|
| 探 cookie session 是否在 | `/api.php/v2/users/{cachedUserId}` | GET | cookie | v2.0 |
| 拉项目列表 | `/api.php/v2/projects?browseType=all&recPerPage=N` | GET | token | v2.0（3.11.x）|
| 拉项目详情（拿关联 product ID） | `/api.php/v2/projects/{projectId}` | GET | token | v2.0（3.11.5）|
| 拉用户列表（指派人下拉） | `/api.php/v2/users?recPerPage=N` | GET | token | v2.0（3.21.3）|
| 拉模块列表 | `/api.php/v1/modules?id={productId}&type=bug` | GET | token | **v1.0 保留** — v2 没 Module 章节，强行下线丢功能 |
| 创建 bug | `/api.php/v2/bugs` | POST JSON | token | v2.0（3.2.1）|
| 查询 bug 详情（状态回查） | `/api.php/v2/bugs/{id}` | GET | token | v2.0（3.2.6）|
| 上传附件（截图 / 录像 / curl.sh） | `/file-ajaxUpload.html?uid=&extra=editor&field=imgFile` | POST multipart | cookie | **不属于 v1/v2 RESTful，是禅道老 zui editor 端点** |

**实话讲清楚**：禅道官方文档里 [v1.0 手册](https://www.zentao.net/book/api/1397.html) 和 [v2.0 手册](https://www.zentao.net/book/api/2309.html) 是**两套独立并存的 RESTful API**，章节分开、不是兼容别名。v0.4.0 前 Moo 读操作走 v1.0、写操作走 v2.0，混用虽然代码注释里有据（v0.2.3 时实测 v2 token 跨 v1 端点兼容），但留着「禅道某天去掉 v1」的风险。

**v0.4.0 全面 v2 化**：6 个读 endpoint 里有 5 个收口到 v2.0，**只剩 `listModules` 保留 v1** —— 因为 v2 RESTful 21 个章节里完全没有 Module 章节（实测查证 + 两次独立 fetch 互证），强行下线「所属模块」下拉会让用户视角丢功能。这一条等禅道补 v2 Module 章节再收口。附件上传走老 zui editor 端点不变（v2 `/files` 账号权限 deny，且不支持 inline 渲染）。

### Moo 没走但 v2 API 提供的（想自己 curl 拓展）

照官方文档对应章节走，拿到 token 后所有写操作 header 加 `Token: <你的 token>` 就能直接 curl：

| 你想干嘛 | 看 v2 文档第几章 |
|---|---|
| 修改 / 解决 / 关闭 / 激活 / 删除 bug | 3.2.x（Moo 当前只支持创建 + 查询）|
| 操作任务 / 需求 / 测试用例 | 3.16 任务 / 3.14 需求 / Testcase 章 |
| 创建 / 修改 / 删除用户 | 3.21.1 / 3.21.2 / 3.21.5 |
| Build / Release 管理 | 3.3 Build / 3.12 Release |
| Execution（迭代）相关 | 3.5.x |

### v2 API 隐藏陷阱（dogfood 实测踩出来的，下次别重踩）

#### 1. v2 endpoint 鉴权失效**不**返 401，返 HTTP 200 + `{result:false}` 非标响应

v0.4.0 dogfood 实测踩到。token 过期 / 被禁 / 账号被锁时，v2 endpoint 不像标准 RESTful 那样返 `401 Unauthorized`，而是这样：

```
HTTP/1.1 200 OK
Content-Type: application/json

{ "result": false, "message": "登录已超时，请重新登入" }
```

`res.ok === true`、`res.status === 200`，常规 `if (!res.ok) retryLogin()` 完全捕不到。必须**解析 body** 才能识别。

应对：`src/background/zentao/client.ts` 里有 `isV2AuthExpired(body)` helper，6 个 v2 read endpoint 都过一遍。新接 v2 endpoint 也要套上：

```ts
const data = await res.json()
if (isV2AuthExpired(data)) {
  await reLogin()
  return retry(...)
}
```

`isV2AuthExpired` 匹配的关键词：`登录已超时 | 请重新登入 | 请重新登录 | 未登录 | 未授权 | unauthor | token.*(expir|invalid|missing)`。新接口踩到其他类似关键词，加进 helper。

**反面教训**：dogfood 第 1 版按 401 写 retry 逻辑，token 过期时 SubmitDialog 「✓ 已登录」状态条**显示绿色但实际失败**，因为响应 HTTP 200 通过了我们的「成功」分支。

#### 2. v2 `/api.php/v2/files` 端点附件上传账号 deny

参见下面的「已知做不到」。

#### 3. v2 endpoint 不接受 cookie 鉴权（必须 token）

v0.4.0 dogfood 时一度想用 v2 endpoint 探 cookie 是否还在 jar 里，发现 v2 endpoint 严格只认 `Token: <token>` header，cookie 完全无视。

应对：login 后**信任** cookie 已写入 jar（不再探），cookie 失效靠下一次 `/file-ajaxUpload.html` 失败 + reLogin 重写。代码 `ensureCookieSession()` 走 trust 路径。

---

### 已知「做不到」（v0.2.3 实测穷举过的，下次别再花时间重探）

- **录像在 bug 详情页 inline 播放**：禅道 HTML sanitizer 是严格白名单，`<video>` / `<embed>` / `<object>` 整段剥成空，`<iframe>` 字母被改全角；上传的 `.webm` 被禅道强制改名 `.txt` + 返 `application/octet-stream`。webm → GIF 理论可行但体积膨胀 5-10 倍必超 50M。**现状：bug 详情页放下载链接**。
- **v2 标准 `/api.php/v2/files` 附件端点**：账号没 `file.create` 权限 deny。换走老 zui editor `/file-ajaxUpload.html` 路径才通。
- **bug 详情页 curl 代码块直接复制粘贴执行**：禅道 WAF 为防 SSRF 改 URL 里的字符，复制出来 bash 跑不动。**用 bug 附件里的 `moo-requests.curl.sh`** —— 干净版，下载下来直接 `bash` 跑。

---

## 反馈

- 用着不对劲 / 想要新功能：[Moo issues](https://gitee.com/charsen/moo-chrome-dev-tool/issues)
- 紧急问题：直接找 Moo 维护者
