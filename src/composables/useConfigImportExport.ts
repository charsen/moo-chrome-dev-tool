/**
 * Environment.vue 中配置导入/导出操作集合 composable。
 *
 * v0.5.3 P1（task #127）拆分：从 Environment.vue 抽 150 行 import/export 工具到独立模块。
 * 单测可直接覆盖 collectEndpoints / countProjectsWithToken / countProjectsWithZentaoPassword
 * 这些纯函数（之前在 .vue 内 coverage 配置已排除）。
 *
 * 调用方传入 draftRef + activeIdRef + showToast + confirmDialog。composable 提供
 * exportConfig / importConfig 两个 callable。
 */

import type { Ref } from 'vue'
import {
  normalizeProject,
  stripSensitiveProjectFields,
  type MooConfig
} from '@/types/config'

export interface UseConfigImportExportParams {
  draft: Ref<MooConfig>
  activeId: Ref<string>
  showToast(msg: string, kind?: 'success' | 'error' | 'info'): void
  confirmDialog(opts: { title: string; message: string; danger?: boolean; confirmText?: string }): Promise<boolean>
}

/** 导入配置上限 1MB —— 即使有 100 个项目 × 50 个 server × 64KB 模板，正常也只到几 MB；
 *  超出大概率是恶意 / 损坏文件，避免 JSON.parse 阻塞 devtools 渲染进程几秒 */
const IMPORT_MAX_BYTES = 1024 * 1024

export function useConfigImportExport(params: UseConfigImportExportParams) {
  async function exportConfig(): Promise<void> {
    // 剥所有 zentao.password 字段 —— 导出文件可能流给同事 / 上 git，
    // 密码绝对不能跟着走。同时保留 zentao 其他字段（地址 / projectId 等），
    // 接收方导入后只需补自己的密码即可。
    const stripped: MooConfig = {
      ...params.draft.value,
      projects: params.draft.value.projects.map(stripSensitiveProjectFields)
    }
    const data = JSON.stringify(stripped, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `moo-config-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function importConfig(): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      if (file.size > IMPORT_MAX_BYTES) {
        params.showToast(`这个文件太大（${(file.size / 1024 / 1024).toFixed(1)} MB > 1 MB 上限）。Moo 导出的正常配置不会这么大，请确认文件是否损坏或被篡改`, 'error')
        return
      }
      try {
        const text = await file.text()
        const parsed = JSON.parse(text)
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.projects)) {
          params.showToast('这个 JSON 文件格式不对（应该有顶层 projects 数组）。请确认是 Moo 导出的配置文件', 'error')
          return
        }
        // 安全确认：导入他人配置 = 同意把本机抓取的请求/cookie/storage 发到这些 endpoint。
        // 列出所有 host 让用户在落盘前看清楚，避免被预置的恶意 endpoint 偷数据。
        const endpoints = collectEndpoints(parsed.projects)
        const tokenCount = countProjectsWithToken(parsed.projects)
        const zentaoPwdCount = countProjectsWithZentaoPassword(parsed.projects)
        if (endpoints.length > 0 || tokenCount > 0 || zentaoPwdCount > 0) {
          const lines: string[] = []
          if (endpoints.length > 0) {
            lines.push(
              '这份配置会把抓取到的数据上报到下列地址：',
              '',
              ...endpoints.map((e) => `  • ${e}`),
              '',
              '导入后，匹配规则命中时本机的请求 / cookie / storage / 截图都会发往以上地址。'
            )
          }
          if (tokenCount > 0) {
            if (lines.length) lines.push('')
            lines.push(`⚠ 其中 ${tokenCount} 个项目自带了预置 token——使用 Moo 提交 bug 时会用「配置作者」的身份上报，不是你自己的。如果不认识这份配置的来源，建议导入后手动清空 token 字段，改成自己的。`)
          }
          if (zentaoPwdCount > 0) {
            if (lines.length) lines.push('')
            lines.push(`⚠ 其中 ${zentaoPwdCount} 个项目自带了禅道密码——使用 Moo 提交禅道 bug 时会用「配置作者」的禅道账号身份上报。强烈建议导入后改成你自己的禅道账号 + 密码。`)
          }
          const ok = await params.confirmDialog({
            title: '确认导入配置',
            message: lines.join('\n'),
            danger: true,
            confirmText: '导入'
          })
          if (!ok) return
        }
        // 逐个 project normalize：导入他人或老版本 JSON 时可能缺 capture/redact/servers 等字段，
        // 走 normalize 兜底，避免后续 UI 读取 active.capture.xxx 时炸
        params.draft.value = {
          projects: parsed.projects.map(normalizeProject),
          globalEnabled: typeof parsed.globalEnabled === 'boolean' ? parsed.globalEnabled : true
        }
        params.activeId.value = params.draft.value.projects[0]?.id ?? ''
      } catch (e) {
        params.showToast(`没能读取这个文件：${(e as Error).message}。请确认是 Moo 导出的 JSON 配置文件`, 'error')
      } finally {
        // 解 closure 引用：input 元素没挂 DOM 上，靠 closure 续命；onchange 跑完置 null
        // 让 GC 能立刻回收（不然多次 importConfig 留 N 个游离 input 元素 + closure）
        input.onchange = null
      }
    }
    input.click()
  }

  return { exportConfig, importConfig }
}

/** 数一下导入 JSON 里有多少个 project 带 .token 字段（仅做提示，不做拦截）— export 给单测用 */
export function countProjectsWithToken(projects: unknown[]): number {
  let n = 0
  for (const p of projects) {
    const t = (p as { token?: unknown })?.token
    if (typeof t === 'string' && t.trim()) n++
  }
  return n
}

/** 数一下导入 JSON 里有多少个 project 带 .zentao.password 字段（v0.2.0） */
export function countProjectsWithZentaoPassword(projects: unknown[]): number {
  let n = 0
  for (const p of projects) {
    const z = (p as { zentao?: unknown })?.zentao
    if (z && typeof z === 'object') {
      const pwd = (z as { password?: unknown }).password
      if (typeof pwd === 'string' && pwd.trim()) n++
    }
  }
  return n
}

/** 从 projects 数组里抽出所有 server.endpoint 的可读 host（带协议），去重保序。
 *
 * **Unicode 同形防御**：攻击者可能用 `https://trusted.com‎@evil.com/x` 这种
 * RTL / 不可见字符让用户在确认 dialog 上看到 `trusted.com` 但实际 host 是 evil.com。
 * 我们把 host 走 URL.host（即 punycode 形式：xn--...） + 给非 ASCII host 加 ⚠ 警示，
 * 用户一眼能分辨是 ASCII 域名还是 IDN。 */
export function collectEndpoints(projects: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of projects) {
    const servers = (p as { servers?: unknown[] })?.servers
    if (!Array.isArray(servers)) continue
    for (const s of servers) {
      const ep = (s as { endpoint?: unknown })?.endpoint
      if (typeof ep !== 'string' || !ep) continue
      let display = ep
      try {
        const u = new URL(ep)
        const hostAscii = u.host // URL.host 自动转 punycode（xn-- 前缀），非 ASCII 字符不会进
        const path = u.pathname === '/' ? '' : u.pathname
        display = `${u.protocol}//${hostAscii}${path}`
        // 如果原始字符串和 ASCII 化后的不一致 / 含非 ASCII 字符 / 含 @ 符号（凭证形式），加 ⚠
        if (/[^\x20-\x7E]/.test(ep) || ep.includes('@') || ep !== display) {
          display = `⚠ ${display}  (原文: ${truncate(ep, 60)})`
        }
      } catch {
        // 非法 URL：原样展示，但前加 ⚠ 提示用户配置有问题
        display = `⚠ ${ep}`
      }
      if (!seen.has(display)) {
        seen.add(display)
        out.push(display)
      }
    }
  }
  return out
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…'
}
