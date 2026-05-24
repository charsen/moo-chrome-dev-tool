# 全面排查 · 测试维度矩阵

> 2026-05-20 启动；2026-05-24 v0.4.4 复盘后更新数字。**目的**：枚举所有可测维度的交叉，找出真值缺口。**不堆 fake spec**。
>
> **当前覆盖**：vitest 单测 **356** + 7 skipped（含禅道 v2 schema fuzz 40 + submit builder 17）+ Playwright E2E **100** = **463 case**。
>
> 本文档**活档**：每次新加 spec 或发现新维度都来更新对应单元格。具体维度交叉表（A × B 等）写于 v0.2.0 时代，自 v0.3.x 起未更新单元格，仅作历史 reference 用 —— 现在 fuzz / fixture / 双 MCP 分断面体系跟此表设计无直接 1:1 映射，不强行回填。

---

## 一、测试维度（axes）

| 轴 | 取值 | 数 |
|---|---|---|
| **A · Surface** | popup / Panel / Overview / Environment / History / Settings / BodyViewer / PayloadEditorModal / ConfirmModal / MooCloseBtn / ContentApp / FloatingBall / SubmitDialog / Annotator / ElementPicker / RecBar / passwordMask | **17** |
| **B · Viewport width** | 320 / 360 / 400 / 480 / 600 / 768 / 1024 / 1280 / 1366 / 1440 / 1600 / 1920 / 2560 / 3840 | **14** |
| **C · Color scheme** | light / dark / system-no-pref | **3** |
| **D · DPR** | 1 / 1.5 / 2 / 3 | **4** |
| **E · Data state** | empty / 1 / 10 / 50 / 100 / 1000 / quota-near-full | **7** |
| **F · Interaction** | static-render / click / dblclick / hover / focus / Tab / Shift+Tab / Enter / Escape / Backspace / paste / drag / wheel-scroll / pinch | **14** |
| **G · Browser** | Chromium-latest / Chromium-prev / Edge / Brave / Vivaldi | **5** |
| **H · Permission** | tabCapture-granted / denied / never-asked | **3** |
| **I · Network** | online / offline / slow-3g | **3** |
| **J · Time** | now / 1h-ago / 1d-ago / exactly-24h / 7d-ago / 30d-ago / future-date | **7** |
| **K · Locale & input** | ASCII / 中文 / emoji / RTL / 极长 / SQL / XSS / 控制字符 / NUL byte | **9** |
| **L · Storage** | empty / partial / full-10MB / corrupt-JSON / missing-keys / extra-unknown-keys | **6** |
| **M · Extension lifecycle** | fresh-install / SW-alive / SW-just-restarted / context-invalidated / reload-mid-action | **5** |
| **N · DevTools dock** | popped-out / docked-right / docked-bottom / undocked | **4** |

**轴乘积** = 17×14×3×4×7×14×5×3×3×7×9×6×5×4 = **6 274 695 360**（夸张）

**真有意义子集** ≈ 取每个轴 top-2-3 高价值值 = 17×3×2×2×3×3×2×2×2×3×3×2×2×2 ≈ **5 000**

**Truly unique meaningful** ≈ 大多数交叉等价（如 320 / 360 / 400 在大多数 surface 视觉等价），剩 **~150-250**。

---

## 二、当前覆盖状态（A × B）

行 = Surface，列 = Viewport width。✓ 已 covered，⏳ 真有价值未覆盖，❌ skip + 一句理由。

| Surface \ Width | 320 | 360 | 400 | 480 | 600 | 768 | 1024 | 1280 | 1366 | 1440 | 1600 | 1920 | 2560 | 3840 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| popup | ❌设计宽 | R1 ✓ | ⏳ | ❌过 popup 宽 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Panel | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ✓PH | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ✓PH |
| Overview | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ✓PH | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| Environment | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ✓PH | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| History | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ✓PH | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| Settings | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ✓PH | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| BodyViewer | R3 ✓ | ⏳ | R3 ✓ | ⏳ | ⏳ | R3 ✓ | ⏳ | R3 ✓ | ⏳ | ⏳ | ⏳ | R3 ✓ | ⏳ | R3 ✓ |
| PayloadEditorModal | ❌需 Env 上下文 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| ConfirmModal | ❌依赖父 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| ContentApp | ❌需 host 页注入 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| FloatingBall | ❌同上 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| SubmitDialog | ❌同上 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Annotator | ❌同上 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| ElementPicker | ❌同上 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| RecBar | ❌同上 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**A × B 单元格 = 17 × 14 = 238。已 ✓ = 14（含 7 PH = panel-harness 解锁）。⏳ = 83。❌ = 141。**

❌「需 host 页注入」可以通过给 ContentApp 等加 harness 解决，但是 M 工程量。**列在 todo 不强加。**

❌「过 popup 宽」类是物理上不可能。

**PH = panel-harness 解锁**：commit `fba64eb` 建 `src/devtools/panel-harness.{html,ts}`，mock chrome.devtools.* + chrome.tabs.sendMessage。在 PH 之上累积 **29 case**：
- panel-tabs（11）：4 Tab × empty/populated 渲染 + Overview wide 长 URL 截断 + Panel × 768/3840 响应式
- panel-tabs-dark（4）：4 Tab × dark mode 颜色对比
- panel-overview-detail（4）：行展开 / 慢请求染色 / stack 染色 / BodyViewer 嵌入
- panel-environment-crud（6）：新建/删除项目 + 切换 active + 改项目名 + 加删服务器 + useAutoSave 防抖
- panel-settings-toggle（4）：toggle 双向切换 + 重试队列 + 隔离性

**已知 flake（非引入）**：popup-dark.spec.ts R2 偶发 ERR_FILE_NOT_FOUND（persistent context + MV3 SW 注册时序 race）。两 agent 都独立确认这是 pre-existing flake，单独重跑都 pass。**留待办**：popup-dark page.goto 前可加 SW ready 等待或 retry-on-fail。

**稳化基础设施**：`tests-e2e/fixtures.ts` 加 `waitForBadgeText(sw, expected, timeoutMs=3000)` 50ms 轮询助手，比固定 800ms sleep 稳。badge-corrupt 3 case 已迁移过去，A3.2/A3.3 实测从 800-1500ms 完成时间降到 525-568ms。

---

## 三、其他轴交叉（A × C / A × E / A × J 等）

> 简略列大类，避免无谓填表。

### A × C（surface × color scheme）— 34 cells
- popup × light/dark ✓✓（R2）
- BodyViewer × light/dark ✓✓（R4）
- 其他 13 surface × light/dark = **26 ⏳**

### A × E（surface × data state）— 119 cells
- popup × empty ✓（popup-recent.spec.ts:92）
- popup × 1 / 3 / 100 ✓✓✓（已有 + R5）
- popup × 10 / 50 / 1000 / quota = **4 ⏳**
- 其他 16 surface × 7 state = **112 ⏳**

### A × J（surface × time）— 119 cells
- badge × 1h-ago / 24h-边界 / 1d-ago / 7d-ago ✓✓✓✓（R7）
- badge × future-date = **1 ⏳**（防 NTP 漂或用户改了系统时间）
- 其他 16 surface × 7 time = **112 ⏳**

### A × K（surface × locale & input）— 153 cells
- BodyViewer × XSS ✓（body-viewer.spec.ts:79）
- popup × 极长 ✓（R1）
- 其他 = **140+ ⏳**

### A × L（surface × storage）— 102 cells
- retryQueue × QUOTA ✓（单测）
- 其他 = **100+ ⏳**

### A × M（surface × lifecycle）— 85 cells
- content × SW-just-restarted ✓（commit 5c96d40 加 onError 兜底后 fail-fast 提示）
- 其他 = **80+ ⏳**

---

## 四、真值缺口归类（不堆 fake spec）

**已 ✓ 195 case**（vitest 161 + E2E 34）。**枚举出 ⏳ ~ 600+，真值优先级排序后：**

### P0（必补，发版前应该有）
1. **A × E**：每个 4 DevTools Tab 在 0/1/many 三个数据态各 1 case = 12 case → 缺 12（需要 panel-harness 投入 M）
2. **A × C**：popup 4 surfaces × dark mode = 4，已有 popup ✓ + BodyViewer ✓，缺 12
3. **A × M**：SubmitDialog × SW-just-restarted = 1 case 验 P0 fix 真触发 → 缺 1
4. **A × K**：renderTemplate × 各类 inject（XSS / Unicode / 控制字符 / NUL byte）= 5 case → 缺 5（vitest 已部分 cover）

**P0 缺口 ≈ 30 case**。

### P1（应该补，dogfood 阶段加）
5. **A × E**：DevTools Tab × quota-near-full = 4 case → 缺 4
6. **A × N**：Panel × docked-right/-bottom = 2 case → 缺 2（需 DevTools 自动化能力）
7. **F × A**：键盘 nav focus trap 真触发 = 6 case → 缺 6（需 jsdom or harness）
8. **B × A**：Overview row 在 800-1920 中段宽度 truncate 真触发 = 5 case → 缺 5

**P1 缺口 ≈ 17 case**。

### P2（可有可无，不影响发版）
- ~150 case 各种 edge state
- **更正前查明**：A3.3 第一次以为 badge 把 corrupt entry 当失败是 badge.ts 的 bug，加 isExplicitFailure type guard 想修。实测发现修了没用——`src/storage/history.ts:42` 的 `normalizeHistoryEntry` 早就把缺失 `result.ok` 强制 `bool(undefined)=false`，corrupt entry 走 listHistory 后**已经被显式标为失败**。badge.ts 用啥判定都是 counted。**真改法在 normalize 层**：决策「缺字段 entry 当失败 vs silent 跳过」会传染到 popup statusOf / History 状态 chip 多处，**P2 等架构师拍板**。badge.ts 改动已 revert，A3.3 锁当前行为 = '3'

### ❌ skip + 理由
- popup × 任何 < 320 viewport：Chrome 不会按比 popup 设计宽度小的开
- popup × 任何 > 480：popup 自身宽度固定，更大 viewport 不影响渲染
- ContentApp / FloatingBall / SubmitDialog × 任何宽度：需 host 页真注入，目前无 harness
- ConfirmModal × 独立测：永远嵌父 dialog 里，单测父就够
- 任何 surface × browser=Vivaldi/Brave：跟 Chromium-latest 行为等价
- 任何 surface × DPR>2：CSS px 与 DPR 解耦，视觉等价
- 任何 surface × DPR=1.5：1 与 2 之间渐变，无独特行为

**跳过总数 ≈ 4500 cells。每个都是上面规则之一。**

---

## 五、本 session 推进计划

不一次干完。**本轮先补 P0 中可做的（无需 harness 投入的）**：

- ⏳ A1 · popup × 各种长字符 inject（K 轴）— 1 spec ~ 5 case
- ⏳ A2 · BodyViewer × dropped/invalid case（K + L）— 1 spec ~ 4 case
- ⏳ A3 · badge × future-date / negative timestamp — 1 spec ~ 3 case
- ⏳ A4 · popup × storage corrupt-JSON（L）— 1 spec ~ 2 case

= 4 spec ≈ 14 case 本轮加上去。**E2E 34 → 48**。

剩余 P0 / P1 (需要 panel-harness 投入) **写入待办，下次 session 立项**。

---

## 六、不会做的事（透明）

- 不会写 ❌ 标了的 5000 cells 来凑数
- 不会写 P2 的 150 case 让数字好看
- 不会声称"全面 cover 了 1000 case" —— 真覆盖 ~ 250 + 真有价值缺口 ~ 50

你要 1000 个真 case 是几周分布式工作量。本 session 我交付 matrix（这份文档）+ 14 case 新覆盖 + 真值缺口待办清单。
