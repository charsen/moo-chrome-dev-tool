# 双 MCP 测试分工（Tier 3 · 真发挥不同断面）

> v0.4.3 复盘后立项。「双 MCP 都跑」不等于覆盖到位 —— 之前 chrome-devtools MCP 和 playwright MCP 在用同一份 mock 数据，断面相同，所以同事 dogfood 仍炸。这份文档定下两个 MCP 各管什么。

---

## 一句话分工

| MCP | 测什么 | 不测什么 |
|---|---|---|
| **chrome-devtools MCP** | 真扩展加载到真 Chrome，service worker 行为 + content script 注入 + 跨世界消息链路 | 程序化 DOM 断言（playwright 更准）、表单字段细节 |
| **playwright MCP** | dialog-harness 上挂的组件 + 数据驱动 spec（fixture 切换）+ 键盘/鼠标交互断言 | service worker 行为、跨 origin fetch、真 chrome.commands |

**铁律**：两个 MCP 不能跑同一份场景，否则等于 redundant。如果某个测试用例两个 MCP 都能跑，**选 playwright**（程序化、可重复、跑得快）。chrome-devtools MCP 只用于「playwright 跑不出的」断面。

---

## chrome-devtools MCP 专属断面

**载入 dist/ 真扩展到真 Chrome**，必测 4 件事：

### 1. SW console 干净（无 unexpected error）

发版前必检：
```
mcp__chrome-devtools__navigate_page → chrome://extensions
触发功能：
  - 拍照（floating ball 截图）
  - Annotator 涂改
  - Submit Bug 流程
list_console_messages → grep "error|Error" → 必须 0 条
```

如果 SW 有 `Uncaught (in promise)` 或 `Unchecked runtime.lastError`，**别发版**。

### 2. 真禅道实例往返（如果 dogfood 仪表上有 token）

注意：**chrome-devtools MCP 不该接真生产禅道实例**（怕误改数据）。但 dogfood 环境（你自己的 z.example.com）OK。
- 触发 Submit Bug 流程
- 看 service worker 实际发到禅道的 fetch（network panel）
- 验证 productId 是否拿到、bug 是否真创建（你自己实例可清）

### 3. service worker 重启后 token cache 是否对

- `chrome://extensions` 点 "Service worker" 触发 inspect
- 手动 stop service worker
- 再触发 ping → SW 重新 login → 验证 cache 重建

### 4. content script 注入到真宿主页（含 closed shadow DOM）

- 真宿主网页（不是 harness 页）—— 比如打开你自己的 server 仪表板
- 触发 floating ball 截图 → Annotator
- 验证 closed shadow root 内 UI 渲染对、ESC/⌘⇧B 真捕获到

---

## playwright MCP 专属断面

**dialog-harness.html 上挂组件**，跑程序化断言：

### 1. dialog-harness ?case=submit 的各种 mock 分支

现有：
- `?case=submit` — 空表单
- `?case=submit&fail=true` — mock 提交失败
- `?case=submit&success=true` — mock 提交成功（测 1.5s 保护期）
- `?case=submit&queued=true` — mock queued
- `?case=submit&requests=N` — 注入 N 条假请求（v0.4.2 加，测复制/收起）
- `?case=annotator` — 挂 Annotator

### 2. 键盘 / 鼠标交互断言

- ESC 关闭
- mask 点击关闭
- Tab 焦点循环（不能跳出 dialog）
- ⌘+Enter 提交（content 世界没有，devtools 那边有）
- Annotator 画 2 笔后 cancel-guard 触发

### 3. 复制 / 收起 / 展开 这种 vue 状态断言

DOM 状态 + textContent 断言 + 剪贴板内容验证。

### 4. 多 fixture 数据驱动（Tier 2 集成后）

未来：`?fixture=instance-A` / `?fixture=instance-B` 切换 mock 数据集。同一套 spec 在不同 fixture 上跑一遍。

---

## 发版前必跑清单（v0.4.3 立规）

不论改了什么，发版前两个 MCP 都跑一遍：

```
[ ] chrome-devtools MCP：
    [ ] dist/ 加载到 Chrome → 触发 4 大功能 → SW console 0 error
    [ ] 自己的禅道实例 submit bug 走通（自己 dogfood 一次）
    [ ] SW 重启后 ping 重建 cache OK

[ ] playwright MCP：
    [ ] tests-e2e/ 全 spec 跑过（pnpm test:e2e）
    [ ] 任何修改的 spec 局部跑通 + 截图 review
```

---

## 为什么两个 MCP 不能合并

| 能力 | chrome-devtools | playwright |
|---|---|---|
| 加载真扩展（manifest.json）| ✅ | ❌（playwright 只跑独立 Chromium，不加载 unpacked extension） |
| service worker inspect | ✅ | ❌ |
| 跨 chrome:// 边界 | ✅ | ❌ |
| 程序化 DOM 断言 | △（locator API 弱） | ✅ |
| 剪贴板 / 文件上传 | △ | ✅ |
| 跑得快 / CI 友好 | ❌ | ✅ |
| 真 chrome.commands 全局快捷键 | ✅ | ❌ |

两个都要。

---

## 历史踩坑

- **v0.4.0–v0.4.2**：「双 MCP 都跑了」但都跑同一份 mock（dialog-harness），断面相同 → 多禅道实例 schema 方差测不出 → 发版 → 同事炸
- **v0.4.3 复盘**：明确双 MCP 分断面 + 加 Tier 1 schema fuzz + Tier 2 真实 fixture（不依赖 MCP）

完整复盘见 `feedback_zentao_v2_dual_track_rule` memory。
