import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { chromium, test as base, expect, type BrowserContext, type Worker, type Page, type CDPSession } from '@playwright/test'
import { seedStorage } from './fixtures'

/**
 * 宿主页键盘守卫回归（v0.8.19）—— 真注入 + closed shadow + 真截图链路。
 *
 * 背景（真机 dogfood 复现）：扩展 UI 在 closed shadow 里，键盘事件到宿主页时
 * `e.target` 被重定向成 host `<div>`。后台系统常见的「Backspace 防回退」守卫据此判定
 * 「不在输入框」→ preventDefault，用户在提交弹窗里能打字、不能删字。
 *
 * 覆盖：
 *   K1 document 冒泡守卫 —— 扩展内按键不再冒泡到页面（守卫命中 0），删除正常；
 *   K2 document capture 守卫 —— 页面抢先 preventDefault，shadow 侧补一次等价删除，
 *      仍可正常删除（含 emoji 代理对整字删除）。
 *
 * 驱动手法同 multi-shot-real-flow.spec.ts：CDP pierce closed shadow + 真键盘。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIST = path.resolve(__dirname, '../dist')
const E2E_DIST = path.resolve(__dirname, '../dist-e2e')

function prepareE2EDist(): void {
  if (existsSync(E2E_DIST)) rmSync(E2E_DIST, { recursive: true, force: true })
  cpSync(SRC_DIST, E2E_DIST, { recursive: true })
  const mfPath = path.join(E2E_DIST, 'manifest.json')
  const mf = JSON.parse(readFileSync(mfPath, 'utf8'))
  mf.host_permissions = ['<all_urls>']
  delete mf.optional_host_permissions
  writeFileSync(mfPath, JSON.stringify(mf, null, 2))
}

const test = base.extend<{ context: BrowserContext; sw: Worker }>({
  context: async ({}, use) => {
    prepareE2EDist()
    const ctx = await chromium.launchPersistentContext('', {
      headless: true,
      channel: 'chromium',
      args: ['--headless=new', `--disable-extensions-except=${E2E_DIST}`, `--load-extension=${E2E_DIST}`]
    })
    await use(ctx)
    await ctx.close()
  },
  sw: async ({ context }, use) => {
    let [sw] = context.serviceWorkers()
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 10_000 })
    await use(sw)
  }
})

let server: Server
let PORT: number

test.beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    // ?guard=capture → document capture 阶段注册；缺省 document 冒泡阶段
    const capture = url.searchParams.get('guard') === 'capture'
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<!doctype html><html><head><title>keyboard isolation fixture</title>
<script>
  // 后台系统典型的 Backspace 防回退守卫：只看 e.target 是不是输入框。
  // 闭合 shadow 内的按键到页面时 target 是 host div → 会误判成「不在输入框」。
  function isEditable(t) {
    return t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
  }
  window.__pageKeyHits = 0
  window.__backspaceGuardHits = 0
  document.addEventListener('keydown', function (e) {
    window.__pageKeyHits++
    if (e.key === 'Backspace' && !isEditable(e.target)) {
      window.__backspaceGuardHits++
      e.preventDefault()
    }
  }, ${capture ? 'true' : 'false'})
</script></head>
<body style="background:#fff"><h1 id="headline">keyboard isolation page</h1></body></html>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  PORT = (server.address() as AddressInfo).port
})

test.afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

function makeConfig() {
  return {
    globalEnabled: true,
    projects: [{
      id: 'p-keyboard',
      name: 'keyboard isolation',
      matchPatterns: [`http://127.0.0.1:${PORT}/*`],
      kind: 'webhook' as const,
      servers: [{
        id: 's-mock',
        name: 'mock receiver',
        endpoint: `http://127.0.0.1:${PORT}/api/bug`,
        method: 'POST' as const,
        headers: { 'Content-Type': 'application/json' },
        payloadTemplate: '{"title":"{{title}}"}',
        imageField: 'screenshot',
        imageFormat: 'base64' as const
      }],
      defaultServerId: 's-mock',
      capture: { requests: false, consoleErrors: false, storageKeys: [], requestBufferSize: 50 },
      redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: true },
      enabled: true
    }]
  }
}

// ─── CDP pierce 工具（closed shadow DOM Playwright selector 够不到）───────────
interface CdpNode {
  nodeId: number
  backendNodeId: number
  nodeName: string
  nodeType: number
  nodeValue: string
  attributes?: string[]
  children?: CdpNode[]
  shadowRoots?: CdpNode[]
}
function* walk(node: CdpNode): Generator<CdpNode> {
  yield node
  for (const c of node.children ?? []) yield* walk(c)
  for (const s of node.shadowRoots ?? []) yield* walk(s)
}
function attrsOf(node: CdpNode): Record<string, string> {
  const out: Record<string, string> = {}
  const a = node.attributes ?? []
  for (let i = 0; i + 1 < a.length; i += 2) out[a[i]!] = a[i + 1]!
  return out
}
function textOf(node: CdpNode): string {
  let s = ''
  for (const n of walk(node)) if (n.nodeType === 3) s += n.nodeValue
  return s
}
async function snapshot(cdp: CDPSession): Promise<CdpNode> {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true }) as { root: CdpNode }
  return root
}
type Pred = (n: CdpNode, attrs: Record<string, string>) => boolean
function findAll(root: CdpNode, pred: Pred): CdpNode[] {
  const out: CdpNode[] = []
  for (const n of walk(root)) if (n.nodeType === 1 && pred(n, attrsOf(n))) out.push(n)
  return out
}
async function waitFor(cdp: CDPSession, pred: Pred, what: string, timeoutMs = 12_000): Promise<CdpNode> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const hit = findAll(await snapshot(cdp), pred)[0]
    if (hit) return hit
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`waitFor timeout: ${what}`)
}
async function cdpClick(cdp: CDPSession, node: CdpNode): Promise<void> {
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node.backendNodeId }) as { object: { objectId: string } }
  await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function(){ this.click() }' })
}
async function cdpFocus(cdp: CDPSession, node: CdpNode): Promise<void> {
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node.backendNodeId }) as { object: { objectId: string } }
  await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function(){ this.focus() }' })
}
async function cdpValue(cdp: CDPSession, node: CdpNode): Promise<string> {
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node.backendNodeId }) as { object: { objectId: string } }
  const res = await cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: 'function(){ return this.value }',
    returnByValue: true
  }) as { result: { value: string } }
  return res.result.value
}

const isCaptureBallBtn: Pred = (n, a) => n.nodeName === 'BUTTON' && a['title'] === '截图'
const isAnnotator: Pred = (n, a) => (a['class'] ?? '').includes('moo-annotator')
const isNextBtn: Pred = (n, a) =>
  n.nodeName === 'BUTTON' && (a['class'] ?? '').includes('primary') && textOf(n).includes('下一步')
const isTitleInput: Pred = (n, a) => a['id'] === 'moo-title'
const isDescTextarea: Pred = (n, a) => a['id'] === 'moo-desc'
const isSuccessTitle: Pred = (n, a) => (a['class'] ?? '').includes('moo-success-title')

/** 真截图链路走到 SubmitDialog（标题框 mount 即聚焦） */
async function openSubmitDialog(context: BrowserContext, sw: Worker, guard: 'bubble' | 'capture'): Promise<{ page: Page; cdp: CDPSession }> {
  await seedStorage(sw, { mooConfig: makeConfig() })
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 600)))  // register debounce
  const page = await context.newPage()
  await page.setViewportSize({ width: 1100, height: 750 })
  await page.goto(`http://127.0.0.1:${PORT}/?guard=${guard}`)
  await page.waitForFunction(() => !!document.querySelector('#__moo_dev_tool_host__'), undefined, { timeout: 8000 })
  const cdp = await context.newCDPSession(page)
  const ball = await waitFor(cdp, isCaptureBallBtn, '悬浮球截图按钮', 8000)
  await new Promise((r) => setTimeout(r, 300))  // 悬浮球入场
  await cdpClick(cdp, ball)
  await waitFor(cdp, isAnnotator, 'Annotator（真截屏成功才会出现）')
  await cdpClick(cdp, await waitFor(cdp, isNextBtn, 'Annotator 下一步按钮'))
  await waitFor(cdp, isTitleInput, 'SubmitDialog 标题输入框')
  await page.waitForTimeout(700)  // stealPageFocusRepeatedly 抢焦点窗口
  return { page, cdp }
}

async function pageKeyStats(page: Page): Promise<{ keys: number; guards: number }> {
  return page.evaluate(() => {
    const w = window as unknown as { __pageKeyHits?: number; __backspaceGuardHits?: number }
    return { keys: w.__pageKeyHits ?? 0, guards: w.__backspaceGuardHits ?? 0 }
  })
}

test('K1 · document 冒泡 Backspace 守卫：扩展内按键不冒泡到页面，标题/描述可删除', async ({ context, sw }) => {
  test.setTimeout(90_000)
  const { page, cdp } = await openSubmitDialog(context, sw, 'bubble')

  await page.keyboard.type('abc中文')
  const title = await waitFor(cdp, isTitleInput, '标题输入框')
  expect(await cdpValue(cdp, title)).toBe('abc中文')

  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await expect.poll(() => cdpValue(cdp, title), { timeout: 2000 }).toBe('abc')

  // 页面守卫一次都不该收到扩展 UI 内的按键
  expect(await pageKeyStats(page)).toEqual({ keys: 0, guards: 0 })

  // 描述 textarea 同款
  const desc = await waitFor(cdp, isDescTextarea, '描述输入框')
  await cdpFocus(cdp, desc)
  await page.keyboard.type('steps')
  await page.keyboard.press('Backspace')
  await expect.poll(() => cdpValue(cdp, desc), { timeout: 2000 }).toBe('step')

  // 隔离挂在 shadow root 冒泡阶段，扩展自己的 window capture 快捷键（⌘/Ctrl+Enter）不受影响
  await page.keyboard.press('ControlOrMeta+Enter')
  await waitFor(cdp, isSuccessTitle, '⌘/Ctrl+Enter 应仍能提交成功')

  await page.close()
})

test('K2 · document capture Backspace 守卫：页面抢先 preventDefault 后仍能删除（含 emoji 整字）', async ({ context, sw }) => {
  test.setTimeout(90_000)
  const { page, cdp } = await openSubmitDialog(context, sw, 'capture')

  await page.keyboard.type('ab😀中')
  const title = await waitFor(cdp, isTitleInput, '标题输入框')
  expect(await cdpValue(cdp, title)).toBe('ab😀中')

  await page.keyboard.press('Backspace')
  await expect.poll(() => cdpValue(cdp, title), { timeout: 2000 }).toBe('ab😀')
  // 再删一次：代理对要整字删除，不能留半个 emoji
  await page.keyboard.press('Backspace')
  await expect.poll(() => cdpValue(cdp, title), { timeout: 2000 }).toBe('ab')

  // capture 守卫仍然命中（时间早于 shadow root），删除由 shadow 侧补回
  expect((await pageKeyStats(page)).guards).toBeGreaterThan(0)

  await page.close()
})
