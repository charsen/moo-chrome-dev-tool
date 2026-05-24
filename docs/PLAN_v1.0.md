# v0.5.0 → v1.0 路线图

> 2026-05-24 v0.5.1 第 8 波 review 时 Plan agent 给出的战略建议。**这是路线建议，不是发版计划** — 用户拍板优先级 + 实际工作量评估后再排 sprint。

## 🎯 5 关键决策

### 1. Chrome Web Store 上架 vs. gitee zip 分发

**推荐**：**CWS 上架但保留 gitee 作为内部 canary 通道**

**理由**：
- auto-update 解决「同事 v0.x → v0.y 漏装」问题（v0.4.4 → v0.5.0 8 版 1 天，靠手动）
- gitee zip 仍是 dogfood 快速分发渠道，CWS 审核 1-3 天周转太慢
- CWS 上架本身能让工具走出团队，触及更多用户

**门槛**：
- 隐私政策（隐私洞最少要在 v0.4.8 修过的基础上声明）
- 永久公开包名锁定
- 审核员盯 `<all_urls>` host_permission → 需先做决策 2

---

### 2. `<all_urls>` host_permission → optional_host_permissions

**推荐**：**v1.0 前做完，是 CWS 审核成败的关键单点**

**理由**：manifest 一次性声明 `<all_urls>` host + 4 处 `<all_urls>` match（content / dialog / 录制 host），用户首次安装看到「读取所有网站数据」全权限红字，CWS 审核员会逐字盯。

**改造路线**：
- 保留 `<all_urls>` content scripts（识别 URL 匹配项目用）
- 但禁用所有 `fetch`/`scripting.executeScript` 走 `optional_host_permissions`
- 用户首次切到该项目时 prompt 申请
- `dialog-harness.ts` / `background fetch` / `retryQueue 重发` 三处包 `permissions.request` 拦截

**成本**：中等工作量，但是 v1.0 标志性架构升级。

---

### 3. 追踪后端：禅道 only vs. 抽象 IssueAdapter

**推荐**：**v1.0 抽 `IssueAdapter` interface + 实装禅道 + 通用 webhook，第 3 个 adapter 放 v1.1**

**理由**：
- 当前 `retryQueue` 已经是 `QueuedWebhook | QueuedZentao` 双轨判别联合，再加 Jira/GitHub Issues 会三轨四轨 → 复制粘贴
- 先抽 interface 才能避免 `kind === 'jira'` 蔓延
- 第三个 adapter（建议 GitHub Issues，免费、开发者友好、CWS 评审正向信号）

**收敛点**：`SubmitDialog.vue`/`Environment.vue` 的 `kind` 分支跟着收敛到 adapter 描述符。

---

### 4. 团队 dogfood 范围扩大 vs 保持小团队

**推荐**：**v1.0 前保持小团队（5-10 人内），CWS 上架后再扩**

**理由**：v0.5.0 仍有 background.ts 0 单测 / SW console 错误同事不知道存在 / 无 telemetry 上报。扩大用户会撞「故障看不见」墙。

**配套**：决策 4 完成需要决策 5（运维监控）先到位。

---

### 5. release 节奏：从「每天 1 版」改「2-3 周 minor + 月度 + 紧急 patch」

**推荐**：v0.5.0 → v1.0 期间慢下来

**理由**：
- v0.4.3 → v0.5.0 七版一天把 43 个 bug 消化干净（review 高峰）
- CWS 审核 1-3 天周转，每发审一次成本上升
- 同事 dogfood 升级疲劳
- 给改动留烘焙时间，捕长尾回归

**已写入 RELEASE_TEST_CHECKLIST.md「dogfood 节奏」段**。

---

## 📋 架构债务排序（按 ROI）

### P0 — `background/index.ts` onMessage switch（17 case，~1000 行）

ROI 最高。改造方案：抽 `MessageRouter` 表 — `MSG.X` → `handler` 映射 + 每 handler 单文件 + 单测。同时引入 `runWithSenderCheck` middleware 解决目前每个 case 都得手 narrow payload 的样板。

落地后：background.ts 缩到 200 行壳；每加新 MSG 不动主文件；**0 单测问题顺带解决**（每 handler 文件自带单测）。

### P1 — Environment.vue 1206 行 + Settings.vue 908 行

拆 `EnvironmentZentao.vue` / `EnvironmentWebhook.vue` 子组件 + `useProjectForm` composable 承载 kind-agnostic 校验。

**配合决策 3 的 IssueAdapter**，让新 adapter 加 UI 不动主壳。中 ROI，延后到 P0 完成。

### P2 — SubmitDialog.vue 1047 行

最难，因为业务逻辑（截图/录屏/curl/redact）+ 表单 + kind 分支揉一起。

建议先抽 `useSubmitContext` composable 拿数据，模板层 `<SubmitFormZentao>` / `<SubmitFormWebhook>` 子组件，业务逻辑暂不拆。

### P3 — retryQueue.ts 双轨 → 多轨

当前 `QueuedWebhook | QueuedZentao` 判别已清晰，但 `retryWebhook` / `retryZentao` 是 sibling 函数。

改造成 `retryHandlers: Record<Kind, (q) => Promise<RetryOutcome>>` 注册表，配合 IssueAdapter 走通用化。

### P4 — content/styles.ts 1571 行 **不动**

最长文件但纯 CSS-in-TS 字符串，结构稳定。除非未来做主题/暗色模式才拆。

---

## 🔧 测试 / 运维 / i18n 路线

### 测试

- **必须**：background.ts 路径接入单测，借 P0 路由抽象一次性补齐 17 handler 共性测，约 **+25 单测**
- **下波 fuzz**：
  - `matchProjects(url)` URL 模式匹配（含通配符 / 端口 / hash），**跨站误匹配是高危**
  - `IssueAdapter` 接口契约 fuzz，为加新 adapter 铺路
  - `redact` 已覆盖但建议加 property-based 测试（fast-check）
- **e2e 90 个**不动，**关注点改成 CWS 沙盒下 optional permission prompt 流程**

### 运维 / 监控

- **轻量自托管 collector，不上 Sentry**
- 理由：CWS 政策对第三方 telemetry 严，自托管 webhook（dogfood 同事 → 你的服务器）收：
  - SW 未捕获异常
  - `chrome.runtime.lastError`
  - retryQueue permanent failure
- 用户首次安装弹「匿名错误上报」可选 opt-in
- 加 `chrome://extensions` 页内 SW 错误自动 capture

### i18n

**降低优先级，v1.2+ 再做**

- 同事英文 OS 混搭痛感低于 CWS 上架 / `<all_urls>` 改造 / background 拆分
- CWS 上架后如真要拓海外用户再做，那时 i18n key 提取量更可控
- **v1.0 前可做的低成本步骤**：把所有中文文案集中到 `src/i18n/zh-CN.ts`（不接 `chrome.i18n` API，纯模块导出），为未来切换留口子

---

## 💡 工作方式建议

- **review 节奏**：8 波 review 找 43+ bug 的高峰已过。建议改 **「每个新 feature PR 跑 1 波专项 agent review + 每月 1 次全量 review」**（轮换 mv3-pro / vue-craft / general-purpose / lab-tester / code-simplifier / release-captain / Plan）
- **HANDOFF.md** 19KB 拆活档 + 归档
- **CHANGELOG.md** 79KB 按 minor 归档到 `docs/changelog-archive/`，主 CHANGELOG 只留近 3 个 minor
- **CWS 上架前必做单**：
  - `<all_urls>` 改 optional
  - 隐私政策页
  - ICON 高清
  - screenshots
  - 详细说明（中英）
  - 自托管 demo server 留作 webhook 引导

---

## 📌 优先级建议执行顺序

1. **v0.5.x patch 累积**：dogfood + 修 patch + 累 minor
2. **v0.6.0 大坑**：P0 background MessageRouter（最难也最有 ROI）
3. **v0.7.0**：P1 Environment 拆 + IssueAdapter interface
4. **v0.8.0**：P2 SubmitDialog 拆 + P3 retryQueue 多轨
5. **v0.9.0**：`<all_urls>` 改 optional + 隐私政策 + CWS 准备物料
6. **v1.0.0**：CWS 上架

总体 6-9 个月。短期可继续高频，**v1.0 后必须慢**。

---

**注**：本文档由 Plan agent 自动生成（v0.5.1 第 8 波 review）。具体优先级和执行节奏请 Charsen 拍板。
