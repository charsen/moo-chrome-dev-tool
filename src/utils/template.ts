export type TemplateContext = Record<string, unknown>

/**
 * 极简模板：
 * - {{var}}      → String(value)，并对 JSON 字符串字面量里的特殊字符做转义
 *                  （`"` `\` 换行 / 制表 / 控制符 → \\" \\\\ \\n \\t \\uXXXX）
 *                  渲染后字符串可直接放进 `"..."` 字面量而不破坏 JSON。
 * - {{varJson}}  → JSON.stringify(value)（若 var 不以 Json 结尾，则原样替换）
 *
 * 未找到的变量保留 {{xxx}} 原样输出，方便调试。
 *
 * **为何要 escape**：默认模板长这样 `"title": "{{title}}"`，title 是用户在
 * SubmitDialog 里输入的。若不 escape，用户敲 `"\n` 就能让 POST body 变成
 * 非法 JSON 或注入额外字段（CWE-79 模板注入的 JSON 变体）。
 *
 * **不会破坏数字 / 对象上下文**：JSON.stringify(String(42)) = '"42"'，
 * slice(1,-1) = '42'——放在 `"x": {{n}}` 的位置仍是合法 JSON 数字。
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
      if (v === null || v === undefined) return ''
      return jsonStringInner(String(v))
    }
    return full
  })
}

/** 把字符串转成可以直接拼到 `"..."` 字面量里的 JSON 安全形式（不含外层引号）。
 *  例：`a"b\nc` → `a\"b\\nc` */
function jsonStringInner(s: string): string {
  // JSON.stringify 保证产出 `"..."` 包裹的合法 JSON 字符串字面量，
  // 去掉首尾引号即可得到"内层"，比手写 4-5 个 replace 更稳。
  return JSON.stringify(s).slice(1, -1)
}
