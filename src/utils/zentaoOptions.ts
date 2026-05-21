/**
 * 禅道 bug 字段的候选值字典 —— Environment（项目默认值）+ SubmitDialog（每条 bug 可改）
 * 两处共用，避免分叉。如果禅道版本升级 type 枚举变了，这里改一处。
 */

export interface SelectOption<T = string> {
  value: T
  label: string
}

/** 禅道 bug type 候选（biz12 内置） */
export const ZENTAO_TYPE_OPTIONS: SelectOption[] = [
  { value: 'codeerror', label: '代码错误' },
  { value: 'designdefect', label: '设计缺陷' },
  { value: 'config', label: '配置相关' },
  { value: 'install', label: '安装部署' },
  { value: 'security', label: '安全相关' },
  { value: 'performance', label: '性能问题' },
  { value: 'standard', label: '标准规范' },
  { value: 'automation', label: '自动化' },
  { value: 'designchange', label: '设计变更' },
  { value: 'newfeature', label: '新需求' },
  { value: 'improvement', label: '改进建议' },
  { value: 'others', label: '其他' }
]

export const ZENTAO_SEVERITY_OPTIONS: SelectOption<1 | 2 | 3 | 4>[] = [
  { value: 1, label: '1 致命' },
  { value: 2, label: '2 严重' },
  { value: 3, label: '3 一般' },
  { value: 4, label: '4 提示' }
]

export const ZENTAO_PRI_OPTIONS: SelectOption<1 | 2 | 3 | 4>[] = [
  { value: 1, label: '1 紧急' },
  { value: 2, label: '2 高' },
  { value: 3, label: '3 中' },
  { value: 4, label: '4 低' }
]
