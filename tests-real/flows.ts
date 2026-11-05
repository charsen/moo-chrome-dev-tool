import type { BrowserContext, CDPSession, Page } from '@playwright/test'
import { realClick as realClickImpl } from './fixtures'
import {
  cdpCall, cdpClick, cdpRect, findAll, snapshot, textOf, waitFor, waitGone,
  type CdpNode, type Pred
} from './fixtures'

export const isBallCapture: Pred = (n, a) => n.nodeName === 'BUTTON' && a['title'] === '截图'
export const isBallRow: Pred = (n, a) => (a['class'] ?? '').split(' ').includes('moo-ball-row')
export const isPickerRow: Pred = (n, a) => (a['class'] ?? '').split(' ').includes('moo-ball-picker-row')
export const isBallPicker: Pred = (n, a) => (a['class'] ?? '').split(' ').includes('moo-ball-picker')
export const isAnnotator: Pred = (n, a) => (a['class'] ?? '').includes('moo-annotator')
export const isToolBtn: Pred = (n, a) => n.nodeName === 'BUTTON' && (a['class'] ?? '').split(' ').includes('tool')
export const isNextBtn: Pred = (n, a) =>
  n.nodeName === 'BUTTON' && (a['class'] ?? '').includes('primary') && textOf(n).includes('下一步')
export const isTitleInput: Pred = (n, a) => a['id'] === 'moo-title'
export const isDescTextarea: Pred = (n, a) => a['id'] === 'moo-desc'
export const isDialog: Pred = (n, a) => (a['class'] ?? '').split(' ').includes('moo-dialog')
export const isDialogHead: Pred = (n, a) => (a['class'] ?? '').split(' ').includes('moo-dialog-head')
export const isBump: Pred = (n, a) => (a['class'] ?? '').includes('moo-dialog--bump')
export const isRestorePill: Pred = (n, a) => (a['class'] ?? '').split(' ').includes('moo-dialog-restore-pill')
export const isThumbWrap: Pred = (n, a) => (a['class'] ?? '').split(' ').includes('moo-thumb-wrap')
export const isAddShot: Pred = (n) => n.nodeName === 'BUTTON' && textOf(n).includes('再截一张')
export const isArmTrigger: Pred = (n, a) => (a['class'] ?? '').split(' ').includes('moo-arm-row')
export const isShootBtn: Pred = (n, a) => n.nodeName === 'BUTTON' && (a['class'] ?? '').includes('moo-arm-btn--shoot')
export const isArmCancel: Pred = (n, a) => n.nodeName === 'BUTTON' && (a['class'] ?? '').includes('moo-arm-btn--cancel')
export const isSubmitBtn: Pred = (n, a) =>
  n.nodeName === 'BUTTON' && (a['class'] ?? '').includes('moo-btn') &&
  (a['class'] ?? '').includes('primary') && /提交|重试/.test(textOf(n))
export const isSuccessTitle: Pred = (n, a) => (a['class'] ?? '').includes('moo-success-title')
export const isFailBanner: Pred = (n, a) => (a['class'] ?? '').split(' ').includes('moo-submit-fail')
export const isPickBtn: Pred = (n) => n.nodeName === 'BUTTON' && textOf(n).includes('选元素')
export const isPicker: Pred = (n, a) => (a['class'] ?? '').split(' ').includes('moo-picker')
export const isPickedRow: Pred = (n, a) => (a['class'] ?? '').split(' ').includes('el-item')
export const isReqItem: Pred = (n, a) => (a['class'] ?? '').split(' ').includes('req-item')
export const isThumbImg: Pred = (n, a) => (a['class'] ?? '').includes('moo-thumb')

export interface Flow {
  page: Page
  cdp: CDPSession
}

/** 页面打开 + 等悬浮球（调用方先 seedStorage + 等 register debounce） */
export async function openMatchedPage(
  context: BrowserContext,
  port: number,
  path = '/',
  timeout = 20_000
): Promise<Flow> {
  const page = await context.newPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`http://127.0.0.1:${port}${path}`)
  await page.waitForFunction(() => !!document.querySelector('#__moo_dev_tool_host__'), undefined, { timeout })
  const cdp = await context.newCDPSession(page)
  await waitFor(cdp, isBallCapture, '悬浮球', timeout)
  return { page, cdp }
}

/** 点悬浮球截图 → 等 Annotator */
export async function captureToAnnotator(flow: Flow): Promise<void> {
  await cdpClick(flow.cdp, await waitFor(flow.cdp, isBallCapture, '截图按钮'))
  await waitFor(flow.cdp, isAnnotator, 'Annotator（真截屏成功才会出现）', 20_000)
  await new Promise((r) => setTimeout(r, 250)) // 等图片解码
}

/** 在画布中心画一个矩形（真鼠标） */
export async function drawRect(page: Page, offset = 0): Promise<void> {
  const vp = page.viewportSize()!
  const cx = vp.width / 2
  const cy = vp.height / 2 - 40 + offset
  await page.mouse.move(cx - 100, cy - 60)
  await page.mouse.down()
  await page.mouse.move(cx + 100, cy + 60, { steps: 6 })
  await page.mouse.up()
}

/** 点工具按钮（按可见文字） */
export async function clickTool(cdp: CDPSession, label: string): Promise<void> {
  const btn = await waitFor(cdp, (n, a) => (a['class'] ?? '').split(' ').includes('tool') && textOf(n).includes(label), `工具 ${label}`)
  await cdpClick(cdp, btn)
}

/** Annotator → 下一步 → 等提交弹窗标题框 */
export async function annotatorNext(flow: Flow): Promise<void> {
  await cdpClick(flow.cdp, await waitFor(flow.cdp, isNextBtn, '下一步'))
  await waitFor(flow.cdp, isTitleInput, '提交弹窗标题框')
}

/** 当前缩略图数量 */
export async function thumbCount(cdp: CDPSession): Promise<number> {
  return findAll(await snapshot(cdp), isThumbWrap).length
}

/** 真键盘在标题框输入（元素已 mount 自动聚焦，必要时先点一下） */
export async function typeTitle(flow: Flow, text: string): Promise<void> {
  const input = await waitFor(flow.cdp, isTitleInput, '标题框')
  // 表单可能已经滚到下面（元素/请求分组），先把标题滚回视口再用真鼠标聚焦
  await scrollIntoView(flow.cdp, input)
  const r = await cdpRect(flow.cdp, input)
  await flow.page.mouse.click(r.x + r.w / 2, r.y + r.h / 2)
  await flow.page.keyboard.type(text)
}

/** 选元素：点「选元素」→ 真实鼠标移动/点击页面元素 → 回弹窗 */
export async function pickElementAt(flow: Flow, x: number, y: number): Promise<void> {
  const pickBtn = await waitFor(flow.cdp, isPickBtn, '选元素按钮')
  await scrollIntoView(flow.cdp, pickBtn)
  await realClickImpl(flow.page, flow.cdp, pickBtn)
  await waitFor(flow.cdp, isPicker, '元素选择器')
  await flow.page.waitForTimeout(200)
  await flow.page.mouse.move(x, y)
  await flow.page.waitForTimeout(250)
  await flow.page.mouse.click(x, y)
  await flow.page.waitForTimeout(300)
}

export async function waitNoAnnotator(cdp: CDPSession): Promise<void> {
  await waitGone(cdp, isAnnotator, 'Annotator 退出')
}

/** 读取弹窗里第一张缩略图 dataUrl（标注后的 PNG） */
export async function firstThumbSrc(cdp: CDPSession): Promise<string> {
  const img = await waitFor(cdp, (n, a) => n.nodeName === 'IMG' && (a['class'] ?? '').includes('moo-thumb'), '缩略图')
  return await (async () => {
    const node = img
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node.backendNodeId }) as { object: { objectId: string } }
    const res = await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function(){ return this.src }',
      returnByValue: true
    }) as { result: { value: string } }
    return res.result.value
  })()
}

export async function waitStable(ms = 300): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

export function ballRect(cdp: CDPSession, row: CdpNode) {
  return cdpRect(cdp, row)
}

export async function projectCountForPage(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('#__moo_dev_tool_host__').length)
}


/** 附带请求列表里的行数（错误列表也复用 .req-item，必须限定在第一个 .req-list 内） */
export async function reqRowCount(cdp: CDPSession): Promise<number> {
  const root = await snapshot(cdp)
  const lists = findAll(root, (n, a) => (a['class'] ?? '').split(' ').includes('req-list'))
  const first = lists[0]
  if (!first) return 0
  return findAll(first, (n, a) => (a['class'] ?? '').split(' ').includes('req-item')).length
}


/** 把 closed shadow 里的元素滚到视口中间（真鼠标点击前用） */
export async function scrollIntoView(cdp: CDPSession, node: CdpNode): Promise<void> {
  await cdpCall(cdp, node, 'function(){ this.scrollIntoView({ block: "center", inline: "center" }) }')
  await new Promise((r) => setTimeout(r, 200))
}


/** 展开/收起某个附带分组（附带请求 / 附带错误 / 附带元素） */
export async function openAttachSection(cdp: CDPSession, label: string): Promise<void> {
  const summary = await waitFor(cdp, (n, a) =>
    (a['class'] ?? '').split(' ').includes('moo-attach-hd') && textOf(n).includes(label), `附带分组 ${label}`)
  await cdpCall(cdp, summary, 'function(){ this.parentElement.open = true }')
  await new Promise((r) => setTimeout(r, 200))
}
