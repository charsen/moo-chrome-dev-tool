/**
 * 简易深拷贝：基于 JSON 序列化。
 *
 * 适用：plain object / 数组 / 基础类型嵌套（项目配置、Annotator state 这类纯数据）。
 * 不适用：Date / Map / Set / 含函数 / 含循环引用 / Vue ref 等复杂值——这些场景请改用 structuredClone()。
 */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}
