// 所有内容脚本 UI 的样式，注入到 Shadow Root 中，与宿主页面隔离。
// 设计令牌走 src/styles/tokens.css 单一来源——vite ?raw 把它当字符串导入，
// 抽顶层 :root {...} 块嵌进 .moo-root，shadow DOM 就拿到全套 --moo-c-* 变量。
// 旧代码里 144+ 处 var(--c-*) 短名通过 .moo-root 底部一组 alias 转到 --moo-c-*，
// 无需大改。

import tokensCSS from '@/styles/tokens.css?raw'

// 抓 tokens.css 顶层 :root { ... } 块内容。dark mode 块 @media 内的嵌套 :root 不抓——
// content 是叠在任意宿主页上的覆盖层，跟着系统切深色会跟宿主主题打架，故意保持浅色。
// 正则约束：^:root 行首 + ^} 行首，避开缩进过的嵌套块；如果 tokens.css 改了 :root 块
// 的格式（比如把 } 缩进进去），这里 throw，build 时立即可见。
const SHARED_TOKENS = (() => {
  const m = tokensCSS.match(/^:root\s*\{([\s\S]+?)^\}/m)
  if (!m) throw new Error('[shadow CSS] tokens.css 顶层 :root 块抓不到——格式变了？')
  return m[1]!.trim()
})()

export const SHADOW_CSS = `
* { box-sizing: border-box; }

.moo-root {
  font-family: var(--moo-ff-sans);
  font-size: var(--moo-fs-base);
  color: var(--moo-c-text);

  /* === tokens.css :root 块复用（颜色 / 字号 / 间距 / 圆角 / 阴影 / 动效） === */
  ${SHARED_TOKENS}

  /* === Shadow 独占：tokens.css 没有的 token === */
  --c-mark: #ef4444;   /* annotator 标注红，主世界不用 */

  /* === 玻璃面板 token（ball / menu / picker / dialog 玻璃风） ===
     反相设计：浅页用「深玻璃 + 浅文字」，深页媒体查询里翻成「浅玻璃 + 深文字」
     不进 tokens.css —— 是 shadow 世界专属，且 content 不跟随 prefers-color-scheme
     用 media query 切（避免和宿主页主题冲突），所以集中在这里好维护 */
  --g-bg-deep:        rgba(30, 41, 59, .94);    /* slate-800 透 6% */
  --g-border-deep:    rgba(15, 23, 42, .5);
  --g-bg-light:       rgba(241, 245, 249, .96); /* slate-100 透 4% */
  --g-border-light:   rgba(148, 163, 184, .35);

  /* 玻璃面板三档阴影：默认 / hover / dragging，深页/浅页一一对应 */
  --g-sh-deep:        0 1px 0 rgba(255, 255, 255, .08) inset,
                      0 2px 6px rgba(0, 0, 0, .35),
                      0 10px 28px rgba(0, 0, 0, .45);
  --g-sh-deep-hover:  0 1px 0 rgba(255, 255, 255, .12) inset,
                      0 3px 8px rgba(0, 0, 0, .45),
                      0 14px 36px rgba(0, 0, 0, .55);
  --g-sh-deep-drag:   0 1px 0 rgba(255, 255, 255, .14) inset,
                      0 4px 12px rgba(0, 0, 0, .55),
                      0 18px 44px rgba(0, 0, 0, .65);
  --g-sh-light:       0 1px 0 rgba(255, 255, 255, .8) inset,
                      0 2px 6px rgba(15, 23, 42, .12),
                      0 10px 28px rgba(15, 23, 42, .28);
  --g-sh-light-hover: 0 1px 0 rgba(255, 255, 255, .8) inset,
                      0 3px 8px rgba(15, 23, 42, .16),
                      0 14px 36px rgba(15, 23, 42, .34);
  --g-sh-light-drag:  0 1px 0 rgba(255, 255, 255, .8) inset,
                      0 4px 12px rgba(15, 23, 42, .22),
                      0 18px 44px rgba(15, 23, 42, .42);

  /* === Drift override：shadow 跟 tokens.css 不一致的两处，故意保留 ===
     都是因为 shadow 叠在任意宿主页上，对比度需要比 popup/devtools 这种自有
     chrome 的环境再狠一档。改 tokens.css 时这两个值不会被带跑。 */
  --moo-c-warn-fg: #b45309;                            /* tokens.css 用 #92400e */
  --moo-sh-lg:     0 12px 32px rgba(15, 23, 42, .18);  /* tokens.css 用 .12 */

  /* === 旧短名 → 新长名别名（避免一次性改 144 处 var(--c-*)） === */
  --c-brand:        var(--moo-c-brand);
  --c-brand-hover:  var(--moo-c-brand-hover);
  --c-brand-soft:   var(--moo-c-brand-soft);
  --c-info:         var(--moo-c-info);
  --c-text:         var(--moo-c-text);
  --c-text-muted:   var(--moo-c-text-muted);
  --c-text-dim:     var(--moo-c-text-dim);
  --c-text-faint:   var(--moo-c-text-faint);
  --c-border:       var(--moo-c-border);
  --c-divider:      var(--moo-c-divider);
  --c-bg:           var(--moo-c-bg);
  --c-bg-soft:      var(--moo-c-bg-soft);
  --c-bg-elev:      var(--moo-c-bg-elev);
  --c-success:      var(--moo-c-success);
  --c-success-soft: var(--moo-c-success-soft);
  --c-success-fg:   var(--moo-c-success-fg);
  --c-danger:       var(--moo-c-danger);
  --c-danger-soft:  var(--moo-c-danger-soft);
  --c-danger-fg:    var(--moo-c-danger-fg);
  --c-warn-soft:    var(--moo-c-warn-soft);
  --c-warn-fg:      var(--moo-c-warn-fg);
  --r-sm:   var(--moo-r-sm);
  --r-md:   var(--moo-r-md);
  --r-lg:   var(--moo-r-lg);
  --r-pill: var(--moo-r-pill);
  --sh-lg:  var(--moo-sh-lg);
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
  background: var(--g-bg-deep);
  border: 1px solid var(--g-border-deep);
  border-radius: 28px;
  /* 双层阴影：内嵌微亮顶边 + 远距离暗投影 */
  box-shadow: var(--g-sh-deep);
  backdrop-filter: blur(8px);
  user-select: none;
  touch-action: none;
  transition: box-shadow .15s, transform .15s;
}
.moo-ball-row:hover {
  box-shadow: var(--g-sh-deep-hover);
  transform: translateY(-1px);
}
.moo-ball-row.dragging {
  cursor: grabbing;
  transition: none;
  box-shadow: var(--g-sh-deep-drag);
}
.moo-ball-row.hidden { display: none; }

/* === 深色页 → 浅色 ball（保持之前的视觉） === */
@media (prefers-color-scheme: dark) {
  .moo-ball-row {
    background: var(--g-bg-light);
    border-color: var(--g-border-light);
    box-shadow: var(--g-sh-light);
  }
  .moo-ball-row:hover { box-shadow: var(--g-sh-light-hover); }
  .moo-ball-row.dragging { box-shadow: var(--g-sh-light-drag); }
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
  color: var(--moo-c-brand-fg);
}
@media (prefers-color-scheme: dark) {
  .moo-ball-btn { color: var(--c-text-muted); }
}
.moo-ball-btn:active { background: var(--c-brand-hover); transform: scale(.92); }
.moo-ball-btn svg.ic { width: 15px; height: 15px; display: block; }
.moo-ball-btn .ic { font-size: 13px; line-height: 1; }
.moo-ball-btn--logo {
  /* 品牌色 indigo 600→500 渐变（hover 时 700→600）。
     不走 --moo-c-brand：linear-gradient 不能用单 token 表达；硬编码是「品牌身份」的字面值 */
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
/* 这里 rgba(255,255,255,*) 是「在 indigo 实心上的浅色叠加层」，跟主题无关，硬编码 */
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
  background: var(--g-bg-deep);
  border: 1px solid var(--g-border-deep);
  border-radius: 14px;
  box-shadow: var(--g-sh-deep);
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  padding: 6px;
  gap: 2px;
  animation: moo-menu-in .15s cubic-bezier(.4, 0, .2, 1);
  min-width: 200px;
  /* 极窄宿主页（mobile emulator 320px 等）兜底：picker 280px 加 ball 位置容易左溢
     calc 把 max 缩到 viewport - 32 ；vw 单位 fallback 让旧浏览器不裂 */
  max-width: min(280px, calc(100vw - 32px));
}
@media (prefers-color-scheme: dark) {
  .moo-ball-menu {
    background: var(--g-bg-light);
    border-color: var(--g-border-light);
    box-shadow: var(--g-sh-light);
  }
}
@keyframes moo-menu-in {
  from { opacity: 0; transform: translateY(6px) scale(.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

/* picker 内的项目按钮：默认深 ball 下用 slate-700 卡片；深色页里翻回白底
   颜色都是「在玻璃面板上的微透叠加」语义，跟主世界主题无关，保留 rgba 字面值 */
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
  background: rgba(99, 102, 241, .25);  /* indigo-500 透 25% —— 品牌色 hover 暗示 */
  color: var(--moo-c-brand-fg);
  box-shadow: 0 2px 5px rgba(0, 0, 0, .35);
}
@media (prefers-color-scheme: dark) {
  .moo-ball-action {
    background: var(--moo-c-bg);  /* 深色页里 ball 翻浅色，卡片用纯 bg 白 */
    color: var(--c-text);
    box-shadow: 0 1px 2px rgba(15, 23, 42, .08);
  }
  .moo-ball-action:hover {
    background: var(--c-brand-soft);
    color: var(--c-brand);
    box-shadow: 0 2px 5px rgba(79, 70, 229, .2);  /* 品牌色 indigo-600 投影，跟 brand 渐变同色系 */
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
  /* 长项目名（"Some-Very-Long-Internal-Project-Name"）不加 min-width: 0
     会把按钮撑超 .moo-ball-menu 的 max-width，ellipsis 也失效 */
  min-width: 0;
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
  /* 同上：flex + ellipsis 标配 min-width: 0 兜底 */
  min-width: 0;
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
  /* 自定义 scrim：比 --moo-c-scrim 的 .5 再深一点，annotator 满屏标注要更强压住宿主页 */
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
  /* 半透白：盖在截图（任意主题）上要可读，不能跟随 --moo-c-bg —— 否则深色页里输入框跟标注红撞 */
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
  /* 窄屏（< 720px viewport，DevTools 开着的笔电也常踩到）让工具/色板/线宽按钮自然换行，
     否则整行溢出 .moo-toolbar 的 max-width: calc(100vw - 32px)，视觉上像被挤变形 */
  flex-wrap: wrap;
  row-gap: 6px;
  justify-content: center;
}
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
  flex-wrap: wrap;
  row-gap: 6px;
  justify-content: flex-end;
}
.moo-toolbar--stacked .tool span {
  margin-left: 4px;
}
/* 窄屏（< 720px）藏掉工具按钮的中文标签只留 icon，配合 toolbar-row 的 flex-wrap
   能让整条工具栏在小笔电 / DevTools 半屏场景里仍单行容纳 */
@media (max-width: 720px) {
  .moo-toolbar--stacked .tool span { display: none; }
  .moo-toolbar--stacked .tool { padding: 0 8px; }
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
  color: var(--moo-c-brand-fg);
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
  color: #fff;  /* 红底白字：标注红是字面值，--c-mark 上必须用白文字 */
  /* 强化选中态：内嵌阴影 + 外环，让"当前在哪个工具"一眼可读
     rgba 值是 --c-mark (#ef4444) 的高光/暗角字面表达，跟主题无关 */
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, .35),
    inset 0 -2px 0 rgba(0, 0, 0, .18),
    0 0 0 2px rgba(239, 68, 68, .22);
}
.moo-toolbar button.tool.active:hover {
  background: var(--c-danger);  /* hover 再深一档，从 mark(#ef4444) 到 danger(#dc2626) */
  color: #fff;
}

/* 色板 swatch：圆形色块，选中态加白边 + 外环 */
.moo-toolbar button.swatch {
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 50%;
  /* swatch 在任意颜色色块外加白边，必须硬编码白色（不能跟主题 bg 走） */
  border: 2px solid rgba(255, 255, 255, .85);
  box-shadow: 0 0 0 1px var(--c-border);
  transition: transform .12s, box-shadow .12s;
}
.moo-toolbar button.swatch:hover { transform: scale(1.08); background: inherit; }
.moo-toolbar button.swatch.active {
  box-shadow:
    0 0 0 1px var(--c-text),
    0 0 0 4px rgba(15, 23, 42, .12);  /* 焦点外环：scrim 同色调淡化版 */
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
  background: var(--moo-c-scrim);
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
  color: var(--moo-c-brand-fg);
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
  color: var(--moo-c-brand-fg);
  animation: moo-confirm-pulse 1s ease-in-out infinite;
}
.moo-btn.is-confirming:hover {
  background: var(--c-danger-fg);
  border-color: var(--c-danger-fg);
}
/* 脉动光环：danger-600 (#dc2626) 字面值，跟 .moo-c-danger 强绑定，没法 var()（@keyframes 里改不了）*/
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
  background: var(--moo-c-scrim);
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
  box-shadow: 0 0 0 3px var(--moo-c-focus-ring);
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
  border: 1px solid var(--c-warn-soft);
  background: var(--c-warn-soft);
  border-radius: var(--r-md);
  color: var(--c-warn-fg);
}
.server-warn b { color: var(--c-text); font-weight: 600; }
.zentao-target {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--c-bg-elev);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  font-size: 12px;
  flex-wrap: wrap;
}
.zentao-target-tag {
  font-weight: 600;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: var(--r-sm);
  background: var(--c-brand, #3b82f6);
  color: white;
}
.zentao-target-base {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  color: var(--c-text);
  word-break: break-all;
}
.zentao-target-pid {
  color: var(--c-text-muted);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
/* SubmitDialog zentao 字段（类型/严重/优先级横排 + 指派下拉） */
.moo-zentao-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.zentao-field {
  flex: 1;
  min-width: 130px;
}
.zentao-assignee-pick {
  display: flex;
  gap: 6px;
  align-items: stretch;
  flex: 1;
  min-width: 0;
}
.zentao-assignee-pick select { flex: 1; min-width: 0; }
.zentao-assignee-pick .moo-btn { white-space: nowrap; }
/* ↻ 刷新按钮高度跟 select 对齐（select 实际高 ~32px：font 13px + padding 6+6 + border 1+1）。
   .moo-btn 默认 30px 跟 small 24px 都对不齐 select，这里手动给跟 select 一样的高 + 紧凑 padding */
.zentao-assignee-refresh {
  height: auto;
  align-self: stretch;
  padding: 0 12px;
  font-size: 13px;
  min-width: 36px;
}
.zentao-cookie-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  padding: 6px 10px;
  border-radius: var(--r-md);
}
.zentao-cookie-row.ok {
  background: var(--c-bg-elev);
  color: var(--c-ok-fg, #16a34a);
}
.zentao-cookie-row.fail {
  background: var(--c-warn-soft);
  color: var(--c-warn-fg);
  border: 1px solid var(--c-warn-soft);
}
.zentao-cookie-row .moo-btn { margin-left: auto; }
.zentao-cookie-row .moo-btn + .moo-btn { margin-left: 4px; }
.moo-preview {
  background: var(--c-bg-soft);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: 10px 12px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  /* 渲染后的 JSON / base64 截图常含极长无空格 token，pre-wrap 不会断词，
     虽有 overflow: auto 兜底但用户得横向滚很丑；anywhere 强制按字符断行 */
  overflow-wrap: anywhere;
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
  color: var(--moo-c-brand-fg);
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
  /* flex 子项默认 min-width: auto = 内容宽度，会让长 URL（含元素列表的 selector
     "div > div > … > button.xxx"）把整行撑爆方法/状态列丢，ellipsis 也失效。
     min-width: 0 是 flex + ellipsis 的标配兜底。 */
  min-width: 0;
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
/* 同事 dogfood 反馈：每条请求 inline 展开看 body/response 对照字段 */
.req-row { display: block; }
.req-expand-btn {
  flex: 0 0 22px;
  height: 20px;
  padding: 0;
  margin-left: auto;
  background: transparent;
  border: 1px solid var(--c-border, transparent);
  border-radius: 3px;
  color: var(--c-text-dim);
  font-size: 11px;
  cursor: pointer;
  line-height: 1;
}
.req-expand-btn:hover { background: var(--c-bg-soft); color: var(--c-text); }
.req-detail {
  padding: 8px 10px 10px;
  background: var(--c-bg-soft);
  border-bottom: 1px solid var(--c-divider);
  font-size: 11px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.req-detail-row { display: flex; flex-direction: column; gap: 3px; }
.req-detail-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.req-copy-btn {
  font-size: 10px;
  padding: 2px 8px;
  border: 1px solid var(--c-divider);
  background: var(--c-bg, #fff);
  color: var(--c-text-muted);
  border-radius: 3px;
  cursor: pointer;
  line-height: 1.4;
  transition: color 120ms, background 120ms, border-color 120ms;
}
.req-copy-btn:hover { color: var(--c-text); background: var(--c-bg-soft); border-color: var(--c-text-dim); }
.req-detail-label {
  font-weight: 600;
  font-size: 10px;
  color: var(--c-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.req-detail-label em { font-style: normal; font-weight: 400; color: var(--c-text-dim); }
.req-detail-value {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  color: var(--c-text);
  word-break: break-all;
}
.req-detail-body {
  margin: 0;
  padding: 6px 8px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px;
  line-height: 1.4;
  background: var(--c-bg, #fff);
  border: 1px solid var(--c-divider);
  border-radius: 3px;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--c-text);
}
.req-detail-error {
  color: var(--c-danger-fg);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
}
.req-detail-empty {
  color: var(--c-text-dim);
  font-style: italic;
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
  /* 比 --moo-c-scrim 略深：缩略图 hover overlay 要明确遮住缩略图本身才能凸显按钮 */
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
  /* 缩略图 hover 浮卡：盖在任意截图上要可读，必须半透白底（不能跟主世界 bg） */
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
/* hover 把半透白加深到全白，跟正常按钮的「bg-soft」语义不同：这里是浮在截图上的玻璃卡 */
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
/* primary 按钮（indigo 实心）上的 kbd 标签：必须用白色叠加层，跟主题无关 */
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
  color: var(--moo-c-brand-fg);
  font-size: 32px;
  line-height: 56px;
  margin-bottom: 14px;
  /* 复用 tokens.css 的 --moo-c-success-halo（同色调 .14 透明度的柔光） */
  box-shadow: 0 0 0 6px var(--moo-c-success-halo);
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
.moo-success-link {
  display: inline-block;
  margin: 6px 0 8px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--c-brand, #3b82f6);
  background: var(--c-bg-elev);
  border-radius: var(--r-sm);
  text-decoration: none;
  border: 1px solid var(--c-border);
  transition: background 120ms;
}
.moo-success-link:hover {
  background: var(--c-bg);
  text-decoration: none;
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
  /* 后端错误经常带超长 token / 无空格 URL，pre-line 不会断词，会撑爆 fail banner
     横向出 dialog；anywhere 是 word-break: break-all 的现代等价但保留单词边界 */
  overflow-wrap: anywhere;
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
  /* toast 暗底始终保持高对比度：跟主题无关，必须独立硬编码 slate-900 */
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
  /* 品牌色 indigo-600 (#4f46e5) 软填充 + 全屏 box-shadow 反相 scrim
     box-shadow spread 法做反相 scrim 的标准技巧；rgba 跟 --moo-c-brand / --moo-c-scrim 系出同源 */
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
  color: var(--moo-c-brand-fg);
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
  /* 分隔线在 indigo 实心上：必须用白叠加，跟主题无关 */
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
  /* 视频 letterbox 背景必须是纯黑：跟主题无关，是视频播放器约定 */
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
  /* 录制浮条暗底：保持高对比度，跟主题无关，硬编码 slate-900 */
  background: rgba(15, 23, 42, .95);
  color: #fff;
  border-radius: var(--r-pill, 999px);
  box-shadow: var(--sh-lg);
  font-size: 12px;
  font-weight: 500;
  /* 极窄宿主页（移动端模拟器 / DevTools docked 半屏）兜底：浮条估算宽 245px，
     超窄 viewport 时让内容横向不溢出可视区；ContentApp.vue 的 recBarStyle 也用
     245px 做 clamp，这里只是 CSS 层最后一道保险 */
  max-width: calc(100vw - 16px);
}
.rec-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--c-danger);
  /* danger-600 halo：颜色绑定 --c-danger 字面值，没法 var() 进 rgba */
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
/* rec-bar 内部按钮：在 slate-900 暗底上的白色叠加按钮，跟主题无关 */
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
