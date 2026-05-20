import { test, expect, seedStorage } from './fixtures'

/**
 * R8（10 回合第 8 回）：popup status chip 全 7 种正确渲染。
 *
 * popup statusOf 有 6 个明确分支 + default = 7 种状态。现有 popup-recent.spec.ts
 * 只覆盖了 3 种（queued / open / deleted）。这次覆盖全 7 种，每种验证 label 文案。
 *
 * 7 种：
 * 1) 重试中 (!ok && queued)
 * 2) 失败 (!ok && !queued)
 * 3) 完成 (ok && remoteStatus='done')
 * 4) 处理中 (ok && remoteStatus='in_progress')
 * 5) 已删 (ok && remoteStatus='deleted')
 * 6) 待处理 (ok && remoteStatus='open')
 * 7) 已提交 (ok && remoteStatus=undefined / unknown)
 */

function entry(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'h-' + Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    projectId: 'p1',
    projectName: '示例项目',
    serverId: 's1',
    serverName: 'srv',
    title: '标题',
    description: '',
    image: '',
    hasVideo: false,
    videoDuration: 0,
    url: 'https://example.com/page',
    userAgent: '',
    viewport: '',
    requests: [],
    errors: [],
    result: { ok: true },
    ...over
  }
}

const ALL_7: Array<{ override: Record<string, unknown>, label: string }> = [
  // 顺序按 timestamp 倒序：第 1 个最新（prominent 卡），后 6 个 compact 行（popup 只显前 3，所以这里只取 7 个的前 3）
  { override: { title: '7 已提交',  timestamp: Date.now() -  1 * 60_000, result: { ok: true } /* 无 remoteStatus */ },           label: '已提交' },
  { override: { title: '6 待处理',  timestamp: Date.now() -  2 * 60_000, result: { ok: true }, remoteStatus: 'open' },           label: '待处理' },
  { override: { title: '5 已删',    timestamp: Date.now() -  3 * 60_000, result: { ok: true }, remoteStatus: 'deleted' },        label: '已删' },
  { override: { title: '4 处理中',  timestamp: Date.now() -  4 * 60_000, result: { ok: true }, remoteStatus: 'in_progress' },    label: '处理中' },
  { override: { title: '3 完成',    timestamp: Date.now() -  5 * 60_000, result: { ok: true }, remoteStatus: 'done' },           label: '完成' },
  { override: { title: '2 失败',    timestamp: Date.now() -  6 * 60_000, result: { ok: false, error: '401' } },                  label: '失败' },
  { override: { title: '1 重试中',  timestamp: Date.now() -  7 * 60_000, result: { ok: false, queued: true } },                  label: '重试中' }
]

// 一次只测 3 个（popup 只显 prominent + 2 compact = 3）；分 3 轮覆盖 7 种
const ROUNDS = [
  [ALL_7[0], ALL_7[1], ALL_7[2]], // 已提交 / 待处理 / 已删
  [ALL_7[3], ALL_7[4], ALL_7[5]], // 处理中 / 完成 / 失败
  [ALL_7[6], ALL_7[0], ALL_7[1]], // 重试中 + 复用已测过的
] as const

for (let i = 0; i < ROUNDS.length; i++) {
  const round = ROUNDS[i]!
  test(`R8.${i + 1} · popup 状态 chip 渲染：${round.map(r => r!.label).join(' / ')}`, async ({ context, extensionId, sw }) => {
    await seedStorage(sw, { mooHistory: round.map(r => entry(r!.override)) })

    const popup = await context.newPage()
    await popup.setViewportSize({ width: 360, height: 600 })
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
    await popup.waitForSelector('.rh-card', { timeout: 5000 })

    // chip 在 card 和 row 都是 .rh-status（同一个类，不分卡/行）
    const labels = await popup.evaluate(() => {
      const cardChip = document.querySelector('.rh-card .rh-status') as HTMLElement | null
      const rowChips = Array.from(document.querySelectorAll('.rh-row .rh-status')) as HTMLElement[]
      return [cardChip?.textContent?.trim() ?? null, ...rowChips.map(c => c.textContent?.trim() ?? null)]
    })

    for (let j = 0; j < round.length; j++) {
      expect(labels[j], `第 ${j + 1} 条 status chip 标签错`).toBe(round[j]!.label)
    }

    await popup.close()
  })
}
