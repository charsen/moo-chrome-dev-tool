# 后端接入指南

你被同事拉来接一下扩展？读完这一份就够了。

你要写两个 HTTP 接口：

| 接口 | 方法 | 作用 |
|---|---|---|
| `<base>/intake` | POST | 收扩展提交的 bug |
| `<base>/<id>/status-public` | POST | 让扩展回查这条 bug 的当前状态 |

`<base>` 是你定的前缀，比如 `https://your-host/api/bugs`。开发者在扩展里填的就是 `<base>/intake`，回查地址扩展自己拼。**提交地址末尾必须是 `/intake`**，扩展靠这个推导回查 URL。

## 提交流程长这样

测试小李在你的网站发现一个 bug，按悬浮球截图、写描述、点提交。扩展把所有东西打成一个 JSON（或 multipart），POST 到 `<base>/intake`，带上你给小李的 token。你的接口收下、存好截图、给它一个 id 返回去。

之后小李在扩展「历史」Tab 想看这条 bug 现在处理到哪了，扩展就 POST `<base>/<id>/status-public`（body 里同样带 token），你返回当前状态（比如「处理中」），扩展显示出来。

## 1. 提交接口（intake）

### 鉴权

扩展把 token 放在 **POST body 里**，字段名 `token`。你的接口从 body 里读出来比对就行——和 webhook 类似，没有 `Authorization` header，没有 CSRF，没有 session。

```jsonc
{
  "token": "<dev_token>",
  "title": "..."
  // ...
}
```

token 是开发者自己在扩展里填的，由你给每人发一份。比较时用 `hash_equals` / `crypto.timingSafeEqual`，别用 `==`。

**token 格式约束**：仅 ASCII 可打印字符（`[\x21-\x7E]`），长度 ≤512。扩展配置层会 reject 超长 / 含 CRLF / 非 ASCII 的 token，所以别发 JWT 这种动不动几 KB 的格式。常见就是 `lle_xxxxxxxxxxx` 之类的固定前缀 + 随机字符串。

> 字段名 `token` 是扩展默认 Payload 模板里写的——开发者可以改模板把它放到任何路径（比如 `auth.token`），你的接口跟着改即可。但若开发者用 multipart 模式，**token 必须在模板顶层**，原因见下面「请求体」段。

### 请求体

默认 `application/json`，长这样：

```jsonc
{
  "token": "lle_xxxxxxxxxxx",                // 必填，鉴权用
  "title": "登录按钮点了没反应",              // 必填
  "description": "复现步骤...\n\n页面: ...",
  "screenshot": "data:image/png;base64,iVBOR...",
  "video": "data:video/webm;base64,GkXf...",  // 可空
  "context": {
    "url": "https://example.com/login",
    "userAgent": "Mozilla/5.0 ...",
    "requests": [ /* 抓到的 fetch/xhr */ ],
    "errors":   [ /* 抓到的 JS 错误 */ ]
  }
}
```

**`token` 和 `title` 必填**，其他都可空。完整字段表在附录 A。

字段名是用户在扩展里编辑的「Payload 模板」生成的——你想叫 `bug_title` 也行，让开发者把模板改了即可。

**大视频场景**：扩展可以切到 `multipart/form-data`，截图二进制不必 base64 编码，体积省一截。你按 `Content-Type` 分支处理，注意几个坑：

> **多张截图（v0.8.10 起）**：multipart 模式下第一张仍走配置的图片字段名（如 `screenshot`），第 2 张起追加 `screenshot_2`、`screenshot_3` …（文件名 `screenshot_N.png`，上限 5 张）。不认识这些字段的服务端忽略即可，无需改动；要收多图就按该命名约定取。JSON 模式用模板变量 `{{imagesJson}}`（见下文模板变量表）。

- 扩展先按 Payload 模板渲染一份 JSON 字符串，再 `JSON.parse` 摊平：**每个顶层字段** `form.append(k, ...)` 一次；嵌套对象（如 `context`）会被 `JSON.stringify` 成字符串塞进对应字段。所以 `token` **必须放模板顶层**——放 `auth.token` 的话后端会拿到 `auth` = `'{"token":"..."}'` 这种 JSON 字符串，得自己再 parse 一次。
- 截图字段名由扩展配置的 `imageField` 决定，默认 `screenshot`；老配置可能用 `image`。你的代码应该都接，或者明确文档化要求开发者填某个名字。
- 截图字段会被从 JSON 里 skip 掉、单独以 Blob 形式 append，所以从 file 字段读二进制即可。
- 若模板渲染后 JSON 解析失败（用户写坏了），整个 payload 退化为单字段 `payload=<原始模板渲染串>`——属于异常路径，建议后端遇到只有 `payload` 这一个字段时返 400 提示用户。

### 响应

成功（HTTP 2xx）：

```json
{ "ok": true, "id": "01HXX...", "status": "open" }
```

**`id` 字段约束（必看）**：
- 必返，且必须是**顶层** `id`（不是 `data.id` 之类的嵌套）
- 类型必须是**字符串**，数字主键请先 `(string)` 转一下
- 字符集只允许 `[A-Za-z0-9_-]`（防路径注入：扩展会把 id 拼到回查 URL `<base>/<id>/status-public`）
- 长度 ≤128
- **不满足以上任何一条，扩展静默丢弃 `id`，状态回查永远不工作**（无报错，最隐蔽的那种）

`status` 推荐返。取值你自己定，但推荐用 `open` / `in_progress` / `done` / `deleted` 这 4 个值——下面「定期清理」（§ 4 几个坑里那条）按这套清理策略说事。

**响应体大小**：扩展只 parse 前 64KB（防超大 HTML 错误页拖垮 SW）。intake 响应别把整条 todo 全文塞进去，只返必要字段即可。

失败（4xx / 5xx）：

```json
{ "ok": false, "error": "token 不对" }
```

错误信息会原样显示给用户，**写人话**别写堆栈。字段名 **`error` 优先**，缺失时退到 `message`——所以 `{"error":"xxx"}` 和 `{"message":"xxx"}` 都行，但用其它名字（如 `error_message` / `errors[0]`）扩展拿不到，只会显示一个干巴巴的 HTTP 状态码。

扩展处理规则：
- **5xx / 网络错** → 尝试入重试队列，每 5 分钟扫一次，每条最多重试 5 次
- **4xx** → 当你拒绝了，不重试，直接提示用户
- **重试的隐藏门槛**：只有 JSON 模式且**渲染后的 body < 1MB** 才入队；multipart 模式、或带录屏的大 body **不入队**。带录屏的提交 5xx 后用户得手动到「历史」Tab 重新提交。后端别假设"扩展一定会重试"做幂等补偿——大体积场景就一次机会。

## 2. 状态回查接口（status-public）

```
POST <base>/<id>/status-public
Content-Type: application/json

{ "token": "<dev_token>" }
```

跟 intake 一个模式：POST + body 带 token。返回：

```json
{ "ok": true, "status": "in_progress" }
```

扩展只读 `status`，取值你自己定。推荐：`open` / `in_progress` / `done` / `deleted`。

路径后缀 `-public` 是为了和登录态的内部接口区分，你不用这套区分也行——但**路径模式必须固定**为 `<base>/<id>/status-public`，扩展是写死的。

> 不用 GET + `?token=` 是为了让 token 完全不进 URL，避免 access log / referer / 历史记录里残留。

## 3. CORS 预检（必须处理）

扩展是从 Service Worker 跨域 POST 的：源是 `chrome-extension://<扩展 id>`，目标是你的域名。`Content-Type: application/json` 不是 simple header，**浏览器会先发一个 `OPTIONS` 预检请求**。后端如果不响应，扩展那边的 toast 会显示「提交失败：Failed to fetch」（不是 HTTP 错误码，是 CORS 阻断）。

最小响应：

```
OPTIONS /api/bugs/intake  →  HTTP 204
Access-Control-Allow-Origin: chrome-extension://*    # 或者直接 *，反正不带 cookie
Access-Control-Allow-Methods: POST
Access-Control-Allow-Headers: Content-Type
Access-Control-Max-Age: 86400                         # 缓存预检结果一天，省流量
```

intake 和 status-public 两条路由都要。Laravel 用 `fruitcake/laravel-cors` 或自己写 middleware；Node + Express 用 `cors()` 中间件；Nginx 反代可以在 location 块里加 `add_header`。注意**不要带 `Access-Control-Allow-Credentials: true`**——扩展不送 cookie，加这条反而和 `Allow-Origin: *` 冲突报错。

## 4. 几个坑

- **请求体大小**：录屏 30 秒 base64 后接近 40MB。PHP 设 `post_max_size=60M`、Node `express.json({ limit: '60mb' })`、Nginx `client_max_body_size 60M`。
- **截图录屏别塞数据库**：直接落盘到 `_assets/{date}/{id}.{ext}`，HTTP 服务时加 `Cache-Control: private`（截图可能含敏感信息）。
- **不要信客户端报的提交人字段**：用 token 反查开发者身份，自己写进去。
- **token 别进日志**。两个接口都走 POST body，access log 默认拿不到；如果你额外开了 request body logging（比如 `logging_format=combined+body`），记得加脱敏。
- **定期清理**：`done` 状态留 30 天、`deleted` 留 7 天就够了。

## 5. 最小骨架（Node + Express）

校验 token、存 bug、回查状态——三步全在这里。截图怎么落盘自己选（base64 解码后写文件即可）。

```js
import express from 'express'
import crypto from 'node:crypto'

const app = express()
app.use(express.json({ limit: '60mb' }))

// CORS 预检：扩展是 chrome-extension:// 跨域来的，必须处理
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')  // 不带 cookie，* 即可
  res.setHeader('Access-Control-Allow-Methods', 'POST')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '86400')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

const TOKENS = new Set(['lle_xxxxxxxxxxx'])  // 改成你的 DB / 配置
const safeEq = (a, b) => {
  const ba = Buffer.from(a), bb = Buffer.from(b)
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}
const checkToken = (t) => {
  if (typeof t !== 'string' || !t) return false
  for (const known of TOKENS) if (safeEq(t, known)) return true
  return false
}

app.post('/api/bugs/intake', async (req, res) => {
  if (!checkToken(req.body.token))
    return res.status(401).json({ ok: false, error: 'token 不对' })
  if (!req.body.title?.trim())
    return res.status(422).json({ ok: false, error: '标题不能为空' })

  const id = crypto.randomUUID()
  // TODO: req.body.screenshot / req.body.video 是 data URL，解码后落盘
  // TODO: 把 id + body 存到你的 DB
  res.json({ ok: true, id, status: 'open' })
})

app.post('/api/bugs/:id/status-public', async (req, res) => {
  if (!checkToken(req.body.token))
    return res.status(401).json({ ok: false, error: 'unauthorized' })
  // TODO: 从 DB 查 req.params.id 的当前 status
  res.json({ ok: true, status: 'open' })
})

app.listen(8787)
```

data URL 解码就一行：`Buffer.from(dataUrl.split(',')[1], 'base64')`。MIME 从 `data:` 后面的部分取。

---

## 附录 · 字段速查

**Payload 模板变量**（用户在扩展里编辑模板时可用）：

| 变量 | 内容 |
|---|---|
| `{{token}}` | 项目 token（在「环境」里填的那个）。后端若从 body 读 token 鉴权就用它 |
| `{{title}}` / `{{description}}` | 用户填的标题 / 描述 |
| `{{url}}` / `{{userAgent}}` / `{{viewport}}` / `{{timestamp}}` | 页面环境 |
| `{{image}}` | 截图 data URL（多图时 = 第一张） |
| `{{imagesJson}}` | v0.8.10 起：全部截图的 JSON 数组（`["data:image/png;base64,...", ...]`，含第一张）。模板不引用则不发，老服务端零影响 |
| `{{video}}` / `{{videoDuration}}` / `{{videoBytes}}` | 录像 / 秒 / 字节 |
| `{{requestsJson}}` / `{{errorsJson}}` / `{{elementsJson}}` / `{{storageJson}}` | 抓到的请求 / 错误 / 选中元素 / localStorage 快照（用 `Json` 后缀）|

`{{var}}` 替换为字符串，`{{varJson}}` 替换为 `JSON.stringify(value)`。未匹配的占位符原样保留。

**context 子字段**：

```jsonc
// requests[i]
{ "method":"POST", "url":"...", "status":401, "ok":false,
  "requestHeaders":{...}, "requestBody":"...", "responseBody":"...",  // 截到 20KB
  "duration":312, "startedAt":"2026-05-17T10:00:01.234Z" }

// errors[i]
{ "level":"error",  // error / rejection / console
  "message":"...", "stack":"...",
  "source":"...", "line":42, "col":7,
  "startedAt":"2026-05-17T10:00:01.234Z" }

// elements[i]（用户点「选元素」选中的）
{ "selector":"button.primary", "tag":"button", "text":"登录",
  "rect":{"x":100,"y":200,"w":80,"h":32}, "outerHtml":"..." }

// storage：扁平 { "user_token":"abc", "locale":"zh-CN" }
```
