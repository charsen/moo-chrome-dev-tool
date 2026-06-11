import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * v0.8.9 Fix B 回归（source-level tripwire）：ElementPicker 忽略自身 shadow host
 * 的判定必须用 styles.ts 的 HOST_ID 单一事实源。
 *
 * 回归背景：旧码写死 'MOO-DEV-TOOL-ROOT' / '__moo_root__' —— 是早已不存在的标识，
 * 等于没挡：取色 hover 扫过我们自己的悬浮球/dialog host 时会把它当页面元素选中。
 *
 * 断面说明（如实声明）：.vue 组件在本仓 vitest（node 环境、无 vue plugin）挂不起来，
 * 这里做的是「源码漂移 tripwire」—— 锁 HOST_ID import + 判定语句 + 过期标识清零，
 * 防止下次重构再写回硬编码。styles.ts 模块本身也不能 import（顶层解析 tokens.css
 * 的 vite ?inline 在 node 下挂）—— 全部走源码文本断言。真实 hover 拾取行为不在
 * 单测/现有 e2e 断面内（Playwright 驱不动 closed shadow 内的 hover 拾取链路）→
 * 归发版前手测（RELEASE_TEST_CHECKLIST 元素选取段）。
 */

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('ElementPicker HOST_ID 单一事实源（v0.8.9 Fix B tripwire）', () => {
  const picker = read('src/content/ElementPicker.vue')

  it('ElementPicker 从 styles.ts import HOST_ID 并用于自身 host 判定', () => {
    expect(picker).toContain(`import { HOST_ID } from './styles'`)
    expect(picker).toContain('target.id === HOST_ID')
  })

  it('过期硬编码标识不再作为判定条件（旧码 = 没挡，picker 会选中自家悬浮球）', () => {
    // 注：修复注释里提到这两个旧标识是允许的（讲历史），锁的是「比较用法」不复活
    expect(picker).not.toContain(`tagName === 'MOO-DEV-TOOL-ROOT'`)
    expect(picker).not.toContain(`target.id === '__moo_root__'`)
  })

  it('HOST_ID 在 styles.ts 真实有值，且 content/index.ts 注入 host 用的就是它（两端同源才挡得住）', () => {
    const styles = read('src/content/styles.ts')
    const m = styles.match(/export const HOST_ID = '([^']+)'/)
    expect(m?.[1]).toBeTruthy()                       // 单一事实源定义存在且非空
    const contentIndex = read('src/content/index.ts')
    expect(contentIndex).toContain('host.id = HOST_ID')
  })
})
