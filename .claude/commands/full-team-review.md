---
description: 拉「大团队」并行 review 整个仓库找出所有维度的问题
---

# /full-team-review

v0.4.4 复盘后立项。**3 个领域专家 agent 并行扫描整仓库**，找出代码 / MV3 架构 / Vue UI / 文档完整性各维度的问题，最后统一给一份按严重度排序的清单。

**触发场景**：
- 发版前最后一道闸（RELEASE_TEST_CHECKLIST 列必跑）
- 怀疑「测试不够」「同事老报错」时
- 定期复盘（用户可设 schedule 每周 / 每两周自动跑）

## 操作步骤（接到 /full-team-review 时执行）

并行启动以下 **3 个核心 agent（+ 1 个可选）**，各自独立扫描，**不让用户等任何一个串行返回**：

### Agent 1: mv3-pro
```
背景：moo-chrome-dev-tool 是 Chrome MV3 扩展。架构：service worker / devtools panel / popup / content script / offscreen / injected main world 多世界。

任务：仅审查不修改。从 MV3 架构维度找潜在问题。

重点：
1. manifest.json permissions 最小化？host_permissions 是否应改 optional？
2. background/index.ts SW 入口 — 闲置回收 race / state sync 陷阱？
3. content script 跨 closed shadow DOM + main world 消息协议健壮性
4. offscreen document 状态机 / dangling state
5. injected/main-world.ts CSP 风险 / postMessage origin 校验
6. 跨世界消息：content ↔ background ↔ offscreen ↔ injected world ↔ devtools 5 路 user gesture / tabCapture / origin 三件套
7. chrome.commands global shortcut 跟 manifest 一致

输出（< 400 字）：⛔ 必须改 / ⚠️ 建议 / ✅ 设计正确的地方。具体 file:line。
```

### Agent 2: vue-craft
```
背景：moo-chrome-dev-tool Vue 3 + Vite + TS。代码分布 DevTools 4 Tab / popup / content 世界 / 共享组件 / tokens.css + shadow CSS。

任务：仅审查不修改。Vue / 样式 / dark mode token 一致性维度找问题。

重点：
1. SubmitDialog / Annotator / FloatingBall / Panel / Overview 等核心组件
2. shadow DOM CSS 注入 + tokens.css 一致性（不能用不存在的 token + 硬编码 hex fallback）
3. dark mode 切换时所有元素都用 token
4. v-model / props drilling / 响应式
5. closed shadow DOM Vue 应用挂载是否清理干净
6. setTimeout / addEventListener 在 onBeforeUnmount 是否清

输出（< 400 字）：⛔ 必须改 / ⚠️ 建议 / ✅ 设计合理的地方。具体 file:line。
```

### Agent 3: general-purpose 仓库整体审计
```
背景：moo-chrome-dev-tool Chrome MV3 扩展，最新 git tag vX.X.X（接命令时 git describe 拿）。

任务：仅审查不修改。做仓库整体审计，找其他 agent 不查的死角问题。

扫描范围（任选有价值的方向）：
1. 死代码 / unused exports（grep / 手动核实，注意 .vue 模板里的 import）
2. TODO / FIXME / XXX 注释积累
3. 文档跟代码不一致（docs/*.md vs 现状）
4. .gitignore 遗漏 / 入仓不该的
5. package.json scripts 重复 / 无人用
6. CHANGELOG / HANDOFF 版本号跟 git tag 一致性
7. 依赖：pnpm audit
8. CI / pre-commit hook 遗漏
9. 测试覆盖盲区

禁止：filter-repo / amend / rebase / pnpm install / 修代码

输出（< 500 字）：⛔ 严重 / ⚠️ 中等 / 💡 优化 / ✅ 验证过的优点。具体文件。
```

### Agent 4（可选）: code-simplifier:code-simplifier
仅在「最近一波改动较多」时启动，让 code-simplifier 看看可简化空间。其他情况跳过避免噪音。

## 报告合并模板

**3 个核心 agent 返回后按严重度合并**（code-simplifier 如启动则单独追加它的简化建议，不混入主报告）：

```
## 🔴 严重问题（强烈建议立刻修）

### 1. [问题]
**[file:line]** — 描述
修法：...

[更多严重问题]

## 🟡 中等问题（建议改）

[列表]

## 🟢 小问题（顺手或忽略）

[列表]

## ✅ 团队验证过对的设计

[列表]

## 怎么动？

[用 AskUserQuestion 给修复范围选项，让用户拍板]
```

## 触发频率建议

- **必跑**：每次发版前（RELEASE_TEST_CHECKLIST）
- **推荐**：每 1-2 周一次 / 每累 5+ commits 一次
- **可选**：用户怀疑「同事老报错」时立刻

## v0.4.4 首跑战绩（参考）

第一次跑发现：4 严重（MV3 安全漏洞 / dark mode 硬编码 / 文档版本误导 / setTimeout leak）+ 7 中等 + 一堆小。全修后单测 339 → 356 + 100 e2e + vue-tsc 0 报错。

## v0.4.4 → v0.5.1 8 波 review 元教训

| 波次 | agent 组合 | 严重 | 关键发现 | 教训 |
|---|---|---|---|---|
| v0.4.4 | mv3-pro / vue-craft / general-purpose | 4 | 代码+架构 | 第一次有用，找出基线 bug |
| v0.4.5 | 同上 | 4 同款 | **「我刚做的就有同款 bug」** | 主动扩展清单第一版不够 |
| v0.4.6 | 文档专项 3 general-purpose | 5 | 文档+PII+归档 | filter-repo 清 PII history |
| v0.4.7 | 业务专项 3 general-purpose | 8 | **4 个月隐藏 bug**（History 重提错发 webhook） | 模拟真用户场景 = 找隐藏 bug |
| v0.4.8 | 业务 v2 3 general-purpose | 12 | **4 隐私洞**（capture 开关失效 / URL 不脱敏 / iframe 密码框 / main-world all_urls） | 数据隐私链路审 |
| v0.4.9 | 业务 v3 3 general-purpose | 5 | **5 个 v0.4.8 修复未修干净** | 「上波修不完整」是核心价值 |
| v0.5.0 | **换 lab-tester + code-simplifier + mv3-pro 二次** | 5 | **测试 debt + 代码重复 + chrome 130+ API 未来坑** | **换 agent 视角 = 找新维度** |
| v0.5.1 | **换 release-captain + Plan + vue-craft 三审** | 3 严重 + Plan 战略路线 | release.mjs rollback / Plan v1.0 路线 | **专家断面 ROI 远 > 重复 general-purpose** |

## 核心元教训（按时间排序，可以直接抄）

1. **第一次跑找基线 bug**（mv3 / vue / general 三档够用）
2. **每跑一次都有 5-12 个新发现**，证明 review 的边际效用不为零
3. **「上波修复没修干净」是 review 真正的价值** — 同款漏扫 / 部分修 / 老路径回归
4. **换 agent 视角 = 找新维度**，比反复跑 general-purpose ROI 高得多。可用专家清单：
   - mv3-pro（chrome MV3）
   - vue-craft（UI / 样式）
   - lab-tester（测试覆盖断面）
   - code-simplifier:code-simplifier（代码重复 / 死代码）
   - release-captain（发版流程 / 工程化）
   - Plan（架构路线 / 长期决策）
5. **不要把发现都标 backlog**，每波严重的真要修；mini-feature 才标 backlog
6. **跑完一波 → 修完 → 发版 → 下一波再跑** 比攒一大波再跑节奏好

## v0.5.0 后建议节奏改变

7 波 review 一天发 7 个版本是高峰期，accumulated debt 已被清。后续建议：
- **每 feature PR 跑 1 波专项 agent review**（按 PR 范围选 1-2 个相关 expert）
- **每月跑 1 次全量 review**（mv3-pro / vue-craft / general-purpose / lab-tester / code-simplifier / release-captain / Plan 轮换）
- **不再每天发版**，按 docs/PLAN_v1.0.md 改 2-3 周 minor 节奏
