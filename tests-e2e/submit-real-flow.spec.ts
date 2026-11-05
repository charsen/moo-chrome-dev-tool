import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { chromium, test as base, expect, type BrowserContext, type Worker, type Page, type CDPSession } from '@playwright/test'
import { seedStorage } from './fixtures'

/**
 * 真实业务闭环回归：提交 → history 落库 → 失败入重试队列 → flush 重试 → history 翻成功。
 *
 * 现有 e2e 只覆盖了 UI 反馈（提交成功/失败面板）和 seed 后的列表渲染，没有把
 * 「后台真的写 history / 真的入队 / 真的重试并回填」串起来跑过。这里用本地 mock
 * server 全程闭环，不接任何外部服务。
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
/** 收到的 POST body（utf8）；顺序即到达顺序 */
let received: string[] = []
/** 前 N 次 POST 返回 500，之后返回 200 */
let failFirstN = 0

test.beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && req.url === '/api/bug') {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        received.push(Buffer.concat(chunks).toString('utf8'))
        if (failFirstN > 0) {
          failFirstN--
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'mock server down' }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, id: `mock-${received.length}` }))
      })
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><html><head><title>submit flow fixture</title></head><body style="background:#fff"><h1 id="headline">submit flow page</h1></body></html>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  PORT = (server.address() as AddressInfo).port
})

test.afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

test.beforeEach(() => {
  received = []
  failFirstN = 0
})

function makeConfig() {
  return {
    globalEnabled: true,
    projects: [{
      id: 'p-flow',
      name: '业务闭环项目',
      matchPatterns: [`http://127.0.0.1:${PORT}/*`],
      kind: 'webhook' as const,
      servers: [{
        id: 's-mock',
        name: 'mock 接收端',
        endpoint: `http://127.0.0.1:${PORT}/api/bug`,
        method: 'POST' as const,
        headers: { 'Content-Type': 'application/json' },
        payloadTemplate: '{"title":"{{title}}","url":"{{url}}"}',
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

// ─── CDP pierce 工具（closed shadow DOM 够不到，同 keyboard-isolation.spec）─────────
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
async function cdpClick(cdp: CDPSession, node: CdpNode): Promise<void> {
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node.backendNodeId }) as { object: { objectId: string } }
  await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function(){ this.click() }' })
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
const isCaptureBallBtn: Pred = (n, a) => n.nodeName === 'BUTTON' && a['title'] === '截图'
const isAnnotator: Pred = (n, a) => (a['class'] ?? '').includes('moo-annotator')
const isNextBtn: Pred = (n, a) =>
  n.nodeName === 'BUTTON' && (a['class'] ?? '').includes('primary') && textOf(n).includes('下一步')
const isTitleInput: Pred = (n, a) => a['id'] === 'moo-title'
const isSuccessTitle: Pred = (n, a) => (a['class'] ?? '').includes('moo-success-title')
const isSubmitFail: Pred = (n, a) => (a['class'] ?? '').split(' ').includes('moo-submit-fail')

async function openSubmitDialog(context: BrowserContext, sw: Worker): Promise<{ page: Page; cdp: CDPSession }> {
  await seedStorage(sw, { mooConfig: makeConfig() })
  await sw.evaluate(async () => {
    await chrome.storage.local.remove(['mooHistory', 'mooRetryQueue', 'mooLastFlushAt'])
  })
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 600)))  // register debounce

  const page = await context.newPage()
  await page.setViewportSize({ width: 1100, height: 750 })
  await page.goto(`http://127.0.0.1:${PORT}/`)
  await page.waitForFunction(() => !!document.querySelector('#__moo_dev_tool_host__'), undefined, { timeout: 8000 })
  const cdp = await context.newCDPSession(page)
  const ball = await waitFor(cdp, isCaptureBallBtn, '悬浮球截图按钮', 8000)
  await new Promise((r) => setTimeout(r, 300))
  await cdpClick(cdp, ball)
  await waitFor(cdp, isAnnotator, 'Annotator')
  await cdpClick(cdp, await waitFor(cdp, isNextBtn, '下一步'))
  await waitFor(cdp, isTitleInput, '标题输入框')
  await page.waitForTimeout(700)
  return { page, cdp }
}

async function readStorage<T>(sw: Worker, key: string): Promise<T | undefined> {
  return sw.evaluate(async (k) => {
    const r = await chrome.storage.local.get(k)
    return r[k] as T | undefined
  }, key)
}

interface HistoryShape {
  id: string
  title: string
  projectId: string
  projectName: string
  url: string
  images?: string[]
  hasVideo: boolean
  result: { ok: boolean; status?: number; error?: string }
  remoteId?: string
}
interface QueueShape {
  kind: string
  historyId?: string
  endpoint: string
  bodyString: string
}

test('S1 · 提交成功 → history 落库 + popup 最近提交可见', async ({ context, sw }) => {
  test.setTimeout(90_000)
  const { page, cdp } = await openSubmitDialog(context, sw)
  const TITLE = '业务闭环：提交成功标题'

  await page.keyboard.type(TITLE)
  await page.keyboard.press('Enter')  // 标题回车提交
  await waitFor(cdp, isSuccessTitle, '提交成功面板')

  await expect.poll(() => received.length, { timeout: 10_000 }).toBe(1)
  const body = JSON.parse(received[0]!) as { title: string; url: string }
  expect(body.title).toBe(TITLE)
  expect(body.url).toContain(`http://127.0.0.1:${PORT}/`)

  const history = await readStorage<HistoryShape[]>(sw, 'mooHistory')
  expect(history?.length, 'history 应写入 1 条').toBe(1)
  const entry = history![0]!
  expect(entry.title).toBe(TITLE)
  expect(entry.projectId).toBe('p-flow')
  expect(entry.projectName).toBe('业务闭环项目')
  expect(entry.result.ok).toBe(true)
  expect(entry.result.status).toBe(200)
  expect(entry.remoteId).toBe('mock-1')
  expect(entry.hasVideo).toBe(false)
  expect(entry.images?.length, 'history 应保留本次截图').toBe(1)
  expect(entry.url).toContain(`http://127.0.0.1:${PORT}/`)

  // popup 读同一份 storage → 最近提交显示这条
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${(await sw.evaluate(() => chrome.runtime.id))}/src/popup/index.html`)
  await expect(popup.locator('body')).toContainText(TITLE, { timeout: 5000 })
  await popup.close()

  await page.close()
})

test('S2 · 提交失败 → 入重试队列 → flush 重试成功 → history 翻成功 + 队列清空', async ({ context, sw }) => {
  test.setTimeout(90_000)
  const { page, cdp } = await openSubmitDialog(context, sw)
  const TITLE = '业务闭环：先失败后重试标题'
  failFirstN = 1

  await page.keyboard.type(TITLE)
  await page.keyboard.press('Enter')
  // 失败横幅（role=alert）—— 真页面是 closed shadow，Playwright locator 穿不进去，走 CDP
  const failBanner = await waitFor(cdp, isSubmitFail, '提交失败横幅')
  expect(textOf(failBanner)).toContain('提交失败')

  const historyBefore = await readStorage<HistoryShape[]>(sw, 'mooHistory')
  expect(historyBefore?.[0]?.result.ok, '失败也要写 history').toBe(false)
  const queueBefore = await readStorage<QueueShape[]>(sw, 'mooRetryQueue')
  expect(queueBefore?.length, '5xx 应入重试队列').toBe(1)
  expect(queueBefore![0]!.kind).toBe('webhook')
  expect(queueBefore![0]!.historyId, '队列项要带 historyId 供回填').toBe(historyBefore![0]!.id)
  expect(queueBefore![0]!.bodyString).toContain(TITLE)

  // 手动 flush（Settings「立即重试」同一条消息）。先清 cooldown 排除别的 flush 留下的窗口期。
  // ⚠ 必须从扩展页面发：SW 自己 sendMessage 不会投递回自己的 onMessage（Chrome 排除 sender 帧）
  await sw.evaluate(async () => { await chrome.storage.local.remove('mooLastFlushAt') })
  const helper = await context.newPage()
  await helper.goto(`chrome-extension://${await sw.evaluate(() => chrome.runtime.id)}/src/popup/index.html`)
  const flushRes = await helper.evaluate(async () => {
    return await chrome.runtime.sendMessage({ type: 'RETRY_QUEUE_FLUSH' }) as { ok: boolean; processed: number; dropped: number; deferred: number; skipped: string | null }
  })
  await helper.close()
  expect(flushRes.ok).toBe(true)
  expect(flushRes.skipped).toBeNull()
  expect(flushRes.processed, '重试应成功 1 条').toBe(1)
  expect(flushRes.dropped).toBe(0)

  expect(received.length, 'mock 应收到首次失败 + 重试成功共 2 次').toBe(2)
  expect(JSON.parse(received[1]!).title).toBe(TITLE)

  await expect.poll(async () => (await readStorage<QueueShape[]>(sw, 'mooRetryQueue'))?.length ?? 0, { timeout: 5000 }).toBe(0)
  const historyAfter = await readStorage<HistoryShape[]>(sw, 'mooHistory')
  expect(historyAfter?.[0]?.result.ok, '重试成功后 history 应翻成功').toBe(true)
  expect(historyAfter?.[0]?.remoteId, '重试成功应回填 remoteId').toBe('mock-2')

  await page.close()
})

test('S3 · 历史「重新提交」→ 真发到服务器 + 新增一条 history', async ({ context, sw }) => {
  test.setTimeout(60_000)
  const TITLE = '历史重提：用当时现场重发'
  const seeded = [{
    id: 'h-resubmit-1',
    timestamp: Date.now() - 60_000,
    projectId: 'p-flow',
    projectName: '业务闭环项目',
    serverId: 's-mock',
    serverName: 'mock 接收端',
    title: TITLE,
    description: '当时的复现步骤',
    image: '',
    hasVideo: false,
    videoDuration: 0,
    url: `http://127.0.0.1:${PORT}/old-page`,
    userAgent: 'Mozilla/5.0 (e2e)',
    viewport: '1280x800',
    requests: [],
    errors: [],
    result: { ok: false, error: '之前失败了' }
  }]
  await seedStorage(sw, { mooConfig: makeConfig(), mooHistory: seeded })
  await sw.evaluate(async () => {
    await chrome.storage.local.remove(['mooRetryQueue', 'mooLastFlushAt'])
  })

  const id = await sw.evaluate(() => chrome.runtime.id)
  const page = await context.newPage()
  await page.goto(`chrome-extension://${id}/src/devtools/panel-harness.html?tab=history&seed=external`)
  await expect(page.locator('.row')).toHaveCount(1, { timeout: 5000 })

  await page.locator('button:has-text("重新提交")').click()
  await expect.poll(() => received.length, { timeout: 10_000 }).toBe(1)
  const body = JSON.parse(received[0]!) as { title: string; url: string }
  expect(body.title).toBe(TITLE)
  expect(body.url).toContain('/old-page')

  // 重提是「原地更新原失败记录」（replacesHistoryId），不再新增一条重复历史
  await expect(page.locator('.row')).toHaveCount(1, { timeout: 5000 })
  const history = await readStorage<HistoryShape[]>(sw, 'mooHistory')
  expect(history?.length).toBe(1)
  expect(history?.[0]?.title).toBe(TITLE)
  expect(history?.[0]?.result.ok, '重提成功应把原记录翻成功').toBe(true)
  expect(history?.[0]?.id).toBe('h-resubmit-1')

  await page.close()
})
