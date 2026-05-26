import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { chromium, test as base, expect, type BrowserContext, type Worker } from '@playwright/test'
import { seedStorage } from './fixtures'

/**
 * v0.7.1 dogfood 装上即炸（dynamic register 后 web_accessible_resources.use_dynamic_url=true
 * 导致 lazy chunks 被 chrome 拒载）—— 已有 e2e（content-scripts-dynamic-register.spec.ts E1/E2/E3）
 * 只验 SW chrome.scripting register API 契约调用，**不验真注入 + 真渲染**。这条 spec 补上
 * 「register → navigate → content script 真注入到 page DOM + chunks 加载无错」端到端链路。
 *
 * ---
 * 关键 trick：mandatory host_permissions
 *
 * 生产 manifest 用 optional_host_permissions:['<all_urls>']，fresh install 时 chrome
 * 不 grant 任何 host_permission，需 permissions.request 用户手势同意——playwright 给不了
 * user gesture（SW evaluate 没 gesture / Browser.grantPermissions 不覆盖 extension host
 * perm / Secure Preferences HMAC 防篡改改了被 Chrome reset / 也没暴露 CDP
 * Extensions.grantHostPermission method）。**已逐条 probe 验证全废**（见 probe-* 脚本）。
 *
 * 唯一 work 的手段：复制 dist/ → dist-e2e/，改 manifest 把 optional_host_permissions
 * 提升为 mandatory host_permissions。chrome 装 mandatory 时自动 grant，**绕过 user gesture**。
 * src/ 不动，prod manifest 不动，只在 e2e 跑前临时生成 dist-e2e/。
 *
 * 语义 gap 诚实标注：本 spec 不验「optional permission grant 流程」，验的是
 * 「permission 已就绪后，dynamic register + chunks 加载 + DOM 注入全链路无错」。
 * v0.7.1 那个 web_accessible_resources 配错只要 chunks 拒载就会爆 console，本 spec 能抓。
 * 「optional → mandatory 转换流程」靠 RELEASE_TEST_CHECKLIST 手测。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIST = path.resolve(__dirname, '../dist')
const E2E_DIST = path.resolve(__dirname, '../dist-e2e')

function prepareE2EDist(): void {
  if (existsSync(E2E_DIST)) rmSync(E2E_DIST, { recursive: true, force: true })
  cpSync(SRC_DIST, E2E_DIST, { recursive: true })
  const mfPath = path.join(E2E_DIST, 'manifest.json')
  const mf = JSON.parse(readFileSync(mfPath, 'utf8'))
  // optional → mandatory，chrome 装载时自动 grant
  mf.host_permissions = ['<all_urls>']
  delete mf.optional_host_permissions
  // SELF-TEST: 模拟 v0.7.1 bug — web_accessible_resources 加 use_dynamic_url
  if (process.env.MOO_E2E_INJECT_V071_BUG === '1') {
    mf.web_accessible_resources = (mf.web_accessible_resources || []).map((r: { use_dynamic_url?: boolean }) => ({ ...r, use_dynamic_url: true }))
  }
  writeFileSync(mfPath, JSON.stringify(mf, null, 2))
}

// 独立 fixture（不复用 fixtures.ts 的 context —— 那个挂 dist/，本 spec 要挂 dist-e2e/）
interface MandatoryFixtures {
  context: BrowserContext
  sw: Worker
  extensionId: string
}

const test = base.extend<MandatoryFixtures>({
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
  },
  extensionId: async ({ sw }, use) => {
    await use(new URL(sw.url()).host)
  }
})

let server: Server
let PORT: number

test.beforeAll(async () => {
  server = createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><html><head><title>moo e2e fixture</title></head><body><div id="probe-marker">hi</div></body></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  PORT = (server.address() as AddressInfo).port
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function makeConfig(matchPatterns: string[]) {
  return {
    globalEnabled: true,
    projects: [{
      id: 'p-e2e-real',
      name: 'real inject',
      matchPatterns,
      kind: 'webhook' as const,
      servers: [],
      defaultServerId: '',
      enabled: true
    }]
  }
}

// ---------------------------------------------------------------------------
// R1. 端到端：dynamic register → navigate 命中 URL → content script 真注入 +
//     悬浮球 host element 真在 DOM + 无 chunks 加载错（v0.7.1 那条 bug 的 regression guard）
// ---------------------------------------------------------------------------
test('R1 · 真注入：register + navigate → #__moo_dev_tool_host__ in DOM + no chunk errors', async ({ context, sw }) => {
  // chrome 装 mandatory host_permissions 时自动 grant
  const granted = await sw.evaluate(async () => await chrome.permissions.contains({ origins: ['<all_urls>'] }))
  expect(granted).toBe(true)

  // seed mooConfig 触发 syncContentScripts（200ms debounce + register API）
  const pattern = `http://127.0.0.1:${PORT}/*`
  await seedStorage(sw, { mooConfig: makeConfig([pattern]) })
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 500)))

  // register 完成校验
  const registered = await sw.evaluate(async () =>
    await chrome.scripting.getRegisteredContentScripts().catch(() => [])
  )
  expect(registered).toHaveLength(2)

  // navigate 命中 URL，收集 console error / pageerror
  const page = await context.newPage()
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

  await page.goto(`http://127.0.0.1:${PORT}/test`)
  // content script document_start + dynamic chunks 加载 + Vue mount —— 1.5s 兜底慢机器
  await page.waitForTimeout(1500)

  // ---- 主断言：悬浮球 host element 真挂在 DOM ----
  const hostExists = await page.evaluate(() => !!document.querySelector('#__moo_dev_tool_host__'))
  expect(hostExists).toBe(true)

  // ---- chunks 加载错误零容忍（v0.7.1 web_accessible_resources 配错的 signature）----
  const blockingErrors = consoleErrors.filter((m) =>
    /Denying load|Failed to fetch dynamically imported|Loading chunk|chrome-extension:.*net::ERR/i.test(m)
  )
  expect(blockingErrors, `unexpected chunk/load errors:\n${blockingErrors.join('\n')}`).toEqual([])

  await page.close()
})

// ---------------------------------------------------------------------------
// R2. 反向：globalEnabled=false → 即使 pattern 命中也不该注入
//     （E3 验了 unregister API，这里验真 navigate 后 DOM 真没 host element）
// ---------------------------------------------------------------------------
test('R2 · 真注入：globalEnabled=false → navigate 命中但 DOM 无 host element', async ({ context, sw }) => {
  const pattern = `http://127.0.0.1:${PORT}/*`
  await seedStorage(sw, { mooConfig: { ...makeConfig([pattern]), globalEnabled: false } })
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 500)))

  const registered = await sw.evaluate(async () =>
    await chrome.scripting.getRegisteredContentScripts().catch(() => [])
  )
  expect(registered).toHaveLength(0)

  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${PORT}/test`)
  await page.waitForTimeout(1000)

  const hostExists = await page.evaluate(() => !!document.querySelector('#__moo_dev_tool_host__'))
  expect(hostExists).toBe(false)

  await page.close()
})
