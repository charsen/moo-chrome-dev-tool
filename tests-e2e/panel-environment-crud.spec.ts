import { test, expect } from './fixtures'

/**
 * Environment Tab CRUD 交互锁定。
 *
 * panel-tabs.spec 只验了「项目列表渲染 3 + 第 1 个 active」的静态基线，
 * 真正会出回归的「点 + 新建 / 点删除 / 切 active / 改项目名 → 800ms 防抖
 * 自动保存」交互链路从来没 E2E 覆盖。一旦 addProject / removeProject /
 * activeId 切换 / useAutoSave 防抖窗口哪天回归，没人能拦住。
 *
 * 关键路径：
 *   addProject       → draft.projects.push + activeId = 新 id
 *   removeProject    → confirmDialog (danger=true) → 确认后 filter 掉
 *   addServer        → activeProject.servers.push
 *   removeServer     → confirmDialog (danger=true) → 确认后 filter 掉
 *   项目名 v-model   → watch(draft, deep) → scheduleSave(800ms 防抖)
 *                    → save() → saveState='saved' → ✓ 已自动保存
 *
 * 弹窗 DOM：ConfirmModal 走 .modal-mask > .modal，danger 主按钮 class
 * 是 `.moo-btn--danger-solid`，取消按钮无修饰（裸 .moo-btn）。
 */

function harnessUrl(extensionId: string, tab: string, seed: string, count?: number): string {
  const q = new URLSearchParams({ tab, seed })
  if (count) q.set('count', String(count))
  return `chrome-extension://${extensionId}/src/devtools/panel-harness.html?${q.toString()}`
}

// ----------------------------------------------------------------------------

test('panel · Environment C1 · 点「+ 新建项目」→ 列表 +1 行 + 自动 active', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'environment', 'populated'))
  await page.waitForSelector('.env-wrap', { timeout: 5000 })

  // populated seed 给 3 项目
  await expect(page.locator('.project-item')).toHaveCount(3)

  // sidebar-head 里 title="新建项目" 的按钮（避开导入 / 导出兄弟按钮）
  await page.locator('.sidebar-head button[title="新建项目"]').click()

  // 列表 +1 行
  await expect(page.locator('.project-item')).toHaveCount(4)
  // 新项目 = active（addProject 设 activeId = 新 id）
  // 默认名 `项目 4`（draft.projects.length + 1 = 4）
  await expect(page.locator('.project-item.active .name')).toHaveText('项目 4')
  // 新项目 servers=[]，count 显示「⚠ 无服务器」
  await expect(page.locator('.project-item.active .count')).toContainText('无服务器')
})

// v0.7.1 新功能锁：addProject 自动填当前 inspected tab URL → matchPatterns[0]
test('panel · Environment C1b · 新建项目 → matchPatterns[0] 默认填当前 tab URL host (v0.7.1)', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'environment', 'populated'))
  await page.waitForSelector('.env-wrap', { timeout: 5000 })

  await page.locator('.sidebar-head button[title="新建项目"]').click()
  await expect(page.locator('.project-item.active .name')).toHaveText('项目 4')

  // panel-harness mock chrome.devtools.inspectedWindow.tabId=1 + chrome.tabs.get(1)→{url:'https://harness.local/test'}
  // → addProject 自动填 matchPatterns[0] = 'https://harness.local/*'
  const textarea = page.locator('textarea.patterns')
  await expect(textarea).toHaveValue('https://harness.local/*')
})

// v0.7.1 新功能锁：suggestPattern banner — 已有项目时进入环境，当前 URL 不命中 → 弹追加引导
test('panel · Environment C1c · suggestPattern banner：当前 URL 不命中 enabled 项目 → 弹追加 banner (v0.7.1)', async ({ context, extensionId }) => {
  const page = await context.newPage()
  // populated seed 给 3 项目，matchPatterns 都是 example.com / google.com 之类不命中 harness.local
  await page.goto(harnessUrl(extensionId, 'environment', 'populated'))
  await page.waitForSelector('.env-wrap', { timeout: 5000 })

  // suggest banner 应自动出现（当前 inspected 'https://harness.local/test' 不命中任何 enabled 项目）
  await page.waitForSelector('.suggest-pattern', { timeout: 3000 })
  await expect(page.locator('.suggest-pattern')).toBeVisible()
  await expect(page.locator('.suggest-pattern .suggest-msg code')).toHaveText('https://harness.local/*')

  // 点「追加」→ banner 消失 + textarea value 含新 pattern（用 toHaveValue 查 value 属性，textarea 无 textContent）
  await page.locator('.suggest-pattern button:has-text("追加")').click()
  await expect(page.locator('.suggest-pattern')).toHaveCount(0)
  await expect(page.locator('textarea.patterns')).toHaveValue(/https:\/\/harness\.local\/\*/)
})

test('panel · Environment C1d · suggestPattern banner：点「不加」session 级 dismiss (v0.7.1)', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'environment', 'populated'))
  await page.waitForSelector('.env-wrap', { timeout: 5000 })
  await page.waitForSelector('.suggest-pattern', { timeout: 3000 })

  // dismiss
  await page.locator('.suggest-pattern button:has-text("不加")').click()
  await expect(page.locator('.suggest-pattern')).toHaveCount(0)

  // 切 active 项目 → 不再重新弹（session 级 dismiss）
  await page.locator('.project-item').nth(1).click()
  // 给 watch 一点时间 fire
  await page.waitForTimeout(300)
  await expect(page.locator('.suggest-pattern')).toHaveCount(0)
})

test('panel · Environment C2 · 切换 active 项目（点第 2 个）→ detail 显示项目 2', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'environment', 'populated'))
  await page.waitForSelector('.env-wrap', { timeout: 5000 })

  // 默认第 1 个 active —— detail 的项目名 input 显示「项目 1」
  await expect(page.locator('.project-item.active .name')).toHaveText('项目 1')
  const nameInput = page.locator('.detail .row').first().locator('input').first()
  await expect(nameInput).toHaveValue('项目 1')

  // click 第 2 个
  await page.locator('.project-item').nth(1).click()

  // active 跳到第 2 项 + detail 同步换成「项目 2」
  await expect(page.locator('.project-item.active .name')).toHaveText('项目 2')
  await expect(nameInput).toHaveValue('项目 2')
})

test('panel · Environment C3 · 改项目名 → 800ms 防抖 → save-bar 显示「✓ 已自动保存」', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'environment', 'populated'))
  await page.waitForSelector('.env-wrap', { timeout: 5000 })

  const nameInput = page.locator('.detail .row').first().locator('input').first()
  await expect(nameInput).toHaveValue('项目 1')

  // 改名（fill 会一次性触发 input event；v-model 立刻 sync draft）
  await nameInput.fill('改名测试 X')

  // sidebar 名字立刻同步（v-model 是即时的，跟防抖无关）
  await expect(page.locator('.project-item.active .name')).toHaveText('改名测试 X')

  // 等防抖 800ms + save 走完 → save-bar 进入 is-saved 状态
  // useAutoSave 状态机：dirty → saving → saved。给 2s 余量覆盖 save() 真落盘的耗时
  await expect(page.locator('.save-bar.is-saved')).toBeVisible({ timeout: 2500 })
  await expect(page.locator('.save-bar .status-msg')).toContainText('已自动保存')
})

test('panel · Environment C4 · 点「+ 新建服务器」→ server-card 多一个', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'environment', 'populated'))
  await page.waitForSelector('.env-wrap', { timeout: 5000 })

  // populated seed 给每项目 1 server
  await expect(page.locator('.server-card')).toHaveCount(1)

  // section-head 里「+ 新建服务器」按钮：用文本定位避开 sidebar-head 的「+」
  await page.locator('.section-head button', { hasText: '新建服务器' }).click()

  await expect(page.locator('.server-card')).toHaveCount(2)
  // 新 server 默认名「服务器 2」
  const lastServerName = page.locator('.server-card').last().locator('input').first()
  await expect(lastServerName).toHaveValue('服务器 2')
})

test('panel · Environment C5 · 删服务器 → confirm 二次确认走 → server-card -1', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'environment', 'populated'))
  await page.waitForSelector('.env-wrap', { timeout: 5000 })

  // 先加一个 server 才能测删除（populated 每项目只 1 server，删完会变 0 触发空态条）
  // —— 这里我们直接测「删唯一一个」，验证 confirm 走 + 空态条出现
  await expect(page.locator('.server-card')).toHaveCount(1)

  await page.locator('.server-card button', { hasText: '删除' }).click()

  // confirm modal 弹出
  const modal = page.locator('.modal[role="alertdialog"]')
  await expect(modal).toBeVisible()
  await expect(modal.locator('.modal-hd h3')).toContainText('删除服务器')

  // 点 danger-solid 主按钮确认（避开 .moo-btn 裸取消按钮）
  await modal.locator('button.moo-btn--danger-solid').click()
  await expect(modal).toBeHidden()

  // server-card 清零 + 空态警告条出现（v-if="!activeProject.servers.length"）
  await expect(page.locator('.server-card')).toHaveCount(0)
  await expect(page.locator('.server-empty-warn')).toBeVisible()
})

test('panel · Environment C6 · 删项目 → confirm 走 → 项目列表 -1 + active 跳邻居', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(harnessUrl(extensionId, 'environment', 'populated'))
  await page.waitForSelector('.env-wrap', { timeout: 5000 })

  await expect(page.locator('.project-item')).toHaveCount(3)
  await expect(page.locator('.project-item.active .name')).toHaveText('项目 1')

  // detail 的「删除项目」按钮：moo-btn--danger（非 sm）+ 文本 "删除项目"
  await page.locator('.detail button', { hasText: '删除项目' }).first().click()

  const modal = page.locator('.modal[role="alertdialog"]')
  await expect(modal).toBeVisible()
  await expect(modal.locator('.modal-hd h3')).toContainText('删除项目')

  await modal.locator('button.moo-btn--danger-solid').click()
  await expect(modal).toBeHidden()

  // 列表 -1，active 跳到剩余第一个（原「项目 2」）
  await expect(page.locator('.project-item')).toHaveCount(2)
  await expect(page.locator('.project-item.active .name')).toHaveText('项目 2')
})
