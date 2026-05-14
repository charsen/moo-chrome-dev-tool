/**
 * 截图前给页面上所有 type=password 的输入框盖一层灰条，防止真实密码被截进图。
 *
 * 用法：
 *   const unmask = maskPasswordInputs()
 *   // ... 触发截图
 *   unmask()
 */
export function maskPasswordInputs(): () => void {
  const pwds = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=password]'))
  if (pwds.length === 0) return () => {}

  const overlays: HTMLDivElement[] = []
  for (const input of pwds) {
    const rect = input.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue

    const overlay = document.createElement('div')
    overlay.setAttribute('data-moo-pwd-mask', '1')
    Object.assign(overlay.style, {
      position: 'fixed',
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
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
