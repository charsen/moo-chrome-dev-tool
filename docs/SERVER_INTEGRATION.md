# 后端接入指南

你被同事拉来接一下扩展？读完这一份就够了。

你要写两个 HTTP 接口：

| 接口 | 方法 | 作用 |
|---|---|---|
| `<base>/intake` | POST | 收扩展提交的 bug |
| `<base>/<id>/status-public` | GET | 让扩展回查这条 bug 的当前状态 |

`<base>` 是你定的前缀，比如 `https://your-host/api/bugs`。开发者在扩展里填的就是 `<base>/intake`，回查地址扩展自己拼。**提交地址末尾必须是 `/intake`**，扩展靠这个推导回查 URL。

## 提交流程长这样

测试小李在你的网站发现一个 bug，按悬浮球截图、写描述、点提交。扩展把所有东西打成一个 JSON（或 multipart），POST 到 `<base>/intake`，带上你给小李的 token。你的接口收下、存好截图、给它一个 id 返回去。

之后小李在扩展「历史」Tab 想看这条 bug 现在处理到哪了，扩展就 GET `<base>/<id>/status-public`，你返回当前状态（比如「处理中」），扩展显示出来。

## 1. 提交接口

### 鉴权

扩展会同时发两个 header，**你校验任意一个就行**：

```
Authorization: Bearer <token>
X-Scaffold-Token: <token>
```

token 是开发者自己在扩展里填的，由你给每人发一份。比较时用 `hash_equals` / `crypto.timingSafeEqual`，别用 `==`。

### 请求体

默认 `application/json`，长这样：

```jsonc
{
  "title": "登录按钮点了没反应",            // 必填
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

**只有 `title` 必填**，其他都可空。完整字段表在附录 A。

字段名是用户在扩展里编辑的「Payload 模板」生成的——你想叫 `bug_title` 也行，让开发者把模板改了即可。

**大视频场景**：扩展可以切到 `multipart/form-data`，截图和录屏走二进制文件字段（省 33% 体积）。你按 `Content-Type` 分支处理：multipart 时从 file 字段读二进制，转回 base64 跟 JSON 模式对齐。

### 响应

成功（HTTP 2xx）：

```json
{ "ok": true, "id": "01HXX...", "status": "open" }
```

`id` **必返**——扩展存到本地，后续状态回查靠它。`status` 推荐返，扩展会显示出来。

失败（4xx / 5xx）：

```json
{ "ok": false, "error": "token 不对" }
```

`error` 会原样显示给用户，**写人话**别写堆栈。

扩展处理规则：
- **5xx / 网络错** → 自动入重试队列，每 5 分钟扫一次
- **4xx** → 当你拒绝了，不重试，直接提示用户

## 2. 状态回查接口

```
GET <base>/<id>/status-public
```

带同样的 token header（**不带** Content-Type）。返回：

```json
{ "ok": true, "status": "in_progress" }
```

扩展只读 `status`，取值你自己定。推荐：`open` / `in_progress` / `done` / `deleted`。

路径后缀 `-public` 是为了和登录态的内部接口区分，你不用这套区分也行——但**路径模式必须固定**为 `<base>/<id>/status-public`，扩展是写死的。

## 3. 几个坑

- **请求体大小**：录屏 30 秒 base64 后接近 40MB。PHP 设 `post_max_size=60M`、Node `express.json({ limit: '60mb' })`、Nginx `client_max_body_size 60M`。
- **截图录屏别塞数据库**：直接落盘到 `_assets/{date}/{id}.{ext}`，HTTP 服务时加 `Cache-Control: private`（截图可能含敏感信息）。
- **不要信客户端报的提交人字段**：用 token 反查开发者身份，自己写进去。
- **token 别进日志**。
- **定期清理**：`done` 状态留 30 天、`deleted` 留 7 天就够了。

## 4. 最小骨架（Node + Express）

校验 token、存 bug、回查状态——三步全在这里。截图怎么落盘自己选（base64 解码后写文件即可）。

```js
import express from 'express'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'

const app = express()
app.use(express.json({ limit: '60mb' }))

const TOKENS = new Set(['lle_xxxxxxxxxxx'])  // 改成你的 DB / 配置
const tokenOf = req =>
  (req.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  || req.get('X-Scaffold-Token') || ''

app.post('/api/bugs/intake', async (req, res) => {
  if (!TOKENS.has(tokenOf(req)))
    return res.status(401).json({ ok: false, error: 'token 不对' })
  if (!req.body.title?.trim())
    return res.status(422).json({ ok: false, error: '标题不能为空' })

  const id = crypto.randomUUID()
  // TODO: req.body.screenshot / req.body.video 是 data URL，解码后落盘
  // TODO: 把 id + body 存到你的 DB
  res.json({ ok: true, id, status: 'open' })
})

app.get('/api/bugs/:id/status-public', async (req, res) => {
  if (!TOKENS.has(tokenOf(req)))
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
| `{{title}}` / `{{description}}` | 用户填的标题 / 描述 |
| `{{url}}` / `{{userAgent}}` / `{{viewport}}` / `{{timestamp}}` | 页面环境 |
| `{{image}}` | 截图 data URL |
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
