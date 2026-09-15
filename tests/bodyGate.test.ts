import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_BODY_READ_BYTES,
  TEXTUAL_MIMES,
  mimeOf,
  isTextualContentType,
  gateResponseBodyRead,
  skippedBodyNote
} from '@/utils/bodyGate'

/**
 * 两组用例：
 *  A. 闸门逻辑本身（纯函数）
 *  B. **漂移守卫** —— src/injected/main-world.ts 不能 import @/ 模块（IIFE 注入 MAIN world 的
 *     硬约束，见该文件头），所以它内联了一份同语义副本。B 组直接读那份源码，断言阈值与 mime
 *     表跟这里的权威实现一致。跟 `scripts/check-version-consistency.mjs` 用读源码方式校验
 *     「⌘⇧B 文案 ↔ ContentApp.vue」是同一套路子。
 */

describe('mimeOf', () => {
  it('去掉 charset 参数并小写', () => {
    expect(mimeOf('Application/JSON; charset=utf-8')).toBe('application/json')
    expect(mimeOf('text/plain')).toBe('text/plain')
  })
  it('null / undefined / 空串 → 空串', () => {
    expect(mimeOf(null)).toBe('')
    expect(mimeOf(undefined)).toBe('')
    expect(mimeOf('')).toBe('')
  })
})

describe('isTextualContentType', () => {
  it('text/* 与常见 application 文本类型 → true', () => {
    for (const ct of [
      'text/html', 'text/plain; charset=utf-8', 'application/json',
      'application/xml', 'application/x-www-form-urlencoded', 'application/graphql'
    ]) {
      expect(isTextualContentType(ct)).toBe(true)
    }
  })
  it('+json / +xml 后缀（如 application/vnd.api+json）→ true', () => {
    expect(isTextualContentType('application/vnd.api+json')).toBe(true)
    expect(isTextualContentType('application/atom+xml')).toBe(true)
  })
  it('二进制类型 → false', () => {
    for (const ct of [
      'image/png', 'video/webm', 'audio/mpeg', 'application/octet-stream',
      'application/pdf', 'application/zip', 'font/woff2'
    ]) {
      expect(isTextualContentType(ct)).toBe(false)
    }
  })
  it('拿不到 content-type → false（但不等于要跳过，见 gateResponseBodyRead）', () => {
    expect(isTextualContentType(null)).toBe(false)
  })
})

describe('gateResponseBodyRead', () => {
  it('小 JSON（文本 + 有 content-length）→ 读', () => {
    const g = gateResponseBodyRead('application/json', '512')
    expect(g.skip).toBe(false)
    expect(g.bytes).toBe(512)
  })

  it('大 JSON（文本但超上限）→ 跳过，并带回真实字节数', () => {
    const g = gateResponseBodyRead('application/json', String(8 * 1024 * 1024))
    expect(g.skip).toBe(true)
    expect(g.bytes).toBe(8 * 1024 * 1024)
  })

  it('二进制（png）→ 跳过，即使体积很小', () => {
    expect(gateResponseBodyRead('image/png', '2048').skip).toBe(true)
  })

  it('拿不到 content-length 的文本响应 → 放行（no-cors / 分块传输占日常大多数，误判会丢采集）', () => {
    expect(gateResponseBodyRead('application/json', null).skip).toBe(false)
    expect(gateResponseBodyRead('text/html', '').skip).toBe(false)
  })

  it('畸形的 content-length（NaN / 负数 / 0）→ 不当作超限', () => {
    expect(gateResponseBodyRead('application/json', 'NaN').skip).toBe(false)
    expect(gateResponseBodyRead('application/json', '-1').skip).toBe(false)
    expect(gateResponseBodyRead('application/json', '0').skip).toBe(false)
    expect(gateResponseBodyRead('application/json', 'NaN').bytes).toBe(0)
  })

  it('完全拿不到类型、也没有长度 → 放行（保守优先保采集）', () => {
    expect(gateResponseBodyRead(null, null).skip).toBe(false)
  })

  it('完全拿不到类型、但长度明确超限 → 跳过（只看长度这一条线索）', () => {
    const g = gateResponseBodyRead(null, String(MAX_BODY_READ_BYTES + 1))
    expect(g.skip).toBe(true)
  })

  it('边界：正好等于上限 → 读（用 > 而不是 >=）', () => {
    expect(gateResponseBodyRead('application/json', String(MAX_BODY_READ_BYTES)).skip).toBe(false)
    expect(gateResponseBodyRead('application/json', String(MAX_BODY_READ_BYTES + 1)).skip).toBe(true)
  })
})

describe('skippedBodyNote', () => {
  it('自解释：含 mime、体积、去向提示', () => {
    const note = skippedBodyNote(gateResponseBodyRead('image/png', String(2 * 1024 * 1024)))
    expect(note).toContain('image/png')
    expect(note).toContain('2.0 MB')
    expect(note).toContain('未读取响应体')
    expect(note).toContain('DevTools')
  })

  it('拿不到长度时不硬编体积', () => {
    const note = skippedBodyNote(gateResponseBodyRead('video/webm', null))
    expect(note).toContain('video/webm')
    expect(note).not.toContain('MB ·')
  })
})

// ---------------------------------------------------------------------------
// B. 漂移守卫：断言 main-world.ts 的内联副本与权威实现一致
// ---------------------------------------------------------------------------

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN_WORLD_SRC = readFileSync(resolve(SRC_DIR, 'src/injected/main-world.ts'), 'utf8')

/** 只允许数字 / 乘 / 加 —— 够用且不必 eval */
function evalArith(expr: string): number {
  if (!/^[\d\s*+]+$/.test(expr)) throw new Error(`不是纯算术表达式，拒绝求值: ${expr}`)
  return expr
    .split('+')
    .reduce((acc, part) => acc + part.split('*').reduce((a, b) => a * Number(b.trim()), 1), 0)
}

describe('main-world.ts 内联副本一致性（MAIN world 不能 import，只能靠这组断言挡漂移）', () => {
  it('main-world.ts 不得出现顶层 import（IIFE 注入 MAIN world 的硬约束）', () => {
    // 顶层 import 语句必须顶格（允许前面有空白），注释里的 "import" 不在行首因此不会误报
    expect(MAIN_WORLD_SRC).not.toMatch(/^\s*import\s/m)
  })

  it('MAX_BODY_READ_BYTES 两处数值一致', () => {
    const m = MAIN_WORLD_SRC.match(/const MAX_BODY_READ_BYTES = ([^\n]+)/)
    expect(m, 'main-world.ts 里找不到 MAX_BODY_READ_BYTES，可能被重命名了').toBeTruthy()
    expect(evalArith(m![1]!)).toBe(MAX_BODY_READ_BYTES)
  })

  it('TEXTUAL_MIMES 两处集合一致', () => {
    const m = MAIN_WORLD_SRC.match(/const TEXTUAL_MIMES = \[([\s\S]*?)\]/)
    expect(m, 'main-world.ts 里找不到 TEXTUAL_MIMES').toBeTruthy()
    const inline = (m![1]!.match(/'([^']+)'/g) ?? []).map(s => s.slice(1, -1))
    expect(inline.sort()).toEqual([...TEXTUAL_MIMES].sort())
  })

  it('两个注入点（fetch / XHR）都过了闸门，别只改一处', () => {
    const gateCalls = MAIN_WORLD_SRC.match(/gateBody\(/g) ?? []
    // 1 次定义 + 2 处调用
    expect(gateCalls.length).toBe(3)
    expect(MAIN_WORLD_SRC.match(/skippedBodyNote\(/g)?.length).toBe(3) // 1 定义 + 2 调用
  })
})
