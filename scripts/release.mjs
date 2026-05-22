// 发版打包 + 可选发布。
//
// 模式：
//   pnpm release                          → dry-run：纯打印「会做啥」清单（不 build / 不写盘）
//   pnpm release --publish                → 真发：build + zip + sha256 + tag + push + Gitee create-release + 上传
//   pnpm release --skip-build             → 仍是 dry-run，只是连「会跑 build」那行都不打印
//   pnpm release --publish --skip-build   → 真发但跳 vite build（用现有 dist/）
//
// 设计原则：
// - 默认 dry-run，防误推；dry-run 绝不真 build / 不真写 zip / sha256（之前 P1 bug：名不副实，污染 working tree）
// - tag/push/Gitee API 都搬进来，下次换人换 AI 不靠记忆贴 bash
// - dry-run 会预检 git tag v$VERSION 是否已存在 —— 已存在就 warn，提示先 bump 版本号
// - Gitee POST 不重试：可能已成功，重试会拿到 400「该标签已存在发行版」
// - GITEE_TOKEN 只从 env 读，绝不写盘、不打 log、不进 commit
// - HANDOFF.md / CHANGELOG 收尾留给用户手动判断，脚本只打提示

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync, openAsBlob } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// ---------- 参数解析 ----------
const argv = process.argv.slice(2)
const publish = argv.includes('--publish')
const skipBuild = argv.includes('--skip-build')
const dryRun = !publish // 默认 dry-run

// ---------- 版本号：package.json + manifest.json 双读校验一致 ----------
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const version = pkg.version
if (!version) {
  console.error('package.json 缺 version 字段')
  process.exit(1)
}

const manifestPath = resolve(root, 'manifest.json')
const manifestRaw = readFileSync(manifestPath, 'utf8')
const mfMatch = manifestRaw.match(/"version"\s*:\s*"([^"]+)"/)
const manifestVersion = mfMatch ? mfMatch[1] : null
if (manifestVersion && manifestVersion !== version) {
  // 不再像旧脚本那样静默改写 —— 发版前两边必须显式一致，避免脚本帮人吞掉错误
  console.error(`版本号不一致：package.json=${version}  manifest.json=${manifestVersion}`)
  console.error('请手动对齐后重跑（两个文件都应当是新版号）。')
  process.exit(1)
}

// ---------- owner/repo：从 git remote 解析，不硬编码 ----------
function parseRepo() {
  let url = ''
  try {
    url = execSync('git remote get-url origin', { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    console.error('无法 git remote get-url origin —— 不在 git 仓库 / 无 remote')
    process.exit(1)
  }
  // 支持 https://gitee.com/owner/repo(.git) 和 git@gitee.com:owner/repo(.git)
  const m = url.match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?$/)
  if (!m) {
    console.error(`origin 解析失败：${url}`)
    process.exit(1)
  }
  return { owner: m[1], repo: m[2] }
}
const { owner, repo } = parseRepo()

// ---------- 工作区干净检查（dry-run 也要查，否则 zip 跟未来真发对不上）----------
if (!process.env.MOO_RELEASE_FORCE) {
  let dirty = ''
  try {
    dirty = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' })
  } catch {
    // 不在 git 仓库 —— 跳过
  }
  if (dirty.trim()) {
    console.error('工作区有未提交的改动，先 commit 再 release（避免 zip 和 git tag 不一致）：')
    console.error(dirty.trim().split('\n').map((l) => '  ' + l).join('\n'))
    console.error('真的要带脏树发版，可设 MOO_RELEASE_FORCE=1 跳过。')
    process.exit(1)
  }
}

// ---------- pre-flight 脱敏检查（dry-run + publish 都跑）----------
// 起因：v0.4.0 发版时把同事真名写进 commit / CHANGELOG / Gitee release page，用户要求撤回重发。
// 规则见 CLAUDE.md「🔴 发版信息脱敏」。命中即 abort；紧急时可 MOO_RELEASE_SKIP_PII_CHECK=1 绕过。
//
// 黑名单词来源：`.release-pii-deny`（gitignored，本地维护，不入仓库）。
// 没设词表 fallback `.release-pii-deny.example`（占位演示，仓库自带）。
// 设计原因：黑名单词本身就是真 PII，写进 release.mjs 等于把要脱的内容塞进公开仓库。
const PII_DENY_FILE = resolve(root, '.release-pii-deny')
const PII_DENY_EXAMPLE_FILE = resolve(root, '.release-pii-deny.example')
const PII_INCLUDE_EXTS = ['md', 'ts', 'tsx', 'vue', 'json', 'mjs', 'js']
const PII_EXCLUDE_PATH_PATTERNS = [
  'node_modules/',
  'dist/',
  'release/',
  '.test-output',
  '/.git/',
  // example 文件含占位演示词，自身不算命中
  './.release-pii-deny.example'
]

function loadPiiDenyTerms() {
  const candidate = existsSync(PII_DENY_FILE)
    ? PII_DENY_FILE
    : existsSync(PII_DENY_EXAMPLE_FILE)
      ? PII_DENY_EXAMPLE_FILE
      : null
  if (!candidate) return { terms: [], source: null }
  const text = readFileSync(candidate, 'utf8')
  const terms = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
  return { terms, source: candidate }
}

function preFlightPiiCheck() {
  if (process.env.MOO_RELEASE_SKIP_PII_CHECK) {
    console.warn('⚠ MOO_RELEASE_SKIP_PII_CHECK=1 已设，跳过脱敏检查（紧急通道）')
    console.warn('')
    return
  }
  const { terms, source } = loadPiiDenyTerms()
  if (terms.length === 0) {
    console.warn('⚠ 未找到 .release-pii-deny 或 .release-pii-deny.example，跳过脱敏检查')
    console.warn('  建议：cp .release-pii-deny.example .release-pii-deny ，加入你需要脱敏的真词')
    console.warn('')
    return
  }
  const relSource = source.replace(root + '/', '')
  if (source === PII_DENY_EXAMPLE_FILE) {
    console.warn(`⚠ 正在用 ${relSource} 作为脱敏词表（fallback）`)
    console.warn('  建议：cp .release-pii-deny.example .release-pii-deny  然后加入你需要脱敏的真词')
    console.warn('')
  }
  const includeArgs = PII_INCLUDE_EXTS.map((e) => `--include=*.${e}`).join(' ')
  // 词里若含 grep ERE 元字符，转义掉
  const grepPattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  let raw = ''
  try {
    raw = execSync(
      `grep -rEn ${includeArgs} "${grepPattern}" . 2>/dev/null || true`,
      { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
    )
  } catch {
    // grep 找不到时已通过 || true 兜底，这里再 catch 一次保险
  }
  const hits = raw
    .split('\n')
    .filter(Boolean)
    .filter((line) => !PII_EXCLUDE_PATH_PATTERNS.some((p) => line.includes(p)))
  if (hits.length > 0) {
    console.error('━━━ ⛔ pre-flight 脱敏检查命中 ━━━')
    console.error(`词表来源: ${relSource}（${terms.length} 词）`)
    console.error('以下文件含黑名单词，发版前必须脱敏：')
    console.error('')
    for (const l of hits) console.error('  ' + l)
    console.error('')
    console.error('脱敏对照表见 CLAUDE.md「🔴 发版信息脱敏」。')
    console.error('真要跳（不推荐），重跑：MOO_RELEASE_SKIP_PII_CHECK=1 pnpm release ...')
    process.exit(1)
  }
  console.log(`✓ pre-flight 脱敏检查通过（词表 ${relSource}, ${terms.length} 词，无命中）`)
  console.log('')
}
preFlightPiiCheck()

// ---------- --publish 模式 token 预检（fail-fast，省得 build 完才发现）----------
const token = process.env.GITEE_TOKEN || ''
if (publish && !token) {
  console.error('--publish 模式需要 Gitee token，请先：')
  console.error('  export GITEE_TOKEN=<你的 gitee 私人令牌>')
  console.error('用完去 gitee「私人令牌」页重置 token。')
  process.exit(1)
}

console.log(`版本：v${version}  仓库：${owner}/${repo}  模式：${publish ? 'PUBLISH（真发）' : 'DRY-RUN（默认）'}`)
console.log('')

// ---------- 路径 / 文件名常量（dry-run 也要用来打印「会做啥」）----------
const distDir = resolve(root, 'dist')
const releaseDir = resolve(root, 'release')
const zipName = `moo-chrome-dev-tool-${version}.zip`
const zipPath = resolve(releaseDir, zipName)
const sha256TxtPath = resolve(releaseDir, `${zipName}.sha256.txt`)

// ---------- CHANGELOG 抽当前版本段（给 Gitee release body 用 / dry-run 也打印长度）----------
function extractChangelogSection(v) {
  const changelogPath = resolve(root, 'CHANGELOG.md')
  if (!existsSync(changelogPath)) return ''
  const raw = readFileSync(changelogPath, 'utf8')
  // 抓 `## vX.Y.Z` 到下一个 `## v` 或文档末尾之间。
  // 注意：不用 `m` flag —— 否则 `$` 会匹配每行尾，非贪婪 `*?` 立刻 0 长度命中第一行末尾。
  // 用 `\n## v` 锚定段首，文档末尾用 `$` 配 RegExp 默认行为（= 字符串结尾）。
  const re = new RegExp(`\\n## v${v.replace(/\./g, '\\.')}\\s*\\n([\\s\\S]*?)(?=\\n## v|$)`)
  const m = raw.match(re)
  return m ? m[1].trim() : ''
}
const changelogSection = extractChangelogSection(version)

// ---------- Step 4 + 5 共用：tag 名 / message / release 元数据 ----------
const tagName = `v${version}`
const tagMessage = `${tagName} 发版

主要变更：见 CHANGELOG.md 当前版本段

完整 changelog: CHANGELOG.md`

const releaseBody = changelogSection || `v${version} 发版`
const releaseTitle = `v${version}`

// ---------- DRY-RUN 早返回：不 build / 不 zip / 不写 sha256，纯打印 ----------
// 起因：旧版「dry-run」名不副实 —— 完整跑 vite build、清 dist/、写 zip + sha256，
// 用户视角「试一下看看」代价远超预期还污染 working tree。
if (dryRun) {
  // 1) tag 预检：本地有 v$VERSION 就 warn，免得 --publish 才发现 tag 撞了
  let tagAlreadyExists = false
  try {
    const out = execSync(`git tag -l ${tagName}`, { cwd: root, encoding: 'utf8' }).trim()
    tagAlreadyExists = out === tagName
  } catch {
    // 不在 git 仓库或 git 命令失败 —— 跳过，不阻塞 dry-run
  }
  if (tagAlreadyExists) {
    console.warn(`⚠️  tag ${tagName} 已存在（本地）。直接 --publish 会在 Step 4 撞失败（或 push 失败）。`)
    console.warn('   先 bump package.json + manifest.json 版本号再跑。')
    console.warn('')
  }

  if (!changelogSection) {
    console.warn(`⚠ CHANGELOG.md 没找到 ## v${version} 段，真发时 release body 会是空的`)
    console.warn('')
  }

  console.log('━━━ DRY-RUN 会做的事（不真 build / 不写盘）━━━')
  console.log('')
  console.log('Step 3 — build + 打包 + 校验和:')
  if (skipBuild) {
    console.log('  （--skip-build：会跳过 vite build，直接用现有 dist/）')
    if (!existsSync(distDir)) {
      console.warn('  ⚠ dist/ 当前不存在；--publish --skip-build 会在此 fail')
    }
  } else {
    console.log(`  rm -rf dist/    # 清旧 build`)
    console.log(`  pnpm build      # 即 vite build`)
  }
  console.log('  冒烟检查 dist/ 必需文件齐（manifest / service-worker-loader / popup / devtools / panel / offscreen）')
  console.log(`  zip -r -X -q release/${zipName} ./    # cwd=dist/`)
  console.log(`  sha256 算法 = node:crypto createHash('sha256')，写两份：`)
  console.log(`    release/${zipName}.sha256       # 兼容旧存档`)
  console.log(`    release/${zipName}.sha256.txt   # 上传给 Gitee`)
  console.log('')
  console.log('Step 4 — git tag + push:')
  console.log(`  git tag -a ${tagName} -F -   # message 走 stdin`)
  console.log(`  git push origin master --tags`)
  console.log('  tag message:')
  console.log(tagMessage.split('\n').map((l) => '    ' + l).join('\n'))
  console.log('')
  console.log('Step 5 — Gitee Release API:')
  console.log(`  POST https://gitee.com/api/v5/repos/${owner}/${repo}/releases`)
  console.log(`    tag_name: ${tagName}`)
  console.log(`    name: ${releaseTitle}`)
  console.log(`    body: <CHANGELOG ## v${version} 段，${releaseBody.length} 字>`)
  console.log(`    target_commitish: master`)
  console.log(`  POST .../releases/{id}/attach_files (multipart)`)
  console.log(`    file: release/${zipName}`)
  console.log(`    file: release/${zipName}.sha256.txt`)
  console.log('')
  console.log(`token: ${token ? '已读到 GITEE_TOKEN（' + token.length + ' 字符，已 mask）' : '未设（真发时需 export GITEE_TOKEN=...）'}`)
  console.log('')
  console.log('要真发，重跑：pnpm release --publish')
  printNextSteps()
  process.exit(0)
}

// ---------- 以下都是 --publish 真发分支 ----------

// ---------- build ----------
if (!skipBuild) {
  if (existsSync(distDir)) {
    console.log('清理旧 dist/')
    rmSync(distDir, { recursive: true, force: true })
  }
  console.log('运行 vite build…')
  execSync('pnpm build', { cwd: root, stdio: 'inherit' })
} else {
  console.log('--skip-build：跳过 vite build，直接打包现有 dist/')
  if (!existsSync(distDir)) {
    console.error('dist/ 不存在，没法 --skip-build')
    process.exit(1)
  }
}

// ---------- 冒烟检查：dist 必需文件齐 ----------
// 起因：v0.1.1 因为 panel.html 没在 vite input 里、build 没产出，朋友装完打开 DevTools 一片空白。
const required = [
  'manifest.json',
  'service-worker-loader.js',
  'src/popup/index.html',
  'src/devtools/index.html',
  'src/devtools/panel.html',
  'src/offscreen/index.html'
]
const missing = required.filter((f) => !existsSync(resolve(distDir, f)))
if (missing.length > 0) {
  console.error('build 产物缺以下必需文件，中止发版：')
  for (const f of missing) console.error(`  - dist/${f}`)
  process.exit(1)
}

// ---------- 打包 + sha256 ----------
mkdirSync(releaseDir, { recursive: true })
if (existsSync(zipPath)) rmSync(zipPath)

console.log(`打包 → release/${zipName}`)
execSync(`zip -r -X -q "${zipPath}" .`, { cwd: distDir })

const stat = statSync(zipPath)
const hash = createHash('sha256').update(readFileSync(zipPath)).digest('hex')

// sha256 文件保留两个：旧的 .sha256（兼容已发存档）+ 新的 .sha256.txt（attach_files 上传给 Gitee）
// 内容 = `${sha256}  ${filename}\n`，shasum -c 兼容格式
const sha256Body = `${hash}  ${zipName}\n`
writeFileSync(resolve(releaseDir, `${zipName}.sha256`), sha256Body)
writeFileSync(sha256TxtPath, sha256Body)

console.log('')
console.log(`✓ ${zipName}  ${(stat.size / 1024).toFixed(1)} KB`)
console.log(`  sha256: ${hash}`)
console.log('')

if (!changelogSection) {
  console.warn(`⚠ CHANGELOG.md 没找到 ## v${version} 段，release body 会是空的`)
}

// ---------- 真发：Step 4 ----------
console.log('━━━ Step 4: git tag + push ━━━')
// 检查 tag 是否已存在（本地），存在就跳过创建免重复
let tagExists = false
try {
  execSync(`git rev-parse ${tagName}`, { cwd: root, stdio: 'pipe' })
  tagExists = true
} catch {
  // 不存在
}
if (tagExists) {
  console.log(`tag ${tagName} 已存在（本地），跳过 git tag -a`)
} else {
  console.log(`创建 annotated tag ${tagName}`)
  // tag message 走 -F -（从 stdin 读），避免多行 message 在不同 shell 下 escape 不一致
  execSync(`git tag -a ${tagName} -F -`, { cwd: root, input: tagMessage })
}
console.log('推送 master + tags …')
execSync('git push origin master --tags', { cwd: root, stdio: 'inherit' })
console.log('')

// ---------- 真发：Step 5 ----------
console.log('━━━ Step 5: Gitee create-release + attach_files ━━━')

const apiBase = `https://gitee.com/api/v5/repos/${owner}/${repo}`

/**
 * 创建 release。已知陷阱：响应可能 JSON parse fail（body 带控制字符）。
 * 不重试 POST —— 可能已成功，重 POST 会 400「该标签已存在发行版」。
 * parse 失败时立即调 list_releases 验证；存在拿 id 继续，不存在再 fail。
 */
async function createOrFindRelease() {
  console.log(`POST /releases  (tag=${tagName})`)
  const res = await fetch(`${apiBase}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({
      access_token: token,
      tag_name: tagName,
      name: releaseTitle,
      body: releaseBody,
      prerelease: false,
      target_commitish: 'master'
    })
  })
  const text = await res.text()
  if (res.ok) {
    try {
      const j = JSON.parse(text)
      console.log(`✓ release 创建成功，id=${j.id}`)
      return j.id
    } catch (e) {
      console.warn(`⚠ 响应 JSON parse 失败（${e.message}），但 HTTP ${res.status} —— 可能已创建，走 list_releases 核实`)
      return await findReleaseIdByTag()
    }
  }
  // 非 2xx：先看 list_releases，可能上一次部分成功
  console.warn(`⚠ POST 非 2xx：${res.status}  body: ${text.slice(0, 200)}`)
  console.warn('  走 list_releases 核实是否已存在')
  const id = await findReleaseIdByTag()
  if (id) return id
  console.error('create-release 失败且 list 里也没找到，中止。')
  process.exit(1)
}

async function findReleaseIdByTag() {
  // Gitee list_releases 分页，per_page 最大 100；这版本就在最新一页里，不分页
  const url = `${apiBase}/releases?access_token=${encodeURIComponent(token)}&page=1&per_page=20&direction=desc`
  const res = await fetch(url)
  if (!res.ok) {
    console.error(`list_releases HTTP ${res.status}`)
    return null
  }
  const list = await res.json()
  const hit = Array.isArray(list) ? list.find((r) => r.tag_name === tagName) : null
  if (hit) {
    console.log(`✓ list 里找到了，id=${hit.id}`)
    return hit.id
  }
  return null
}

async function attachFile(releaseId, filePath) {
  const fileName = filePath.split('/').pop()
  console.log(`POST /releases/${releaseId}/attach_files  (${fileName})`)
  const blob = await openAsBlob(filePath)
  const form = new FormData()
  form.append('access_token', token)
  form.append('file', blob, fileName)
  const res = await fetch(`${apiBase}/releases/${releaseId}/attach_files`, {
    method: 'POST',
    body: form
  })
  const text = await res.text()
  if (!res.ok) {
    console.error(`⚠ attach ${fileName} 失败：HTTP ${res.status}  ${text.slice(0, 200)}`)
    console.error('  attach_files 不会因为一个失败回滚另一个 —— 请去 gitee release 页面手动补传')
    return false
  }
  try {
    const j = JSON.parse(text)
    console.log(`  ✓ ${fileName}  ${j.browser_download_url || '(无下载链接字段)'}`)
  } catch {
    console.log(`  ✓ ${fileName}  (响应非 JSON 但 HTTP 200)`)
  }
  return true
}

const releaseId = await createOrFindRelease()
await attachFile(releaseId, zipPath)
await attachFile(releaseId, sha256TxtPath)

console.log('')
console.log('✓ Gitee release 发布完成')
printNextSteps()

// ---------- Step 6 + 7 提示（不代写，留给用户）----------
function printNextSteps() {
  console.log('')
  console.log('━━━ 下一步（人工判断，脚本不代写）━━━')
  console.log('')
  console.log('Step 6 — 同步 HANDOFF.md:')
  console.log('  - 「一句话现状」第一段更新到新版号')
  console.log(`  - 「这两周做了什么」加 v${version} 段`)
  console.log('  - **把上上版的「这两周做了什么」段移到 docs/handoff-archive/v0.1.x.md**')
  console.log('    （HANDOFF 主文件只保留当前未发 + 最近 1 个发版）')
  console.log('  - 如果跳了 RELEASE_TEST_CHECKLIST，把「发版决策小记」也更新')
  console.log('  - 划掉已完成的 todo')
  console.log('')
  console.log('Step 7 — 最后 commit:')
  console.log('  git add CHANGELOG.md HANDOFF.md docs/handoff-archive/')
  console.log(`  git commit -m "docs(handoff): v${version} 已发版 + ..."`)
  console.log('  git push origin master')
  console.log('')
  console.log('完事别忘了去 gitee「私人令牌」页重置 GITEE_TOKEN。')
}
