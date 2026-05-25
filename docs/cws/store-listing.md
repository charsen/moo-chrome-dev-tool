# Chrome Web Store Listing 物料

填到 https://chrome.google.com/webstore/devconsole/ 的「Store listing」/「Privacy practices」字段。

---

## 短描述（Short description）

**字数上限 132 字符**。CWS 列表页 + 搜索结果显示。

### 中文（推荐主语言）

```
开发者 bug 上报工具：截图 / 录屏 / 请求快照 + console 错误一键提交到禅道或自建 webhook。本地存储 0 上传。
```
（59 字符 / 132 字符上限）

### English

```
Developer bug-reporting tool: screenshot / screen-recording / network-request capture, one-click submit to Zentao or custom webhook.
```
（128 字符 / 132 字符上限）

---

## 详细说明（Detailed description）

**字数上限 16000 字符**。listing 页正文展示。

### 中文版

```
Moo Dev Tool 是一个面向开发 / QA / 业务测试的 Chrome 扩展，把「现场截图、关键请求、控制台错误、可选录屏」打成一次 bug 报告，直接发到禅道（v17+）或你自建的上报服务器。

🎯 解决什么问题

测试或同事踩到 bug 时，常见的「报告流程」是：
- 自己截图、再复制粘贴报错、再描述步骤、再找开发对接……
- 信息散在 4 个地方（截图工具 / 浏览器 console / 网络面板 / IM 文字）

Moo 把这条链路压到 1 次点击：截图 → 自动附带最近 30s 网络请求 + console errors → 你写标题描述 → 提交到禅道 / webhook。

⚙️ 主要功能

- 悬浮球截图：在你「事先配置匹配的网页」自动注入悬浮球，点一下截图
- ⌥⇧R 录屏：MV3 offscreen + tabCapture 录当前标签页
- 自动抓数据：最近 30s 的 fetch/XHR 请求 + console 错误 / warning + 元素堆栈
- 禅道集成：自动登录 → 提交 bug → 附件上传 → 拿到禅道 bug 链接
- Webhook 模式：JSON / multipart 模板自定义，发到你自建的 server
- History tab：失败的提交自动入队 5 分钟重试；提交后跟进禅道侧状态
- 隐私优先：密码 / token 导出时自动剥离，敏感字段批量 redact

🔒 隐私

- 不向 Moo 自有服务器发任何数据（Moo 没有服务器）
- 所有配置 / 历史存浏览器本地（chrome.storage.local），卸载即删
- 提交地址完全由你配置（禅道实例 / 自建 webhook URL）
- 录屏、上报权限走 optional permission — 你 popup 主动启用一次即可

📂 开源

代码 + 文档：https://gitee.com/charsen/moo-chrome-dev-tool
隐私政策：https://gitee.com/charsen/moo-chrome-dev-tool/blob/master/docs/cws/PRIVACY.md

⚡ 快速上手

1. 安装后右上角点 Moo 图标，开「允许向上报服务器发送请求」+「录屏功能」
2. F12 打开 DevTools → Moo → 环境，配项目（禅道 or webhook）
3. 在你匹配的页面看到悬浮球 → 点截图 → 填标题 → 提交

技术：Vue 3 + TypeScript + Vite + closed shadow DOM + MV3 service worker，所有代码 open source。
```

### English

```
Moo Dev Tool is a Chrome extension for developers / QA / business testers that packages "screenshot + recent network requests + console errors + optional screen recording" into a one-click bug report, sent directly to Zentao (v17+) or your custom webhook server.

🎯 Problem solved

When testers hit a bug, the usual reporting flow is:
- Take a screenshot, paste error logs, write reproduction steps, ping a developer
- Information scattered across 4 tools (screenshot app / browser console / network panel / IM)

Moo collapses this into one click: screenshot → auto-attach last 30s of network + console errors → write title → submit to Zentao / webhook.

⚙️ Features

- Floating ball screenshot on configured URL patterns
- ⌥⇧R screen recording (MV3 offscreen + tabCapture)
- Auto-capture last 30s fetch/XHR requests + console errors + element stacks
- Zentao integration: auto-login → submit → upload attachments → return bug link
- Webhook mode: customizable JSON / multipart templates
- History tab: failed submissions auto-queue for retry every 5 min; track Zentao-side status
- Privacy-first: passwords / tokens stripped on export; sensitive fields batch-redact

🔒 Privacy

- Sends NO data to Moo's own servers (Moo has none)
- All config / history stored locally in chrome.storage.local; deleted on uninstall
- Submission destination entirely user-configured (Zentao instance / webhook URL)
- Recording + submission permissions go through optional permissions — enable once in the popup

📂 Open source

Code + docs: https://gitee.com/charsen/moo-chrome-dev-tool
Privacy policy: https://gitee.com/charsen/moo-chrome-dev-tool/blob/master/docs/cws/PRIVACY.md

⚡ Quickstart

1. After install, click the Moo icon top-right, enable "Allow requests to submission server" + "Recording"
2. Open DevTools → Moo → Environment tab, configure a project (Zentao or webhook)
3. See the floating ball on matched pages → click screenshot → fill title → submit

Tech: Vue 3 + TypeScript + Vite + closed shadow DOM + MV3 service worker, all open source.
```

---

## Category / Tags / Language

- **Category**: `Developer Tools`
- **Language**: Chinese (Simplified) — 主语言；可加 English 副
- **Country availability**: All countries（除非你想限制）

---

## Permissions Justification

CWS 后台「Permissions」页每个 permission 单独一段。评审员逐字看。**写英文**（评审员主要英文）。

### `storage`

```
Used to store user-configured project profiles (matching URL patterns, submission server endpoints, optional Zentao credentials) and submission history locally via chrome.storage.local. No data is sent to any third party; all storage is in the user's own Chrome profile and deleted on extension uninstall.
```

### `tabs`

```
Used to read the active tab's URL when the user clicks the floating ball or triggers a screenshot, so that the bug report includes the page on which the issue occurred. The URL is only captured at the moment of user action, never continuously polled.
```

### `scripting`

```
Used to inject a content script that captures recent fetch/XHR requests and console errors on user-matched pages. Also used (with user opt-in via project whitelist) to read specific localStorage / sessionStorage keys at submission time, as additional bug-report context. No content is captured outside the user's matched-URL patterns.
```

### `alarms`

```
Used to schedule two background tasks: (1) retry queue for failed submissions, running every 5 minutes when the user is online; (2) version check against the public Gitee releases API, running every 24 hours to notify the user of new versions (since this extension is currently distributed outside the Web Store as well).
```

### `offscreen`

```
Required by Manifest V3 architecture for screen recording: MediaRecorder cannot run directly in a service worker, so the extension creates an offscreen document to host the recording session. The offscreen document is created only when the user triggers recording via the ⌥⇧R shortcut, and destroyed immediately after recording stops.
```

### `tabCapture` (optional)

```
Used to capture the active tab's video for screen recording, so that the user can attach a recording to the bug report. This permission is OPTIONAL and granted only after the user explicitly enables "Recording" in the extension popup. The recording is processed entirely locally (no cloud upload) and attached to the user-submitted bug report at the user's choice.
```

### `<all_urls>` host permission (optional)

```
Required to (1) fetch the user-configured bug-submission server endpoint (which can be any URL the user enters — webhook, Zentao instance, etc.), and (2) inject a content script on pages matching user-configured URL patterns to capture network requests for the bug report. This permission is OPTIONAL_HOST_PERMISSIONS and granted only after the user explicitly enables "Allow requests to submission server" in the extension popup. The extension never sends any data to its own servers (it has none); all network activity targets user-configured destinations.
```

---

## Data Usage Declarations

CWS 后台「Privacy practices」页填表勾选。

**What types of user data are collected?** 勾以下（其它不勾）：

- ✅ Personally identifiable information — user-provided credentials (Zentao password / webhook token, stored locally)
- ✅ Authentication information — same as above, classified by CWS as "auth info"
- ✅ Personal communications — bug report titles / descriptions written by user (technically PII because user types them)
- ✅ Website content — screenshots, network requests, console errors captured from user-matched pages
- ❌ Health info / Financial info / Location / Web history / User activity（不收集）

**For each checked type**, declare:

```
Used for: 
  - Performing the extension's single purpose: packaging bug reports for user-initiated submission
  - Submission to user-configured external destinations (Zentao / webhook)

NOT used for:
  - NOT sold to third parties
  - NOT used to determine creditworthiness or lending
  - NOT used for purposes unrelated to the extension's single purpose
  - NOT shared with any party except the user-configured submission destination

Stored: locally in chrome.storage.local; deleted on extension uninstall.
```

**Privacy policy URL**: 填你托管 PRIVACY.md 的 URL，推荐 https://gitee.com/charsen/moo-chrome-dev-tool/blob/master/docs/cws/PRIVACY.md

**Single purpose**: 填

```
Capture and submit bug reports (screenshot + network requests + console errors + optional screen recording) to user-configured Zentao or webhook endpoints.
```

---

## 截图清单（你拍 / 不能让 AI 代拍）

5 张，1280×800 或 640×400 PNG，**严禁真名 / 真实公司域 / 真账号**，建议用一个 demo 项目 + 假数据：

| # | 截图内容 | 拍摄场景 |
|---|---|---|
| 1 | popup 主界面 + 双开关 | 点 toolbar Moo 图标，截 popup 完整页面 |
| 2 | DevTools → Moo → 环境 配置 | DevTools 内 Moo 面板「环境」tab，展示 zentao 或 webhook 配置（**截前清空真实信息**）|
| 3 | 悬浮球 + 截图按钮 | 一个 demo 页面（example.com 之类）右下角悬浮球展开状态 |
| 4 | SubmitDialog 提交对话框 | 截图后弹出的提交 dialog，含截图缩略图 + 类型 / 优先级下拉 |
| 5 | History tab 提交历史 | DevTools → Moo → History tab，展示提交记录列表（用 demo 数据）|

每张右下角可加水印 `v0.6.x` 表明版本。

---

## 提交流程

1. https://chrome.google.com/webstore/devconsole/ 登录
2. 左上角「New item」上传 `release/moo-chrome-dev-tool-X.Y.Z.zip`
3. 填 Store listing（中英文短描述 + 详细说明 + 5 张截图 + Promotional images 选填）
4. 填 Privacy practices（勾数据类型 + 隐私政策 URL）
5. 填 Single purpose + Permissions justification（贴上面 7 段）
6. Distribution → Public（或 Unlisted 内部测）
7. Submit for review → 1-3 天审核

首次审核常被打回，准备好接邮件改物料。
