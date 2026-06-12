/**
 * v0.7.9: submitToZentao orchestrator 单测 — 补 v0.4.4「编排层不裸奔」规则缺口。
 *
 * 之前 zentaoSubmitBuilders.test.ts 只测了 buildZentaoEnv / buildZentaoStepsHtml 纯函数；
 * 80 行 orchestrator（cookie session + 错误分类 + 上传 + 提交 + orphan hint）零覆盖。
 *
 * Mock 三个 client 函数（ensureCookieSession / submitBug / uploadEditorFile）后断言：
 *   ① envCheck 失败短路
 *   ② cookie session 网络错 vs 认证错 分类
 *   ③ submitBug 成功 / 失败 / throw 三路径
 *   ④ orphan hint 拼装（uploaded > 0 时附 hint）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Project } from '@/types/config'
import type { SubmitBugReq } from '@/types/messages'

// Mock client 模块 — vitest hoist 到 import 前
vi.mock('@/background/zentao/client', () => ({
  ensureCookieSession: vi.fn(),
  submitBug: vi.fn(),
  uploadEditorFile: vi.fn()
}))

import { ensureCookieSession, submitBug, uploadEditorFile } from '@/background/zentao/client'
import { submitToZentao, uploadZentaoAttachments } from '@/background/zentao/submit'

const mockedEnsure = vi.mocked(ensureCookieSession)
const mockedSubmit = vi.mocked(submitBug)
const mockedUpload = vi.mocked(uploadEditorFile)

const project: Project = {
  id: 'p1',
  name: 'test',
  matchPatterns: ['https://*.example.com/*'],
  kind: 'zentao',
  servers: [],
  defaultServerId: '',
  zentao: {
    baseUrl: 'https://z.example.com',
    account: 'alice',
    password: 'secret',
    projectId: 26,
    moduleId: 0,
    defaultSeverity: 3,
    defaultPri: 3,
    defaultType: 'codeerror',
    defaultKeywords: 'Moo'
  },
  capture: { requests: true, consoleErrors: true, storageKeys: [], requestBufferSize: 50 },
  redact: { headerKeys: [], bodyKeys: [], maskPasswordInputs: false },
  enabled: true
}

const baseReq: SubmitBugReq = {
  serverId: '',
  projectId: 'p1',
  title: 'test bug',
  description: 'repro',
  image: '',
  url: 'https://www.example.com/page',
  userAgent: 'Mozilla/5.0',
  viewport: '1920x1080',
  timestamp: '2026-05-27 10:00:00',
  requests: [],
  errors: []
}

const dataUrlToBlobStub = (_url: string) => new Blob(['fake'], { type: 'image/png' })

beforeEach(() => {
  mockedEnsure.mockReset()
  mockedSubmit.mockReset()
  mockedUpload.mockReset()
})

describe('submitToZentao · envCheck 短路', () => {
  it('zentao 配置整体缺失 → 早返不调 cookie/submit', async () => {
    const badProject = { ...project, zentao: undefined }
    const r = await submitToZentao(baseReq, badProject, dataUrlToBlobStub)
    expect(r.ok).toBe(false)
    expect(mockedEnsure).not.toHaveBeenCalled()
    expect(mockedSubmit).not.toHaveBeenCalled()
  })
})

describe('submitToZentao · ensureCookieSession 失败分类', () => {
  it('网络错关键词 → 错误前缀保留原文（让 retryQueue keep 进重试）', async () => {
    mockedEnsure.mockResolvedValue({ ok: false, error: '网络超时' })
    const r = await submitToZentao(baseReq, project, dataUrlToBlobStub)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('网络超时')
    expect(r.error).not.toContain('禅道登录失败')
    expect(mockedSubmit).not.toHaveBeenCalled()
  })

  it('英文 timeout 关键词 → 当网络错处理', async () => {
    mockedEnsure.mockResolvedValue({ ok: false, error: 'request timeout after 30s' })
    const r = await submitToZentao(baseReq, project, dataUrlToBlobStub)
    expect(r.ok).toBe(false)
    expect(r.error).not.toContain('禅道登录失败')
  })

  it('非网络错（认证 / 配置） → 加「禅道登录失败：」前缀（让 retryQueue drop）', async () => {
    mockedEnsure.mockResolvedValue({ ok: false, error: '账号或密码错误' })
    const r = await submitToZentao(baseReq, project, dataUrlToBlobStub)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('禅道登录失败：账号或密码错误')
    expect(mockedSubmit).not.toHaveBeenCalled()
  })

  it('ensureCookieSession throw → wrap 成「网络错误：」', async () => {
    mockedEnsure.mockRejectedValue(new Error('fetch aborted'))
    const r = await submitToZentao(baseReq, project, dataUrlToBlobStub)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('网络错误：fetch aborted')
  })
})

describe('submitToZentao · submitBug 三路径', () => {
  it('正常成功路径 → ok=true + remoteId + viewUrl', async () => {
    mockedEnsure.mockResolvedValue({ ok: true })
    mockedUpload.mockResolvedValue({ ok: false, error: 'skip' }) // 无附件
    mockedSubmit.mockResolvedValue({
      ok: true,
      data: { bugId: 9999, viewUrl: 'https://z.example.com/bug-view-9999.html' }
    })
    const r = await submitToZentao(baseReq, project, dataUrlToBlobStub)
    expect(r.ok).toBe(true)
    expect(r.remoteId).toBe('9999')
    expect(r.viewUrl).toBe('https://z.example.com/bug-view-9999.html')
  })

  it('submitBug 失败 + 0 个附件 → 无 orphan hint', async () => {
    mockedEnsure.mockResolvedValue({ ok: true })
    mockedUpload.mockResolvedValue({ ok: false, error: 'no upload' })
    mockedSubmit.mockResolvedValue({ ok: false, error: '禅道 500' })
    // 没截图 / 视频 / requests / errors → 仅 1 个 context 附件，让 upload mock 全失败 → uploaded=0
    const r = await submitToZentao(baseReq, project, dataUrlToBlobStub)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('禅道 500')
    expect(r.error).not.toContain('已上传')
    expect(r.error).not.toContain('附件')
  })

  it('submitBug 失败 + N 个附件 → orphan hint 拼装（含 URL + displayName）', async () => {
    mockedEnsure.mockResolvedValue({ ok: true })
    // 让 uploadEditorFile 全返成功 — uploadZentaoAttachments 会 push 进 uploaded[]
    mockedUpload.mockResolvedValue({
      ok: true,
      data: { url: '/file-read-42.png' }
    })
    mockedSubmit.mockResolvedValue({ ok: false, error: '禅道 500' })
    const reqWithImage: SubmitBugReq = { ...baseReq, image: 'data:image/png;base64,XX' }
    const r = await submitToZentao(reqWithImage, project, dataUrlToBlobStub)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('禅道 500')
    expect(r.error).toContain('⚠ 已上传')
    expect(r.error).toContain('/file-read-42.png')
    expect(r.error).toContain('管理员可手动清理')
  })

  it('submitBug throw + N 个附件 → 网络错前缀 + orphan hint（双重信号）', async () => {
    mockedEnsure.mockResolvedValue({ ok: true })
    mockedUpload.mockResolvedValue({ ok: true, data: { url: '/file-read-7.png' } })
    mockedSubmit.mockRejectedValue(new Error('ECONNRESET'))
    const reqWithImage: SubmitBugReq = { ...baseReq, image: 'data:image/png;base64,XX' }
    const r = await submitToZentao(reqWithImage, project, dataUrlToBlobStub)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('网络错误：ECONNRESET')
    expect(r.error).toContain('/file-read-7.png')
  })

  it('SubmitDialog 选了 zentaoModuleId / Severity / Pri → 优先于 project 默认值', async () => {
    mockedEnsure.mockResolvedValue({ ok: true })
    mockedUpload.mockResolvedValue({ ok: false, error: 'no upload' })
    mockedSubmit.mockResolvedValue({ ok: true, data: { bugId: 1 } })
    const customReq: SubmitBugReq = {
      ...baseReq,
      zentaoModuleId: 99,
      zentaoSeverity: 1,
      zentaoPri: 1,
      zentaoType: 'feature',
      zentaoAssignedTo: 'bob'
    }
    await submitToZentao(customReq, project, dataUrlToBlobStub)
    // 第 1 调用：传 env（含 moduleId）+ fields（含 severity / pri / type / assignedTo）
    expect(mockedSubmit).toHaveBeenCalledOnce()
    const [env, fields] = mockedSubmit.mock.calls[0]!
    expect(env.moduleId).toBe(99)
    expect(fields.severity).toBe(1)
    expect(fields.pri).toBe(1)
    expect(fields.type).toBe('feature')
    expect(fields.assignedTo).toBe('bob')
  })
})

// ─────────────────── v0.8.10 多张截图：uploadZentaoAttachments ───────────────────
// 契约：req.images 多图逐张上传（文件名 moo-screenshot-N.png）；单图老调用方
// （只有 req.image）仍是 moo-screenshot.png 不变（接收端按文件名识别截图，不能回归）。
describe('uploadZentaoAttachments · v0.8.10 多图', () => {
  // 'QUFB' = base64('AAA')，3 字节，过 blob.size===0 的跳过守卫
  const shot = (tag: string) => `data:image/png;base64,QUFB${tag}`

  /** 取所有 uploadEditorFile 调用里 displayName 形如 moo-screenshot*.png 的列表（过滤掉 context 附件） */
  function screenshotNames(): string[] {
    return mockedUpload.mock.calls
      .map((c) => c[2] as string)
      .filter((n) => n.startsWith('moo-screenshot'))
  }

  it('req.images 3 张 → uploadEditorFile 截图调 3 次，名字 -1/-2/-3.png', async () => {
    mockedUpload.mockResolvedValue({ ok: true, data: { url: '/file-read-1.png' } })
    const req: SubmitBugReq = {
      ...baseReq,
      image: shot('A'),
      images: [shot('A'), shot('B'), shot('C')]
    }
    const { uploaded } = await uploadZentaoAttachments(req, project, 'https://z.example.com')
    expect(screenshotNames()).toEqual([
      'moo-screenshot-1.png',
      'moo-screenshot-2.png',
      'moo-screenshot-3.png'
    ])
    expect(uploaded.filter((f) => f.kind === 'screenshot')).toHaveLength(3)
  })

  it('单图老调用方（无 images）→ 仍 1 次 moo-screenshot.png（不回归）', async () => {
    mockedUpload.mockResolvedValue({ ok: true, data: { url: '/file-read-2.png' } })
    const req: SubmitBugReq = { ...baseReq, image: shot('A') }
    await uploadZentaoAttachments(req, project, 'https://z.example.com')
    expect(screenshotNames()).toEqual(['moo-screenshot.png'])
  })

  it('images 恰 1 张 → 不带序号（跟单图语义一致）', async () => {
    mockedUpload.mockResolvedValue({ ok: true, data: { url: '/file-read-3.png' } })
    const req: SubmitBugReq = { ...baseReq, image: shot('A'), images: [shot('A')] }
    await uploadZentaoAttachments(req, project, 'https://z.example.com')
    expect(screenshotNames()).toEqual(['moo-screenshot.png'])
  })

  it('无 image 无 images → 0 次截图上传', async () => {
    mockedUpload.mockResolvedValue({ ok: true, data: { url: '/file-read-4.png' } })
    await uploadZentaoAttachments({ ...baseReq }, project, 'https://z.example.com')
    expect(screenshotNames()).toEqual([])
  })

  it('多图中第 2 张上传失败 → best-effort：1/3 进 failed，其余 2 张照传', async () => {
    let call = 0
    mockedUpload.mockImplementation(async (_base: string, _blob: Blob, name: string) => {
      if (!name.startsWith('moo-screenshot')) return { ok: true as const, data: { url: '/file-read-x.txt' } }
      call++
      return call === 2
        ? { ok: false as const, error: '503' }
        : { ok: true as const, data: { url: `/file-read-${call}.png` } }
    })
    const req: SubmitBugReq = {
      ...baseReq,
      image: shot('A'),
      images: [shot('A'), shot('B'), shot('C')]
    }
    const { uploaded, failed } = await uploadZentaoAttachments(req, project, 'https://z.example.com')
    expect(uploaded.filter((f) => f.kind === 'screenshot')).toHaveLength(2)
    expect(failed.filter((f) => f.kind === 'screenshot').map((f) => f.displayName))
      .toEqual(['moo-screenshot-2.png'])
  })
})
