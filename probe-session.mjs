import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { chromium } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIST = path.resolve('/Volumes/dev/wwwroot/moo-chrome-dev-tool', 'dist')
const E2E_DIST = path.resolve('/Volumes/dev/wwwroot/moo-chrome-dev-tool', 'dist-e2e')

if (existsSync(E2E_DIST)) rmSync(E2E_DIST, { recursive: true, force: true })
cpSync(SRC_DIST, E2E_DIST, { recursive: true })
const mfPath = path.join(E2E_DIST, 'manifest.json')
const mf = JSON.parse(readFileSync(mfPath, 'utf8'))
mf.host_permissions = ['<all_urls>']
delete mf.optional_host_permissions
writeFileSync(mfPath, JSON.stringify(mf, null, 2))

const server = createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end('<!doctype html><html><body>hi</body></html>')
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port

const ctx = await chromium.launchPersistentContext('', {
  headless: true,
  channel: 'chromium',
  args: ['--headless=new', `--disable-extensions-except=${E2E_DIST}`, `--load-extension=${E2E_DIST}`]
})

const warm = await ctx.newPage(); await warm.goto('about:blank')
let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10_000 })
await warm.close()

await sw.evaluate(async () => {
  await chrome.storage.local.set({ mooConfig: {
    globalEnabled: true,
    projects: [{ id: 'p-probe', name: 'probe', matchPatterns: [`http://127.0.0.1:*/*`], kind: 'webhook', servers: [], defaultServerId: '', enabled: true }]
  }})
  await chrome.storage.session.set({ mooHiddenFloatingBallHosts: ['127.0.0.1'] })
})
await new Promise(r => setTimeout(r, 600))

const swDump = await sw.evaluate(async () => {
  const s = await chrome.storage.session.get('mooHiddenFloatingBallHosts')
  return { sessionList: s.mooHiddenFloatingBallHosts }
})
console.log('SW session dump:', JSON.stringify(swDump))

const page = await ctx.newPage()
const pageErrs = []
page.on('pageerror', e => pageErrs.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') pageErrs.push('console.error: ' + m.text()) })
await page.goto(`http://127.0.0.1:${PORT}/test`)
await new Promise(r => setTimeout(r, 1500))

// 从 SW 内查 listener 是否注册（content script's chrome.storage.onChanged）
// 不能直接探，但可以再写一次 session 然后等等
const probe = await page.evaluate(() => {
  const host = document.getElementById('__moo_dev_tool_host__')
  if (!host) return { hostExists: false }
  // 默认球 (w-200, h-70) ~ (1080, 650) playwright headless 默认视口 1280x720
  const w = window.innerWidth, h = window.innerHeight
  let hits = 0
  const samples = []
  for (let dx = 0; dx < 130; dx += 30) {
    for (let dy = 0; dy < 40; dy += 15) {
      const x = w - 200 + dx, y = h - 70 + dy
      const el = document.elementFromPoint(x, y)
      if (el === host) hits++
      samples.push({x, y, el: el ? (el.id || el.tagName) : 'null'})
    }
  }
  return { hostExists: true, hits, w, h, samples }
})
console.log('Page probe:', JSON.stringify(probe, null, 2))
console.log('Page errors:', pageErrs)

await ctx.close()
server.close()
