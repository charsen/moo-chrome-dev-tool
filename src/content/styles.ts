// 所有内容脚本 UI 的样式，注入到 Shadow Root 中，与宿主页面隔离。
// 设计令牌与 src/styles/tokens.css 保持一致（shadow DOM 拿不到外面的 :root 变量，所以这里硬编码同值）。
export const SHADOW_CSS = `
* { box-sizing: border-box; }

.moo-root {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
               "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  color: #0f172a;
  --c-brand:        #4f46e5;
  --c-brand-hover:  #4338ca;
  --c-brand-soft:   #eef2ff;
  --c-info:         #2563eb;
  --c-text:         #0f172a;
  --c-text-muted:   #475569;
  --c-text-dim:     #94a3b8;
  --c-border:       #e2e8f0;
  --c-divider:      #f1f5f9;
  --c-bg:           #ffffff;
  --c-bg-soft:      #f8fafc;
  --c-bg-elev:      #f1f5f9;
  --c-success:      #16a34a;
  --c-success-soft: #dcfce7;
  --c-success-fg:   #15803d;
  --c-danger:       #dc2626;
  --c-danger-soft:  #fee2e2;
  --c-danger-fg:    #b91c1c;
  --c-warn:         #d97706;
  --c-warn-soft:    #fef3c7;
  --c-warn-fg:      #b45309;
  --c-mark:         #ef4444;
  --r-sm: 4px;
  --r-md: 6px;
  --r-lg: 8px;
  --sh-md: 0 4px 12px rgba(15, 23, 42, .08);
  --sh-lg: 0 12px 32px rgba(15, 23, 42, .18);
}

/* ============================================
   悬浮球（点击展开菜单）
   ----------------------------------------------
   设计：跟宿主页主题"反相"，保证高对比度。
   - 浅色页（默认 / prefers-color-scheme: light）→ 深色 ball
   - 深色页（prefers-color-scheme: dark）→ 浅色 ball（媒体查询覆写）
   shadow DOM 会继承 document 的 color-scheme 检测，所以 @media 在这里有效。
============================================ */
.moo-ball-wrap {
  position: fixed;
  z-index: 2147483600;
  /* 横排三按钮自然撑宽，不再固定 44px */
}

/* === 默认（浅页）→ 深色 ball === */
.moo-ball-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: rgba(30, 41, 59, .94);       /* slate-800 */
  border: 1px solid rgba(15, 23, 42, .5);
  border-radius: 28px;
  /* 双层阴影：内嵌微亮顶边 + 远距离暗投影 */
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .08) inset,
    0 2px 6px rgba(0, 0, 0, .35),
    0 10px 28px rgba(0, 0, 0, .45);
  backdrop-filter: blur(8px);
  user-select: none;
  touch-action: none;
  transition: box-shadow .15s, transform .15s;
}
.moo-ball-row:hover {
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .12) inset,
    0 3px 8px rgba(0, 0, 0, .45),
    0 14px 36px rgba(0, 0, 0, .55);
  transform: translateY(-1px);
}
.moo-ball-row.dragging {
  cursor: grabbing;
  transition: none;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .14) inset,
    0 4px 12px rgba(0, 0, 0, .55),
    0 18px 44px rgba(0, 0, 0, .65);
}
.moo-ball-row.hidden { display: none; }

/* === 深色页 → 浅色 ball（保持之前的视觉） === */
@media (prefers-color-scheme: dark) {
  .moo-ball-row {
    background: rgba(241, 245, 249, .96);
    border-color: rgba(148, 163, 184, .35);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, .8) inset,
      0 2px 6px rgba(15, 23, 42, .12),
      0 10px 28px rgba(15, 23, 42, .28);
  }
  .moo-ball-row:hover {
    box-shadow:
      0 1px 0 rgba(255, 255, 255, .8) inset,
      0 3px 8px rgba(15, 23, 42, .16),
      0 14px 36px rgba(15, 23, 42, .34);
  }
  .moo-ball-row.dragging {
    box-shadow:
      0 1px 0 rgba(255, 255, 255, .8) inset,
      0 4px 12px rgba(15, 23, 42, .22),
      0 18px 44px rgba(15, 23, 42, .42);
  }
}

.moo-ball-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  /* 扁平化：默认透明背景，靠 row 底承托；hover 才出明显色块。
     默认（深 ball）用浅色描边图标，深色页媒体查询里翻回 dim 灰 */
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: rgba(241, 245, 249, .82);
  padding: 0;
  transition: background-color .12s, color .12s, transform .12s;
}
.moo-ball-btn:hover {
  background: var(--c-brand);
  color: #ffffff;
}
@media (prefers-color-scheme: dark) {
  .moo-ball-btn { color: var(--c-text-muted); }
}
.moo-ball-btn:active { background: var(--c-brand-hover); transform: scale(.92); }
.moo-ball-btn svg.ic { width: 15px; height: 15px; display: block; }
.moo-ball-btn .ic { font-size: 13px; line-height: 1; }
.moo-ball-btn--logo {
  background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, .25) inset;
  cursor: grab;
  overflow: hidden;
}
.moo-ball-btn--logo:hover { background: linear-gradient(135deg, #4338ca 0%, #4f46e5 100%); }
.moo-ball-row.dragging .moo-ball-btn--logo { cursor: grabbing; }

/* 带快捷键标识的按钮（录屏按钮）—— 标签内联显示用户必须用快捷键的事实，
   不再让用户对一个看似可点击却只弹 toast 的按钮产生错误预期 */
.moo-ball-btn.moo-ball-btn--with-kbd {
  width: auto;
  padding: 0 8px 0 6px;
  gap: 5px;
  border-radius: 14px;
}
.moo-ball-btn--with-kbd .kbd-tag {
  font-size: 10px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-weight: 600;
  /* 深 ball 默认：浅色 kbd 标签 */
  color: rgba(241, 245, 249, .85);
  background: rgba(255, 255, 255, .12);
  padding: 1px 5px;
  border-radius: 4px;
  line-height: 1.4;
  letter-spacing: .02em;
}
@media (prefers-color-scheme: dark) {
  .moo-ball-btn--with-kbd .kbd-tag {
    color: var(--c-text-muted);
    background: rgba(15, 23, 42, .08);
  }
}
/* hover 时 button 整体变 indigo，kbd-tag 必须跟着切浅色，不然在 indigo 上是橄榄黄 */
.moo-ball-btn--with-kbd:hover .kbd-tag {
  color: rgba(255, 255, 255, .95);
  background: rgba(255, 255, 255, .22);
}
.moo-ball-btn--logo .moo-ball-icon {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  display: block;
  border-radius: 50%;
}
/* 多匹配项目选择器：跟 .moo-ball-row 同样的反相规则 */
.moo-ball-menu {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 8px;
  background: rgba(30, 41, 59, .94);
  border: 1px solid rgba(15, 23, 42, .5);
  border-radius: 14px;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .08) inset,
    0 2px 6px rgba(0, 0, 0, .35),
    0 10px 28px rgba(0, 0, 0, .45);
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  padding: 6px;
  gap: 2px;
  animation: moo-menu-in .15s cubic-bezier(.4, 0, .2, 1);
  min-width: 200px;
  max-width: 280px;
}
@media (prefers-color-scheme: dark) {
  .moo-ball-menu {
    background: rgba(241, 245, 249, .96);
    border-color: rgba(148, 163, 184, .35);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, .8) inset,
      0 2px 6px rgba(15, 23, 42, .12),
      0 10px 28px rgba(15, 23, 42, .28);
  }
}
@keyframes moo-menu-in {
  from { opacity: 0; transform: translateY(6px) scale(.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

/* picker 内的项目按钮：默认深 ball 下用 slate-700 卡片；深色页里翻回白底 */
.moo-ball-action {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border: none;
  background: rgba(255, 255, 255, .06);
  color: rgba(241, 245, 249, .92);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  border-radius: 10px;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .25);
  transition: background-color .12s, color .12s, box-shadow .12s, transform .12s;
  text-align: left;
  width: 100%;
}
.moo-ball-action:hover {
  background: rgba(99, 102, 241, .25);
  color: #fff;
  box-shadow: 0 2px 5px rgba(0, 0, 0, .35);
}
@media (prefers-color-scheme: dark) {
  .moo-ball-action {
    background: #ffffff;
    color: var(--c-text);
    box-shadow: 0 1px 2px rgba(15, 23, 42, .08);
  }
  .moo-ball-action:hover {
    background: var(--c-brand-soft, #eef2ff);
    color: var(--c-brand);
    box-shadow: 0 2px 5px rgba(79, 70, 229, .2);
  }
}
.moo-ball-action:active { transform: scale(.98); }
.moo-ball-action .ic {
  font-size: 14px;
  width: 18px;
  text-align: center;
  flex: none;
}
.moo-ball-action .lab {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 多匹配 picker：项目名 + 下一行 matchPatterns 灰色小字（让用户分清"这俩为什么都匹配"） */
.moo-ball-action .lab-stack {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
  text-align: left;
}
.moo-ball-action .lab-stack .lab { flex: none; line-height: 1.3; }
.moo-ball-action .lab-stack .lab-sub {
  font-size: 10px;
  color: var(--c-text-dim);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* picker 标题：两行（主标题 + pending 提示） */
.moo-ball-picker-hd {
  padding: 4px 8px 6px;
  font-size: 11px;
  color: var(--c-text-muted);
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.moo-ball-picker-pending {
  color: var(--c-brand);
  font-weight: 500;
}

/* 已选项目头条（菜单顶部） */
.moo-ball-active-hd {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  margin-bottom: 2px;
  border-bottom: 1px solid var(--c-divider);
  font-size: 11px;
  color: var(--c-text-muted);
}
.moo-ball-active-hd .ic { font-size: 12px; }
.moo-ball-active-hd .lab {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  color: var(--c-text);
}
.moo-ball-switch {
  border: none;
  background: transparent;
  color: var(--c-brand);
  cursor: pointer;
  padding: 0 2px;
  font-size: 11px;
}
.moo-ball-switch:hover { text-decoration: underline; }


/* ============================================
   标注层
============================================ */
.moo-annotator {
  position: fixed;
  inset: 0;
  z-index: 2147483640;
  background: rgba(15, 23, 42, .65);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.moo-canvas-wrap {
  position: relative;
  max-width: calc(100vw - 80px);
  max-height: calc(100vh - 140px);
  background: var(--c-bg);
  border-radius: var(--r-lg);
  overflow: hidden;
  box-shadow: var(--sh-lg);
}
.moo-canvas-bg, .moo-canvas-draw {
  display: block;
  width: 100%;
  height: 100%;
}
.moo-canvas-draw {
  position: absolute;
  inset: 0;
  cursor: crosshair;
}
.moo-canvas-draw.is-text { cursor: text; }
.moo-canvas-draw.is-hover { cursor: move; }
.moo-text-input-wrap {
  position: absolute;
  z-index: 10;
  display: flex;
  gap: 4px;
  align-items: stretch;
}
.moo-text-input {
  font-family: inherit;
  font-weight: 700;
  color: var(--c-mark);
  background: rgba(255, 255, 255, .96);
  border: 2px dashed var(--c-mark);
  border-radius: var(--r-sm);
  padding: 2px 8px;
  outline: none;
  min-width: 160px;
}
.moo-text-btn {
  width: 28px;
  border: 1px solid var(--c-border);
  background: var(--c-bg);
  border-radius: var(--r-sm);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
}
.moo-text-btn.ok     { color: var(--c-success-fg); border-color: var(--c-success-fg); }
.moo-text-btn.cancel { color: var(--c-danger-fg);  border-color: var(--c-danger-fg); }
.moo-text-btn:hover  { background: var(--c-bg-soft); }

/* 工具栏 */
.moo-toolbar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--c-bg);
  border-radius: var(--r-lg);
  padding: 8px;
  display: flex;
  gap: 6px;
  align-items: center;
  box-shadow: var(--sh-lg);
  z-index: 2147483641;
  border: 1px solid var(--c-border);
  max-width: calc(100vw - 32px);
}
.moo-toolbar--stacked {
  flex-direction: column;
  align-items: stretch;
  padding: 6px 8px;
  gap: 4px;
}
.toolbar-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.toolbar-row.tools-row { justify-content: center; }
.toolbar-row.action-row {
  border-top: 1px solid var(--c-divider);
  padding-top: 6px;
  margin-top: 2px;
}
.toolbar-row.action-row .hint { flex: 1; min-width: 0; }
.toolbar-row .actions-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
.moo-toolbar--stacked .tool span {
  margin-left: 4px;
}
.moo-toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid transparent;
  background: transparent;
  color: var(--c-text);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: background .12s, color .12s, border-color .12s;
  font-family: inherit;
}
.moo-toolbar button:hover { background: var(--c-bg-soft); }
.moo-toolbar button.primary {
  background: var(--c-brand);
  color: #fff;
  border-color: var(--c-brand);
}
.moo-toolbar button.primary:hover { background: var(--c-brand-hover); border-color: var(--c-brand-hover); }
.moo-toolbar button.danger { color: var(--c-danger-fg); }
.moo-toolbar button.danger:hover { background: var(--c-danger-soft); }
.moo-toolbar .sep { width: 1px; height: 20px; background: var(--c-divider); margin: 0 2px; }
.moo-toolbar .hint {
  font-size: 11px;
  color: var(--c-text-dim);
  margin-left: 6px;
  padding-right: 4px;
}
.moo-toolbar .tools { display: flex; gap: 2px; }
.moo-toolbar button.tool {
  padding: 0 10px;
  color: var(--c-text-muted);
}
.moo-toolbar button.tool:hover { background: var(--c-bg-elev); color: var(--c-text); }
.moo-toolbar button.tool.active {
  background: var(--c-mark);
  color: #fff;
  /* 强化选中态：内嵌阴影 + 外环，让"当前在哪个工具"一眼可读 */
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, .35),
    inset 0 -2px 0 rgba(0, 0, 0, .18),
    0 0 0 2px rgba(239, 68, 68, .22);
}
.moo-toolbar button.tool.active:hover {
  background: #dc2626;
  color: #fff;
}

/* 色板 swatch：圆形色块，选中态加白边 + 外环 */
.moo-toolbar button.swatch {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, .85);
  box-shadow: 0 0 0 1px var(--c-border);
  transition: transform .12s, box-shadow .12s;
}
.moo-toolbar button.swatch:hover { transform: scale(1.08); background: inherit; }
.moo-toolbar button.swatch.active {
  box-shadow:
    0 0 0 1px var(--c-text),
    0 0 0 4px rgba(15, 23, 42, .12);
}

/* 线宽按钮：方形按钮内嵌一个圆点表示线宽 */
.moo-toolbar button.width-btn {
  width: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.moo-toolbar button.width-btn .width-dot {
  display: inline-block;
  border-radius: 50%;
  background: var(--c-text-muted);
  transition: background .12s;
}
.moo-toolbar button.width-btn.active {
  background: var(--c-bg-elev);
  box-shadow: inset 0 0 0 1px var(--c-text-faint, var(--c-border));
}

/* Annotator 取消保护小卡（已绘标注时点取消会弹这个） */
.moo-cancel-guard {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  background: rgba(15, 23, 42, .55);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: moo-mask-in .15s;
}
.moo-cancel-guard-card {
  background: var(--c-bg);
  border-radius: var(--r-lg);
  padding: 18px 20px 14px;
  width: 340px;
  max-width: calc(100vw - 32px);
  box-shadow: var(--sh-lg);
  animation: moo-dialog-in .18s cubic-bezier(.4, 0, .2, 1);
}
.moo-cancel-guard-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text);
  margin-bottom: 6px;
}
.moo-cancel-guard-msg {
  font-size: 12px;
  color: var(--c-text-muted);
  margin-bottom: 14px;
  line-height: 1.5;
}
.moo-cancel-guard-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.moo-cancel-guard-actions .moo-btn.primary.danger-confirm {
  background: var(--c-danger);
  border-color: var(--c-danger);
  color: #fff;
}
.moo-cancel-guard-actions .moo-btn.primary.danger-confirm:hover {
  background: var(--c-danger-fg);
  border-color: var(--c-danger-fg);
}

/* 两步确认按钮的"待确认"态：用于 SubmitDialog 附带元素「清空」按钮。
   第一次点击后变红色，3 秒内再点才真清；避免误点丢光辛苦挑的所有元素。 */
.moo-btn.is-confirming {
  background: var(--c-danger);
  border-color: var(--c-danger);
  color: #fff;
  animation: moo-confirm-pulse 1s ease-in-out infinite;
}
.moo-btn.is-confirming:hover {
  background: var(--c-danger-fg);
  border-color: var(--c-danger-fg);
}
@keyframes moo-confirm-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, .4); }
  50%      { box-shadow: 0 0 0 4px rgba(220, 38, 38, .15); }
}

/* ============================================
   提交对话框
============================================ */
.moo-dialog-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, .55);
  backdrop-filter: blur(2px);
  z-index: 2147483645;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: moo-mask-in .18s;
}
@keyframes moo-mask-in { from { opacity: 0; } to { opacity: 1; } }

.moo-dialog {
  background: var(--c-bg);
  border-radius: var(--r-lg);
  width: 680px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  box-shadow: var(--sh-lg);
  animation: moo-dialog-in .2s cubic-bezier(.4, 0, .2, 1);
}
@keyframes moo-dialog-in {
  from { opacity: 0; transform: translateY(8px) scale(.99); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.moo-dialog-head {
  padding: 14px 18px;
  border-bottom: 1px solid var(--c-divider);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.moo-dialog-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -.005em;
  color: var(--c-text);
}
.moo-dialog-body {
  padding: 16px 18px;
  overflow: auto;
  flex: 1;
}
.moo-dialog-foot {
  padding: 12px 18px;
  border-top: 1px solid var(--c-divider);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  background: var(--c-bg-soft);
}

.moo-form-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.moo-form-row label {
  flex: 0 0 64px;
  font-size: 12px;
  color: var(--c-text-muted);
  padding-top: 7px;
  font-weight: 500;
}
.moo-form-row input,
.moo-form-row select,
.moo-form-row textarea {
  flex: 1;
  font-size: 13px;
  padding: 6px 10px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-bg);
  font-family: inherit;
  min-width: 0;
  color: var(--c-text);
  transition: border-color .12s, box-shadow .12s;
}
.moo-form-row input:focus,
.moo-form-row select:focus,
.moo-form-row textarea:focus {
  outline: none;
  border-color: var(--c-brand);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, .15);
}
.moo-form-row input::placeholder,
.moo-form-row textarea::placeholder { color: var(--c-text-dim); }
.moo-form-row textarea {
  resize: vertical;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  line-height: 1.5;
}

.moo-thumb {
  max-width: 100%;
  max-height: 160px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  display: block;
}

/* 服务器选择行：select + 配错时下方红色 warn 文案 */
.server-pick {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.server-pick select { width: 100%; }
.server-warn {
  font-size: 11px;
  line-height: 1.5;
  padding: 7px 10px;
  border: 1px solid var(--c-warn-soft, #fef3c7);
  background: var(--c-warn-soft, #fef3c7);
  border-radius: var(--r-md);
  color: var(--c-warn-fg, #b45309);
}
.server-warn b { color: var(--c-text); font-weight: 600; }
.moo-preview {
  background: var(--c-bg-soft);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: 10px 12px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  max-height: 240px;
  overflow: auto;
  color: var(--c-text);
}

/* 按钮 */
.moo-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 16px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  border: 1px solid var(--c-border);
  background: var(--c-bg);
  color: var(--c-text);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: background .12s, border-color .12s, color .12s;
}
.moo-btn:hover:not(:disabled) {
  background: var(--c-bg-soft);
  border-color: var(--c-text-dim);
}
.moo-btn.primary {
  background: var(--c-brand);
  color: #fff;
  border-color: var(--c-brand);
}
.moo-btn.primary:hover:not(:disabled) { background: var(--c-brand-hover); border-color: var(--c-brand-hover); }
.moo-btn:disabled { opacity: .5; cursor: not-allowed; }

/* ============================================
   附带请求列表
============================================ */
.moo-req-row .req-count {
  font-size: 10px;
  color: var(--c-text-dim);
  font-weight: normal;
  margin-top: 3px;
}
.req-panel {
  flex: 1;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-bg);
  min-width: 0;
  overflow: hidden;
}
.req-controls {
  display: flex;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--c-divider);
  background: var(--c-bg-soft);
}
.req-controls .req-window,
.req-controls .req-filter {
  padding: 4px 8px;
  font-size: 11px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  background: var(--c-bg);
  color: var(--c-text);
  font-family: inherit;
}
.req-controls .req-window { flex: 0 0 100px; }
.req-controls .req-filter { flex: 1; min-width: 0; }
.req-controls .moo-btn.small { height: 22px; padding: 0 10px; font-size: 11px; }
.moo-btn.small { height: 24px; padding: 0 12px; font-size: 11px; }

.req-list {
  max-height: 180px;
  overflow: auto;
}
.req-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  font-size: 11px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  border-bottom: 1px solid var(--c-divider);
  cursor: pointer;
  transition: background .1s;
}
.req-item:last-child { border-bottom: none; }
.req-item:hover { background: var(--c-bg-soft); }
.req-item .method {
  flex: 0 0 44px;
  font-weight: 600;
  color: var(--c-text-muted);
}
.req-item .method.post { color: var(--c-warn-fg); }
.req-item .method.put,
.req-item .method.patch { color: var(--c-info); }
.req-item .method.delete { color: var(--c-danger-fg); }
.req-item .status {
  flex: 0 0 36px;
  font-size: 10px;
  padding: 2px 5px;
  border-radius: 3px;
  text-align: center;
  font-weight: 600;
}
.req-item .status.ok   { background: var(--c-success-soft); color: var(--c-success-fg); }
.req-item .status.warn { background: var(--c-warn-soft);    color: var(--c-warn-fg); }
.req-item .status.err  { background: var(--c-danger-soft);  color: var(--c-danger-fg); }
.req-item .url {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--c-text-muted);
}
.req-item .dur {
  flex: 0 0 50px;
  text-align: right;
  color: var(--c-text-dim);
}
/* 慢请求 duration 染色（≥1s 橙 / ≥3s 红）。
   status chip 只看 HTTP 码，duration 是另一维度——200 但 5s 同样是问题 */
.req-item .dur.dur--slow  { color: var(--c-warn-fg); font-weight: 600; }
.req-item .dur.dur--xslow { color: var(--c-danger-fg); font-weight: 600; }
/* 行级失败强调：左色条 + padding 补偿（4xx 橙 / 5xx + 网络错红）。
   配合 status chip 一起看：chip 标点、左色条扫面 */
.req-item.is-warn {
  border-left: 3px solid var(--c-warn-fg);
  padding-left: 7px;
}
.req-item.is-err {
  border-left: 3px solid var(--c-danger-fg);
  padding-left: 7px;
}
.req-empty {
  padding: 16px;
  font-size: 11px;
  color: var(--c-text-muted);
  text-align: center;
  line-height: 1.55;
}
.req-empty .req-empty-hint {
  color: var(--c-text-dim);
  margin-top: 4px;
  font-size: 10px;
}

.moo-close-btn {
  background: transparent;
  border: none;
  font-size: 20px;
  line-height: 1;
  color: var(--c-text-dim);
  cursor: pointer;
  padding: 4px 6px;
  border-radius: var(--r-sm);
  transition: color .12s, background .12s;
}
.moo-close-btn:hover {
  color: var(--c-text);
  background: var(--c-bg-soft);
}

/* 缩略图小尺寸：截图作为附件展示，不需要占太大空间 */
.moo-thumb--sm {
  max-height: 96px;
  width: auto;
}

/* 缩略图容器 + hover overlay（提供"重新标注 / 重新截图"快速入口） */
.moo-thumb-wrap {
  position: relative;
  display: inline-block;
  border-radius: var(--r-md);
  overflow: hidden;
  line-height: 0;
}
.moo-thumb-wrap .moo-thumb {
  display: block;
  border-radius: var(--r-md);
}
.moo-thumb-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(15, 23, 42, .66);
  opacity: 0;
  transition: opacity .15s;
  line-height: 1.4;
}
.moo-thumb-wrap:hover .moo-thumb-overlay,
.moo-thumb-overlay:focus-within {
  opacity: 1;
}
.moo-thumb-action {
  background: rgba(255, 255, 255, .96);
  border: 1px solid rgba(15, 23, 42, .1);
  color: var(--c-text);
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  padding: 5px 10px;
  border-radius: var(--r-md);
  cursor: pointer;
  transition: background .12s, transform .12s;
}
.moo-thumb-action:hover { background: #fff; transform: translateY(-1px); }
.moo-thumb-action:active { transform: translateY(0); }

/* Ghost 按钮：用于 dev/debug 二级动作（如"预览请求体"），视觉弱化避免和主提交按钮抢焦点 */
.moo-btn.ghost {
  background: transparent;
  border-color: transparent;
  color: var(--c-text-muted);
}
.moo-btn.ghost:hover:not(:disabled) {
  background: var(--c-bg-soft);
  border-color: var(--c-border);
  color: var(--c-text);
}

/* 按钮内的快捷键提示（Esc / ⌘↵） */
.kbd-hint {
  margin-left: 6px;
  padding: 1px 5px;
  font-size: 10px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  color: var(--c-text-dim);
  background: var(--c-bg-elev);
  border-radius: 3px;
  line-height: 1.4;
}
.moo-btn.primary .kbd-hint {
  background: rgba(255, 255, 255, .22);
  color: rgba(255, 255, 255, .9);
}

/* 提交成功的内嵌反馈面板（替代仅靠 toast 一闪而过） */
.moo-submit-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 44px 24px 48px;
  text-align: center;
  animation: moo-success-in .2s cubic-bezier(.4, 0, .2, 1);
}
@keyframes moo-success-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.moo-success-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--c-success);
  color: #fff;
  font-size: 32px;
  line-height: 56px;
  margin-bottom: 14px;
  box-shadow: 0 0 0 6px rgba(22, 163, 74, .14);
  animation: moo-success-pop .35s cubic-bezier(.34, 1.56, .64, 1);
}
@keyframes moo-success-pop {
  from { transform: scale(.4); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
}
.moo-success-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--c-text);
  margin-bottom: 8px;
}
.moo-success-id {
  font-size: 12px;
  color: var(--c-text-muted);
  margin-bottom: 6px;
}
.moo-success-id code {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  background: var(--c-bg-elev);
  padding: 2px 8px;
  border-radius: var(--r-sm);
  color: var(--c-text);
  font-size: 12px;
}
.moo-success-msg {
  font-size: 11px;
  color: var(--c-text-dim);
}

/* 提交失败的内嵌持久横幅：toast 是一闪而过的通知，这里给用户「点击重试 / 知道为什么没成」
   的稳定锚点。带录像的提交（cannotAutoRetry）多一行提示用户去 历史 Tab 重提。 */
.moo-submit-fail {
  margin: 0 16px 12px;
  padding: 10px 12px;
  background: var(--c-danger-soft);
  border: 1px solid var(--c-danger);
  border-radius: var(--r-md);
  animation: moo-success-in .15s cubic-bezier(.4, 0, .2, 1);
}
.moo-submit-fail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.moo-submit-fail-icon {
  font-size: 14px;
  color: var(--c-danger);
}
.moo-submit-fail-title {
  flex: 1;
  font-weight: 600;
  color: var(--c-danger-fg);
  font-size: 13px;
}
.moo-submit-fail-dismiss {
  background: transparent;
  border: none;
  color: var(--c-danger-fg);
  font-size: 18px;
  line-height: 1;
  padding: 0 4px;
  cursor: pointer;
  opacity: .6;
  transition: opacity .12s;
}
.moo-submit-fail-dismiss:hover { opacity: 1; }
.moo-submit-fail-msg {
  font-size: 12px;
  color: var(--c-text);
  white-space: pre-line;
  line-height: 1.55;
  margin-bottom: 4px;
}
.moo-submit-fail-hint {
  font-size: 11px;
  color: var(--c-text-muted);
  line-height: 1.55;
  padding-top: 6px;
  margin-top: 6px;
  border-top: 1px dashed var(--c-danger);
}
.moo-submit-fail-hint b { color: var(--c-danger-fg); font-weight: 600; }

/* 折叠附件组（请求 / 错误 / 元素）——基于原生 <details> 实现，
   a11y 和键盘交互（Enter/Space 展开）由浏览器内置 */
.moo-attach {
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  background: var(--c-bg);
  margin-bottom: 12px;
  overflow: hidden;
}
.moo-attach-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  list-style: none;
  user-select: none;
  background: var(--c-bg-soft);
  font-size: 12px;
  color: var(--c-text);
  font-weight: 500;
  transition: background .12s;
}
.moo-attach-hd:hover { background: var(--c-bg-elev); }
.moo-attach-hd::-webkit-details-marker { display: none; }
.moo-attach-chev {
  display: inline-block;
  font-size: 10px;
  color: var(--c-text-dim);
  transition: transform .15s;
  flex: 0 0 10px;
}
.moo-attach[open] > .moo-attach-hd > .moo-attach-chev { transform: rotate(90deg); }
.moo-attach-title { flex: 0 0 auto; }
.moo-attach-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--c-text-dim);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
.moo-attach-bd {
  padding: 10px 12px 12px;
  background: var(--c-bg);
}
.moo-attach-bd > .req-panel {
  /* 在 attach-bd 容器里 req-panel 不再需要外框，直接展开内容 */
  border: none;
}

/* ============================================
   Toast
============================================ */
.moo-toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(15, 23, 42, .94);
  color: #fff;
  padding: 11px 18px;
  border-radius: var(--r-md);
  font-size: 13px;
  line-height: 1.5;
  max-width: min(560px, calc(100vw - 48px));
  word-break: break-word;
  white-space: pre-line;
  /* toast 比 rec-bar 高一层，录制时弹 toast 不被浮条遮 */
  z-index: 2147483647;
  box-shadow: var(--sh-lg);
  animation: moo-toast-in .2s cubic-bezier(.4, 0, .2, 1);
  font-weight: 500;
}
.moo-toast.success { background: var(--c-success); }
.moo-toast.error   { background: var(--c-danger); }
@keyframes moo-toast-in {
  from { opacity: 0; transform: translate(-50%, -12px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}

/* ============================================
   Element Picker
============================================ */
.moo-picker {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  pointer-events: none;
}
.picker-overlay {
  position: fixed;
  inset: 0;
  cursor: crosshair;
  background: transparent;
  pointer-events: auto;
}
.picker-hover {
  position: fixed;
  border: 2px solid var(--c-brand);
  background: rgba(79, 70, 229, .08);
  box-shadow: 0 0 0 9999px rgba(15, 23, 42, .35);
  pointer-events: none;
  transition: all .08s ease-out;
  border-radius: 2px;
}
.picker-tip {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--c-brand);
  color: #fff;
  padding: 8px 14px;
  border-radius: var(--r-md);
  font-size: 12px;
  font-weight: 500;
  box-shadow: var(--sh-lg);
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100vw - 80px);
  pointer-events: none;
}
.picker-tip-icon {
  font-size: 14px;
  font-weight: 700;
}
.picker-tip-sel {
  padding-left: 8px;
  margin-left: 4px;
  border-left: 1px solid rgba(255, 255, 255, .35);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px;
  opacity: .9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 480px;
}

/* ============================================
   Submit Dialog 内的元素 / 视频
============================================ */
.req-item.el-item {
  cursor: default;
}
.req-item.el-item .moo-close-btn {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: 14px;
}
.req-hint {
  font-size: 11px;
  color: var(--c-text-dim);
  margin-left: 8px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.moo-video-preview {
  width: 100%;
  max-height: 280px;
  background: #000;
  display: block;
}

/* 录制中浮条（屏幕顶端）—— z-index 比 toast 低 1，让 toast 能盖在浮条上 */
.moo-rec-bar {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483646;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px 8px 14px;
  background: rgba(15, 23, 42, .95);
  color: #fff;
  border-radius: var(--r-pill, 999px);
  box-shadow: var(--sh-lg);
  font-size: 12px;
  font-weight: 500;
}
.rec-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--c-danger);
  box-shadow: 0 0 0 4px rgba(220, 38, 38, .25);
  animation: rec-pulse 1.2s ease-in-out infinite;
}
@keyframes rec-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: .5; transform: scale(1.2); }
}
.rec-time {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  letter-spacing: .04em;
  min-width: 78px;
  text-align: center;
}
.moo-rec-bar .moo-btn {
  background: rgba(255, 255, 255, .12);
  border-color: rgba(255, 255, 255, .25);
  color: #fff;
  height: 26px;
  padding: 0 12px;
}
.moo-rec-bar .moo-btn:hover {
  background: rgba(255, 255, 255, .22);
  border-color: rgba(255, 255, 255, .4);
}
`
