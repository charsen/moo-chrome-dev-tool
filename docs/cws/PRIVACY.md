# Moo Dev Tool 隐私政策 / Privacy Policy

**最后更新：2026-05-25 / Last updated: 2026-05-25**

---

## 中文版

### 一句话总结

Moo Dev Tool 是一个本地 bug 上报工具，**不向 Moo 自有服务器发送任何数据**（Moo 没有服务器）。所有数据要么存在你浏览器本地（chrome.storage.local），要么由你主动点「提交」时按你自己配置的目标地址发送。

### Moo 会访问哪些数据

Moo 的 content script 在所有网页注入（manifest content_scripts.matches=`<all_urls>`），但 content script **只做以下两件事**：
- (a) 后台监听 fetch/XHR 请求 + console 错误（仅在你**事先配置匹配 URL 的项目**页面才挂悬浮球 + 真正抓数据；其它页面 content script 安装但什么都不做）
- (b) 等你主动点悬浮球或快捷键截图触发

**只在你主动操作时**抓数据，不持续上传 / 不后台收集：

1. **当前网页的网络请求 / 控制台错误**：你点悬浮球或快捷键截图时，Moo 抓取你**事先配置匹配的网页**最近 30 秒的 fetch/XHR 请求 + console 错误，作为 bug 报告的附带证据。
2. **截图 / 录屏**：你按 ⌥⇧R 启动录屏，或点截图按钮时，Moo 调用 Chrome 标准 API 抓当前标签页画面。**任何时候不会自动后台录屏。**
3. **页面 localStorage / sessionStorage**：仅当你在项目配置里指定了「白名单 key」时，Moo 在你提交 bug 那一刻读取这些 key 的值。
4. **UserAgent / 视口尺寸**：跟随 bug 报告一起发出。

### Moo 会**长期保存**哪些数据（全在浏览器本地）

- 你的项目配置（含禅道账号 / 自建上报服务器 URL / token）：chrome.storage.local
- 提交历史（含上次提交的截图缩略图 / 描述 / 远端 bug id）：chrome.storage.local
- 失败重试队列（5 分钟自动重试一次）：chrome.storage.local

**这些数据全部存在你的 Chrome profile 里。卸载扩展即删除。Moo 不向任何第三方发送这些数据。**

### Moo 会向哪里**发送**数据

只在你点「提交 bug」时，按**你自己配置的目标**发送：

- **禅道集成模式**：发送到你配置的禅道实例（如 `https://your-zentao.example.com`）
- **Webhook 模式**：发送到你配置的 server endpoint URL

**Moo 没有自有服务器，从不向 moo.example 之类的地方发数据。** 上报地址完全由你决定。

### 权限说明

| 权限 | 用途 |
|---|---|
| `storage` | 存项目配置 / 提交历史 / 重试队列（本地）|
| `tabs` | 抓当前标签页 URL（作为 bug 报告字段）|
| `scripting` | 注入 content script 抓请求 / 错误；按白名单读 localStorage |
| `alarms` | 定时跑重试队列（5 分钟）+ 版本检查（24 小时）|
| `offscreen` | MV3 录屏架构要求（在 offscreen document 内调 MediaRecorder）|
| `tabCapture`（可选）| 录屏；仅在你 popup 主动启用后授权 |
| `<all_urls>` host（可选）| fetch 你配置的上报服务器；仅在你 popup 主动启用后授权 |

### 你的控制权

- **数据可导出**：DevTools → Moo → 环境 → 「导出配置」按钮（导出 JSON，密码字段自动剥离）
- **数据可清空**：卸载扩展 = 删除所有本地数据；或单独清空 History tab / 重试队列
- **录屏 / 上报权限可关**：popup 双开关，关闭后扩展不再调用对应 API

### 联系方式

代码开源在 [Gitee](https://gitee.com/charsen/moo-chrome-dev-tool)。issue 反馈走仓库 issues。

---

## English Version

### TL;DR

Moo Dev Tool is a local bug-reporting utility. **It does not send any data to Moo's own servers** (Moo has none). All data is either stored in your browser's local storage (chrome.storage.local) or forwarded to a destination YOU configure when you click "Submit".

### Data Accessed

Moo's content script is registered on all URLs (manifest `content_scripts.matches=<all_urls>`), but the content script **only does these two things**:
- (a) Passively listens for fetch/XHR requests + console errors (mounts the floating ball + actually captures data **only on pages matching your configured project patterns**; on other pages the content script is installed but inert)
- (b) Waits for your active trigger (floating ball click / keyboard shortcut)

Moo accesses data **only when you actively trigger it**, never as background upload / collection:

1. **Network requests / console errors of the current page**: when you click the floating ball or press the screenshot shortcut, Moo captures the last 30 seconds of fetch/XHR requests + console errors **of pages matching your configured patterns**, as evidence attached to the bug report.
2. **Screenshots / screen recording**: when you press ⌥⇧R or the screenshot button, Moo calls standard Chrome APIs to capture the current tab. **Moo never records in the background unbidden.**
3. **Page localStorage / sessionStorage**: only if you whitelist specific keys in project config — Moo reads those keys at the moment you submit a bug.
4. **UserAgent / viewport**: sent as part of the bug report.

### Data Stored Long-Term (all local to your browser)

- Project config (including Zentao credentials / webhook server URLs / tokens): chrome.storage.local
- Submission history (including thumbnails of past screenshots / descriptions / remote bug IDs): chrome.storage.local
- Failed-submission retry queue (auto-retries every 5 minutes): chrome.storage.local

**All stored in your Chrome profile. Uninstalling the extension deletes it. Moo does not send this data to any third party.**

### Data Sent (only to your configured destinations)

Only when you click "Submit bug", sent to **destinations YOU configure**:

- **Zentao integration**: to your configured Zentao instance (e.g. `https://your-zentao.example.com`)
- **Webhook mode**: to your configured server endpoint URL

**Moo has no servers of its own and never sends data to anywhere like moo.example.** The submission destination is entirely your choice.

### Permissions

| Permission | Purpose |
|---|---|
| `storage` | Store project config / submission history / retry queue (locally) |
| `tabs` | Read current tab URL (as a bug report field) |
| `scripting` | Inject content script to capture requests / errors; read whitelisted localStorage |
| `alarms` | Schedule retry queue (5 min) + version check (24 hr) |
| `offscreen` | Required by MV3 architecture for recording (MediaRecorder in offscreen document) |
| `tabCapture` (optional) | Screen recording; granted only after you enable it in the popup |
| `<all_urls>` host (optional) | Fetch your configured submission server; granted only after you enable it in the popup |

### Your Control

- **Export data**: DevTools → Moo → Environment → "Export config" button (JSON export, password fields auto-stripped)
- **Clear data**: uninstall extension to delete all local data; or clear individual History tab / retry queue
- **Toggle recording / submission permission**: dual switches in popup, disabling stops the extension from calling the corresponding APIs

### Contact

Source code open at [Gitee](https://gitee.com/charsen/moo-chrome-dev-tool). Feedback via repository issues.
