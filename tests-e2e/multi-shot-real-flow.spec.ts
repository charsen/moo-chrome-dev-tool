import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { chromium, test as base, expect, type BrowserContext, type Worker, type Page, type CDPSession } from '@playwright/test'
import { seedStorage } from './fixtures'

/**
 * 多张截图「真流程」smoke（v0.8.10）—— 容忍重跑（比常规 e2e 更接近真用户链路，
 * 涉及 captureVisibleTab 真截屏 + closed shadow UI 驱动，偶发慢机器超时可重跑）。
 *
 * 覆盖（harness e2e dialog-multi-shot.spec.ts 驱不动的整段闭环）：
 *   F1 悬浮球点截图 → 真 captureVisibleTab → Annotator 画矩形 → 下一步 →
 *      SubmitDialog 键盘输标题 → ＋再截一张 → 第二轮真截图+标注 → 回弹窗
 *      （标题草稿还在 + 2 张缩略）→ 提交 → 本地 mock server 收到
 *      JSON body：image(=images[0]) + images 长度 2 且两张内容不同
 *   F2 同闭环 multipart 路径：server 收到 form-data 字段 screenshot + screenshot_2
 *   F3 取消语义：Esc 主动退出 → 草稿丢弃 → 重新开流程弹窗干净（标题空 + 仅 1 张新截图）
 *   F4 弹窗位置记忆（v0.8.11 dialogPos）：header 拖开 → 再截一张卸载重挂 → 回原位
 *      无闪跳（--moved + animation none）；Esc 取消重开 → 复位居中
 *
 * 不覆盖：录屏链路（需 chrome.commands user gesture）/ 禅道路径 / toolbar badge。
 *
 * ---
 * 驱动手法（closed shadow DOM Playwright selector 够不到）：
 *   CDP `DOM.getDocument({ pierce: true })` 能穿透 **closed** shadow root 拿全树，
 *   `DOM.resolveNode` + `Runtime.callFunctionOn` 对树内任意元素 click / 读 value。
 *   比坐标点击稳（不依赖布局），比 page.evaluate 强（主世界拿不到 closed shadow）。
 *   标题输入走真键盘（page.keyboard.type）——验证 SubmitDialog mount 即聚焦的真行为。
 *
 * host permission 同 dynamic-register-real-inject.spec.ts：复制 dist → dist-e2e，
 * optional_host_permissions 提升为 mandatory（chrome 装载自动 grant，绕 user gesture）。
 * captureVisibleTab 也靠这个 <all_urls> 真截屏（--headless=new 支持）。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIST = path.resolve(__dirname, '../dist')
const E2E_DIST = path.resolve(__dirname, '../dist-e2e-multishot')

function prepareE2EDist(): void {
  if (existsSync(E2E_DIST)) rmSync(E2E_DIST, { recursive: true, force: true })
  cpSync(SRC_DIST, E2E_DIST, { recursive: true })
  const mfPath = path.join(E2E_DIST, 'manifest.json')
  const mf = JSON.parse(readFileSync(mfPath, 'utf8'))
  mf.host_permissions = ['<all_urls>']
  delete mf.optional_host_permissions
  writeFileSync(mfPath, JSON.stringify(mf, null, 2))
}

interface Fixtures {
  context: BrowserContext
  sw: Worker
}

const test = base.extend<Fixtures>({
  context: async ({}, use) => {
    prepareE2EDist()
    const ctx = await chromium.launchPersistentContext('', {
      headless: true,
      channel: 'chromium',
      args: [
        '--headless=new',
        `--disable-extensions-except=${E2E_DIST}`,
        `--load-extension=${E2E_DIST}`
      ]
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

// ─── 本地 mock 接收端（全程 127.0.0.1，零外发）──────────────────────────────
interface ReceivedReq {
  contentType: string
  /** 原始字节。JSON 断言用 utf8 解码；multipart 体含二进制 PNG，字段名搜索用 latin1（不破坏字节序列） */
  body: Buffer
}
let server: Server
let PORT: number
const received: ReceivedReq[] = []

test.beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && req.url === '/api/bug') {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        received.push({
          contentType: req.headers['content-type'] ?? '',
          body: Buffer.concat(chunks)
        })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: 'mock-bug-1' }))
      })
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><html><head><title>moo multishot fixture</title></head><body style="background:#fff"><h1 id="headline">multi-shot e2e page</h1></body></html>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  PORT = (server.address() as AddressInfo).port
})

test.afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

test.beforeEach(() => { received.length = 0 })

// ─── 配置 seed ──────────────────────────────────────────────────────────────
function makeConfig(imageFormat: 'base64' | 'multipart') {
  const payloadTemplate = imageFormat === 'base64'
    ? '{"title":"{{title}}","screenshot":"{{image}}","images":{{imagesJson}},"url":"{{url}}"}'
    : '{"title":"{{title}}"}'
  return {
    globalEnabled: true,
    projects: [{
      id: 'p-multishot',
      name: 'multi-shot real flow',
      matchPatterns: [`http://127.0.0.1:${PORT}/*`],
      kind: 'webhook' as const,
      servers: [{
        id: 's-mock',
        name: 'mock receiver',
        endpoint: `http://127.0.0.1:${PORT}/api/bug`,
        method: 'POST' as const,
        headers: imageFormat === 'base64' ? { 'Content-Type': 'application/json' } : {},
        payloadTemplate,
        imageField: 'screenshot',
        imageFormat
      }],
      defaultServerId: 's-mock',
      capture: { requests: false, consoleErrors: false, storageKeys: [], requestBufferSize: 50 },
      redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: true },
      enabled: true
    }]
  }
}

// ─── CDP pierce 工具（穿透 closed shadow root）─────────────────────────────
interface CdpNode {
  nodeId: number
  backendNodeId: number
  nodeName: string
  nodeType: number
  nodeValue: string
  attributes?: string[]
  children?: CdpNode[]
  shadowRoots?: CdpNode[]
  contentDocument?: CdpNode
}

function* walk(node: CdpNode): Generator<CdpNode> {
  yield node
  for (const c of node.children ?? []) yield* walk(c)
  for (const s of node.shadowRoots ?? []) yield* walk(s)
  if (node.contentDocument) yield* walk(node.contentDocument)
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

function findAll(root: CdpNode, pred: (n: CdpNode, attrs: Record<string, string>) => boolean): CdpNode[] {
  const out: CdpNode[] = []
  for (const n of walk(root)) {
    if (n.nodeType !== 1) continue
    if (pred(n, attrsOf(n))) out.push(n)
  }
  return out
}

type Pred = (n: CdpNode, attrs: Record<string, string>) => boolean

async function waitFor(cdp: CDPSession, pred: Pred, what: string, timeoutMs = 10_000): Promise<CdpNode> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const hit = findAll(await snapshot(cdp), pred)[0]
    if (hit) return hit
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`waitFor timeout: ${what}`)
}

async function waitGone(cdp: CDPSession, pred: Pred, what: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (findAll(await snapshot(cdp), pred).length === 0) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`waitGone timeout: ${what}`)
}

/** closed shadow 内元素 click：resolveNode + callFunctionOn（不依赖坐标/布局） */
async function cdpClick(cdp: CDPSession, node: CdpNode): Promise<void> {
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node.backendNodeId }) as { object: { objectId: string } }
  await cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: 'function(){ this.click() }'
  })
}

/** closed shadow 内元素上跑任意函数取返回值（rect / class / style 都走这个） */
async function cdpCall<T>(cdp: CDPSession, node: CdpNode, fn: string): Promise<T> {
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node.backendNodeId }) as { object: { objectId: string } }
  const res = await cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: fn,
    returnByValue: true
  }) as { result: { value: T } }
  return res.result.value
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

// ─── 常用谓词 ────────────────────────────────────────────────────────────────
const isCaptureBallBtn: Pred = (n, a) => n.nodeName === 'BUTTON' && a['title'] === '截图'
const isAnnotator: Pred = (n, a) => (a['class'] ?? '').includes('moo-annotator')
const isNextBtn: Pred = (n, a) =>
  n.nodeName === 'BUTTON' && (a['class'] ?? '').includes('primary') && textOf(n).includes('下一步')
const isTitleInput: Pred = (n, a) => a['id'] === 'moo-title'
const isAddShotBtn: Pred = (n) => n.nodeName === 'BUTTON' && textOf(n).includes('再截一张')
const isThumb: Pred = (n, a) => (a['class'] ?? '').includes('moo-thumb-wrap')
const isSubmitBtn: Pred = (n, a) =>
  n.nodeName === 'BUTTON' && (a['class'] ?? '').includes('moo-btn') &&
  (a['class'] ?? '').includes('primary') && /提交|重试/.test(textOf(n))

// ─── 流程步骤封装 ────────────────────────────────────────────────────────────
async function openMatchedPage(context: BrowserContext, sw: Worker, imageFormat: 'base64' | 'multipart'): Promise<{ page: Page; cdp: CDPSession }> {
  await seedStorage(sw, { mooConfig: makeConfig(imageFormat) })
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 600)))   // register debounce 200ms

  const page = await context.newPage()
  await page.setViewportSize({ width: 1100, height: 750 })
  await page.goto(`http://127.0.0.1:${PORT}/`)
  // content script 注入 + Vue mount
  await page.waitForFunction(() => !!document.querySelector('#__moo_dev_tool_host__'), undefined, { timeout: 8000 })
  const cdp = await context.newCDPSession(page)
  await waitFor(cdp, isCaptureBallBtn, '悬浮球截图按钮')
  return { page, cdp }
}

/** 悬浮球截图 → 等 Annotator（真 captureVisibleTab 链路） */
async function captureOnce(cdp: CDPSession): Promise<void> {
  const btn = await waitFor(cdp, isCaptureBallBtn, '悬浮球截图按钮')
  await cdpClick(cdp, btn)
  await waitFor(cdp, isAnnotator, 'Annotator overlay（真截屏成功才会出现）', 12_000)
}

/** Annotator 画一个矩形（验证标注合成进 PNG）再点「下一步」 */
async function annotateAndNext(page: Page, cdp: CDPSession, drawRect: boolean): Promise<void> {
  if (drawRect) {
    // 默认工具是矩形；坐标点 canvas 中部拖一笔。鼠标事件跨 closed shadow 正常命中
    const vp = page.viewportSize()!
    const cx = vp.width / 2, cy = vp.height / 2 - 60
    await page.mouse.move(cx - 80, cy - 50)
    await page.mouse.down()
    await page.mouse.move(cx + 80, cy + 50, { steps: 5 })
    await page.mouse.up()
  }
  const next = await waitFor(cdp, isNextBtn, 'Annotator 下一步按钮')
  await cdpClick(cdp, next)
  await waitFor(cdp, isTitleInput, 'SubmitDialog 标题输入框')
}

async function thumbCount(cdp: CDPSession): Promise<number> {
  return findAll(await snapshot(cdp), isThumb).length
}

// ═══════════════════════════════════════════════════════════════════════════
// F1 · JSON(base64) 完整闭环：2 张真截图 + 草稿保留 + payload image/images 断言
// ═══════════════════════════════════════════════════════════════════════════
test('F1 · 真流程闭环：悬浮球→真截屏→标注→标题→再截一张→草稿+2缩略→提交→mock 收到 images[2]', async ({ context, sw }) => {
  test.setTimeout(90_000)
  const { page, cdp } = await openMatchedPage(context, sw, 'base64')

  // ── 第 1 轮：截图 → 画矩形 → 下一步 ──
  await captureOnce(cdp)
  await annotateAndNext(page, cdp, true)

  // ── SubmitDialog：mount 即聚焦标题框 → 真键盘打字 ──
  const TITLE = '多图真流程冒烟标题'
  await page.waitForTimeout(700)   // stealPageFocusRepeatedly 抢焦点窗口
  await page.keyboard.type(TITLE)
  const titleNode1 = await waitFor(cdp, isTitleInput, '标题输入框')
  expect(await cdpValue(cdp, titleNode1), 'SubmitDialog mount 后标题框应持焦点可直接打字').toBe(TITLE)
  expect(await thumbCount(cdp), '第 1 轮后应有 1 张缩略').toBe(1)

  // ── 改页面内容（保证两张截图像素不同）→「＋ 再截一张」──
  await page.evaluate(() => {
    document.body.style.background = '#fde047'
    document.querySelector('#headline')!.textContent = 'SECOND SHOT MARKER'
  })
  const addBtn = await waitFor(cdp, isAddShotBtn, '再截一张按钮')
  expect(textOf(addBtn)).toContain('（1/5）')
  await cdpClick(cdp, addBtn)

  // ── 第 2 轮：弹窗卸载 → 真截屏 → 标注 → 下一步 → 回弹窗 ──
  await waitFor(cdp, isAnnotator, '第 2 轮 Annotator', 12_000)
  await annotateAndNext(page, cdp, false)

  // ── 核心断言：草稿标题还在 + 2 张缩略 ──
  const titleNode2 = await waitFor(cdp, isTitleInput, '重挂后的标题输入框')
  expect(await cdpValue(cdp, titleNode2), '「再截一张」卸载重挂后标题草稿应保留').toBe(TITLE)
  expect(await thumbCount(cdp), '第 2 轮后应有 2 张缩略').toBe(2)
  const addBtn2 = await waitFor(cdp, isAddShotBtn, '再截一张按钮（2/5）')
  expect(textOf(addBtn2)).toContain('（2/5）')

  // ── 提交 → mock server 真收 ──
  const submitBtn = await waitFor(cdp, isSubmitBtn, '提交按钮')
  await cdpClick(cdp, submitBtn)
  await expect.poll(() => received.length, { timeout: 10_000 }).toBe(1)

  const body = JSON.parse(received[0]!.body.toString('utf8')) as { title: string; screenshot: string; images: string[]; url: string }
  expect(received[0]!.contentType).toContain('application/json')
  expect(body.title).toBe(TITLE)
  expect(body.url).toContain(`http://127.0.0.1:${PORT}/`)
  expect(body.screenshot.startsWith('data:image/png;base64,')).toBe(true)
  expect(Array.isArray(body.images)).toBe(true)
  expect(body.images).toHaveLength(2)
  expect(body.images[0], '约定 image === images[0]').toBe(body.screenshot)
  expect(body.images[1]!.startsWith('data:image/png;base64,')).toBe(true)
  expect(body.images[1], '两张截图内容应不同（页面已改色 + 仅第 1 张画了矩形）').not.toBe(body.images[0])

  // ── 提交成功视图 → 自动关闭 reset ──
  await waitFor(cdp, (n, a) => (a['class'] ?? '').includes('moo-success-title'), '提交成功面板')
  await waitGone(cdp, isTitleInput, '成功后弹窗自动关闭', 8000)

  await page.close()
})

// ═══════════════════════════════════════════════════════════════════════════
// F2 · multipart 路径：form-data 字段 screenshot + screenshot_2
// ═══════════════════════════════════════════════════════════════════════════
test('F2 · multipart 闭环：2 张截图 → form-data 收到 screenshot + screenshot_2 字段', async ({ context, sw }) => {
  test.setTimeout(90_000)
  const { page, cdp } = await openMatchedPage(context, sw, 'multipart')

  await captureOnce(cdp)
  await annotateAndNext(page, cdp, false)

  await page.waitForTimeout(700)
  await page.keyboard.type('multipart 多图')

  await page.evaluate(() => { document.body.style.background = '#86efac' })
  const addBtn = await waitFor(cdp, isAddShotBtn, '再截一张按钮')
  await cdpClick(cdp, addBtn)
  await waitFor(cdp, isAnnotator, '第 2 轮 Annotator', 12_000)
  await annotateAndNext(page, cdp, false)
  expect(await thumbCount(cdp)).toBe(2)

  const submitBtn = await waitFor(cdp, isSubmitBtn, '提交按钮')
  await cdpClick(cdp, submitBtn)
  await expect.poll(() => received.length, { timeout: 10_000 }).toBe(1)

  const { contentType, body } = received[0]!
  const raw = body.toString('latin1')
  expect(contentType).toContain('multipart/form-data')
  expect(raw).toContain('name="title"')
  expect(raw).toContain('name="screenshot"; filename="screenshot.png"')
  expect(raw).toContain('name="screenshot_2"; filename="screenshot_2.png"')
  // 没有第 3 张
  expect(raw).not.toContain('name="screenshot_3"')

  await page.close()
})

// ═══════════════════════════════════════════════════════════════════════════
// F3 · 取消语义：Esc 主动退出丢草稿，重开流程弹窗干净
// ═══════════════════════════════════════════════════════════════════════════
test('F3 · Esc 取消后重开流程：标题空（草稿已丢）+ 仅 1 张新截图', async ({ context, sw }) => {
  test.setTimeout(90_000)
  const { page, cdp } = await openMatchedPage(context, sw, 'base64')

  // 第 1 次流程：截图 → 下一步 → 填标题 → Esc 主动取消
  await captureOnce(cdp)
  await annotateAndNext(page, cdp, false)
  await page.waitForTimeout(700)
  await page.keyboard.type('这条草稿应该被丢弃')
  await page.keyboard.press('Escape')
  await waitGone(cdp, isTitleInput, 'Esc 后弹窗应关闭')

  // captureVisibleTab quota ≤2 次/秒 兜底间隔
  await page.waitForTimeout(800)

  // 第 2 次流程：弹窗应干净
  await captureOnce(cdp)
  await annotateAndNext(page, cdp, false)
  const titleNode = await waitFor(cdp, isTitleInput, '重开流程的标题输入框')
  expect(await cdpValue(cdp, titleNode), 'Esc 主动取消 = 丢草稿，重开流程标题应为空').toBe('')
  expect(await thumbCount(cdp), '重开流程只应有本次新截的 1 张').toBe(1)

  // 收尾：无任何提交发生
  expect(received.length, '取消流程不应有任何上报').toBe(0)
  await page.close()
})

// ═══════════════════════════════════════════════════════════════════════════
// F4 · 弹窗位置记忆（v0.8.11 dialogPos）：真 closed shadow + 真卸载重挂
// ═══════════════════════════════════════════════════════════════════════════
const isDialog: Pred = (n, a) => (a['class'] ?? '').split(' ').includes('moo-dialog')
const isDialogHead: Pred = (n, a) => (a['class'] ?? '').split(' ').includes('moo-dialog-head')

interface DialogProbe { x: number; y: number; w: number; h: number; moved: boolean; inlineTransform: string; animationName: string }
const PROBE_FN = `function(){
  const r = this.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height,
    moved: this.classList.contains('moo-dialog--moved'),
    inlineTransform: this.style.transform,
    animationName: getComputedStyle(this).animationName }
}`

async function probeDialog(cdp: CDPSession): Promise<DialogProbe> {
  const node = await waitFor(cdp, isDialog, '.moo-dialog')
  return await cdpCall<DialogProbe>(cdp, node, PROBE_FN)
}

test('F4 · 位置记忆：拖开 → 再截一张重挂回原位（--moved + 无入场动画 = 无闪跳）；Esc 取消重开 → 居中复位', async ({ context, sw }) => {
  test.setTimeout(90_000)
  const { page, cdp } = await openMatchedPage(context, sw, 'base64')

  // ── 流程进到 SubmitDialog ──
  await captureOnce(cdp)
  await annotateAndNext(page, cdp, false)
  await page.waitForTimeout(700)   // 入场动画 0.2s + stealPageFocus 窗口，拿稳定基准

  const before = await probeDialog(cdp)
  expect(before.moved, '初始不带 --moved').toBe(false)

  // ── 真鼠标拖 header（closed shadow 内坐标命中正常）──
  const head = await waitFor(cdp, isDialogHead, '.moo-dialog-head')
  const hr = await cdpCall<{ x: number; y: number; h: number }>(cdp, head,
    'function(){ const r = this.getBoundingClientRect(); return { x: r.x, y: r.y, h: r.height } }')
  const gx = hr.x + 60, gy = hr.y + hr.h / 2
  await page.mouse.move(gx, gy)
  await page.mouse.down()
  await page.mouse.move(gx + 120, gy + 70, { steps: 5 })
  await page.mouse.up()

  const dragged = await probeDialog(cdp)
  expect(dragged.moved).toBe(true)
  expect(dragged.x - before.x).toBeCloseTo(120, 0)
  expect(dragged.y - before.y).toBeCloseTo(70, 0)

  // ── 再截一张 → 真卸载（draft 存 dialogPos）→ 第 2 轮标注 → 重挂 ──
  const addBtn = await waitFor(cdp, isAddShotBtn, '再截一张按钮')
  await cdpClick(cdp, addBtn)
  await waitFor(cdp, isAnnotator, '第 2 轮 Annotator', 12_000)
  await annotateAndNext(page, cdp, false)

  // ── 核心断言：重挂即回原位 + 无闪跳 ──
  // 不 sleep：标题框出现即测。有 `.moo-dialog--moved{animation:none}` 时首帧就该在
  // 记忆位（内联 translate 不被 moo-dialog-in 的 keyframes transform 盖掉）。
  const restored = await probeDialog(cdp)
  expect(restored.moved, '重挂应带 --moved（pos 从 draft 还原）').toBe(true)
  expect(restored.inlineTransform, '内联 translate 还原').toBe('translate(120px, 70px)')
  // 位置语义是「相对 flex 居中基准的偏移」：宽度不变 → x 绝对回原位；
  // 高度因第 2 张缩略变了 → y 的居中基准随之挪，断「新基准 + 70」而非旧绝对值
  expect(restored.x, '重挂后 x 回拖拽位（宽度不变 → 绝对位置一致）').toBeCloseTo(dragged.x, 0)
  const vh = page.viewportSize()!.height
  const expectedY = (vh - restored.h) / 2 + 70
  expect(Math.abs(restored.y - expectedY), `重挂后 y 应=新居中基准+70（实际 ${restored.y}，期望 ${expectedY}）`).toBeLessThanOrEqual(1)
  expect(restored.animationName, '--moved 必须干掉入场动画（闪跳根源）').toBe('none')

  // ── Esc 取消（丢草稿）→ 重开流程：复位居中 ──
  await page.keyboard.press('Escape')
  await waitGone(cdp, isTitleInput, 'Esc 后弹窗关闭')
  await page.waitForTimeout(800)   // captureVisibleTab quota ≤2 次/秒

  await captureOnce(cdp)
  await annotateAndNext(page, cdp, false)
  const reopened = await probeDialog(cdp)
  expect(reopened.moved, '取消重开不应带 --moved').toBe(false)
  expect(reopened.inlineTransform).toBe('')
  const vw = page.viewportSize()!.width
  expect(reopened.x + reopened.w / 2, '取消重开应回 flex 居中').toBeCloseTo(vw / 2, 0)

  expect(received.length, '全程不应有任何上报').toBe(0)
  await page.close()
})
