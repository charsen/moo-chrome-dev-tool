import { beforeEach, describe, expect, it, vi } from 'vitest'

// vitest 环境是 'node'（vitest.config.ts）：useFocusTrap 在 setup 外调用 onBeforeUnmount
// 会 Vue warn —— mock 成 no-op（同 useAutoSave.test.ts 先例），专注测 trap 状态机：
// activate（挂监听+初始焦点）/ Tab 循环 / Esc 钩子 / paused 摘挂监听（v0.8.11 新增）。
//
// 覆盖：composable 的监听挂/摘、焦点策略、paused 切换语义（MooDialog 缩小态依赖）、
// isComposing 组字守卫（v0.8.16：IME 取消候选的 Esc 不该关弹窗）。
// 不覆盖：真浏览器 Tab 键焦点移动 / shadow DOM 下钻（e2e dialog-submit D4 + dialog-ux 负责）、
// 真实 IME 组字事件（合成不了 trusted composition，发版前人肉：中文输入中按 Esc）。
vi.mock('vue', async (importActual) => {
  const actual = await importActual<typeof import('vue')>()
  return { ...actual, onBeforeUnmount: vi.fn() }
})

const { nextTick, ref, shallowRef } = await import('vue')
const { useFocusTrap } = await import('@/composables/useFocusTrap')

// ── 最小 fake DOM（node 环境无 document）────────────────────────────────────
// useFocusTrap 真正用到的元素表面：addEventListener/removeEventListener/focus/
// querySelectorAll/contains/getRootNode/offsetParent/disabled。逐个手造，
// 比引入 jsdom 轻（仓库未装 DOM 实现，且只需驱动状态机不需要布局）。

interface FakeDoc { activeElement: unknown }

function makeFocusable(doc: FakeDoc, name: string) {
  const el = {
    name,
    disabled: false,
    offsetParent: {},        // 非 null → getFocusable 视为可见
    shadowRoot: undefined,
    focus: vi.fn(() => { doc.activeElement = el }),
    getRootNode: () => doc
  }
  return el
}

type Listener = (e: unknown) => void

function makeRoot(doc: FakeDoc, focusables: ReturnType<typeof makeFocusable>[]) {
  const listeners = new Map<string, Set<Listener>>()
  const root = {
    listeners,
    shadowRoot: undefined,
    focus: vi.fn(() => { doc.activeElement = root }),
    addEventListener: (t: string, f: Listener) => {
      if (!listeners.has(t)) listeners.set(t, new Set())
      listeners.get(t)!.add(f)
    },
    removeEventListener: (t: string, f: Listener) => {
      listeners.get(t)?.delete(f)
    },
    querySelectorAll: (_sel: string) => focusables,
    contains: (n: unknown) => n === root || focusables.includes(n as never),
    getRootNode: () => doc,
    /** 测试驱动：模拟 keydown 事件派发到已挂的监听（无监听 = 啥也不发生，正是 paused 语义） */
    dispatch(type: string, ev: unknown) {
      for (const f of [...(listeners.get(type) ?? [])]) f(ev)
    },
    keydownCount(): number {
      return listeners.get('keydown')?.size ?? 0
    }
  }
  return root
}

function makeKeyEvent(key: string, shiftKey = false, isComposing = false) {
  return { key, shiftKey, isComposing, preventDefault: vi.fn() }
}

function setup(opts: { initialFocus?: 'first' | 'container'; paused?: ReturnType<typeof ref<boolean>>; onEscape?: () => void } = {}) {
  const doc: FakeDoc = { activeElement: null }
  const body = makeFocusable(doc, 'body-btn')   // trap 激活前宿主页的焦点元素
  doc.activeElement = body
  const first = makeFocusable(doc, 'first')
  const mid = makeFocusable(doc, 'mid')
  const last = makeFocusable(doc, 'last')
  const root = makeRoot(doc, [first, mid, last])
  vi.stubGlobal('document', doc)
  vi.stubGlobal('getComputedStyle', () => ({ position: 'static' }))

  const rootRef = shallowRef(root as unknown as HTMLElement)
  useFocusTrap(rootRef as never, {
    initialFocus: opts.initialFocus,
    paused: opts.paused as never,
    onEscape: opts.onEscape
  })
  return { doc, body, first, mid, last, root, rootRef }
}

describe('useFocusTrap', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('激活：root 挂 keydown 监听 + initialFocus=first 聚焦第一个可聚焦元素', async () => {
    const { root, first, doc } = setup()
    await nextTick()
    expect(root.keydownCount()).toBe(1)
    expect(first.focus).toHaveBeenCalledTimes(1)
    expect(doc.activeElement).toBe(first)
  })

  it("initialFocus='container'：聚焦容器自身（不抢 consumer 自管的输入框焦点策略）", async () => {
    const { root, first } = setup({ initialFocus: 'container' })
    await nextTick()
    expect(root.focus).toHaveBeenCalledTimes(1)
    expect(first.focus).not.toHaveBeenCalled()
  })

  it('Tab 循环：焦点在最后一个 → preventDefault + 跳回第一个；Shift+Tab 在第一个 → 跳到最后', async () => {
    const { root, first, last, doc } = setup()
    await nextTick()

    doc.activeElement = last
    const tab = makeKeyEvent('Tab')
    root.dispatch('keydown', tab)
    expect(tab.preventDefault).toHaveBeenCalled()
    expect(doc.activeElement).toBe(first)

    const shiftTab = makeKeyEvent('Tab', true)
    root.dispatch('keydown', shiftTab)   // 此刻焦点在 first
    expect(shiftTab.preventDefault).toHaveBeenCalled()
    expect(doc.activeElement).toBe(last)
  })

  it('Esc → 调 onEscape 回调（不自作主张关 dialog）', async () => {
    const onEscape = vi.fn()
    const { root } = setup({ onEscape })
    await nextTick()
    root.dispatch('keydown', makeKeyEvent('Escape'))
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('组字中（isComposing）的 Esc 不触发 onEscape；非组字 Esc 照常触发', async () => {
    // v0.8.16：中文输入法在标题/描述框组字时按 Esc 是「取消候选」，不是关弹窗命令。
    // 漏了这个守卫 = 打字取消候选直接关窗丢内容。
    const onEscape = vi.fn()
    const { root } = setup({ onEscape })
    await nextTick()

    root.dispatch('keydown', makeKeyEvent('Escape', false, true))
    expect(onEscape, '组字中的 Esc 必须被吞掉').not.toHaveBeenCalled()

    // 正控：同一个监听，非组字 Esc 立即生效 —— 证明不是「监听没挂上」的假绿
    root.dispatch('keydown', makeKeyEvent('Escape'))
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('组字中（isComposing）的 Tab 不做焦点循环：不 preventDefault、焦点不动', async () => {
    const { root, first, last, doc } = setup()
    await nextTick()
    expect(first.focus).toHaveBeenCalledTimes(1)   // activate 时的 initialFocus

    doc.activeElement = last
    const tab = makeKeyEvent('Tab', false, true)
    root.dispatch('keydown', tab)
    expect(tab.preventDefault, '组字中的 Tab 不该被拦').not.toHaveBeenCalled()
    expect(doc.activeElement, '焦点不应被 trap 挪动').toBe(last)
    expect(first.focus).toHaveBeenCalledTimes(1)   // 没有第二次 focus（未发生循环回跳）
  })

  it('paused=true：摘掉 keydown 监听 —— Tab/Esc 全还给宿主页（MooDialog 缩小态依赖）', async () => {
    const paused = ref(false)
    const onEscape = vi.fn()
    const { root } = setup({ paused, onEscape })
    await nextTick()
    expect(root.keydownCount()).toBe(1)

    paused.value = true
    await nextTick()
    // 核心断言：监听必须真摘掉。漏摘 = 缩小态 dialog 隐藏后键盘链上还挂着 trap 残留
    expect(root.keydownCount()).toBe(0)
    root.dispatch('keydown', makeKeyEvent('Escape'))
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('paused 复位 false：重挂监听 + 按 initialFocus 把焦点送回（恢复弹窗即可继续键盘操作）', async () => {
    const paused = ref(false)
    const { root, first } = setup({ paused })
    await nextTick()
    expect(first.focus).toHaveBeenCalledTimes(1)

    paused.value = true
    await nextTick()
    paused.value = false
    await nextTick()
    expect(root.keydownCount()).toBe(1)            // 监听同 tick 重挂
    // 焦点恢复刻意推迟一拍（nextTick）：watcher 的 post cb 排在 v-show display
    // 翻转（queuePostRenderEffect）之前，同步 focus 会打在 hidden 容器上变 no-op
    await nextTick()
    expect(first.focus).toHaveBeenCalledTimes(2)   // 复位时 focusInitial 又跑一次

    // 复位后 trap 立即可用：Tab 循环正常
    const { doc } = { doc: root.getRootNode() as FakeDoc }
    doc.activeElement = first
    const shiftTab = makeKeyEvent('Tab', true)
    root.dispatch('keydown', shiftTab)
    expect(shiftTab.preventDefault).toHaveBeenCalled()
  })

  it('挂载瞬间就是 paused：不抢焦点不挂监听；复位后才补挂+给焦点', async () => {
    const paused = ref(true)
    const { root, first, doc, body } = setup({ paused })
    await nextTick()
    expect(root.keydownCount()).toBe(0)
    expect(first.focus).not.toHaveBeenCalled()
    expect(doc.activeElement).toBe(body)   // 宿主页焦点没被偷

    paused.value = false
    await nextTick()
    expect(root.keydownCount()).toBe(1)
    await nextTick()   // 焦点恢复推迟一拍（同上：等 v-show display 翻转）
    expect(first.focus).toHaveBeenCalledTimes(1)
  })

  it('复位 false 后、焦点落地前又 paused=true：放弃这次焦点恢复（nextTick 防御守卫）', async () => {
    const paused = ref(false)
    const { first } = setup({ paused })
    await nextTick()
    expect(first.focus).toHaveBeenCalledTimes(1)

    paused.value = true
    await nextTick()
    paused.value = false
    await nextTick()      // watcher 已跑（监听重挂），焦点恢复 cb 还押在 microtask 队列里
    paused.value = true   // 快速连点：焦点落地前又缩小
    await nextTick()
    await nextTick()
    expect(first.focus, '已经又缩小了，不该有第二次 focus（焦点会打到 hidden 容器）').toHaveBeenCalledTimes(1)
  })

  it('paused 反复切换不累积重复监听（addEventListener 幂等性兜底）', async () => {
    const paused = ref(false)
    const { root } = setup({ paused })
    await nextTick()
    for (let i = 0; i < 3; i++) {
      paused.value = true
      await nextTick()
      paused.value = false
      await nextTick()
    }
    expect(root.keydownCount()).toBe(1)
  })
})
