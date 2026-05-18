# Changelog

> 时间倒序。**BREAKING** 表示装新版后老服务器（或反过来）会跑不动，需要同步升级两侧。

## v0.1.11

### BREAKING：token 从 header 改 POST body

以前：扩展上报时自动注 `Authorization: Bearer {token}` + `X-Scaffold-Token: {token}` 两个 header，后端读 header 校验。

现在：token 走 POST body 的 `token` 字段（webhook 风格）。扩展不再注任何鉴权 header，后端从 body 读 token 校验。状态回查（`/status-public`）也从 GET 改 POST，token 同样在 body 里——URL 完全不沾 token。

**升级清单**：

1. **后端**：从 body 读 token（不是 header）。`moo-scaffold` 包需同步升级到本次配套版本（`authenticateWithReason` 改成读 `$req->json('token')`，状态回查路由从 GET 改 POST）。自写后端的同事改两行：
   - `req.body.token` 校验
   - `/status-public` 路由从 GET 改 POST，从 `req.body.token` 校验

2. **扩展用户**：所有**老 server**的 Payload 模板还是旧 snapshot，不含 `"token": "{{token}}"` 字段。升级后**首次提交会 401「missing token」**。手工修：
   - DevTools → Moo → 环境 → 服务器（每条）→ 「Payload 模板」第一行加 `"token": "{{token}}",`
   - 保存

   新建的 server 默认模板已带 token 字段，不用动。

3. **现有 history 条目**：老 entry 的 `remoteHeaders` 字段不再使用（已从类型删除），storage 里残留无害。

### 其它

- `src/utils/remoteHeaders.ts` 删除 `pickPropagatedHeaders`（保留 `parseRemoteId`）
- `src/background/index.ts` 删除 `applyAuthHeaders` 函数和所有调用
- 默认 Payload 模板（`DEFAULT_PAYLOAD_TEMPLATE`）顶部加 `"token": "{{token}}"`
- 服务端集成文档 `docs/SERVER_INTEGRATION.md` 整段重写为 webhook 风格
- UI 提示文案（环境 Tab 项目 token 字段下方）同步改写
- 单测 105 case 全过
