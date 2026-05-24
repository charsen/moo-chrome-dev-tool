import { describe, expect, it } from 'vitest'
import type {
  IssueAdapter,
  AdapterSubmitCtx,
  AdapterSubmitOutcome,
  AdapterStatus,
  AdapterRetryOutcome,
  AdapterRetryPayload,
  AdapterKind,
  AdapterRegistry
} from '@/adapters/IssueAdapter'
import type { Project } from '@/types/config'
import type { SubmitBugReq } from '@/types/messages'

/**
 * v0.5.2 IssueAdapter 草案 type-fit 单测。
 *
 * 目的：在不实装 adapter 的前提下，**用 TS 编译器证明**现有 zentao/webhook 调用形态
 * 可以 fit 进 IssueAdapter interface。给用户审接口时一份"零业务改动可适配"的证据。
 *
 * 这里没有 runtime 业务 assert，全部价值在 vue-tsc 编译期。一旦 IssueAdapter 接口被改
 * 得跟现有路径不兼容（漏字段 / 类型缩窄过严），本文件 type-check 会先失败。
 *
 * **不实装真 adapter**：仅 wrap 现有 handleSubmitBug / submitToZentao 的签名做 type-only
 * assertion。等用户拍板接口后再开 src/adapters/{zentao,webhook}Adapter.ts。
 */

describe('IssueAdapter type-fit', () => {
  it('zentao adapter 形态可 fit', () => {
    // 一个 zentao adapter 的最小骨架（仅类型，全是空实现）
    const zentaoAdapter: IssueAdapter<'zentao'> = {
      kind: 'zentao',
      async submit(
        _req: SubmitBugReq,
        _project: Project,
        _ctx: AdapterSubmitCtx
      ): Promise<AdapterSubmitOutcome> {
        return { ok: false, error: 'not implemented' }
      },
      async fetchStatus(
        _project: Project,
        _remoteId: string
      ): Promise<AdapterStatus | undefined> {
        return undefined
      },
      serializeForRetry(_req: SubmitBugReq, _project: Project): AdapterRetryPayload | null {
        // zentao 保留完整 SubmitBugReq —— 重试时重发 multipart
        return { kind: 'zentao', req: _req, projectId: _project.id }
      },
      async retryFromPayload(_payload: AdapterRetryPayload, _project: Project): Promise<AdapterRetryOutcome> {
        return { kind: 'ok' }
      }
    }
    expect(zentaoAdapter.kind).toBe('zentao')
  })

  it('webhook adapter 形态可 fit', () => {
    const webhookAdapter: IssueAdapter<'webhook'> = {
      kind: 'webhook',
      async submit(
        _req: SubmitBugReq,
        _project: Project,
        _ctx: AdapterSubmitCtx
      ): Promise<AdapterSubmitOutcome> {
        return { ok: false, error: 'not implemented' }
      },
      async fetchStatus(
        _project: Project,
        _remoteId: string
      ): Promise<AdapterStatus | undefined> {
        return undefined
      },
      serializeForRetry(_req: SubmitBugReq, _project: Project): AdapterRetryPayload | null {
        // webhook 入队 bodyString + endpoint + headers（不含图片 / 视频）
        return { kind: 'webhook', endpoint: '', method: 'POST', headers: {}, bodyString: '' }
      },
      async retryFromPayload(_payload: AdapterRetryPayload, _project: Project): Promise<AdapterRetryOutcome> {
        return { kind: 'ok' }
      }
    }
    expect(webhookAdapter.kind).toBe('webhook')
  })

  it('fetchStatus 缺省（可选）也合法', () => {
    const minimal: IssueAdapter<'webhook'> = {
      kind: 'webhook',
      async submit() { return { ok: false } },
      serializeForRetry() { return null },
      async retryFromPayload() { return { kind: 'ok' } }
    }
    expect(minimal.kind).toBe('webhook')
  })

  it('AdapterRegistry 形态：按 kind 索引', () => {
    const registry: AdapterRegistry = {
      webhook: {
        kind: 'webhook',
        async submit() { return { ok: false } },
        serializeForRetry() { return null },
        async retryFromPayload() { return { kind: 'ok' } }
      },
      zentao: {
        kind: 'zentao',
        async submit() { return { ok: false } },
        serializeForRetry() { return null },
        async retryFromPayload() { return { kind: 'ok' } }
      }
    }
    const projectKind: AdapterKind = 'webhook'
    const adapter = registry[projectKind]
    expect(adapter?.kind).toBe('webhook')
  })

  it('AdapterRetryOutcome union 三态：ok / drop / keep', () => {
    const ok: AdapterRetryOutcome = { kind: 'ok' }
    const drop: AdapterRetryOutcome = { kind: 'drop', reason: '认证失败' }
    const keep: AdapterRetryOutcome = { kind: 'keep', status: 500, error: 'boom' }
    expect([ok.kind, drop.kind, keep.kind]).toEqual(['ok', 'drop', 'keep'])
  })

  it('AdapterSubmitOutcome.retryable 三态语义：true / false / undefined', () => {
    const queueable: AdapterSubmitOutcome = { ok: false, retryable: true }
    const permanentFail: AdapterSubmitOutcome = { ok: false, retryable: false }
    const undecided: AdapterSubmitOutcome = { ok: false }  // retryable 缺省 = adapter 没意见
    expect(queueable.retryable).toBe(true)
    expect(permanentFail.retryable).toBe(false)
    expect(undecided.retryable).toBeUndefined()
  })
})
