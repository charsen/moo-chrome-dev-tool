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
