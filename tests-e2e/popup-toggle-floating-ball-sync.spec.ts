import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { chromium, test as base, expect, type BrowserContext, type Worker } from '@playwright/test'
import { seedStorage } from './fixtures'

/**
 * v0.7.4 commit 10775e9：popup「悬浮球当前页隐藏」toggle 写 chrome.storage.session，
 * content 通过 storage.onChanged listener 同步 → 当前页 FloatingBall v-if 隐藏。
 *
 * 这条 spec 验跨 popup ↔ content 的 session-area 同步链路是否真在 content world work：
 * - storage.session 是否能在 onChanged 派发到 content（mv3-pro 担心的关键点）
 * - listener 接到后 hostHidden ref 翻转 + FloatingBall v-if 真的下树
 *
 * 复用 dynamic-register-real-inject 的 mandatory-manifest 套路：optional → mandatory
 * 跳过 chrome 的 user-gesture host_permissions grant，让 content script 真注入。
 *
 * 不验：popup 真 UI 点击（chrome-extension://EXTID/src/popup/index.html 在 playwright
 * 里能开但「点 toggle 调 chrome.storage.session.set」靠 chrome API 直接调更稳）。
 * popup UI 渲染由 popup-* 共 16 case 验。这里 SW evaluate 模拟 popup 写 session 即可。
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
    res.end('<!doctype html><html><head><title>moo toggle sync</title></head><body><div id="marker">page</div></body></html>')
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
      id: 'p-toggle',
      name: 'toggle test',
      matchPatterns,
      kind: 'webhook' as const,
      servers: [],
      defaultServerId: '',
      enabled: true
    }]
  }
}

const HIDDEN_HOSTS_KEY = 'mooHiddenFloatingBallHosts'
const HOST_ID = '__moo_dev_tool_host__'

// closed shadow 探针：FloatingBall 默认定位 (window.innerWidth - 200, innerHeight - 70)
// 按钮 row 宽度约 130px、高 40px。
// - 球渲染时：该 viewport 坐标 elementFromPoint 命中 shadow 内 element →
//   retarget 到外部可见的 host element（id=__moo_dev_tool_host__）。
// - 球隐藏（v-if=false）时：shadow 内 FloatingBall 子树被卸载 → 该坐标后面只有
//   host element 自身（pointer-events:none）→ hit-test 穿透到下方 body/html。
//
// 多点采样（覆盖 row 几个位置）+ 任意一点命中 host 即视为「球可见」。
async function getHostState(page: import('@playwright/test').Page) {
  return await page.evaluate((id) => {
    const host = document.querySelector(`#${id}`) as HTMLElement | null
    if (!host) return { exists: false, ballHits: 0, samples: [] as string[] }
    const w = window.innerWidth
    const h = window.innerHeight
    // FloatingBall 默认 pos = (w - 200, h - 70)，按钮 row 大约 130x40
    // 采 9 个点覆盖 row 区域
    const points: Array<[number, number]> = []
    for (let dx = 0; dx < 130; dx += 30) {
      for (let dy = 0; dy < 40; dy += 15) {
        points.push([w - 200 + dx, h - 70 + dy])
      }
    }
    let hits = 0
    const samples: string[] = []
    for (const [x, y] of points) {
      const el = document.elementFromPoint(x, y)
      const isHost = el === host
      if (isHost) hits++
      samples.push(`(${x},${y})→${el ? (el.id || el.tagName.toLowerCase()) : 'null'}`)
    }
    return { exists: true, ballHits: hits, samples }
  }, HOST_ID)
}

test('S1 · 悬浮球初始显示 + popup 写 storage.session 隐藏 host → content listener 同步 → 球消失', async ({ context, sw }) => {
  const pattern = `http://127.0.0.1:${PORT}/*`
  await seedStorage(sw, { mooConfig: makeConfig([pattern]) })
  // 200ms debounce + dynamic register 起来
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 500)))

  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${PORT}/test`)
  // 等 content script + Vue mount + 初次 refreshHostHidden 完成
  await page.waitForTimeout(1500)

  // 初始：host 存在 + 球可见（rect.height > 4）
  const before = await getHostState(page)
  expect(before.exists, 'host element should be in DOM').toBe(true)
  expect(before.ballHits, `expect ball visible (some hit-test points → host); got ${JSON.stringify(before)}`).toBeGreaterThan(0)

  // 模拟 popup 写 storage.session（绕过真 popup UI；
  // 验的是 onChanged 同步链路，不验 popup UI）
  await sw.evaluate(async ({ key, host }) => {
    await chrome.storage.session.set({ [key]: [host] })
  }, { key: HIDDEN_HOSTS_KEY, host: '127.0.0.1' })

  // 等 storage.onChanged 广播 + content listener refreshHostHidden + Vue patch
  await page.waitForTimeout(400)

  const after = await getHostState(page)
  expect(after.exists, 'host element should remain in DOM after toggle').toBe(true)
  expect(after.ballHits, `expect ball hidden (no hit-test points → host); got ${JSON.stringify(after)}`).toBe(0)

  await page.close()
})

test('S2 · 反向：删除 host 出隐藏列表 → content 同步 → 球恢复', async ({ context, sw }) => {
  const pattern = `http://127.0.0.1:${PORT}/*`
  await seedStorage(sw, { mooConfig: makeConfig([pattern]) })
  // 预先把 127.0.0.1 写入 session 隐藏列表（模拟用户在上一次会话中关掉了悬浮球）
  await sw.evaluate(async ({ key, host }) => {
    await chrome.storage.session.set({ [key]: [host] })
  }, { key: HIDDEN_HOSTS_KEY, host: '127.0.0.1' })
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 500)))

  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${PORT}/test`)
  await page.waitForTimeout(1500)

  // 初始：host 在但球应隐藏（refreshHostHidden onMounted 已读 session 列表）
  const before = await getHostState(page)
  expect(before.exists).toBe(true)
  expect(before.ballHits, `ball should start hidden (no host hit); got ${JSON.stringify(before)}`).toBe(0)

  // 模拟 popup 二次点击取消隐藏：从列表里移除 127.0.0.1
  await sw.evaluate(async ({ key }) => {
    await chrome.storage.session.set({ [key]: [] })
  }, { key: HIDDEN_HOSTS_KEY })
  await page.waitForTimeout(400)

  const after = await getHostState(page)
  expect(after.exists).toBe(true)
  expect(after.ballHits, `ball should reappear (some host hit); got ${JSON.stringify(after)}`).toBeGreaterThan(0)

  await page.close()
})

test('S3 · 隐藏列表含其它 host 不影响本页（list 包含 example.com 但本页是 127.0.0.1）', async ({ context, sw }) => {
  const pattern = `http://127.0.0.1:${PORT}/*`
  await seedStorage(sw, { mooConfig: makeConfig([pattern]) })
  // 预置无关 host
  await sw.evaluate(async ({ key }) => {
    await chrome.storage.session.set({ [key]: ['example.com', 'foo.test'] })
  }, { key: HIDDEN_HOSTS_KEY })
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 500)))

  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${PORT}/test`)
  await page.waitForTimeout(1500)

  const state = await getHostState(page)
  expect(state.exists).toBe(true)
  expect(state.ballHits, `ball should be visible (127.0.0.1 not in hidden list); got ${JSON.stringify(state)}`).toBeGreaterThan(0)

  await page.close()
})
