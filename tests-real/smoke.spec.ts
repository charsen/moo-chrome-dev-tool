import { test, expectReal, seedStorage, waitHost, waitBall, openExtensionPage, shot } from './fixtures'
import { startRealServer, type RealServer } from './server'
import { webhookProject, configWith } from './config'

let server: RealServer

test.beforeAll(async () => { server = await startRealServer() })
test.afterAll(async () => { await server.close() })

test('R0 · 真机探针：可见 Chrome 加载扩展 / 悬浮球 / popup / 工作区', async ({ context, sw, extensionId }) => {
  await seedStorage(sw, {
    mooConfig: configWith([webhookProject(server.port)]),
    mooHistory: []
  })
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 600)))

  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${server.port}/`)
  await waitHost(page)
  const cdp = await context.newCDPSession(page)
  await waitBall(cdp)
  await shot(page, 'r0-page-with-ball')

  // 悬浮球在 closed shadow 里：用 DOM 探针 + 鼠标位置一起确认
  const hostBox = await page.evaluate(() => {
    const host = document.getElementById('__moo_dev_tool_host__')
    const r = host?.getBoundingClientRect()
    return r ? { w: r.width, h: r.height } : null
  })
  expectReal(hostBox?.w ?? 0).toBeGreaterThan(0)

  const popup = await openExtensionPage(context, `chrome-extension://${extensionId}/src/popup/index.html`)
  await expectReal(popup.locator('body')).toContainText('真机项目', { timeout: 5000 })
  await shot(popup, 'r0-popup')

  const options = await openExtensionPage(context, `chrome-extension://${extensionId}/src/options/index.html`)
  await expectReal(options.locator('#opt-tab-overview')).toBeVisible({ timeout: 5000 })
  await expectReal(options.locator('#opt-tab-env')).toBeVisible()
  await expectReal(options.locator('#opt-tab-history')).toBeVisible()
  await expectReal(options.locator('#opt-tab-settings')).toBeVisible()
  await shot(options, 'r0-options')
})
