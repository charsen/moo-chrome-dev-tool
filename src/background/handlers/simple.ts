/**
 * 3 个简单 onMessage handler：CAPTURE_SCREENSHOT / MATCH_PROJECT / PREVIEW_PAYLOAD。
 *
 * v0.5.2 P0 重构第 3 阶段：这 3 个 case 没有共享状态、纯函数式，单独跑没副作用，
 * 抽出来让 background/index.ts 主 switch 变成纯 dispatch。
 */

import type {
  CaptureScreenshotRes,
  MatchProjectRes,
  PreviewPayloadRes
} from '@/types/messages'
import type { BugServer } from '@/types/config'
import { loadConfig, matchProjects } from '@/storage/config'
import { renderTemplate } from '@/utils/template'
import { downscaleToMaxWidth } from '@/utils/image'
import { t } from '@/i18n'

export async function handleCaptureScreenshot(windowId?: number): Promise<CaptureScreenshotRes> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(
      windowId ?? chrome.windows.WINDOW_ID_CURRENT,
      { format: 'png' }
    )
    // 上传前降采样到 ≤ 2560 宽（高 DPI 截图物理像素 3840px+/5–6MB）—— 标注/预览/上传/history
    // 全拿到这张缩好的图，单一收口点。失败内部兜底返原图，不影响截图成功。
    const downscaled = await downscaleToMaxWidth(dataUrl)
    return { ok: true, dataUrl: downscaled }
  } catch (err) {
    // v0.4.5：Promise 版 captureVisibleTab 失败时 reject Error，理论上不会留 lastError。
    // 但 chrome 109-115 实现历史上有版本两条都设，防御性 read 一下避免 unchecked 警告
    void chrome.runtime.lastError
    return { ok: false, error: (err as Error).message }
  }
}

export async function handleMatchProject(url: string): Promise<MatchProjectRes> {
  try {
    const config = await loadConfig()
    const matches = matchProjects(config, url)
    return { project: matches[0] ?? null, matches }
  } catch (err) {
    // 保持 shape 一致：outer catch 默认返 {ok:false,error} 不符 MatchProjectRes，
    // ContentApp 那边读 res.matches 拿到 undefined → 悬浮球默默消失没解释。
    console.warn('[Moo] MATCH_PROJECT failed:', (err as Error).message)
    return { project: null, matches: [] }
  }
}

export function handlePreviewPayload(payload: { server?: BugServer; context?: Record<string, unknown> } | undefined): PreviewPayloadRes {
  if (!payload || !payload.server) {
    return { ok: false, error: t('preview.payload.no-server') }
  }
  try {
    const rendered = renderTemplate(payload.server.payloadTemplate, payload.context ?? {})
    return { ok: true, rendered }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
