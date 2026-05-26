import { createServer } from 'node:http'
import path from 'node:path'
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { chromium } from '@playwright/test'

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

// 等 SW 完整起来 (setAccessLevel async resolve)
await new Promise(r => setTimeout(r, 1000))

// 写 config + 预置 session
await sw.evaluate(async () => {
  await chrome.storage.local.set({ mooConfig: {
    globalEnabled: true,
    projects: [{ id: 'p-probe', name: 'probe', matchPatterns: [`http://127.0.0.1:*/*`], kind: 'webhook', servers: [], defaultServerId: '', enabled: true }]
  }})
  await chrome.storage.session.set({ mooHiddenFloatingBallHosts: ['127.0.0.1'] })
})
await new Promise(r => setTimeout(r, 600))

// 现在加 page console listener，看 content script 跑起来时报什么错
const page = await ctx.newPage()
page.on('console', m => console.log(`[page ${m.type()}]`, m.text()))
page.on('pageerror', e => console.log('[page error]', e.message))

await page.goto(`http://127.0.0.1:${PORT}/test`)
await new Promise(r => setTimeout(r, 2000))

const probe = await page.evaluate(() => {
  const host = document.getElementById('__moo_dev_tool_host__')
  let hits = 0
  const w = window.innerWidth, h = window.innerHeight
  for (let dx = 0; dx < 130; dx += 30) {
    for (let dy = 0; dy < 40; dy += 15) {
      const el = document.elementFromPoint(w - 200 + dx, h - 70 + dy)
      if (el === host) hits++
    }
  }
  return { hostExists: !!host, hits }
})
console.log('After 2s wait probe:', JSON.stringify(probe))

// 再 set 一次试试，看 onChanged 能否触发
await sw.evaluate(async () => {
  await chrome.storage.session.set({ mooHiddenFloatingBallHosts: ['127.0.0.1'] })
})
await new Promise(r => setTimeout(r, 600))

const probe2 = await page.evaluate(() => {
  const host = document.getElementById('__moo_dev_tool_host__')
  let hits = 0
  const w = window.innerWidth, h = window.innerHeight
  for (let dx = 0; dx < 130; dx += 30) {
    for (let dy = 0; dy < 40; dy += 15) {
      const el = document.elementFromPoint(w - 200 + dx, h - 70 + dy)
      if (el === host) hits++
    }
  }
  return { hostExists: !!host, hits }
})
console.log('After re-set probe:', JSON.stringify(probe2))

await ctx.close()
server.close()
