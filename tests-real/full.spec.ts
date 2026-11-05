import { test, expectReal, seedStorage, waitHost, shot, findAll, snapshot, waitFor, waitGone, cdpCall, cdpClick, cdpRect, cdpValue, readStorage, realClick, textOf, openBackgroundTab, activateTab } from './fixtures'
import { startRealServer, type RealServer } from './server'
import { webhookProject, zentaoProject, configWith } from './config'
import {
  isBallCapture, isBallPicker, isBallRow, isPickerRow, isAnnotator, reqRowCount,
  openMatchedPage, captureToAnnotator, drawRect, clickTool, annotatorNext,
  thumbCount, typeTitle, pickElementAt, firstThumbSrc, scrollIntoView, openAttachSection
} from './flows'

interface HistEntry {
  id?: string
  result?: { ok?: boolean; queued?: boolean }
  remoteId?: string
  remoteBase?: string
  serverId?: string
}
interface QueueEntry { enqueuedAt?: number; historyId?: string }
interface CfgShape { globalEnabled?: boolean }

let server: RealServer

test.beforeAll(async () => { server = await startRealServer() })
test.afterAll(async () => { await server.close() })
test.beforeEach(() => {
  server.webhook.requests.length = 0
  server.webhook.failFirstN = 0
  server.zentao.bugPayloads.length = 0
  server.zentao.uploads.length = 0
  server.zentao.logins = 0
})

async function seed(sw: import('@playwright/test').Worker, projects: unknown[]): Promise<void> {
  await seedStorage(sw, { mooConfig: configWith(projects), mooHistory: [] })
  await sw.evaluate(() => new Promise<void>((r) => setTimeout(r, 800)))
}

// ═══════════════════════════════════════════════════════════════════════════
// R1 · 悬浮球 / 多项目 picker / 拖拽 / 录屏入口提示 / popup / 工作区
// ═══════════════════════════════════════════════════════════════════════════
test('R1 · 悬浮球三交互 + popup 真状态 + 工作区窗口', async ({ context, sw, extensionId }) => {
  await seed(sw, [
    webhookProject(server.port, { id: 'p-a', name: '项目甲' }),
    webhookProject(server.port, { id: 'p-b', name: '项目乙' })
  ])
  const { page, cdp } = await openMatchedPage(context, server.port)

  // 点 logo → 多项目 picker（2 行）
  const logo = await waitFor(cdp, (n, a) => n.nodeName === 'BUTTON' && (a['class'] ?? '').includes('moo-ball-btn--logo'), 'logo')
  await realClick(page, cdp, logo)
  await waitFor(cdp, isPickerRow, '项目 picker')
  expectReal(findAll(await snapshot(cdp), isPickerRow)).toHaveLength(2)
  await shot(page, 'r1-picker')

  // Esc 关闭 picker（v0.8.19 补的退出方式）
  await page.keyboard.press('Escape')
  await waitGone(cdp, isBallPicker, 'Esc 关闭 picker')

  // 重新打开并选「项目甲」
  await realClick(page, cdp, logo)
  const rows = findAll(await snapshot(cdp), isPickerRow)
  await realClick(page, cdp, rows[0]!)
  await waitGone(cdp, isBallPicker, '选完关闭 picker')

  // 真鼠标拖动悬浮球
  const row = await waitFor(cdp, isBallRow, '悬浮球 row')
  const before = await cdpRect(cdp, row)
  await page.mouse.move(before.x + before.w / 2, before.y + before.h / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.w / 2 - 220, before.y + before.h / 2 - 140, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const after = await cdpRect(cdp, row)
  expectReal(Math.abs(after.x - before.x), '拖动后 x 应变化').toBeGreaterThan(80)
  expectReal(Math.abs(after.y - before.y), '拖动后 y 应变化').toBeGreaterThan(50)
  await shot(page, 'r1-dragged')

  // 录屏按钮：真机点它应提示必须用快捷键
  const recBtn = await waitFor(cdp, (n, a) => n.nodeName === 'BUTTON' && (a['title'] ?? '').startsWith('录屏快捷键'), '录屏按钮')
  await realClick(page, cdp, recBtn)
  const toast = await waitFor(cdp, (n, a) => (a['class'] ?? '').includes('moo-toast'), '录屏提示 toast')
  expectReal(textOf(toast)).toContain('录屏需要键盘启动')

  // popup 在后台 tab 打开：这样它查到的 active tab 仍是我们的 http 页面（真实工具栏 popup 语义）
  const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`
  const pagePromise = context.waitForEvent('page')
  await sw.evaluate((u) => chrome.tabs.create({ url: u, active: false }), popupUrl)
  const popup = await pagePromise
  await popup.waitForLoadState('domcontentloaded')
  await expectReal(popup.locator('.state-title')).toContainText('已启用', { timeout: 8000 })
  await expectReal(popup.locator('.proj-card')).toHaveCount(2)
  await shot(popup, 'r1-popup-matched')

  // 悬浮球 host 开关：隐藏 → 页面上的球消失；恢复 → 球回来
  const ballSwitch = popup.locator('.rec-toggle', { hasText: '悬浮球' }).locator('button[role="switch"]')
  await expectReal(ballSwitch).toBeEnabled()
  await ballSwitch.click()
  await waitGone(cdp, isBallRow, '隐藏后悬浮球消失', 8000)
  await ballSwitch.click()
  await waitFor(cdp, isBallCapture, '恢复后悬浮球出现', 8000)

  // 版本检查 chip：真 fetch Gitee（成功 / 限流失败都算有效终态，不能卡在「检查中」）
  const chip = popup.locator('button.moo-chip--btn')
  await chip.click()
  await expectReal.poll(async () => (await chip.textContent()) ?? '', { timeout: 30_000 })
    .toMatch(/已是最新|检查失败|v\d/)

  // 打开工作区：应新建一个包含 options 页的独立窗口
  await sw.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({ url: u })
    if (tabs[0]?.id) await chrome.tabs.update(tabs[0].id, { active: true })
  }, popupUrl)
  await popup.locator('.opt-cta').click()
  await expectReal.poll(async () => {
    const urls = await sw.evaluate(async () => {
      const wins = await chrome.windows.getAll({ populate: true })
      return wins.flatMap((w) => (w.tabs ?? []).map((t) => t.url ?? ''))
    })
    return urls.some((u) => u.includes('/src/options/index.html'))
  }, { timeout: 8000 }).toBe(true)

  await page.close()
  await popup.close()
})

// ═══════════════════════════════════════════════════════════════════════════
// R2 · 截图 → Annotator 全工具 / 键盘 / 复制 / 下载 / 下一步
// ═══════════════════════════════════════════════════════════════════════════
test('R2 · Annotator 全工具真机操作（矩形/圆/箭头/指针/文字/马赛克 + 撤销重做 + 复制/下载）', async ({ context, sw }) => {
  await seed(sw, [webhookProject(server.port)])
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${server.port}` })
  const flow = await openMatchedPage(context, server.port)
  const { page, cdp } = flow

  // 先制造请求 / 错误，供后续弹窗使用
  await page.click('#btn-fetch')
  await page.click('#btn-xhr')
  await page.click('#btn-error')
  await page.waitForTimeout(600)

  await captureToAnnotator(flow)
  await shot(page, 'r2-annotator')

  // 工具逐个切换 + 真鼠标画
  await clickTool(cdp, '矩形'); await drawRect(page)
  await clickTool(cdp, '圆形'); await drawRect(page, 20)
  await clickTool(cdp, '箭头'); await drawRect(page, 40)
  await clickTool(cdp, '指针'); await drawRect(page, 60)
  await clickTool(cdp, '马赛克'); await drawRect(page, 80)

  // 文字工具：点画布 → shadow 内 input 出现 → 真键盘输入中文 → Enter 提交标注
  await clickTool(cdp, '文字')
  const vp = page.viewportSize()!
  await page.mouse.click(vp.width / 2 - 160, vp.height / 2 + 120)
  const textInput = await waitFor(cdp, (n, a) => n.nodeName === 'INPUT' && (a['class'] ?? '').includes('moo-text-input'), '文字输入框')
  await realClick(page, cdp, textInput)
  await page.keyboard.type('真机文字标注')
  await page.keyboard.press('Enter')
  await waitGone(cdp, (n, a) => (a['class'] ?? '').includes('moo-text-input'), '文字输入框收起')

  // 撤销 / 重做（真键盘快捷键）
  await page.keyboard.press('Meta+z')
  await page.waitForTimeout(150)
  await page.keyboard.press('Meta+Shift+z')
  await page.waitForTimeout(150)

  // 复制：真剪贴板里应有 PNG
  const copyBtn = await waitFor(cdp, (n) => n.nodeName === 'BUTTON' && textOf(n) === '复制', '复制按钮')
  await realClick(page, cdp, copyBtn)
  await page.waitForTimeout(400)
  const types = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    return items.flatMap((i) => i.types)
  })
  expectReal(types.join(','), '剪贴板应含图片').toContain('image/png')
  await shot(page, 'r2-after-ops')

  // 下载
  const downloadPromise = page.waitForEvent('download', { timeout: 8000 })
  const dlBtn = await waitFor(cdp, (n) => n.nodeName === 'BUTTON' && textOf(n) === '下载', '下载按钮')
  await realClick(page, cdp, dlBtn)
  const download = await downloadPromise
  expectReal(download.suggestedFilename()).toMatch(/^moo-screenshot-.*\.png$/)

  // 下一步 → 提交弹窗
  await annotatorNext(flow)
  expectReal(await thumbCount(cdp)).toBe(1)
  await shot(page, 'r2-submit-dialog')
  await page.keyboard.press('Escape')
  await waitGone(cdp, (n, a) => a['id'] === 'moo-title', 'Esc 关闭弹窗')
  await page.close()
})

// ═══════════════════════════════════════════════════════════════════════════
// R3 · SubmitDialog：请求/错误/元素/粘贴/多图/拖动/最小化/提交成功
// ═══════════════════════════════════════════════════════════════════════════
test('R3 · 提交弹窗全字段 + 多图 + 元素 + 粘贴 + 提交成功（payload/history/popup）', async ({ context, sw, extensionId }) => {
  await seed(sw, [webhookProject(server.port)])
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${server.port}` })
  const flow = await openMatchedPage(context, server.port)
  const { page, cdp } = flow

  await page.click('#btn-fetch')
  await page.click('#btn-xhr')
  await page.click('#btn-error')
  await page.waitForTimeout(600)

  await captureToAnnotator(flow)
  await drawRect(page)
  await annotatorNext(flow)

  // 请求列表：至少 2 条；筛选；全选/清空；展开 + 复制
  await expectReal.poll(async () => reqRowCount(cdp), { timeout: 5000 }).toBeGreaterThanOrEqual(2)
  const filter = await waitFor(cdp, (n, a) => a['class'] === 'req-filter', 'URL 过滤框')
  await realClick(page, cdp, filter)
  await page.keyboard.type('echo2')
  await page.waitForTimeout(300)
  expectReal(await reqRowCount(cdp), 'URL 过滤后应只剩 echo2 一条').toBe(1)
  await page.keyboard.press('Meta+a')
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(300)

  // 全选 / 清空
  const selectAll = await waitFor(cdp, (n) => n.nodeName === 'BUTTON' && textOf(n).includes('全选'), '全选')
  await realClick(page, cdp, selectAll)
  const selectNone = await waitFor(cdp, (n, a) => n.nodeName === 'BUTTON' && textOf(n).includes('清空') && (a['class'] ?? '').includes('moo-btn'), '清空')
  await realClick(page, cdp, selectNone)
  // 清空后手动勾一条，验证提交 payload 里确实带上了选中请求
  const firstCheckbox = await waitFor(cdp, (n, a) => n.nodeName === 'INPUT' && a['type'] === 'checkbox', '请求 checkbox')
  await realClick(page, cdp, firstCheckbox)

  // 展开第一条详情 + 复制 body
  const expandBtn = await waitFor(cdp, (n, a) => (a['class'] ?? '').split(' ').includes('req-expand-btn'), '展开按钮')
  await realClick(page, cdp, expandBtn)
  await waitFor(cdp, (n, a) => (a['class'] ?? '').split(' ').includes('req-detail'), '请求详情')
  const copyBody = await waitFor(cdp, (n, a) => (a['class'] ?? '').includes('req-copy-btn'), '复制 body')
  await realClick(page, cdp, copyBody)
  const clipText = await page.evaluate(() => navigator.clipboard.readText())
  expectReal(clipText.length).toBeGreaterThan(0)

  // 错误段可见
  expectReal(findAll(await snapshot(cdp), (n) => textOf(n).includes('附带错误')).length).toBeGreaterThan(0)

  // 元素选择：先展开「附带元素」分组，再挑 h1 + 清空
  await openAttachSection(cdp, '附带元素')
  await pickElementAt(flow, 120, 60)
  expectReal(findAll(await snapshot(cdp), (n, a) => (a['class'] ?? '').split(' ').includes('el-item')).length).toBe(1)
  // 「清空」有两个（附带请求 / 附带元素），按 DOM 顺序取最后一个 = 元素区
  const clearButtons = findAll(await snapshot(cdp), (n, a) =>
    n.nodeName === 'BUTTON' && textOf(n).includes('清空') && (a['class'] ?? '').includes('moo-btn'))
  const elementClear = clearButtons[clearButtons.length - 1]!
  await scrollIntoView(cdp, elementClear)
  await realClick(page, cdp, elementClear)
  // 单个元素不需要二次确认，直接清空
  await expectReal.poll(async () => findAll(await snapshot(cdp), (n, a) => (a['class'] ?? '').split(' ').includes('el-item')).length, { timeout: 3000 }).toBe(0)
  // 再挑一次，供提交 payload 断言
  await pickElementAt(flow, 120, 60)

  // 粘贴图片：写系统剪贴板 → Meta+V
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 48
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#e11d48'; ctx.fillRect(0, 0, 64, 48)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('toBlob failed')
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  })
  const beforePaste = await thumbCount(cdp)
  await page.keyboard.press('Meta+v')
  await expectReal.poll(async () => thumbCount(cdp), { timeout: 6000 }).toBe(beforePaste + 1)

  // 多图：再截一张 → arming → 现在截图 → 标注 → 回弹窗
  await typeTitle(flow, '真机全链路标题')
  expectReal(await cdpValue(cdp, await waitFor(cdp, (n, a) => a['id'] === 'moo-title', '标题框回读')), '标题应真的输入成功').toBe('真机全链路标题')
  await cdpClick(cdp, await waitFor(cdp, (n) => n.nodeName === 'BUTTON' && textOf(n).includes('再截一张'), '再截一张'))
  await waitFor(cdp, (n, a) => (a['class'] ?? '').split(' ').includes('moo-arm-row'), 'arming 触发器')
  await cdpClick(cdp, await waitFor(cdp, (n, a) => n.nodeName === 'BUTTON' && (a['class'] ?? '').includes('moo-arm-btn--shoot'), '现在截图'))
  await waitFor(cdp, isAnnotator, '第二轮 Annotator', 20_000)
  await page.waitForTimeout(250)
  await annotatorNext(flow)
  expectReal(await thumbCount(cdp), '应有 2 张缩略图').toBeGreaterThanOrEqual(2)
  const titleNode = await waitFor(cdp, (n, a) => a['id'] === 'moo-title', '标题框')
  const titleValue = await (async () => {
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: titleNode.backendNodeId }) as { object: { objectId: string } }
    const res = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function(){ return this.value }', returnByValue: true }) as { result: { value: string } }
    return res.result.value
  })()
  expectReal(titleValue, '重挂后草稿标题应保留').toBe('真机全链路标题')

  // 弹窗拖动 + 最小化/恢复 + 点遮罩不关
  const head = await waitFor(cdp, (n, a) => (a['class'] ?? '').split(' ').includes('moo-dialog-head'), '弹窗头部')
  const hRect = await cdpRect(cdp, head)
  await page.mouse.move(hRect.x + 60, hRect.y + hRect.h / 2)
  await page.mouse.down()
  await page.mouse.move(hRect.x + 160, hRect.y + hRect.h / 2 + 60, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const minBtn = await waitFor(cdp, (n, a) => n.nodeName === 'BUTTON' && (a['class'] ?? '').includes('moo-dialog-min-btn'), '最小化')
  await cdpClick(cdp, minBtn)
  await waitFor(cdp, (n, a) => (a['class'] ?? '').split(' ').includes('moo-dialog-restore-pill'), '恢复 pill')
  await page.keyboard.press('Escape')
  await waitGone(cdp, (n, a) => (a['class'] ?? '').split(' ').includes('moo-dialog-restore-pill'), 'Esc 恢复弹窗')
  await page.mouse.click(30, 30)
  await page.waitForTimeout(200)
  expectReal(findAll(await snapshot(cdp), (n, a) => a['id'] === 'moo-title').length, '点遮罩不应关弹窗').toBe(1)
  await shot(page, 'r3-dialog-full')

  // 标题回车提交
  const title2 = await waitFor(cdp, (n, a) => a['id'] === 'moo-title', '标题框')
  await realClick(page, cdp, title2)
  await page.keyboard.press('End')
  await page.keyboard.type('（真机）')
  await page.keyboard.press('Enter')
  await waitFor(cdp, (n, a) => (a['class'] ?? '').includes('moo-success-title'), '提交成功面板', 20_000)
  await shot(page, 'r3-success')

  // 服务端 payload
  await expectReal.poll(() => server.webhook.requests.length, { timeout: 10_000 }).toBe(1)
  const payload = JSON.parse(server.webhook.requests[0]!.body.toString('utf8')) as {
    title: string; description: string; url: string; screenshots: string[];
    requests: unknown[]; errors: unknown[]; elements: unknown[]
  }
  expectReal(payload.title).toContain('真机全链路标题')
  expectReal(payload.url).toContain(`127.0.0.1:${server.port}`)
  expectReal(payload.screenshots.length, '应提交 >=2 张截图（首图 + 粘贴 + 再截一张）').toBeGreaterThanOrEqual(2)
  expectReal(payload.requests.length, '应提交选中的 1 条请求').toBe(1)
  expectReal(payload.elements.length, '应提交选中的元素').toBe(1)

  // history + popup 最近提交
  const history = await sw.evaluate(async () => (await chrome.storage.local.get('mooHistory')).mooHistory as unknown[])
  expectReal(history.length).toBe(1)
  const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`
  const popup = await context.newPage()
  await popup.goto(popupUrl)
  await expectReal(popup.locator('body')).toContainText('真机全链路标题', { timeout: 5000 })
  await popup.close()
  await page.close()
})

// ═══════════════════════════════════════════════════════════════════════════
// R4 · 失败 → 重试队列 → 工作区手动重试 → history 翻成功；队列删/清
// ═══════════════════════════════════════════════════════════════════════════
test('R4 · 5xx 失败入队 + 工作区立即重试 + 队列单条删除/清空', async ({ context, sw, extensionId }) => {
  await seed(sw, [webhookProject(server.port)])
  server.webhook.failFirstN = 1

  const flow = await openMatchedPage(context, server.port)
  const { page, cdp } = flow
  await captureToAnnotator(flow)
  await annotatorNext(flow)
  await typeTitle(flow, '真机失败重试标题')
  await page.keyboard.press('Enter')

  const banner = await waitFor(cdp, (n, a) => (a['class'] ?? '').split(' ').includes('moo-submit-fail'), '失败横幅', 20_000)
  expectReal(textOf(banner)).toContain('已存到重试队列')

  const histFailed = (await readStorage<HistEntry[]>(sw, 'mooHistory')) ?? []
  expectReal(histFailed.length).toBe(1)
  expectReal(histFailed[0]?.result?.ok).toBe(false)
  expectReal(histFailed[0]?.result?.queued, '失败条应标成队列中').toBe(true)
  const queueBefore = (await readStorage<QueueEntry[]>(sw, 'mooRetryQueue')) ?? []
  expectReal(queueBefore.length).toBe(1)
  expectReal(queueBefore[0]?.historyId).toBe(histFailed[0]?.id)

  // 工作区 → 设置 → 立即重试
  const optionsUrl = `chrome-extension://${extensionId}/src/options/index.html`
  const options = await openBackgroundTab(context, sw, optionsUrl)
  await activateTab(sw, optionsUrl)
  await options.click('#opt-tab-settings')
  await expectReal(options.locator('.settings .row', { hasText: '重试队列' }).locator('.stat')).toHaveText('1 条', { timeout: 8000 })
  await options.locator('button', { hasText: '立即重试' }).click()

  await expectReal.poll(async () => (await readStorage<QueueEntry[]>(sw, 'mooRetryQueue'))?.length ?? 0, { timeout: 15_000 }).toBe(0)
  expectReal(server.webhook.requests.length, '应收到首次失败 + 重试成功共 2 次').toBe(2)
  await expectReal.poll(async () => (await readStorage<HistEntry[]>(sw, 'mooHistory'))?.[0]?.result?.ok, { timeout: 8000 }).toBe(true)
  await shot(options, 'r4-settings-flushed')

  // 队列删单条 / 清空（UI 与 storage 同步）
  await sw.evaluate(async () => {
    await chrome.storage.local.set({ mooRetryQueue: [
      { enqueuedAt: Date.now(), attempts: 0, endpoint: 'http://x/a', method: 'POST', headers: {}, bodyString: '{}' },
      { enqueuedAt: Date.now() + 10, attempts: 1, endpoint: 'http://x/b', method: 'POST', headers: {}, bodyString: '{}' }
    ] })
  })
  await options.reload()
  await options.click('#opt-tab-settings')
  await expectReal(options.locator('.settings .row', { hasText: '重试队列' }).locator('.stat')).toHaveText('2 条', { timeout: 8000 })
  // 展开明细 → 删第一条
  await options.locator('.settings .queue-chev').click()
  const queueItems = options.locator('#queue-detail-list .queue-detail-item')
  await expectReal(queueItems).toHaveCount(2)
  await queueItems.nth(0).locator('.qdi-rm').click()
  await expectReal.poll(async () => (await readStorage<QueueEntry[]>(sw, 'mooRetryQueue'))?.length ?? 0, { timeout: 8000 }).toBe(1)
  // 清空（行内「清空」按钮）
  await options.locator('.settings .row', { hasText: '重试队列' }).locator('button', { hasText: '清空' }).click()
  const modal = options.locator('.modal[role="alertdialog"]')
  await expectReal(modal).toBeVisible({ timeout: 5000 })
  await modal.locator('button', { hasText: '确认丢弃' }).click()
  await expectReal.poll(async () => (await readStorage<QueueEntry[]>(sw, 'mooRetryQueue'))?.length ?? 0, { timeout: 8000 }).toBe(0)

  await options.close()
  await page.close()
})

// ═══════════════════════════════════════════════════════════════════════════
// R5 · multipart 提交（真 form-data）
// ═══════════════════════════════════════════════════════════════════════════
test('R5 · multipart：真 form-data 收到 title/description + screenshot 文件', async ({ context, sw }) => {
  await seed(sw, [webhookProject(server.port, { imageFormat: 'multipart' })])
  const flow = await openMatchedPage(context, server.port)
  const { page, cdp } = flow
  await captureToAnnotator(flow)
  await annotatorNext(flow)
  await typeTitle(flow, '真机 multipart 标题')
  await page.keyboard.press('Enter')
  await waitFor(cdp, (n, a) => (a['class'] ?? '').includes('moo-success-title'), 'multipart 成功面板', 20_000)

  await expectReal.poll(() => server.webhook.requests.length, { timeout: 10_000 }).toBe(1)
  const req = server.webhook.requests[0]!
  expectReal(req.contentType).toContain('multipart/form-data')
  const raw = req.body.toString('utf8')
  expectReal(raw).toContain('name="title"')
  expectReal(raw).toContain('真机 multipart 标题')
  expectReal(raw).toContain('name="description"')
  expectReal(raw).toContain('name="screenshot"; filename="screenshot.png"')
  await page.close()
})

// ═══════════════════════════════════════════════════════════════════════════
// R6 · 禅道 mock 全链路：登录/模块/指派/附件/提交/状态回查
// ═══════════════════════════════════════════════════════════════════════════
test('R6 · 禅道：登录态/模块/指派 + 附件上传(cookie) + 建单 + 状态同步', async ({ context, sw, extensionId }) => {
  await seed(sw, [zentaoProject(server.port)])

  // 环境页「测试连接 / 拉项目列表」真调 mock 禅道
  const optionsUrl = `chrome-extension://${extensionId}/src/options/index.html`
  const env = await openBackgroundTab(context, sw, optionsUrl)
  await activateTab(sw, optionsUrl)
  await env.click('#opt-tab-env')
  await env.locator('button', { hasText: '测试连接' }).click()
  await expectReal(env.locator('.zentao-status')).toContainText('测试员', { timeout: 10_000 })
  await env.locator('button', { hasText: '拉项目列表' }).click()
  await expectReal.poll(async () => env.locator('select option', { hasText: '真实项目' }).count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
  await env.close()

  const flow = await openMatchedPage(context, server.port)
  const { page, cdp } = flow
  // 生成请求 + 错误，让禅道 steps 里也带 curl / 调试附件
  await page.click('#btn-fetch')
  await page.click('#btn-xhr')
  await page.click('#btn-error')
  await page.waitForTimeout(600)
  await captureToAnnotator(flow)
  await drawRect(page)
  await annotatorNext(flow)

  // 登录预检（真实 login + Set-Cookie）
  await waitFor(cdp, (n, a) =>
    (a['class'] ?? '').split(' ').includes('moo-dialog') && textOf(n).includes('已登录禅道'), '禅道登录状态', 20_000)

  // 模块 / 指派列表（来自 mock v1/v2）
  await expectReal.poll(async () => {
    const text = textOf(await waitFor(cdp, (n, a) => (a['class'] ?? '').split(' ').includes('moo-dialog'), '弹窗'))
    return text.includes('登录页') && text.includes('爱丽丝')
  }, { timeout: 10_000 }).toBe(true)

  const moduleSel = await waitFor(cdp, (n, a) => a['id'] === 'moo-zentao-module', '模块下拉')
  await cdpCall(cdp, moduleSel, `function(){ this.value='11'; this.dispatchEvent(new Event('change',{bubbles:true})) }`)
  const assigneeSel = await waitFor(cdp, (n, a) => a['id'] === 'moo-zentao-assignee', '指派下拉')
  await cdpCall(cdp, assigneeSel, `function(){ this.value='alice'; this.dispatchEvent(new Event('change',{bubbles:true})) }`)

  await typeTitle(flow, '禅道真机标题')
  const submit = await waitFor(cdp, (n, a) => n.nodeName === 'BUTTON' && (a['class'] ?? '').includes('primary') && textOf(n).includes('提交'), '提交按钮')
  await cdpClick(cdp, submit)
  await waitFor(cdp, (n, a) => (a['class'] ?? '').includes('moo-success-title'), '禅道成功面板', 30_000)
  const successId = await waitFor(cdp, (n, a) => (a['class'] ?? '').includes('moo-success-id'), '成功单号')
  expectReal(textOf(successId)).toContain('#101')
  await shot(page, 'r6-zentao-success')

  // 后端断言：登录、附件 cookie、建单字段、steps inline 图
  expectReal(server.zentao.logins).toBeGreaterThanOrEqual(1)
  expectReal(server.zentao.uploads.length, '附件至少 3 个（截图/请求/curl/错误/上下文）').toBeGreaterThanOrEqual(3)
  expectReal(server.zentao.uploads.every((u) => u.hadCookie), '附件上传必须携带 login 写入的 cookie').toBe(true)
  expectReal(server.zentao.bugPayloads.length).toBe(1)
  const bug = server.zentao.bugPayloads[0]!
  expectReal(bug.title).toBe('禅道真机标题')
  expectReal(bug.module).toBe(11)
  expectReal(bug.assignedTo).toBe('alice')
  const steps = String(bug.steps)
  expectReal(steps).toContain('<img src="/file-read-')
  expectReal(steps).toContain('moo-requests.curl.sh')

  // history 记录 remoteId / remoteBase
  const hist = (await readStorage<HistEntry[]>(sw, 'mooHistory')) ?? []
  expectReal(hist[0]?.remoteId).toBe('101')
  expectReal(hist[0]?.remoteBase).toBe(`http://127.0.0.1:${server.port}`)
  expectReal(hist[0]?.serverId).toBe('zentao')

  // 状态回查：mock 改 resolved → 历史 Tab 手动同步 → 已完成
  server.zentao.status = 'closed'
  const options = await openBackgroundTab(context, sw, optionsUrl)
  await activateTab(sw, optionsUrl)
  await options.click('#opt-tab-history')
  await options.locator('button', { hasText: '同步远端状态' }).click()
  await expectReal(options.locator('.remote-status').first()).toContainText('已完成', { timeout: 15_000 })
  await shot(options, 'r6-history-status')
  await options.close()
  await page.close()
})

// ═══════════════════════════════════════════════════════════════════════════
// R7 · 截图密码遮罩像素级验证（顶层 / 同源 iframe / open shadow）
// ═══════════════════════════════════════════════════════════════════════════
test('R7 · 密码框遮罩：截图像素里三处密码区域都被灰条盖住', async ({ context, sw }) => {
  const sharp = (await import('sharp')).default
  await seed(sw, [webhookProject(server.port)])
  const flow = await openMatchedPage(context, server.port, '/mask')
  const { page, cdp } = flow
  await captureToAnnotator(flow)
  await annotatorNext(flow)

  const src = await firstThumbSrc(cdp)
  expectReal(src.startsWith('data:image/png;base64,'), '缩略图应是 PNG dataUrl').toBe(true)
  const buf = Buffer.from(src.split(',')[1]!, 'base64')
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  expectReal(info.width, 'DPR=1 时截图宽度应等于视口').toBe(1440)
  const pixel = (x: number, y: number) => {
    const i = (Math.round(y) * info.width + Math.round(x)) * info.channels
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]
  }
  const isGray = ([r, g, b]: number[]) => {
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    return max < 235 && max - min < 40
  }

  const top = pixel(160, 136)
  const frame = pixel(151, 246)
  const shadow = pixel(160, 436)
  const bg = pixel(800, 700)
  expectReal(isGray(top), `顶层密码框应被灰条遮住，实际 ${top}`).toBe(true)
  expectReal(isGray(frame), `同源 iframe 密码框应被灰条遮住，实际 ${frame}`).toBe(true)
  expectReal(isGray(shadow), `open shadow 密码框应被灰条遮住，实际 ${shadow}`).toBe(true)
  expectReal(Math.min(...bg), '页面空白处不应被遮罩').toBeGreaterThan(235)
  await shot(page, 'r7-mask-dialog')

  await page.keyboard.press('Escape')
  await waitGone(cdp, (n, a) => a['id'] === 'moo-title', '关闭弹窗')
  await page.close()
})

// ═══════════════════════════════════════════════════════════════════════════
// R8 · 工作区四 Tab：Overview 真数据 / Environment 增删导入导出 / History 删清 / Settings
// ═══════════════════════════════════════════════════════════════════════════
test('R8 · 工作区四 Tab 真机操作', async ({ context, sw, extensionId }) => {
  const fs = await import('node:fs/promises')
  await seed(sw, [webhookProject(server.port)])

  // 先造真实请求/错误，供 Overview 从被检查 tab 拉取
  const http = await context.newPage()
  await http.goto(`http://127.0.0.1:${server.port}/`)
  await waitHost(http)
  await http.click('#btn-fetch')
  await http.click('#btn-xhr')
  await http.click('#btn-error')
  await http.waitForTimeout(600)

  const optionsUrl = `chrome-extension://${extensionId}/src/options/index.html`
  const options = await openBackgroundTab(context, sw, optionsUrl)
  await expectReal(options.locator('#opt-tab-overview')).toBeVisible({ timeout: 8000 })

  // Overview：后台 tab 打开 → inspected tab 是 http 页 → 能看到真请求/错误
  await expectReal.poll(async () => options.locator('.overview .row').count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
  await options.locator('.overview .row-head').first().click()
  await expectReal(options.locator('.row-detail').first()).toBeVisible({ timeout: 5000 })
  await shot(options, 'r8-overview')
  // 过滤 → 清空
  const filter = options.locator('.overview input.filter')
  await filter.fill('echo2')
  await expectReal.poll(async () => options.locator('.overview .row').count(), { timeout: 5000 }).toBe(1)
  await filter.fill('')
  await options.locator('.overview button[title="清空当前 Tab 数据"]').click()
  const clearReqModal = options.locator('.modal[role="alertdialog"]')
  await expectReal(clearReqModal).toBeVisible({ timeout: 5000 })
  await clearReqModal.locator('button.moo-btn--danger-solid').click()
  await expectReal.poll(async () => options.locator('.overview .row').count(), { timeout: 8000 }).toBe(0)

  // Environment：新增 / 删除 / 导出 / 导入
  await activateTab(sw, optionsUrl)
  await options.click('#opt-tab-env')
  await expectReal(options.locator('.project-item')).toHaveCount(1)
  await options.locator('button[title="新建项目"]').click()
  await expectReal(options.locator('.project-item')).toHaveCount(2)
  await options.locator('button', { hasText: '删除项目' }).click()
  const modal = options.locator('.modal[role="alertdialog"]')
  await expectReal(modal).toBeVisible({ timeout: 5000 })
  await modal.locator('button.moo-btn--danger-solid').click()
  await expectReal(options.locator('.project-item')).toHaveCount(1)

  // 导出（不含密钥）→ 下载 JSON 可解析
  const dlPromise = options.waitForEvent('download', { timeout: 8000 })
  await options.locator('button[title^="导出配置（不含密钥"]').click()
  const download = await dlPromise
  const exportPath = await download.path()
  expectReal(exportPath).toBeTruthy()
  const exported = JSON.parse(await fs.readFile(exportPath!, 'utf8')) as { projects: unknown[] }
  expectReal(exported.projects.length).toBe(1)
  await shot(options, 'r8-environment')

  // History：种子 2 条 → 删 1 条 → 清空
  await sw.evaluate(async () => {
    const now = Date.now()
    const mk = (id: string, title: string) => ({
      id, timestamp: now, projectId: 'p-real', projectName: '真机项目',
      serverId: 's-p-real', serverName: '本地接收端', title, description: 'd', image: '',
      hasVideo: false, url: 'http://127.0.0.1/', userAgent: 'UA', viewport: '1440x900',
      requests: [], errors: [], result: { ok: true, status: 200 }
    })
    await chrome.storage.local.set({ mooHistory: [mk('h1', '真机历史 A'), mk('h2', '真机历史 B')] })
  })
  await options.click('#opt-tab-history')
  await expectReal(options.locator('.history .row')).toHaveCount(2, { timeout: 8000 })
  // 历史「重新提交」：原地更新原记录（replacesHistoryId），不新增行；服务端真收到
  const reqBeforeResubmit = server.webhook.requests.length
  await options.locator('.history .row').first().locator('button', { hasText: '重新提交' }).click()
  await expectReal.poll(() => server.webhook.requests.length, { timeout: 10_000 }).toBe(reqBeforeResubmit + 1)
  await expectReal(options.locator('.history .row')).toHaveCount(2, { timeout: 8000 })
  await expectReal(options.locator('.history .row').first().locator('.status')).toHaveText('200')
  await options.locator('.history .row-head').first().click()
  await expectReal(options.locator('.history .row-detail').first()).toBeVisible()
  await options.locator('.history button', { hasText: '删除' }).first().click()
  const delModal = options.locator('.modal[role="alertdialog"]')
  await expectReal(delModal).toBeVisible({ timeout: 5000 })
  await delModal.locator('button.moo-btn--danger-solid').click()
  await expectReal(options.locator('.history .row')).toHaveCount(1, { timeout: 8000 })
  await options.locator('.history button', { hasText: '清空' }).click()
  const clearModal = options.locator('.modal[role="alertdialog"]')
  await expectReal(clearModal).toBeVisible({ timeout: 5000 })
  await clearModal.locator('button.moo-btn--danger-solid').click()
  await expectReal(options.locator('.history .row')).toHaveCount(0, { timeout: 8000 })

  // 回到 Environment 再导入（后面切过 History Tab）
  await options.click('#opt-tab-env')
  // 导入：无 endpoint/token 的最小项目（不触发确认框）
  const minimalProject = {
    id: 'p-import-real', name: '导入项目', matchPatterns: [], kind: 'webhook',
    servers: [], defaultServerId: '',
    capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
    redact: { headerKeys: ['authorization'], bodyKeys: ['password'], maskPasswordInputs: true },
    enabled: true
  }
  const chooserPromise = options.waitForEvent('filechooser', { timeout: 8000 })
  await options.locator('button[title="导入配置"]').click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: 'moo-real-import.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ globalEnabled: true, projects: [minimalProject] }, null, 2))
  })
  // 导入是整份配置替换（不是追加）：导入后只剩导入的项目
  await expectReal(options.locator('.project-item')).toHaveCount(1, { timeout: 8000 })
  await expectReal(options.locator('.project-item').first()).toContainText('导入项目')

  // Settings：全局开关真写 storage
  await options.click('#opt-tab-settings')
  const globalSwitch = options.locator('.settings button.moo-switch[role="switch"]').first()
  const before = (await readStorage<CfgShape>(sw, 'mooConfig'))?.globalEnabled
  await globalSwitch.click()
  await expectReal.poll(async () => (await readStorage<CfgShape>(sw, 'mooConfig'))?.globalEnabled, { timeout: 5000 }).toBe(!before)
  await globalSwitch.click()
  await expectReal.poll(async () => (await readStorage<CfgShape>(sw, 'mooConfig'))?.globalEnabled, { timeout: 5000 }).toBe(before)

  await options.close()
  await http.close()
})

// ═══════════════════════════════════════════════════════════════════════════
// R9 · 失败 → 弹窗内「重试」成功：旧队列项被移除、history 原地翻成功、不再重复发送
// ═══════════════════════════════════════════════════════════════════════════
test('R9 · 手动重试成功不残留队列项：队列清空 + history 单条翻成功 + flush 不再重发', async ({ context, sw, extensionId }) => {
  await seed(sw, [webhookProject(server.port)])
  server.webhook.failFirstN = 1

  const flow = await openMatchedPage(context, server.port)
  const { page, cdp } = flow
  await captureToAnnotator(flow)
  await annotatorNext(flow)
  await typeTitle(flow, '真机手动重试去重')
  await page.keyboard.press('Enter')
  await waitFor(cdp, (n, a) => (a['class'] ?? '').split(' ').includes('moo-submit-fail'), '失败横幅', 20_000)

  const histBefore = (await readStorage<HistEntry[]>(sw, 'mooHistory')) ?? []
  expectReal(histBefore.length).toBe(1)
  const failedId = histBefore[0]?.id
  expectReal(histBefore[0]?.result?.queued).toBe(true)
  expectReal(((await readStorage<QueueEntry[]>(sw, 'mooRetryQueue')) ?? []).length).toBe(1)

  // 弹窗 footer「重试」→ 第二次 200
  const retryBtn = await waitFor(cdp, (n, a) =>
    n.nodeName === 'BUTTON' && (a['class'] ?? '').includes('primary') && textOf(n).includes('重试'), '重试按钮')
  await cdpClick(cdp, retryBtn)
  await waitFor(cdp, (n, a) => (a['class'] ?? '').includes('moo-success-title'), '重试成功面板', 20_000)

  expectReal(server.webhook.requests.length, '首次 500 + 手动重试 200').toBe(2)
  expectReal(((await readStorage<QueueEntry[]>(sw, 'mooRetryQueue')) ?? []).length, '手动重试成功后旧队列项应被移除').toBe(0)
  const histAfter = (await readStorage<HistEntry[]>(sw, 'mooHistory')) ?? []
  expectReal(histAfter.length, '重试不新增重复 history 行').toBe(1)
  expectReal(histAfter[0]?.id).toBe(failedId)
  expectReal(histAfter[0]?.result?.ok).toBe(true)

  // 再触发一次 flush：队列空，绝不能给远端再发第三次
  const optionsUrl = `chrome-extension://${extensionId}/src/options/index.html`
  const options = await openBackgroundTab(context, sw, optionsUrl)
  await options.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'RETRY_QUEUE_FLUSH' })
  })
  await page.waitForTimeout(800)
  expectReal(server.webhook.requests.length, 'flush 不应重复发送已手动重试成功的单').toBe(2)

  await options.close()
  await page.close()
})
