# moo-chrome-dev-tool · UX 评审（v0.1.x 时代快照，多条已 land）

> ⚠️ **本文档为 2026-04 v0.1.x 时代评审快照**。多条 🔴 / 🟡 建议已经在 v0.1.12 / v0.1.14 land：
> - 全局暗色主题：`tokens.css` 加 `prefers-color-scheme: dark` 完整切换
> - Settings/Environment 自动保存范式统一：`composables/useAutoSave.ts` land
> - brand-meta「Tab #」改 hostname fallback：`Panel.vue` 已修
> - × 按钮 aria-label：`MooCloseBtn` 抽组件统一
> - 大列表性能：`History.vue` 用 `content-visibility: auto` 优化
>
> 已 land 项保留只作历史 reference（不划掉保原貌）。当前活档 UX 决策走 [HANDOFF.md](../HANDOFF.md) + 实际代码。
>
> 评审范围：popup、devtools 4 个 tab、content scripts（悬浮球 / 标注器 / 提交弹窗）、设计令牌
> 评审依据：源码静态走读。每条标 `file:line`。前缀 🔴 = 必改、🟡 = 应改、🟢 = 可优化。

---

## 0. 全局

- 🟡 popup 和 devtools 的 logo 当前是占位的紫色方块 + "M" 字母（`src/popup/App.vue:5-6` · `src/devtools/Panel.vue:5-9, :81-92`）。作为占位可用，但工具走出 alpha 阶段前应该有专门设计的视觉标识替换占位。
- 🟡 全局没有暗色主题（`tokens.css` 只有 light 变量）。DevTools 默认深色主题，浅色 panel 嵌进去格格不入。建议加 `prefers-color-scheme: dark` 变量集。

---

## 1. 核心提交 flow：悬浮球 → 标注 → 提交（最关键路径）

### 1.1 悬浮球 `src/content/FloatingBall.vue`

- 🟡 **拖拽手柄不清晰**（`:23-51`）：整条 row 都 `@pointerdown="onDown"`，但视觉上没有 grip icon / cursor 变化。logo 按钮应该 `cursor: grab`，截图/录屏按钮保持 `cursor: pointer`。
- 🔴 **录屏按钮的"假按钮"问题**（`:42-50` + `src/content/ContentApp.vue:197-199`）：点录屏按钮会弹 toast「请按 ⌥⇧R」——按钮看似可用实则不可用，反模式。改造方向二选一：
  - 把按钮做成「快捷键提示卡片」的明确入口，按钮上直接显示 `⌥⇧R` 字样
  - 直接去掉按钮，只在 logo tooltip 里说明
- 🟡 **多项目 picker 上下文丢失**（`:4-20`）：列出的项目只有名字 + 📁 icon，看不出哪个匹配了当前 URL。每项加一行 `matchPatterns` 灰色小字。
- 🟡 **默认位置可能盖住网站自带悬浮元素**（`:77` `right-200, bottom-70`）。首次进入时让球**自动避开 viewport 边缘 64px 内已有的 fixed 元素**，或提供"贴边/吸边"模式。
- 🟡 **录制中浮条与悬浮球位置脱节**（`ContentApp.vue:13-18`）：录制时悬浮球被隐藏，新出现一个浮条。**浮条应复用悬浮球位置 + 红点闪烁动画**，视觉连续。

### 1.2 标注器 `src/content/Annotator.vue`

按优先级排，**这是用户触达最频繁、当前体感最糙的页面之一**：

- 🔴 **没有撤销栈，只能 pop**（`:446-450`）。一次错笔就要清空全部。**加 undo/redo 栈，绑 ⌘Z / ⌘⇧Z**——标注器 baseline 功能。
- 🔴 **不能选中/删除单个已画对象**。误绘只能全清。至少加「橡皮/选择删除」工具。
- 🟡 **颜色和线宽完全锁死**（红色 `#ef4444`、12px）。马赛克盖在红色截图上反差弱。**加 3-4 个颜色快选 + 2-3 档线宽**（参考 Figma comment、飞书截图）。
- 🟡 **没有键盘快捷键切工具**（`:149-152` 只有 Esc）。**绑 1=矩形 2=圆 3=箭头 4=文字 5=马赛克**，频繁标注立刻提速 3 倍。
- 🟡 **工具选中态视觉强度弱**（`src/content/styles.ts:383-390`，仅背景变红）。加 inset shadow 或 outline。
- 🟡 **取消时若已绘内容应二次确认**（`:456-459`）。现在直接 emit cancel 丢工。

### 1.3 提交 Dialog `src/content/SubmitDialog.vue` —— 改造价值最大

- 🔴 **字段顺序违反优先级**（`:11-112`）：当前 `截图 → 录像 → 标题 → 描述 → 服务器 → 附带请求/错误/元素`。**标题/描述是必填、最关心的，应该置顶**；截图录像是已经拍好的附件，应折叠或缩略。建议：
  ```
  ① 标题 *
  ② 描述
  ③ 截图缩略图（小卡片，可点开重画/重拍）
  ④ 服务器（若只有 1 个 server 则隐藏字段）
  ⑤ ▾ 附带请求 (N) / 错误 (M) / 元素 (K)  ← 折叠组，默认展开请求
  ```
- 🔴 **附带请求"时间窗口 30s vs 默认勾选最近 5s"语义不一致**（`:159` vs `:198`）。用户看到几十条请求但只勾了几条会困惑。**统一：默认勾选时间窗口内所有**。
- 🔴 **没有键盘提交**：Esc 取消、⌘/Ctrl+Enter 提交、Tab 顺序未优化。表单基本功。
- 🟡 **截图缩略图无操作入口**（`:11-14` 的 `moo-thumb`）。用户发现标注错了没法回去改——加 hover 蒙层「✎ 重新标注 / 🔄 重新截图」。
- 🟡 **预览 payload 按钮和提交按钮等重**（`:120-124`）。预览是 dev/debug 二级动作，**改成 ghost 按钮 + 提交按钮 primary 单独突出**。
- 🟡 **错误等级缩写 "ERR/REJ/CON"**（`:84-87`）。开发者看得懂但首次使用者会愣。加 tooltip 全称（rejection / console.error / window error）。
- 🟡 **附带元素的"× 删除"按钮没确认**（`:108`）。一次点击直接删。
- 🟢 **提交成功只有 toast 一闪**（`ContentApp.vue:228-231`）。建议提交成功后**在 dialog 内显示一个 success state「✓ 已记录为 #ABC123 → 查看」**，再淡出 reset。这是用户的关键反馈时刻。

---

## 2. DevTools Panel（4 tabs）

### 2.1 顶级架构 `src/devtools/Panel.vue`

- 🟡 **brand-meta "Tab #1234567"**（`:8`）对用户没意义。改成**当前页面的 hostname**（`example.com`）。
- 🟡 **tab icon 用奇怪的 Unicode**（`:44-47` `◰ ⚙ ⌛ ☰`）。除了 ⚙ 都不直观。换成统一风格的 SVG。

### 2.2 Overview `src/devtools/tabs/Overview.vue` —— 用户停留最久

- 🔴 **「请求/错误」是模式切换 tab**（`:5-7`），但当 bug 涉及"错误 + 触发该错误的请求"时，**用户必须来回切换看不到全貌**。合并为一个统一时间线（按时间排序、用 chip 区分类型），或左右分屏。
- 🟡 **toolbar 一字排开过密**（`:9-21`）：windowMs / filter / autoRefresh / 刷新 / 清空 / count。次要操作（刷新/清空）收进 "⋯" 菜单。
- 🟡 **空状态文案专业**（`:88-89`）：「MAIN world 注入脚本」「window.onerror」是黑话。配图示 + 一行 "刷新页面即可开始捕获" 主提示。
- 🟡 **请求详情展开后 Headers/Body 同样 `<pre>` 样式**（`:43-58`），200 行 Body 和 5 行 Headers 视觉一样重。**Body 加 max-height + "展开全文" + 搜索框**。

### 2.3 History / Settings / Environment（汇总）

- 🔴 **删除/清空仍在用 `window.confirm`**（`History.vue:208/214` · `Settings.vue:235/264`），排版丑 + 打断沉浸式。**全部替换为应用内 modal**（可复用 SubmitDialog 样式）。
- 🔴 **Settings 自动保存 vs Environment 手动保存**两套范式不统一。用户跨 tab 操作会困惑。**统一为自动保存 + 顶部固定显示「✓ 已保存 / 保存失败 重试」**。
- 🟡 **Environment 项目列表无搜索**（`:25-37`），项目超 20 个找不到。
- 🟡 **History 列表无搜索**。
- 🟡 **Environment 的 Token 输入框是明文**（`:72-76`）。录屏/截图演示场景容易泄漏。**type=password + 眼睛切换**。
- 🟡 **导入配置的 confirm 是巨大字符串**（`Environment.vue:336-345`）。改成正经 modal 列出 endpoints + matchPatterns + 「我确认」复选框。
- 🟡 **payload 模板编辑器 8 行高 + 模板变量参考不在旁边**（`Environment.vue:148-159`）。模板编辑应该走专门 modal 或分屏，左边写右边实时预览。
- 🟡 **环形缓冲数字输入没有行内校验**（`Settings.vue:50-57`）：输错 onchange 才纠正，输的时候不知道范围。
- 🟡 **History 时间格式秒数和分钟混排**「1:23s / 45s」（`History.vue:194-199`），统一格式器。

---

## 3. 通用一致性问题

- 🟡 **关闭按钮 "×" 散落各处**（`SubmitDialog.vue:8, 108` 等）：都是字符，没 aria-label，键盘读屏识别不出。**统一组件化 `<MooCloseBtn>` + `aria-label="关闭"`**。
- 🟡 **按钮样式碎片化**：`tokens.css:131-138` 定义了 `.moo-btn--danger`，但 `Overview.vue:20` 用 `class="btn danger"` 自己写一套，`SubmitDialog.vue:57-58, 100-101, 120-124` 又有 `class="moo-btn small"` 这种非 token 内的 modifier。**所有按钮全量切到 `.moo-btn` + `.moo-btn--*` 体系**，去掉私有版本。
- 🟡 **重复 `req-panel` 结构**：「附带请求 / 附带错误 / 附带元素」三段（`SubmitDialog.vue:42, 75, 93`）样板重复。抽成 `<AttachmentSection>` 组件并支持默认折叠。

---

## 4. a11y / 键盘

整体比同类工具好（`Panel.vue` 有 `role="tablist"` `aria-selected`），但还需补：

- 🔴 提交 Dialog 没绑 Esc 关闭 / ⌘+Enter 提交。
- 🟡 标注器键盘只有 Esc，没有工具切换。
- 🟡 **状态点仅靠颜色区分**（`popup/App.vue:179-186`，`status-dot--on/warn/off`）。色弱用户认不出。**加形状或图标**（实心/空心圆/警告 △）。
- 🟡 DevTools tab focus 样式（`Panel.vue:135-140`）只改背景色，对比度边界用户难看清。改用 `outline` 或更强的 `box-shadow`。

---

## 优先级排期建议

| 优先级 | 项目 | 工作量 |
|--------|------|--------|
| **P0** | 标注器 undo/redo 栈 + 单对象删除 | M |
| **P0** | SubmitDialog 字段顺序重排（标题置顶 + 附件折叠） | S |
| **P0** | `window.confirm` 全部替换为应用内 modal | M |
| P1 | 提交成功反馈视图（不只是 toast） | S |
| P1 | Overview 请求/错误合并时间线 | M |
| P1 | Settings/Environment 保存范式统一为自动保存 | M |
| P1 | DevTools 暗色主题适配 | M |
| P1 | 标注器颜色/线宽快选 + 键盘快捷键 | S |
| P2 | 录屏假按钮改造 / 悬浮球拖拽手柄区分 | S |
| P2 | Token 字段 password mask | XS |
| P2 | 长列表加搜索（History、Environment） | S |
| P2 | a11y 收尾（key bindings、状态点形状区分、aria-label） | M |

> 工作量估算：XS < 0.5d、S = 0.5-1d、M = 1-3d、L > 3d。所有 P0 加起来约 1-1.5 周；P0 + P1 一个 sprint（2 周）能拿下大头。
