/**
 * 截图前给页面上所有 type=password 的输入框盖一层灰条，防止真实密码被截进图。
 *
 * 覆盖范围（v0.8.19 扩展）：
 *   - 顶层文档
 *   - 同源 iframe（递归，坐标按每层 iframe 的 rect + 边框偏移累计）
 *   - open shadow root（closed shadow 从外部拿不到，属已知限制）
 * 跨域 iframe 的 DOM 读不到，无法自动遮罩 —— 需要用户自行确认截图内容。
 *
 * 用法：
 *   const unmask = maskPasswordInputs()
 *   // ... 触发截图
 *   unmask()
 */

interface MaskTarget {
  input: HTMLInputElement
  /** 相对顶层视口的偏移（跨 iframe 时累计） */
  offsetX: number
  offsetY: number
}

const MAX_FRAME_DEPTH = 6

function collectPasswordInputs(
  root: ParentNode,
  offsetX: number,
  offsetY: number,
  depth: number,
  out: MaskTarget[]
): void {
  if (depth > MAX_FRAME_DEPTH) return

  root.querySelectorAll<HTMLInputElement>('input[type=password]').forEach((input) => {
    out.push({ input, offsetX, offsetY })
  })
  if (depth === MAX_FRAME_DEPTH) return

  // open shadow root：querySelectorAll 不穿透 shadow 边界，需逐元素检查
  root.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const shadow = (el as HTMLElement).shadowRoot
    if (shadow) collectPasswordInputs(shadow, offsetX, offsetY, depth + 1, out)
  })

  // 同源 iframe：contentDocument 可读；跨域会 null / 抛错，跳过
  root.querySelectorAll<HTMLIFrameElement>('iframe').forEach((frame) => {
    try {
      const doc = frame.contentDocument
      if (!doc) return
      const rect = frame.getBoundingClientRect()
      // contentDocument 坐标从 iframe 的 content box 起算，需加上 frame 的边框
      collectPasswordInputs(
        doc,
        offsetX + rect.left + (frame.clientLeft || 0),
        offsetY + rect.top + (frame.clientTop || 0),
        depth + 1,
        out
      )
    } catch {
      // 跨域 / 已卸载 iframe
    }
  })
}

export function maskPasswordInputs(): () => void {
  const targets: MaskTarget[] = []
  collectPasswordInputs(document, 0, 0, 0, targets)
  if (targets.length === 0) return () => {}

  const overlays: HTMLDivElement[] = []
  for (const { input, offsetX, offsetY } of targets) {
    const rect = input.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue

    const overlay = document.createElement('div')
    overlay.setAttribute('data-moo-pwd-mask', '1')
    Object.assign(overlay.style, {
      position: 'fixed',
      left: rect.left + offsetX + 'px',
      top: rect.top + offsetY + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
      // 灰色斜条纹（slate-300 / slate-400 字面值）。这是直接 inline style 贴到宿主 DOM
      // 上的 overlay，不在 shadow root 里，拿不到 tokens.css 变量。视觉语义固定（"密码已遮罩"），
      // 跟主题无关，硬编码字面值
      background: 'repeating-linear-gradient(135deg, #cbd5e1, #cbd5e1 6px, #94a3b8 6px, #94a3b8 12px)',
      borderRadius: getComputedStyle(input).borderRadius || '2px',
      zIndex: '2147483646',
      pointerEvents: 'none'
    } as CSSStyleDeclaration)
    document.documentElement.appendChild(overlay)
    overlays.push(overlay)
  }

  return () => {
    for (const o of overlays) o.remove()
  }
}
