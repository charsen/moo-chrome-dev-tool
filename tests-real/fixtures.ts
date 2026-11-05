import { test as base, chromium, expect, type BrowserContext, type CDPSession, type Page, type Worker } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

/**
 * 真机测试 fixture：可见窗口 + 真扩展 + 真网页。
 *
 * 为什么用 chrome for testing 而不是系统 Chrome：Chrome 137+ 正式渠道移除了
 * `--load-extension`，只有 CfT / Chromium 还能命令行加载 unpacked 扩展。这里用
 * Playwright 自带的 chromium（headed），窗口真实可见、渲染与扩展链路都是真 Chrome 引擎。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIST = path.resolve(__dirname, '../dist')
const REAL_DIST = path.resolve(__dirname, '../dist-real')

function prepareRealDist(): void {
  if (existsSync(REAL_DIST)) rmSync(REAL_DIST, { recursive: true, force: true })
  cpSync(SRC_DIST, REAL_DIST, { recursive: true })
  const mfPath = path.join(REAL_DIST, 'manifest.json')
  const mf = JSON.parse(readFileSync(mfPath, 'utf8'))
  // 绕开 chrome.permissions.request 的 native 手势限制：把 host 权限提升为 mandatory，
  // 加载时自动授予。<all_urls> 与生产 zip 的差异只在权限声明，代码路径一致。
  mf.host_permissions = ['<all_urls>']
  delete mf.optional_host_permissions
  writeFileSync(mfPath, JSON.stringify(mf, null, 2))
}

export const test = base.extend<{ context: BrowserContext; extensionId: string; sw: Worker }>({
  context: async ({}, use) => {
    prepareRealDist()
    const ctx = await chromium.launchPersistentContext('', {
      headless: false,
      channel: 'chromium',
      viewport: null,
      args: [
        `--disable-extensions-except=${REAL_DIST}`,
        `--load-extension=${REAL_DIST}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=Translate',
        '--force-device-scale-factor=1',
        '--window-size=1440,900'
      ]
    })
    await use(ctx)
    await ctx.close()
  },

  extensionId: async ({ context }, use) => {
    const warm = await context.newPage()
    await warm.goto('about:blank')
    let [sw] = context.serviceWorkers()
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 })
    const id = new URL(sw.url()).host
    await warm.close()
    await use(id)
  },

  sw: async ({ context }, use) => {
    let [sw] = context.serviceWorkers()
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15_000 })
    await use(sw)
  }
})

export const expectReal = expect

/** 真机证据截图：统一放 test-results/real-machine（gitignored） */
export async function shot(page: Page, name: string): Promise<string> {
  const file = path.resolve(__dirname, '../test-results/real-machine', `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  return file
}

export async function seedStorage(sw: Worker, data: Record<string, unknown>): Promise<void> {
  await sw.evaluate(async (d) => {
    const transient = [
      'mooNeedsHostPermUpgrade', 'mooLatestVersionInfo', 'mooDroppedMatchPatterns',
      'mooUpgradeIntent', 'mooUpgradedToast', 'mooConfigQuotaFailed'
    ]
    await chrome.storage.local.remove(transient)
    await chrome.storage.local.set(d)
  }, data)
}

export async function readStorage<T>(sw: Worker, key: string): Promise<T | undefined> {
  return sw.evaluate(async (k) => {
    const r = await chrome.storage.local.get(k)
    return r[k] as unknown
  }, key) as Promise<T | undefined>
}

export async function openExtensionPage(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(url)
  return page
}

/** 等 content script Vue 挂载（宿主 div 出现） */
export async function waitHost(page: Page, timeout = 15_000): Promise<void> {
  await page.waitForFunction(() => !!document.querySelector('#__moo_dev_tool_host__'), undefined, { timeout })
}

/** 等悬浮球真的渲染出来（matches 加载完成 + state idle） */
export async function waitBall(cdp: CDPSession, timeout = 15_000): Promise<CdpNode> {
  return waitFor(cdp, (n, a) => n.nodeName === 'BUTTON' && a['title'] === '截图', '悬浮球截图按钮', timeout)
}

// ─── closed shadow pierce（CDP）──────────────────────────────────────────────

export interface CdpNode {
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

export function* walkNode(node: CdpNode): Generator<CdpNode> {
  yield node
  for (const c of node.children ?? []) yield* walkNode(c)
  for (const s of node.shadowRoots ?? []) yield* walkNode(s)
  if (node.contentDocument) yield* walkNode(node.contentDocument)
}

export function attrsOf(node: CdpNode): Record<string, string> {
  const out: Record<string, string> = {}
  const a = node.attributes ?? []
  for (let i = 0; i + 1 < a.length; i += 2) out[a[i]!] = a[i + 1]!
  return out
}

export function textOf(node: CdpNode): string {
  let s = ''
  for (const n of walkNode(node)) if (n.nodeType === 3) s += n.nodeValue
  return s
}

export type Pred = (n: CdpNode, attrs: Record<string, string>) => boolean

export async function snapshot(cdp: CDPSession): Promise<CdpNode> {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true }) as { root: CdpNode }
  return root
}

export function findAll(root: CdpNode, pred: Pred): CdpNode[] {
  const out: CdpNode[] = []
  for (const n of walkNode(root)) {
    if (n.nodeType !== 1) continue
    if (pred(n, attrsOf(n))) out.push(n)
  }
  return out
}

export async function waitFor(cdp: CDPSession, pred: Pred, what: string, timeoutMs = 15_000): Promise<CdpNode> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const hit = findAll(await snapshot(cdp), pred)[0]
    if (hit) return hit
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`waitFor timeout: ${what}`)
}

export async function waitGone(cdp: CDPSession, pred: Pred, what: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (findAll(await snapshot(cdp), pred).length === 0) return
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`waitGone timeout: ${what}`)
}

export async function cdpCall<T>(cdp: CDPSession, node: CdpNode, fn: string): Promise<T> {
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node.backendNodeId }) as { object: { objectId: string } }
  const res = await cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: fn,
    returnByValue: true
  }) as { result: { value: T } }
  return res.result.value
}

export async function cdpClick(cdp: CDPSession, node: CdpNode): Promise<void> {
  await cdpCall(cdp, node, 'function(){ this.click() }')
}

/** 元素在视口中的矩形（closed shadow 内也能拿） */
export async function cdpRect(cdp: CDPSession, node: CdpNode): Promise<{ x: number; y: number; w: number; h: number }> {
  return cdpCall(cdp, node, `function(){
    const r = this.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  }`)
}

export async function cdpValue(cdp: CDPSession, node: CdpNode): Promise<string> {
  return cdpCall(cdp, node, 'function(){ return this.value }')
}

/** 用真鼠标点击 closed shadow 内元素（比 .click() 更接近真用户） */
export async function realClick(page: Page, cdp: CDPSession, node: CdpNode): Promise<void> {
  const r = await cdpRect(cdp, node)
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2)
}

/** 在 closed shadow 内输入框敲字：先真鼠标聚焦，再用键盘 */
export async function realTypeInto(page: Page, cdp: CDPSession, node: CdpNode, text: string): Promise<void> {
  await realClick(page, cdp, node)
  await page.keyboard.type(text)
}

/** 在后台 tab 打开扩展页面：页面 mount 时查到的 active tab 仍是当前业务页（真实 popup/工作区语义） */
export async function openBackgroundTab(
  context: BrowserContext,
  sw: Worker,
  url: string
): Promise<Page> {
  const pagePromise = context.waitForEvent('page')
  await sw.evaluate((u) => chrome.tabs.create({ url: u, active: false }), url)
  const page = await pagePromise
  await page.waitForLoadState('domcontentloaded')
  return page
}

/** 激活某个已打开的扩展页 tab（Playwright 点击需要页面在前后台都能点，但激活更接近真实） */
export async function activateTab(sw: Worker, url: string): Promise<void> {
  await sw.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({ url: u })
    if (tabs[0]?.id) await chrome.tabs.update(tabs[0].id, { active: true })
  }, url)
}
