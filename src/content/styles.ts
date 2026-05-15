// 所有内容脚本 UI 的样式，注入到 Shadow Root 中，与宿主页面隔离。
export const SHADOW_CSS = `
* { box-sizing: border-box; }

.moo-root {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  color: #222;
}

/* ========== 悬浮球 ========== */
.moo-ball {
  position: fixed;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  overflow: hidden;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
  z-index: 2147483600;
  box-shadow: 0 4px 12px rgba(0,0,0,0.35), 0 0 0 2px rgba(255,255,255,0.15) inset;
  transition: transform 0.15s, box-shadow 0.15s;
}
.moo-ball-icon {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  display: block;
}
.moo-ball:hover { transform: scale(1.08); box-shadow: 0 6px 18px rgba(0,0,0,0.45), 0 0 0 2px rgba(255,200,80,0.6) inset; }
.moo-ball.dragging { transition: none; cursor: grabbing; }
.moo-ball.hidden { display: none; }
.moo-ball-tip {
  position: absolute;
  right: 52px;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(0,0,0,0.75);
  color: #fff;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s;
}
.moo-ball:hover .moo-ball-tip { opacity: 1; }

/* ========== 标注层 ========== */
.moo-annotator {
  position: fixed;
  inset: 0;
  z-index: 2147483640;
  background: rgba(0,0,0,0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}
.moo-canvas-wrap {
  position: relative;
  max-width: calc(100vw - 80px);
  max-height: calc(100vh - 140px);
  background: #fff;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
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
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-weight: 700;
  color: #ff3b30;
  background: rgba(255,255,255,0.95);
  border: 2px dashed #ff3b30;
  border-radius: 2px;
  padding: 1px 6px;
  outline: none;
  min-width: 160px;
}
.moo-text-btn {
  width: 28px;
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 3px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
}
.moo-text-btn.ok { color: #15803d; border-color: #15803d; }
.moo-text-btn.cancel { color: #b91c1c; border-color: #b91c1c; }
.moo-text-btn:hover { background: #f5f5f5; }
.moo-toolbar {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #fff;
  border-radius: 6px;
  padding: 8px 12px;
  display: flex;
  gap: 8px;
  align-items: center;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  z-index: 2147483641;
}
.moo-toolbar button {
  font-size: 12px;
  padding: 5px 12px;
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 3px;
  cursor: pointer;
}
.moo-toolbar button:hover { background: #f5f5f5; }
.moo-toolbar button.primary {
  background: #1a73e8;
  color: #fff;
  border-color: #1a73e8;
}
.moo-toolbar button.primary:hover { background: #1666cc; }
.moo-toolbar button.danger { color: #c0392b; }
.moo-toolbar .sep { width: 1px; height: 18px; background: #ddd; }
.moo-toolbar .hint { font-size: 11px; color: #888; margin-left: 4px; }
.moo-toolbar .tools { display: flex; gap: 4px; }
.moo-toolbar button.tool { padding: 5px 10px; }
.moo-toolbar button.tool.active {
  background: #ff3b30;
  color: #fff;
  border-color: #ff3b30;
}
.moo-toolbar button.tool.active:hover { background: #e63027; }

/* ========== 提交对话框 ========== */
.moo-dialog-mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 2147483645;
  display: flex;
  align-items: center;
  justify-content: center;
}
.moo-dialog {
  background: #fff;
  border-radius: 6px;
  width: 640px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 40px rgba(0,0,0,0.3);
}
.moo-dialog-head {
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.moo-dialog-head h3 { margin: 0; font-size: 14px; }
.moo-dialog-body {
  padding: 14px 16px;
  overflow: auto;
  flex: 1;
}
.moo-dialog-foot {
  padding: 10px 16px;
  border-top: 1px solid #eee;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.moo-form-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 10px;
}
.moo-form-row label {
  flex: 0 0 70px;
  font-size: 12px;
  color: #555;
  padding-top: 6px;
}
.moo-form-row input,
.moo-form-row select,
.moo-form-row textarea {
  flex: 1;
  font-size: 12px;
  padding: 6px 8px;
  border: 1px solid #ddd;
  border-radius: 3px;
  background: #fff;
  font-family: inherit;
  min-width: 0;
}
.moo-form-row textarea {
  resize: vertical;
  font-family: ui-monospace, Menlo, monospace;
}
.moo-thumb {
  max-width: 100%;
  max-height: 160px;
  border: 1px solid #eee;
  border-radius: 3px;
}
.moo-preview {
  background: #f7f7f7;
  border: 1px solid #e5e5e5;
  border-radius: 3px;
  padding: 8px 10px;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  max-height: 220px;
  overflow: auto;
}
.moo-btn {
  font-size: 12px;
  padding: 6px 14px;
  border: 1px solid #ddd;
  background: #fff;
  border-radius: 3px;
  cursor: pointer;
}
.moo-btn:hover { background: #f5f5f5; }
.moo-btn.primary {
  background: #1a73e8;
  color: #fff;
  border-color: #1a73e8;
}
.moo-btn.primary:hover { background: #1666cc; }
.moo-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
/* ========== 附带请求列表 ========== */
.moo-req-row .req-count {
  font-size: 10px;
  color: #999;
  font-weight: normal;
  margin-top: 2px;
}
.req-panel {
  flex: 1;
  border: 1px solid #ddd;
  border-radius: 3px;
  background: #fff;
  min-width: 0;
}
.req-controls {
  display: flex;
  gap: 6px;
  padding: 6px;
  border-bottom: 1px solid #eee;
  background: #fafafa;
}
.req-controls .req-window { flex: 0 0 96px; padding: 3px 6px; font-size: 11px; border: 1px solid #ddd; border-radius: 3px; }
.req-controls .req-filter { flex: 1; padding: 3px 6px; font-size: 11px; border: 1px solid #ddd; border-radius: 3px; min-width: 0; }
.req-controls .moo-btn.small { padding: 2px 8px; font-size: 11px; }
.moo-btn.small { padding: 2px 8px; font-size: 11px; }
.req-list {
  max-height: 180px;
  overflow: auto;
}
.req-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 11px;
  font-family: ui-monospace, Menlo, monospace;
  border-bottom: 1px solid #f5f5f5;
  cursor: pointer;
}
.req-item:hover { background: #f9f9f9; }
.req-item .method {
  flex: 0 0 44px;
  font-weight: 600;
  color: #555;
}
.req-item .method.post { color: #d97706; }
.req-item .method.put, .req-item .method.patch { color: #2563eb; }
.req-item .method.delete { color: #dc2626; }
.req-item .status {
  flex: 0 0 32px;
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 2px;
  text-align: center;
}
.req-item .status.ok { background: #dcfce7; color: #15803d; }
.req-item .status.warn { background: #fef3c7; color: #b45309; }
.req-item .status.err { background: #fee2e2; color: #b91c1c; }
.req-item .url {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #444;
}
.req-item .dur { flex: 0 0 50px; text-align: right; color: #888; }
.req-empty {
  padding: 14px;
  font-size: 11px;
  color: #888;
  text-align: center;
}

.moo-close-btn {
  background: transparent;
  border: none;
  font-size: 18px;
  color: #999;
  cursor: pointer;
  padding: 0 4px;
}
.moo-close-btn:hover { color: #333; }

/* ========== Toast ========== */
.moo-toast {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #323232;
  color: #fff;
  padding: 10px 18px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.5;
  max-width: min(560px, calc(100vw - 48px));
  word-break: break-word;
  white-space: pre-line;
  z-index: 2147483647;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  animation: moo-toast-in 0.2s;
}
.moo-toast.success { background: #16a34a; }
.moo-toast.error { background: #dc2626; }
@keyframes moo-toast-in {
  from { opacity: 0; transform: translate(-50%, -10px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
`
