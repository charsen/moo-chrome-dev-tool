/**
 * 状态回查相关的纯函数。
 *
 * 抽出来独立模块的动机：background/index.ts 里这函数原本是私有的，
 * 但单测只测 SW 入口 dispatch 太重，逻辑核心（charset / size limit）
 * 是纯字符串处理 —— 拆到 utils 里既能直接 import 测，又让 background 文件更专注。
 */

/** remoteId 会被拼到 GET ${remoteBase}/${remoteId}/status-public，
 *  必须限制字符集防恶意服务端注入路径 / query（如 `../../admin?token=`）。
 *  服务端正常会返 ULID / UUID / 数字主键这类标识，全部命中 [A-Za-z0-9_-]。 */
const REMOTE_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const REMOTE_ID_MAX = 128
const RESPONSE_PARSE_MAX = 64 * 1024

export function parseRemoteId(text: string): string | undefined {
  // 上报响应体正常几百字节 JSON；防御性：>64KB 直接放弃 parse，
  // 避免误把超大 HTML 错误页喂给 JSON.parse 卡 service worker
  if (!text || text.length > RESPONSE_PARSE_MAX) return undefined
  try {
    const obj = JSON.parse(text) as unknown
    if (!obj || typeof obj !== 'object') return undefined
    const id = (obj as { id?: unknown }).id
    if (typeof id !== 'string' || !id) return undefined
    if (id.length > REMOTE_ID_MAX) return undefined
    if (!REMOTE_ID_PATTERN.test(id)) return undefined
    return id
  } catch {
    // not json
  }
  return undefined
}
