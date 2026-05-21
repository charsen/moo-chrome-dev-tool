/**
 * User-Agent → 禅道 os / browser 枚举值。
 *
 * 禅道 bug 表 `os` / `browser` 字段都是 enum，前端 select 里有固定候选。常见值（来自
 * zentao 12 源码 lang/zh-cn/bug.php osList / browserList）：
 *   os:      all / windows / win10 / win11 / win8 / win7 / vista / winxp / win2012 /
 *            win2008 / win2003 / win2000 / android / ios / wp8 / wp7 / symbian /
 *            linux / freebsd / osx / unix / others
 *   browser: all / ie / ie11 / ie10 / ie9 / ie8 / ie7 / ie6 / chrome / firefox /
 *            opera / safari / maxthon / qt / uc / edge / other
 *
 * Moo 只需要识别桌面 / 移动 + 主流浏览器，detect 不到就返 'others'/'other'。
 */

export interface UaParsed {
  os: string
  browser: string
}

export function parseUserAgent(ua: string): UaParsed {
  return { os: detectOs(ua), browser: detectBrowser(ua) }
}

function detectOs(ua: string): string {
  // 顺序：移动 OS 先 detect —— iPhone/iPad UA 含 "Mac OS X"，Android UA 含 "Linux"
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'osx'
  if (/Windows NT 10/i.test(ua)) return 'win10'
  if (/Windows NT 6\.3|Windows NT 6\.2/i.test(ua)) return 'win8'
  if (/Windows NT 6\.1/i.test(ua)) return 'win7'
  if (/Windows NT 5\.1/i.test(ua)) return 'winxp'
  if (/Windows/i.test(ua)) return 'windows'
  if (/Linux/i.test(ua)) return 'linux'
  if (/FreeBSD/i.test(ua)) return 'freebsd'
  return 'others'
}

function detectBrowser(ua: string): string {
  // Edge / Opera 必须先于 Chrome 判断（它们 UA 里都含 Chrome 字段）
  if (/Edg\//i.test(ua)) return 'edge'
  if (/OPR\/|Opera/i.test(ua)) return 'opera'
  if (/Firefox\//i.test(ua)) return 'firefox'
  if (/Chrome\//i.test(ua)) return 'chrome'
  if (/Safari\//i.test(ua)) return 'safari'
  if (/MSIE 11|Trident/i.test(ua)) return 'ie11'
  return 'other'
}
