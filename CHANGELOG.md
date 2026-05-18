# Changelog

> 时间倒序。**BREAKING** 表示装新版后老服务器（或反过来）会跑不动，需要同步升级两侧。

## v0.1.12

### 请求列表染色升级

请求/错误列表（Overview Tab + 提交弹窗）原本只有 method + status chip 颜色。这版加两维度，扫一眼就抓到坏请求：

- **行级失败强调**：4xx 整行左边 3px 橙色色条，5xx + 网络错红色色条。chip 标点、色条扫面，互补
- **慢请求 duration 染色**：≥1s 橙字加粗，≥3s 红字加粗。200 但 5s 也是问题，光看 chip 看不出来

实现位置：`src/devtools/tabs/Overview.vue`（DevTools 面板）+ `src/content/styles.ts` + `src/content/SubmitDialog.vue`（提交弹窗）。两边用同一套语义类（`is-warn` / `is-err` / `dur--slow` / `dur--xslow`）。

### 新增快捷键：`Alt+Shift+M` 打开 Moo popup

之前打开 popup 必须点扩展图标。现在快捷键直接调起，键盘流不用碰鼠标。

- 注册在 `manifest.json` commands 里，描述：「打开 Moo 控制面板」
- 实现走 `chrome.action.openPopup()`（MV3 Chrome 99+ 可用）
- ⚠️ Chrome MV3 限制：**不能**用 API 直接打开 DevTools 或跳到 DevTools 里某个面板。这快捷键开的是 toolbar popup，不是 DevTools Moo 面板——后者只能 F12 手动开

## v0.1.11

### BREAKING：token 从 header 改 POST body

以前：扩展上报时自动注 `Authorization: Bearer {token}` + `X-Scaffold-Token: {token}` 两个 header，后端读 header 校验。

现在：token 走 POST body 的 `token` 字段（webhook 风格）。扩展不再注任何鉴权 header，后端从 body 读 token 校验。状态回查（`/status-public`）也从 GET 改 POST，token 同样在 body 里——URL 完全不沾 token。

**升级清单**：

1. **后端**：从 body 读 token（不是 header）。`moo-scaffold` 包需同步升级到本次配套版本（`authenticateWithReason` 改成读 `$req->json('token')`，状态回查路由从 GET 改 POST）。自写后端的同事改两行：
   - `req.body.token` 校验
   - `/status-public` 路由从 GET 改 POST，从 `req.body.token` 校验

2. **现有 history 条目**：老 entry 的 `remoteHeaders` 字段不再使用（已从类型删除），storage 里残留无害。

### 其它

- `src/utils/remoteHeaders.ts` 删除 `pickPropagatedHeaders`（保留 `parseRemoteId`）
- `src/background/index.ts` 删除 `applyAuthHeaders` 函数和所有调用
- 默认 Payload 模板（`DEFAULT_PAYLOAD_TEMPLATE`）顶部加 `"token": "{{token}}"`
- 服务端集成文档 `docs/SERVER_INTEGRATION.md` 整段重写为 webhook 风格
- UI 提示文案（环境 Tab 项目 token 字段下方）同步改写
- 单测 105 case 全过
