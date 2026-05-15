# 后端接入指南

本扩展（moo-chrome-dev-tool）是**协议无关**的客户端：用户在 Chrome 里截图/录屏/捕获请求与错误，扩展按用户在「环境 Tab」配置的 `payloadTemplate` 渲染后 POST 到任意 HTTP 端点。

要让你自家的 bug 收件箱接收扩展上报，按本文档实现一个 intake 接口即可。

---

## 1. 端到端流程

```
┌───────────────────────────────┐         ┌──────────────────────────────────┐
│ Chrome 扩展                    │         │ 你的后端                          │
│                               │         │                                  │
│  1. 用户触发提交 (悬浮球/快捷键)  │         │                                  │
│  2. 渲染 payloadTemplate       │         │                                  │
│  3. POST endpoint              │ ───►   │  4. 鉴权 token                    │
│     Authorization: Bearer ..   │         │  5. 解析 body / multipart         │
│     X-Scaffold-Token: ...      │         │  6. 截图/视频落盘到 _assets/      │
│                               │         │  7. todo 元数据存 yaml/db        │
│  8. 收到 {ok, id} 写本地历史    │ ◄───   │  → {"ok":true,"id":"<your-id>"} │
│                               │         │                                  │
│  9. 用户在 DevTools「同步状态」  │ ───►   │  10. GET /<id>/status-public      │
│                               │ ◄───   │      {"ok":true,"status":"done"}  │
└───────────────────────────────┘         └──────────────────────────────────┘
```

扩展端关键代码：
- 鉴权 header 注入：`src/background/index.ts` 的 `applyAuthHeaders`
- 模板渲染：`src/utils/template.ts`
- 状态回查：`src/background/index.ts` 的 `refreshHistoryStatus`

---

## 2. 提交接口

### 2.1 路径 & 方法

由用户在「环境 Tab」配置：
- `endpoint` — 任意 HTTP(S) URL（如 `https://example.com/api/bugs/intake`）
- `method` — `POST` / `PUT` / `PATCH`（默认 POST）

扩展不强制路径风格。`status-public` 回查接口的 base URL 通过 `endpoint.replace(/\/intake\/?$/, '')` 推导出来（详见 §6），**所以推荐 endpoint 以 `/intake` 结尾**。

### 2.2 鉴权

扩展在 header 里**同时**注入两个：

| Header | 值 | 说明 |
|---|---|---|
| `Authorization` | `Bearer <token>` | 标准 OAuth-style |
| `X-Scaffold-Token` | `<token>` | 兼容 scaffold 系列 |

后端任选其一校验即可。token 来源是「环境 Tab」里的 **项目级 token**（每开发者一份，不进版本控制）。

> **建议**：
> 维护一个开发账号表 / 文件，token 命中即放行；命中后用账号自身的 username/role 作为 todo 的 submitter，
> **不要**信任客户端传的提交人字段（不安全）。

### 2.3 Content-Type

扩展支持两种格式，用户在 server.imageFormat 里选：

#### A. `application/json`（默认）

`payloadTemplate` 直接作为 JSON body。模板里 `"screenshot": "{{image}}"` 会渲染成 `"screenshot": "data:image/png;base64,iVBOR..."`，整段 base64 inline 在 JSON 里。

**优点**：单一请求易调试。
**缺点**：base64 体积比二进制大 33%，大视频可能让 JSON body 接近 MB 级。

#### B. `multipart/form-data`

扩展把渲染后的模板按 key 拆成 FormData 字段；`imageField`（默认 `screenshot`）作为**二进制文件字段**附在最后，`video` 字段同样如此。

**优点**：图片/视频走二进制，节省 33% 体积，更易直传对象存储。
**缺点**：实现略多一步（要处理 file 字段）。

后端应**两种都支持**，按 Content-Type 分支：

```php
if ($request->isJson()) {
    $payload = $request->json()->all();
} else {
    $payload = $request->all();
    // multipart：图片/视频作为 UploadedFile，转 data URL 后跟 JSON 模式对齐
    if ($file = $request->file('screenshot') ?? $request->file('image')) {
        $bin = file_get_contents($file->getRealPath());
        $payload['screenshot'] = 'data:'.$file->getMimeType().';base64,'.base64_encode($bin);
    }
    if ($video = $request->file('video')) {
        $bin = file_get_contents($video->getRealPath());
        $payload['video'] = 'data:'.$video->getMimeType().';base64,'.base64_encode($bin);
    }
}
```

---

## 3. 模板变量 cheat sheet

`payloadTemplate` 渲染规则（见 `src/utils/template.ts`）：

- `{{var}}` → `String(value)`，null/undefined 替换为空字符串
- `{{varJson}}` → `JSON.stringify(value)`（用于内嵌数组/对象到 JSON 模板里）
- 未匹配的 `{{xxx}}` 原样保留（方便调试）

可用变量：

| 变量 | 类型 | 内容 |
|---|---|---|
| `{{title}}` | string | 用户填写的标题 |
| `{{description}}` | string | 用户填写的描述（多行） |
| `{{url}}` | string | 当前页面 URL |
| `{{userAgent}}` | string | navigator.userAgent |
| `{{viewport}}` | string | `1920x1080` 形式 |
| `{{timestamp}}` | string | ISO 8601 |
| `{{image}}` | string | `data:image/png;base64,...` 或空 |
| `{{video}}` | string | `data:video/webm;base64,...` 或空 |
| `{{videoBytes}}` | number | 字节数 |
| `{{videoDuration}}` | number | 秒 |
| `{{requestsJson}}` | JSON array | 见 §4.1 |
| `{{errorsJson}}` | JSON array | 见 §4.2 |
| `{{elementsJson}}` | JSON array | 见 §4.3 |
| `{{storageJson}}` | JSON object | localStorage 白名单快照 |

**默认 `payloadTemplate`**（`src/types/config.ts` 的 `DEFAULT_PAYLOAD_TEMPLATE`）：

```jsonc
{
  "title": "{{title}}",
  "description": "{{description}}\n\n页面: {{url}}\nUA: {{userAgent}}\n视口: {{viewport}}\n时间: {{timestamp}}",
  "screenshot": "{{image}}",
  "video": "{{video}}",
  "video_duration": {{videoDuration}},
  "video_bytes": {{videoBytes}},
  "context": {
    "url": "{{url}}",
    "userAgent": "{{userAgent}}",
    "requests": {{requestsJson}},
    "errors": {{errorsJson}}
  }
}
```

用户可在「环境 Tab」改写模板，把字段重命名成你后端期望的名字。例如 `"reporter": "{{userAgent}}"`。

---

## 4. 上下文数据结构

### 4.1 requests（CapturedRequest[]）

来自 MAIN-world 注入脚本的 fetch / XHR 抓取（`src/injected/main-world.ts`）。

```ts
{
  id: string
  kind: 'fetch' | 'xhr'
  method: string                          // 'GET' / 'POST' / ...
  url: string
  requestHeaders: Record<string, string>  // 经过 redact 脱敏
  requestBody: string | null              // 非 string 体（FormData/Blob）记为 '[非字符串体]'
  status: number                          // HTTP status，网络错误为 0
  ok: boolean
  responseHeaders: Record<string, string>
  responseBody: string | null             // 截断到 20KB
  responseSizeBytes: number
  startTime: number                       // 网页 performance.now()
  duration: number                        // ms
  startedAt: string                       // ISO timestamp（跨上下文比较用这个）
  error?: string                          // 仅网络错误时有
}
```

### 4.2 errors（ConsoleError[]）

`window.onerror` / `unhandledrejection` / `console.error` 三种来源：

```ts
{
  id: string
  level: 'error' | 'rejection' | 'console'
  message: string
  stack?: string
  source?: string                         // 出错文件
  line?: number
  col?: number
  startedAt: string                       // ISO
  startTime: number                       // 网页 performance.now()
}
```

### 4.3 elements（PickedElement[]）

用户在 SubmitDialog「附带元素」里用 element picker 选中的 DOM：

```ts
{
  selector: string                        // 精简的 CSS selector
  tag: string                             // 'button' / 'div' / ...
  id: string | null
  classes: string[]
  text: string                            // innerText（前 200 字符）
  rect: { x: number; y: number; w: number; h: number }
  attributes: Record<string, string>
  outerHtml: string
  path: string[]                          // 从 body 到该元素的 tag 路径
}
```

### 4.4 storage

按项目「localStorage 白名单」配置抓取的 key/value（localStorage 优先，未找到尝试 sessionStorage）：

```ts
{ "user_token": "abc...", "locale": "zh-CN" }
```

---

## 5. 响应规范

### 5.1 成功

HTTP 2xx + JSON body：

```json
{
  "ok": true,
  "id": "01krn592qkc1v1s1htc0dpzsqr",
  "status": "open",
  "url": "https://your-host/admin/bugs/01krn592qkc1v1s1htc0dpzsqr"
}
```

- `id`（**必须**）—— 你后端为这条 todo 分配的唯一 ID。扩展会把它写入本地历史，后续状态回查靠它定位记录。
- `status`（推荐）—— 初始状态。扩展不强制取值集合，scaffold 用 `open` / `in_progress` / `done` / `deleted`。
- `url`（可选）—— 后端 UI 详情页 URL。扩展暂未展示，但便于未来打通。

### 5.2 失败

HTTP 4xx/5xx + JSON body：

```json
{
  "ok": false,
  "error": "token not recognized"
}
```

- HTTP **5xx + 网络错误**：扩展会自动入**重试队列**（`chrome.alarms` 每 5 分钟扫一次，最多重试若干次后丢弃）。
- HTTP **4xx**：当作客户端错误，**不重试**，错误文案直接 toast。

扩展收到的 status / body 都会原样存到 `BugHistoryEntry.result`，便于用户在 History Tab 里看完整响应。

---

## 6. 状态回查接口

用户在 DevTools 「历史 Tab」点「同步远端状态」时，扩展对每条本地记录请求：

```
GET  {remoteBase}/{remoteId}/status-public
```

- `remoteBase` = `endpoint.replace(/\/intake\/?$/, '')`。例如 endpoint 是 `https://x.com/api/bugs/intake`，base 就是 `https://x.com/api/bugs`。
- `remoteId` = 当初 intake 响应里的 `id`。
- 请求带回 `Authorization` / `X-Scaffold-Token` header（来自原始请求保留的 token），**不带 Content-Type**。

返回：

```json
{ "ok": true, "status": "in_progress" }
```

扩展只关心 `status` 字段——其他随意。

> **提示**：路径里带 `-public` 是 scaffold 用来跟 web 后台的 `/{id}/status`（要登录态）区分的；你的后端起什么名都行，但路径模式必须是 `{base}/{id}/status-public` 才能被扩展找到。

---

## 7. 体积 / 安全 / 限流建议

### 7.1 体积

- 单张截图 1080p PNG ~600KB（base64 后 ~800KB）
- 30 秒 1080p 视频 ~10-15MB（base64 后 ~15-20MB）
- 默认 max video bytes 30MB

PHP 端别忘了：

```ini
post_max_size = 60M
upload_max_filesize = 60M
```

### 7.3 鉴权细节

- token 比对用 `hash_equals` / `crypto.timingSafeEqual`，避免时序攻击
- 禁用账号要尽快剔除（扩展端没有 token 失效感知，每次提交都会带）
- 不要把 token 写日志

### 7.4 截图/视频存储

- 直接落盘到 `_assets/{date}/{id}.{ext}`，不要塞数据库
- 路径里带日期方便后续按时间清理
- HTTP 服务这些文件时记得加 `Cache-Control: private`（含敏感截图）

### 7.5 自动清理

scaffold 实现了 `php artisan moo:todo:prune`：done 状态保留 30 天，deleted 状态保留 7 天。建议你也做一个定时清理 cron。

---

## 8. 最小可行示例（Node.js / Express）

```js
import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'

const app = express()
app.use(express.json({ limit: '60mb' }))

const TOKENS = new Set(['lle_xxxxxxxxxxx', 'lle_yyyyyyyyyyy'])  // 简化
const STORE = './data'

app.post('/api/bugs/intake', async (req, res) => {
  const token = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '')
                || req.get('X-Scaffold-Token') || ''
  if (!TOKENS.has(token)) {
    return res.status(401).json({ ok: false, error: 'token not recognized' })
  }

  const id = crypto.randomUUID()
  const { title, description, screenshot, video } = req.body
  if (!title?.trim()) return res.status(422).json({ ok: false, error: 'title required' })

  // 落盘截图 / 视频
  const date = new Date().toISOString().slice(0, 10)
  const dir = path.join(STORE, '_assets', date)
  await fs.mkdir(dir, { recursive: true })

  let shotFile = null, videoFile = null
  if (screenshot?.startsWith('data:image/')) {
    const [, mime, b64] = screenshot.match(/^data:([^;]+);base64,(.+)$/) || []
    if (b64) {
      const ext = mime === 'image/jpeg' ? 'jpg' : 'png'
      shotFile = `${date}/${id}.${ext}`
      await fs.writeFile(path.join(STORE, '_assets', shotFile), Buffer.from(b64, 'base64'))
    }
  }
  if (video?.startsWith('data:video/')) {
    const [, mime, b64] = video.match(/^data:([^;]+);base64,(.+)$/) || []
    if (b64) {
      const ext = mime === 'video/mp4' ? 'mp4' : 'webm'
      videoFile = `${date}/${id}.${ext}`
      await fs.writeFile(path.join(STORE, '_assets', videoFile), Buffer.from(b64, 'base64'))
    }
  }

  // 元数据
  const todo = {
    id, status: 'open',
    title, description,
    screenshot: shotFile,
    video: videoFile,
    context: req.body.context,
    created_at: new Date().toISOString()
  }
  await fs.writeFile(path.join(STORE, `${id}.json`), JSON.stringify(todo, null, 2))

  res.json({ ok: true, id, status: 'open' })
})

app.get('/api/bugs/:id/status-public', async (req, res) => {
  // 同样校验 token...
  try {
    const todo = JSON.parse(await fs.readFile(path.join(STORE, `${req.params.id}.json`), 'utf8'))
    res.json({ ok: true, status: todo.status })
  } catch {
    res.status(404).json({ ok: false, error: 'not found' })
  }
})

app.listen(8787)
```

---

## 9. 最小可行示例（Python / Flask）

```python
from flask import Flask, request, jsonify
from pathlib import Path
import base64, json, re, uuid
from datetime import datetime, timezone

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 60 * 1024 * 1024
STORE = Path('./data')
TOKENS = {'lle_xxxxxxxxxxx'}

def check_token():
    bearer = (request.headers.get('Authorization') or '').removeprefix('Bearer ').strip()
    fallback = request.headers.get('X-Scaffold-Token') or ''
    return bearer in TOKENS or fallback in TOKENS

def save_data_url(data_url: str, todo_id: str, kind: str):
    m = re.match(r'^data:([^;]+);base64,(.+)$', data_url or '')
    if not m: return None
    mime, b64 = m.group(1), m.group(2)
    ext = {'image/jpeg': 'jpg', 'image/png': 'png',
           'video/webm': 'webm', 'video/mp4': 'mp4'}.get(mime, 'bin')
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    out = STORE / '_assets' / today / f'{todo_id}.{ext}'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(base64.b64decode(b64))
    return f'{today}/{todo_id}.{ext}'

@app.post('/api/bugs/intake')
def intake():
    if not check_token():
        return jsonify(ok=False, error='token not recognized'), 401
    p = request.get_json(silent=True) or request.form.to_dict()
    if not (p.get('title') or '').strip():
        return jsonify(ok=False, error='title required'), 422
    tid = uuid.uuid4().hex
    shot = save_data_url(p.get('screenshot'), tid, 'image')
    video = save_data_url(p.get('video'), tid, 'video')
    todo = {
        'id': tid, 'status': 'open',
        'title': p['title'], 'description': p.get('description', ''),
        'screenshot': shot, 'video': video,
        'context': p.get('context'),
        'created_at': datetime.now(timezone.utc).isoformat(),
    }
    (STORE / f'{tid}.json').write_text(json.dumps(todo, ensure_ascii=False, indent=2))
    return jsonify(ok=True, id=tid, status='open')

@app.get('/api/bugs/<tid>/status-public')
def status(tid):
    if not check_token():
        return jsonify(ok=False, error='unauthorized'), 401
    f = STORE / f'{tid}.json'
    if not f.exists():
        return jsonify(ok=False, error='not found'), 404
    return jsonify(ok=True, status=json.loads(f.read_text())['status'])
```