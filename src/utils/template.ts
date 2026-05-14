export type TemplateContext = Record<string, unknown>

/**
 * 极简模板：
 * - {{var}}      → String(value)
 * - {{varJson}}  → JSON.stringify(value)（若 var 不以 Json 结尾，则原样替换）
 * 未找到的变量保留 {{xxx}} 原样输出，方便调试。
 */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (full, expr: string) => {
    if (expr.endsWith('Json')) {
      const key = expr.slice(0, -4)
      if (key in ctx) return JSON.stringify(ctx[key])
      return full
    }
    if (expr in ctx) {
      const v = ctx[expr]
      return v === null || v === undefined ? '' : String(v)
    }
    return full
  })
}
