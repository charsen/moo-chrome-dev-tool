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
============================================ */
.moo-ball-wrap {
  position: fixed;
  z-index: 2147483600;
  /* 横排三按钮自然撑宽，不再固定 44px */
}

/* 三按钮横排容器 */
.moo-ball-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  /* 浅色背景：slate-50 风格，跟页面白色背景区分开 */
  background: rgba(241, 245, 249, .96);
  border: 1px solid rgba(148, 163, 184, .35);
  border-radius: 28px;
  /* 双层阴影：紧贴的环 + 远距离投影，让悬浮球在任何背景下都明显 */
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .8) inset,
    0 2px 6px rgba(15, 23, 42, .12),
    0 10px 28px rgba(15, 23, 42, .28);
  backdrop-filter: blur(8px);
  user-select: none;
  touch-action: none;
  transition: box-shadow .15s, transform .15s;
}
.moo-ball-row:hover {
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .8) inset,
    0 3px 8px rgba(15, 23, 42, .16),
    0 14px 36px rgba(15, 23, 42, .34);
  transform: translateY(-1px);
}
.moo-ball-row.dragging {
  cursor: grabbing;
  transition: none;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, .8) inset,
    0 4px 12px rgba(15, 23, 42, .22),
    0 18px 44px rgba(15, 23, 42, .42);
}
.moo-ball-row.hidden { display: none; }

.moo-ball-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  /* 按钮自身保持纯白，跟 row 的浅灰背景形成清晰对比 */
  background: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--c-text);
  padding: 0;
  box-shadow: 0 1px 2px rgba(15, 23, 42, .1);
  transition: background-color .12s, transform .12s, box-shadow .12s;
}
.moo-ball-btn:hover {
  background: var(--c-brand-soft, #eef2ff);
  color: var(--c-brand);
  box-shadow: 0 2px 5px rgba(79, 70, 229, .2);
}
.moo-ball-btn:active { transform: scale(.92); }
.moo-ball-btn .ic { font-size: 13px; line-height: 1; }
.moo-ball-btn--logo {
  background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
  box-shadow: 0 0 0 2px rgba(255, 255, 255, .25) inset;
  cursor: grab;
  overflow: hidden;
}
.moo-ball-btn--logo:hover { background: linear-gradient(135deg, #4338ca 0%, #4f46e5 100%); }
.moo-ball-row.dragging .moo-ball-btn--logo { cursor: grabbing; }
.moo-ball-btn--logo .moo-ball-icon {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  display: block;
  border-radius: 50%;
}
.moo-ball-menu {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 8px;
  background: var(--c-bg);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-lg);
  border: 1px solid var(--c-border);
  display: flex;
  flex-direction: column;
  padding: 4px;
  gap: 2px;
  animation: moo-menu-in .15s cubic-bezier(.4, 0, .2, 1);
  min-width: 120px;
}
@keyframes moo-menu-in {
  from { opacity: 0; transform: translateY(6px) scale(.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.moo-ball-action {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--c-text);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--r-md);
  cursor: pointer;
  transition: background-color .12s, color .12s;
  text-align: left;
}
.moo-ball-action:hover {
  background: var(--c-brand-soft, #eef2ff);
  color: var(--c-brand);
}
.moo-ball-action .ic {
  font-size: 16px;
  width: 20px;
  text-align: center;
}
.moo-ball-action .lab { flex: 1; }

/* 多匹配项目选择器 */
.moo-ball-picker { min-width: 200px; }
.moo-ball-picker-hd {
  padding: 6px 10px 4px;
  font-size: 11px;
  color: var(--c-text-dim);
  line-height: 1.4;
}
.moo-ball-picker-row .lab {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
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
}
.moo-toolbar button.tool.active:hover {
  background: #dc2626;
  color: #fff;
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
.req-empty {
  padding: 18px;
  font-size: 11px;
  color: var(--c-text-dim);
  text-align: center;
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

/* 录制中浮条（屏幕顶端） */
.moo-rec-bar {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483647;
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
