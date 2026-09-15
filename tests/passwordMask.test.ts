import { describe, it, expect, afterEach, vi } from 'vitest'
import { maskPasswordInputs } from '@/content/passwordMask'

/**
 * passwordMask 是 AGENTS.md 点名的「截图前密码遮罩」防线 —— 之前**零测试**
 * （unit + e2e 都没有任何文件引用它）。这组用例锁住它的对外契约：
 *   可见密码框 → 每个盖一层固定定位的灰条纹 overlay；隐藏（零尺寸）的跳过；
 *   unmask() 必须把全部 overlay 摘干净（漏摘 = 灰条永久留在宿主页上）。
 *
 * 环境说明：vitest.config.ts 明确是 `environment: 'node'`（「测试只跑纯函数，
 * 不挂浏览器环境」）。所以这里不引入 jsdom，按本仓既有风格用 vi.stubGlobal
 * 注入一个**只实现该模块真正用到的那几个 API** 的最小 DOM 假体。
 * 好处是断言更精确：假体的 style 是可观察的普通对象，能直接断言「设了哪些属性、值是什么」。
 */

interface FakeStyle {
  [k: string]: string
}

interface FakeEl {
  tag: string
  attrs: Record<string, string>
  style: FakeStyle
  removed: boolean
  rect: { left: number; top: number; width: number; height: number }
  setAttribute(name: string, value: string): void
  remove(): void
  getBoundingClientRect(): { left: number; top: number; width: number; height: number }
}

function fakeEl(
  tag: string,
  rect = { left: 0, top: 0, width: 0, height: 0 }
): FakeEl {
  return {
    tag,
    attrs: {},
    style: {},
    removed: false,
    rect,
    setAttribute(name, value) {
      this.attrs[name] = value
    },
    remove() {
      this.removed = true
    },
    getBoundingClientRect() {
      return this.rect
    }
  }
}

/** 装一套假 DOM，返回「被 append 到 documentElement 的节点」供断言。 */
function installDom(inputs: FakeEl[], computed: { borderRadius: string } = { borderRadius: '6px' }) {
  const appended: FakeEl[] = []
  vi.stubGlobal('document', {
    querySelectorAll: () => inputs,
    createElement: (tag: string) => fakeEl(tag),
    documentElement: {
      appendChild: (el: FakeEl) => {
        appended.push(el)
      }
    }
  })
  vi.stubGlobal('getComputedStyle', () => computed)
  return { appended }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('maskPasswordInputs', () => {
  it('页面上没有 type=password → 不创建任何节点，返回的 unmask 是安全的空操作', () => {
    const { appended } = installDom([])
    const unmask = maskPasswordInputs()
    expect(appended).toHaveLength(0)
    expect(() => unmask()).not.toThrow()
  })

  it('每个可见密码框盖一层 overlay，并按契约设好属性与样式', () => {
    const a = fakeEl('input', { left: 10, top: 20, width: 200, height: 30 })
    const b = fakeEl('input', { left: 0, top: 100, width: 320, height: 40 })
    const { appended } = installDom([a, b])

    maskPasswordInputs()

    expect(appended).toHaveLength(2)
    for (const o of appended) {
      // 标记位是清理与排查的抓手（宿主页上唯一可识别的 Moo 痕迹）
      expect(o.attrs['data-moo-pwd-mask']).toBe('1')
      // 必须是 fixed 且覆盖在输入框正上方、不接管指针事件（否则页面点不动该输入框）
      expect(o.style.position).toBe('fixed')
      expect(o.style.pointerEvents).toBe('none')
      expect(o.style.zIndex).toBe('2147483646')
      // 灰条纹背景：只断言形态，不锁具体色值（改配色不该让测试红）
      expect(o.style.background).toContain('repeating-linear-gradient')
    }
    // 位置 / 尺寸逐框对齐，len 单位是 px
    expect(appended[0]!.style.left).toBe('10px')
    expect(appended[0]!.style.top).toBe('20px')
    expect(appended[0]!.style.width).toBe('200px')
    expect(appended[0]!.style.height).toBe('30px')
    expect(appended[1]!.style.left).toBe('0px')
    expect(appended[1]!.style.width).toBe('320px')
  })

  it('零尺寸（display:none / 未布局）的密码框被跳过，不产生幽灵 overlay', () => {
    const hidden = fakeEl('input', { left: 0, top: 0, width: 0, height: 0 })
    const noHeight = fakeEl('input', { left: 5, top: 5, width: 100, height: 0 })
    const visible = fakeEl('input', { left: 8, top: 8, width: 120, height: 24 })
    const { appended } = installDom([hidden, noHeight, visible])

    maskPasswordInputs()

    expect(appended).toHaveLength(1)
    expect(appended[0]!.style.left).toBe('8px')
  })

  it('unmask() 摘掉全部 overlay（漏摘 = 灰条永久留在宿主页）', () => {
    const a = fakeEl('input', { left: 0, top: 0, width: 100, height: 20 })
    const b = fakeEl('input', { left: 0, top: 40, width: 100, height: 20 })
    const { appended } = installDom([a, b])

    const unmask = maskPasswordInputs()
    expect(appended.every((o) => o.removed)).toBe(false)

    unmask()
    expect(appended).toHaveLength(2)
    expect(appended.every((o) => o.removed)).toBe(true)
  })

  it('unmask() 可重复调用（finally 里调用 + 调用方兜底再调一次不会炸）', () => {
    const a = fakeEl('input', { left: 0, top: 0, width: 100, height: 20 })
    const { appended } = installDom([a])
    const unmask = maskPasswordInputs()
    unmask()
    expect(() => unmask()).not.toThrow()
    expect(appended.every((o) => o.removed)).toBe(true)
  })

  it('输入框 computedStyle 拿不到 borderRadius 时兜底为 2px（而不是写空值丢掉圆角）', () => {
    const a = fakeEl('input', { left: 0, top: 0, width: 100, height: 20 })
    const { appended } = installDom([a], { borderRadius: '' })

    maskPasswordInputs()

    expect(appended[0]!.style.borderRadius).toBe('2px')
  })

  it('有 borderRadius 时用输入框自己的（让灰条贴合圆角输入框）', () => {
    const a = fakeEl('input', { left: 0, top: 0, width: 100, height: 20 })
    const { appended } = installDom([a], { borderRadius: '999px' })

    maskPasswordInputs()

    expect(appended[0]!.style.borderRadius).toBe('999px')
  })
})
