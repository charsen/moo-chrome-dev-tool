# 全面排查 · 测试维度矩阵

> 2026-05-20 启动。**目的**：枚举所有可测维度的交叉，找出真值缺口。**不堆 fake spec**。
>
> 已有覆盖：vitest 单测 161 + Playwright E2E 34 = **195 case**。
>
> 本文档**活档**：每次新加 spec 或发现新维度都来更新对应单元格。

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
| Panel | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| Overview | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| Environment | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| History | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| Settings | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| BodyViewer | R3 ✓ | ⏳ | R3 ✓ | ⏳ | ⏳ | R3 ✓ | ⏳ | R3 ✓ | ⏳ | ⏳ | ⏳ | R3 ✓ | ⏳ | R3 ✓ |
| PayloadEditorModal | ❌需 Env 上下文 | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |
| ConfirmModal | ❌依赖父 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| ContentApp | ❌需 host 页注入 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| FloatingBall | ❌同上 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| SubmitDialog | ❌同上 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Annotator | ❌同上 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| ElementPicker | ❌同上 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| RecBar | ❌同上 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**A × B 单元格 = 17 × 14 = 238。已 ✓ = 7。⏳ = 90。❌ = 141。**

❌「需 host 页注入」可以通过给 ContentApp 等加 harness 解决，但是 M 工程量。**列在 todo 不强加。**

❌「过 popup 宽」类是物理上不可能。

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
- **新增**：A3.3 测试时发现 badge 把 corrupt entry（缺 `result` 字段 / `result: {}`）当作失败计数。`updateActionBadge` 用 `!e.result?.ok` 判定，undefined → falsy → 计入。**潜在改进**：corrupt entry 应 silent 跳过，不污染计数。改法：badge.ts 加 type guard 跳过缺关键字段的 entry。**优先级 P2**：不影响发版，但 storage 升级时遗留老格式 entry 会让 badge 数虚高

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
