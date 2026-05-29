/**
 * SubmitDialog 「dialog 开着期间新进来的请求/错误自动勾选」回归锁 —— 锁死 commit 6e36b53。
 *
 * 被锁 bug：watch 源原本是 `() => props.requests`。上游 useRequests 的 push() 是
 * 原地 mutate 同一数组引用（requests.value.push(r)），computed(() => requests.value)
 * 每次返回**同一 proxy 引用** → 浅 watch 按 Object.is 比引用永不触发 →「dialog 开着
 * 期间新请求自动勾」失效（请求出现在列表但不打勾）。修复改源为 `() => props.requests.slice()`：
 * 每次返回新引用 + 迭代订阅 length/index，push/shift 都触发。errors watch 同款。
 *
 * 为什么这测试能抓回归（区分修复前/后）：
 * - harness 的 requests/errors 用 ref + computed(() => ref.value) **完全复刻** useRequests
 *   数据流，push 钩子做 **in-place `.push()`**（不重赋值）。重赋值会让浅 watch 也触发、
 *   掩盖 bug；in-place push 才是真实条件 —— 把 `.slice()` 改回 `() => props.requests` 后，
 *   D-AS2 / D-AS3「新 push 的条目应被自动勾」就会失败（新条目出现但 checked=false）。
 *
 * 层级：Playwright E2E（harness 断面）。覆盖：首次只勾最新 / 动态 push 自动勾 / errors 同款 /
 * 手动 toggle / selectAll / selectNone 仍正常。不覆盖：真截图触发链路（人肉 checklist）。
 */

import { test, expect, openExtensionPage } from './fixtures'

function harnessUrl(extensionId: string, search = ''): string {
  return `chrome-extension://${extensionId}/src/content/dialog-harness.html?case=submit${search ? '&' + search : ''}`
}

type CheckedMap = Record<string, boolean>

/** 读「附带请求」列表里每条 req-row 的 checkbox 勾选状态，key 是 req id */
async function readRequestChecks(page: import('@playwright/test').Page): Promise<CheckedMap> {
  return await page.evaluate(() => {
    const shadow = (window as unknown as { __mooHarnessShadow?: ShadowRoot }).__mooHarnessShadow
    const out: Record<string, boolean> = {}
    if (!shadow) return out
    // 「附带请求」是第一个 .moo-attach（template 顺序：请求 details 在错误 details 前）
    const rows = shadow.querySelectorAll('.req-list .req-row')
    rows.forEach((row, i) => {
      const cb = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null
      // req-row 没暴露 id 到 DOM，用 .url 文本里的 endpoint-N 反推稳定 key
      const urlEl = row.querySelector('.url') as HTMLElement | null
      const m = urlEl?.title?.match(/endpoint-(\d+)/)
      const key = m ? `req-${m[1]}` : `row-${i}`
      out[key] = !!cb?.checked
    })
    return out
  })
}

/** 读「附带错误」列表 checkbox 勾选状态，key 是 message 里的序号 */
async function readErrorChecks(page: import('@playwright/test').Page): Promise<CheckedMap> {
  return await page.evaluate(() => {
    const shadow = (window as unknown as { __mooHarnessShadow?: ShadowRoot }).__mooHarnessShadow
    const out: Record<string, boolean> = {}
    if (!shadow) return out
    const attaches = shadow.querySelectorAll('.moo-attach')
    // 「附带错误」是含「附带错误」标题的那个 details
    let errAttach: Element | null = null
    attaches.forEach((a) => {
      if (a.querySelector('.moo-attach-title')?.textContent?.includes('附带错误')) errAttach = a
    })
    if (!errAttach) return out
    const items = (errAttach as Element).querySelectorAll('.req-item')
    items.forEach((item, i) => {
      const cb = item.querySelector('input[type="checkbox"]') as HTMLInputElement | null
      const msgEl = item.querySelector('.url') as HTMLElement | null
      out[msgEl?.textContent?.trim() ?? `err-row-${i}`] = !!cb?.checked
    })
    return out
  })
}

async function pushRequest(page: import('@playwright/test').Page): Promise<string> {
  return await page.evaluate(() =>
    (window as unknown as { __mooHarnessPushRequest: () => string }).__mooHarnessPushRequest()
  )
}

async function pushError(page: import('@playwright/test').Page): Promise<string> {
  return await page.evaluate(() =>
    (window as unknown as { __mooHarnessPushError: () => string }).__mooHarnessPushError()
  )
}

test('SubmitDialog · D-AS1 · 打开瞬间只勾最新一条请求（不全选）', async ({ context, extensionId, sw }) => {
  // 起 3 条预置请求 req-0..req-2，末尾 req-2 是最新
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 'requests=3'))
  await page.waitForSelector('.req-list .req-row', { timeout: 5000 })

  const checks = await readRequestChecks(page)
  // 只勾最新（末尾）那条 req-2，其余不勾 —— 不偷偷全选
  expect(checks['req-2']).toBe(true)
  expect(checks['req-1']).toBe(false)
  expect(checks['req-0']).toBe(false)
  // 计数文案也应是 1 / 3
  await expect(page.locator('.moo-attach-count').first()).toHaveText('1 / 3')
})

test('SubmitDialog · D-AS2 · dialog 开着期间新 push 的请求自动被勾选（核心回归点）', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 'requests=2'))
  await page.waitForSelector('.req-list .req-row', { timeout: 5000 })

  // 开局：只勾最新 req-1
  let checks = await readRequestChecks(page)
  expect(checks['req-1']).toBe(true)
  expect(checks['req-0']).toBe(false)

  // dialog 开着期间 in-place push 新请求（复刻 useRequests.push 原地 mutate）
  const newId = await pushRequest(page)  // req-2
  expect(newId).toBe('req-2')

  // 等 watch 跑完一帧 + DOM 渲染出第 3 行
  await page.waitForFunction(() => {
    const shadow = (window as unknown as { __mooHarnessShadow?: ShadowRoot }).__mooHarnessShadow
    return (shadow?.querySelectorAll('.req-list .req-row').length ?? 0) === 3
  }, { timeout: 3000 })

  checks = await readRequestChecks(page)
  // ⭐ 回归断言：新 push 的 req-2 必须被自动勾上。
  // 修复前（() => props.requests 浅 watch）这里 req-2.checked === false → 测试挂。
  expect(checks['req-2']).toBe(true)
  // 之前已勾的 req-1 仍勾，未勾的 req-0 仍不勾
  expect(checks['req-1']).toBe(true)
  expect(checks['req-0']).toBe(false)

  // 再 push 一条，仍自动勾
  const newId2 = await pushRequest(page)  // req-3
  await page.waitForFunction(() => {
    const shadow = (window as unknown as { __mooHarnessShadow?: ShadowRoot }).__mooHarnessShadow
    return (shadow?.querySelectorAll('.req-list .req-row').length ?? 0) === 4
  }, { timeout: 3000 })
  checks = await readRequestChecks(page)
  expect(checks[newId2]).toBe(true)
})

test('SubmitDialog · D-AS3 · errors 同款：开局只勾最新 + 期间新 push 自动勾', async ({ context, extensionId, sw }) => {
  // requests 给 0 条，专测 errors 段；errors 初始为空，先 push 2 条建立 baseline
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 'requests=0'))
  await page.waitForSelector('#moo-title', { timeout: 5000 })

  // 初始无 errors → 「附带错误」details 不渲染（v-if="errors.length"）
  // push 第 1 条 err-0：此时是「dialog 期间新进来」首条，watch 首跑勾它（首次只勾最新一条）
  await pushError(page)  // err-0
  await page.waitForFunction(() => {
    const shadow = (window as unknown as { __mooHarnessShadow?: ShadowRoot }).__mooHarnessShadow
    const attaches = shadow?.querySelectorAll('.moo-attach') ?? []
    return Array.from(attaches).some((a) => a.querySelector('.moo-attach-title')?.textContent?.includes('附带错误'))
  }, { timeout: 3000 })

  let checks = await readErrorChecks(page)
  // err-0 应被勾（无论走首跑「勾最新」还是后续「新进来勾」，结果都该是 checked）
  expect(Object.values(checks).some((v) => v)).toBe(true)
  const firstMsgs = Object.keys(checks)
  expect(firstMsgs.length).toBe(1)
  expect(checks[firstMsgs[0]]).toBe(true)

  // ⭐ 回归点：dialog 开着期间再 push err-1 → 自动勾。
  // 修复前 errors 浅 watch 不触发 → 新错误 checked=false → 测试挂。
  await pushError(page)  // err-1
  await page.waitForFunction(() => {
    const shadow = (window as unknown as { __mooHarnessShadow?: ShadowRoot }).__mooHarnessShadow
    let errAttach: Element | undefined
    ;(shadow?.querySelectorAll('.moo-attach') ?? []).forEach((a) => {
      if (a.querySelector('.moo-attach-title')?.textContent?.includes('附带错误')) errAttach = a
    })
    return (errAttach?.querySelectorAll('.req-item').length ?? 0) === 2
  }, { timeout: 3000 })

  checks = await readErrorChecks(page)
  // 两条都该勾上（baseline 那条 + 新进来那条）
  const vals = Object.values(checks)
  expect(vals.length).toBe(2)
  expect(vals.every((v) => v)).toBe(true)
})

test('SubmitDialog · D-AS4 · 手动 toggle / selectNone / selectAll 仍正常', async ({ context, extensionId, sw }) => {
  const page = await openExtensionPage(context, sw, harnessUrl(extensionId, 'requests=3'))
  await page.waitForSelector('.req-list .req-row', { timeout: 5000 })

  // 找「附带请求」controls 里的全选/清空按钮（第一个 .moo-attach）
  const reqAttach = page.locator('.moo-attach').first()

  // selectAll → 全勾
  await reqAttach.getByRole('button', { name: '全选' }).click()
  let checks = await readRequestChecks(page)
  expect(Object.values(checks).every((v) => v)).toBe(true)
  await expect(page.locator('.moo-attach-count').first()).toHaveText('3 / 3')

  // selectNone → 全不勾
  await reqAttach.getByRole('button', { name: '清空' }).click()
  checks = await readRequestChecks(page)
  expect(Object.values(checks).every((v) => !v)).toBe(true)
  await expect(page.locator('.moo-attach-count').first()).toHaveText('0 / 3')

  // 手动 toggle req-0（reverse 后列表里 req-0 是最后一行）→ 勾上单条
  // 用 checkbox 直接点：filtered 是 reverse 顺序，最新 req-2 在第 0 行
  const rows = page.locator('.req-list .req-row')
  // 点最后一行（req-0）的 checkbox
  await rows.last().locator('input[type="checkbox"]').click()
  checks = await readRequestChecks(page)
  expect(checks['req-0']).toBe(true)
  expect(checks['req-1']).toBe(false)
  expect(checks['req-2']).toBe(false)

  // 再点一次 → 取消
  await rows.last().locator('input[type="checkbox"]').click()
  checks = await readRequestChecks(page)
  expect(checks['req-0']).toBe(false)
})
