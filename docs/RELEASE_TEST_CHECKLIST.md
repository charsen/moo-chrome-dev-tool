# 发版前真机实测清单

> 每次 BREAKING / 大改提交链路的版本，**push 之前**走一遍。
> 自动化覆盖不了的部分：CORS 预检、真实 chrome-extension 跨域、multipart 上传、SW fetch 重试、UI toast 文案。

## 怎么用

- 不依赖 MCP——chrome-devtools-mcp 用独立 profile + `--disable-extensions`，**测不了真扩展**
- 人肉跑：把 `pnpm build` 出的 `dist/` 重新加载到 Chrome（`chrome://extensions` → Moo → 「重新加载」）
- 全绿才 `pnpm release` + push；任何一条红就回去修
- SW DevTools 路径：`chrome://extensions` → Moo 卡片底部「service worker」蓝字 → 打开 → console / 网络 Tab

## v0.1.11 BREAKING — webhook 化基线

| # | 场景 | 操作 | 期望 | ☐ |
|---|---|---|---|---|
| 1 | 默认模板 happy path | gy 站新建项目 + 新建 server + 默认模板 → 悬浮球截图 → 写标题 → 提交 | toast「提交成功 (HTTP 200)」；历史多一条；scaffold todos UI 能看到 | ☐ |
| 2 | 带录屏 JSON 提交 | 同 #1 但 `⌥⇧R` 录 5 秒再截图提交 | 200；后端能解出 video（dataUrl 形态）| ☐ |
| 3 | multipart 模式 | 把 server 切到 `multipart`，重提一遍 #1 | 200；scaffold 收到的 token 在顶层 form 字段；截图是 file 字段 | ☐ |
| 4 | 状态回查 POST | 提交一条 → 在 scaffold todos UI 把状态改成「处理中」→ 回扩展「历史」Tab 点「同步状态」 | toast「已更新 N 条」（N≥1）；条目状态变成「处理中」| ☐ |
| 5 | 登录态下提交不撞 CSRF | 浏览器**先**登录 `app.example.com/scaffold`（拿到 session cookie），**然后**在同域页面用扩展提交 | 200，不出现 419；证明 webhook 接口拆出 group 生效 | ☐ |
| 6 | 跨 engine 后端 | wn 站对应 accounts.yaml 加你账号 token → 重启 wn 后端 → 扩展项目 endpoint 改 `app2.example.com/scaffold/todos/intake` → 提交 | 200；证明同份 moo-scaffold 在不同 engine 都跑通 | ☐ |
| 7 | 网络异常 + 重试 | 关掉后端进程 → 提交一条（无录屏）→ 等 toast → 等 5 分钟后看 SW console 是否自动重试 | toast 形态是「提交失败：Failed to fetch」，加一行「已加入重试队列」；5 分钟后 console 看到重试动作 | ☐ |

## v0.1.12 — 染色 + 快捷键

| # | 场景 | 操作 | 期望 | ☐ |
|---|---|---|---|---|
| 8 | 失败行左色条 | 故意触发一个 404（比如改前端请求路径） + 一个 500（后端 throw） → DevTools Moo 面板 Overview Tab 看那两行；再开提交弹窗看请求列表 | 404 那行左 3px 橙色条；500 那行左 3px 红色条；status chip 颜色不变 | ☐ |
| 9 | 慢请求 duration 染色 | 后端故意 `sleep(2)` 跑一个接口 → Overview 看那行；同样去提交弹窗看 | duration `2000ms` 显示橙色加粗；如果 `sleep(4)` 则红色加粗 | ☐ |
| 10 | `Alt+Shift+M` 开 popup | 任意网页焦点下按 `Alt+Shift+M` | toolbar popup 弹出来，显示项目匹配状态 + 录屏开关；第二次按再开会失败（已打开），SW console 有一行 warn | ☐ |
| 11 | JSON viewer · 格式化 + 染色 | 触发一个返回 JSON 的请求 → Overview 展开行 → 看 Response Body 段 | toolbar 显示「JSON」chip + 「格式化/原文」按钮；默认 pretty + 染色（key 蓝 / string 绿 / number 橙 / bool 加粗 / null 灰斜体）。点切到原文 = 单行紧凑。复制按钮可复制当前显示态文本 | ☐ |
| 12 | JSON viewer · 大 body 折叠 | 触发一个返回 >3KB JSON 的请求（比如 list API 一次拉 100 条） | body 区只显示前一段 + 底部出现「展开剩余 X K 字符」按钮；点了展开全文 | ☐ |
| 13 | 错误 stack 染色 | 在页面 console 跑 `setTimeout(() => { throw new Error('boom') })` → Overview 错误行展开 → 看 Stack 段 | 函数名加粗、文件路径中灰、`:line:col` 弱灰；不是平的一坨等宽字 | ☐ |
| 14 | popup 最近提交区 | 至少做过一次提交后开 popup（点扩展图标 / 按 `Alt+Shift+M`） | 底部出现「最近提交」section，第 1 条是 prominent 卡，往下最多 2 条 compact 行；状态 chip 颜色与含义匹配；点任意一条 → 新 tab 打开当时所在页面 url | ☐ |
| 15 | toolbar 图标 badge | 故意制造一次失败提交（endpoint 填错 / 401 token） | 扩展图标右下角出现红色 badge 数字 `1`；再失败一次变 `2`；去 History tab 删掉这两条，badge 应该消失（依赖 `onHistoryChanged`） | ☐ |

## v0.1.12 第二批 — refactor / 体验补完

| # | 场景 | 操作 | 期望 | ☐ |
|---|---|---|---|---|
| 16 | 按钮样式系统化（视觉一致） | 走一遍 Environment / Overview / History 三个 Tab，看所有按钮 | 同尺寸（普通 28px / 小号 24px）、同字号、同 hover 反馈；Environment 「+ 新建项目」「↓」「↑」按钮跟「+ 新建服务器」一套视觉；Overview toolbar 自动刷新 toggle 开启时品牌色软底；History 「清空」红字 | ☐ |
| 17 | 深色模式硬编码扫尾 | 系统偏好切到深色 → 打开 DevTools Moo 面板：① 删除项目时看 ConfirmModal 背景半透明 ② Settings 鼠标悬浮某一行 ③ History 提交带录像的条目看视频缩略图 | ① 黑色半透明 backdrop（不是纯黑 / 透明 / 过亮）② 行 hover 极轻提亮（不刺眼）③ 视频缩略图块是 slate-600 灰（不是纯黑融进背景，能看清是个「视频块」） | ☐ |
| 18 | 提交失败横幅 + 一键重试 | 故意把 endpoint 改成假 URL → 提交（不带录像）→ 看 dialog；按横幅里的「重试」按钮（不改任何字段）；再把 endpoint 改对，按 footer「重试」 | 失败后 footer 上方出现红色横幅含「⚠ 提交失败」+ 失败原因 + 「重试」按钮；footer「提交」按钮文字变「重试」；按重试时正确再发请求；改对后重试成功 → 横幅消失走成功视图。**再带录像跑一次**：横幅多一行明确提示「关窗后只能去 历史 Tab 重提」 | ☐ |
| 19 | Settings ↔ Environment 多 Tab 同步 | 打开 DevTools Moo 面板 → Settings Tab 看一下当前项目；切到 Environment Tab 改一下项目名（比如加个空格）；等 1 秒；切回 Settings | Settings 那边显示的项目名 = Environment 改后的；以前 Settings 读 loadConfig 一次性，不监听变化，会显示旧名（这一版应已修） | ☐ |
| 20 | 元素「清空」两步确认 | 提交弹窗里 → 「📍 选元素」挑 ≥2 个 DOM → 点「清空」一次 | 按钮文字变「再点一下确认清空」+ 变红 + 微弱脉动；3 秒不点 → 自动复位；3 秒内再点 → 真清；**单个元素时**直接清不走二步（避免单元素 friction） | ☐ |

## 失败处理

任何一条挂掉，**先抓现场再回退**：

1. SW console 截图：`chrome://extensions` → Moo → service worker → console → 截图后两屏（含 `[Moo submit-fail]` 那行）
2. 失败那条请求的「标头」+「响应」全文复制
3. 当时的网址（host page URL）和扩展 endpoint URL

把这三样给我，我能定位 90% 的问题。**不要**靠"再试一次也许就好了"——BREAKING 的失败往往可复现。

## 加新场景的时机

下次再有 BREAKING / 提交链路改动，往表里加新行。比如：

- 改了消息协议 → 加一条"老 history entry 反序列化不崩"
- 改了请求头 / CORS 策略 → 加一条"不同 chrome-extension origin 都通"
- 改了重试规则 → 加一条对应新规则的现场验证
- 改了字段约束（id 长度、status 枚举等） → 加一条边界 case

不要往里塞每版功能小改，那是单测的活；这表只关心**跨进程 / 跨域 / 真用户操作链路**的回归。
