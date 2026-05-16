# 交接 · UX / 交互重构（未 commit）

> 此分支基于 `master @ 31f78d2` 在 working tree 上累积了 24 个独立改动，
> 跨 12 个已存在文件 + 4 个新增文件，**+1755 / -359 行**。
> 全程通过 `pnpm type-check` 与 `pnpm build`，未实机验证。
> Issue 来源是 `docs/UX_REVIEW.md`（按 P0/P1/P2 + polish 分级）。

---

## 1. 接班人快速上手

```bash
pnpm install                # 如未装依赖
pnpm type-check && pnpm build   # 应该全绿
pnpm dev                    # 开 vite dev，配合 chrome://extensions/ "加载已解压"
```

实机走一遍最值得测的 8 个变更（按用户路径）：

1. **悬浮球 → 截图 → 标注 → 提交** 主流程
   - Annotator：撤销/重做（⌘Z/⌘⇧Z）、单击已绘内容选中 + Delete 删除、色板/线宽切换、键盘 1-6 切工具
   - 取消时若有标注会弹二次确认
   - SubmitDialog：标题置顶、Esc/⌘Enter 快捷键、缩略图 hover 出现「重新标注/重新截图」、提交成功有 ✓ 内嵌反馈
2. **录屏（⌥⇧R）**：录屏按钮现在显示 kbd 标签而不是"假按钮"
3. **多匹配 picker**：悬浮球切项目时下方显示 matchPatterns 帮助判断
4. **DevTools Overview**：请求/错误合并到一条时间线，chip 切换可见性；详情展开的 body 可内嵌搜索高亮
5. **Environment 自动保存**：去掉手动「保存/撤销」按钮，改动后 800ms 自动写入；顶栏状态条显示「✓ 已自动保存」/「保存失败 重试」
6. **Token 字段**：默认遮罩 + 眼睛切换；录屏/演示场景不暴露明文
7. **Payload 模板**：点 textarea 旁的「⤢ 大尺寸编辑」打开 modal，左侧大编辑器 + 右侧变量面板点击插入
8. **暗色主题**：把系统/DevTools 主题切到深色，popup 和 devtools panel 应自动适配；content scripts（悬浮球/标注器）保持浅色（按设计意图，不蹭宿主页主题）

---

## 2. 改动总览（按主题，非时间顺序）

### 2.1 新增文件

| 路径 | 作用 |
|---|---|
| `docs/UX_REVIEW.md` | 评审清单，列出所有发现的问题 + 优先级 + 工作量 |
| `docs/LOGO_BRIEF.md` | 给设计师的 logo brief（独立议题，已与 UX 解耦） |
| `HANDOFF.md` | 本文件（仓库根） |
| `src/devtools/components/ConfirmModal.vue` | 应用内确认弹窗（取代 `window.confirm`） |
| `src/devtools/components/confirm.ts` | 命令式 helper：`await confirmDialog({ title, message, danger, confirmText })` |
| `src/devtools/components/PayloadEditorModal.vue` | Payload 模板大尺寸编辑器（左编辑 + 右变量面板） |
| `src/assets/logo-draft.svg` | logo 草图（4 版迭代到 v4，仅供设计师参考；不上 prod） |

### 2.2 核心交互改造

- **Annotator**：past/future 双栈撤销 + 单对象选中 + 删除（⌘Z/⌘⇧Z/⌘Y、Delete/Backspace）；4 色 × 3 线宽快选；键盘 1-6 切工具；选中态蓝色虚线 bounding box；工具选中态加 inset shadow；取消保护
- **SubmitDialog**：字段顺序重排（标题置顶 → 描述 → 截图 → 录像 → 服务器仅 ≠1 时显示 → 折叠附件组）；默认勾选与时间窗口同步；Esc/⌘Enter；预览按钮改 ghost；ERR/REJ/CON tooltip 全称；自动聚焦标题；缩略图 hover overlay 触发 `reannotate`/`recapture`；提交成功 1.5s ✓ 内嵌反馈面板
- **FloatingBall**：录屏按钮加 `⌥⇧R` kbd 标签（不再是"假按钮"）；picker 项目下方显示 matchPatterns

### 2.3 DevTools 面板

- **Panel.vue**：tab 图标从杂烩 Unicode 换成统一 SVG；brand-meta 从 `Tab #1234567` 换成 hostname（onNavigated 监听更新）；tab `:focus-visible` 用 inset box-shadow 强化键盘焦点
- **Overview.vue**：**重大重写**——请求/错误合并到时间线（按 `startedAt` 倒排，每行用 `kind-tag` 区分 REQ/ERR/REJ/CON）；筛选 chip 替代 mode-tabs；刷新/清空/自动刷新换 icon button；body 内嵌搜索高亮；空状态文案去黑话
- **Environment.vue**：自动保存（draft watch + 800ms debounce），删除手动保存/撤销按钮，顶栏 save-bar 状态化；项目侧栏 > 6 个时加搜索；Token 字段 password mask；Payload 模板大尺寸编辑器入口；删除项目/服务器的 confirm 现在带具体名字
- **Settings.vue**：缓冲条数输入实时校验（红边 + 副文案 + aria-invalid，blur 时 clamp）；tag-x 加 aria-label
- **History.vue**：`window.confirm` → `confirmDialog`；时长格式统一 `1m23s` / `45s`（不再 `1:23` 混排）

### 2.4 全局视觉

- **tokens.css**：加 `prefers-color-scheme: dark` 全套变量；新增 `.moo-btn--danger-solid` 实心红 + `.moo-close-btn` 全局类
- **popup/App.vue**：状态点形状区分（绿圆✓ / 橙方块! / 灰空心圆，对色弱友好）；硬编码绿/橙背景换成 token 变量
- **styles.ts (shadow DOM)**：折叠 `<details>` 样式、success 反馈面板、kbd 标签、tool 选中态强化、缩略图 hover overlay、取消保护卡片、色板/线宽按钮、reannotate/recapture 按钮

---

## 3. 任务状态（按 TaskList ID）

| ID | 主题 | 状态 |
|----|----|----|
| 1  | SubmitDialog 字段顺序重排 + 附件折叠 | ✅ |
| 2  | window.confirm → 应用内 Modal | ✅ |
| 3  | Annotator undo/redo + 单对象删除 | ✅ |
| 4  | 提交成功反馈视图 | ✅ |
| 5  | Annotator 颜色/线宽 + 工具键位 | ✅ |
| 6  | Settings/Environment 保存范式统一为自动保存 | ✅ |
| 7  | DevTools 暗色主题适配 | ✅ |
| 8  | Overview 请求/错误合并时间线 | ✅ |
| 9  | Token 字段 password mask | ✅ |
| 10 | 录屏按钮改造 + 拖拽手柄区分 | ✅ |
| 11 | 长列表加搜索（History 已存在，Environment 新增） | ✅ |
| 12 | a11y 收尾（状态点形状、focus 样式、aria-label、aria-pressed） | ✅ |
| 13 | Annotator 取消保护 | ✅ |
| 14 | Panel brand-meta → hostname | ✅ |
| 15 | History 时长格式统一 | ✅ |
| 16 | Picker 显示 matchPatterns | ✅ |
| 17 | Settings 数值行内校验 | ✅ |
| 18 | SubmitDialog 缩略图重新标注/截图 | ✅ |
| 19 | Payload 模板大尺寸编辑器 | ✅ |
| 20 | Overview 响应体内嵌搜索 | ✅ |
| 21 | 空状态文案去黑话 | ✅ |
| 22 | DevTools tab 图标换 SVG | ✅ |
| 23 | 关闭按钮 CSS 提取到 tokens.css | ✅ |
| 24 | Overview toolbar 二级动作图标化 | ✅ |

---

## 4. 已知遗留 / 下一阶段建议

按 `UX_REVIEW.md` 残留项 + 我看到的新债务：

- **按钮样式系统化（L）**：当前 `.moo-btn` 在 devtools / tokens.css / content shadow DOM 三处各有副本，命名也不完全统一（`primary` vs `moo-btn--primary`、`danger` vs `moo-btn--danger`）。值得做一轮 token 系统归一，但**改动面大**，建议单独立项 PR
- **录制 UI 视觉连续性**：悬浮球录制中浮条（`ContentApp.vue:13-18`）目前位置写死在 styles.ts，没有继承悬浮球当前位置。UX 上"开始录制 → 悬浮球消失 → 一个独立浮条出现在屏幕顶部"是断的，建议浮条贴在悬浮球原位置
- **悬浮球默认位置避开宿主页 fixed 元素**：当前 `right-200, bottom-70` 写死，可能盖住网站客服悬浮球等。未做
- **多 server 时附件元素的 × 删除按钮没二次确认**：故意保留（一次点删 element 是合理 UX，过度确认反而烦），可重新评估
- **关闭按钮组件化（Vue）**：本轮只做了 CSS 提取，没做 `<MooCloseBtn>` 组件包装。如果未来 dialog 多了再升级
- **暗色主题打磨**：tokens 全套 dark 已加，但具体 tab 内的硬编码（如 History `.thumb-video` 用 `#0f172a` 暗底）我**有意保留**——它原本就是想做暗背景效果。其他局部可能还有遗漏没扫到，建议实机走一圈深色模式截图回看
- **逻辑层一致性**：Environment auto-save 用了 `draft` 中间层 + 防抖 commit，没有重构 Settings 走同一模式（Settings 是直接 v-model 到 `config.value`）。两者用户感受一致但代码风格不一致

---

## 5. Commit 编排建议

当前所有改动都在 working tree，未 stage。建议分 5-6 个 commit 落地（按 PR 评审友好顺序）：

```
1. infra: 引入 ConfirmModal + confirmDialog helper + .moo-btn--danger-solid
   files: src/devtools/components/{ConfirmModal.vue,confirm.ts}, src/styles/tokens.css

2. fix(devtools): 替换 9 处 window.confirm 为应用内 Modal
   files: src/devtools/tabs/{History,Settings,Environment,Overview}.vue

3. feat(content): SubmitDialog 字段重排 + 折叠附件 + 键盘 + 成功反馈视图
   files: src/content/{SubmitDialog,ContentApp}.vue, src/content/styles.ts

4. feat(content): Annotator undo/redo + 选中删除 + 色板/线宽 + 取消保护 + 键盘 1-6
   files: src/content/Annotator.vue, src/content/styles.ts

5. feat(devtools): Overview 请求/错误合并时间线 + body 搜索 + 图标按钮
   files: src/devtools/tabs/Overview.vue

6. feat(devtools): Environment 自动保存 + 项目搜索 + Token mask + 模板编辑器 + 删除带名字
   files: src/devtools/tabs/Environment.vue, src/devtools/components/PayloadEditorModal.vue

7. polish: DevTools 暗色主题、tab SVG 图标、hostname、状态点形状、a11y 收尾、文案打磨
   files: src/styles/tokens.css, src/devtools/Panel.vue, src/popup/App.vue, 多个 tab .vue

8. docs: 加入 UX_REVIEW.md + LOGO_BRIEF.md + HANDOFF.md
   files: docs/*
```

或者更简单：分 3 个大 commit（P0、P1、P2+polish），后期 review 起来更轻。视你团队评审风格。

---

## 6. 临时占位 / 待替换资源

- `src/assets/logo-draft.svg`：我手工迭代的鹰头 + reticle SVG 草图，**仅供设计师参考**，不要直接 ship。看 `docs/LOGO_BRIEF.md` 第 5 节交付物清单等设计师交付正式资源后再替换 `public/icons/icon-{16,32,48,128}.png`
- popup/devtools 当前的紫色「M」字母方块 logo（`popup/App.vue:5-6`、`Panel.vue:5-9, :81-92`）：占位，新 logo 落地时同步替换

---

## 7. 联系上下文 / 决策记忆

- 团队是 **mooeen（沐恩）**，基督教背景，鹰图腾对应 以赛亚书 40:31「如鹰展翅上腾」。这条记忆已写入 Claude 长期记忆，不要建议把鹰换成虫子/光标/箭头等"纯工具符号"。详见 `docs/LOGO_BRIEF.md`
- UX_REVIEW.md 第 0 节已主动去耦合 LOGO_BRIEF（用户明确要求"不管 LOGO_BRIEF.md"），两文档独立
