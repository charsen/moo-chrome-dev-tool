// 发版打包 + 可选发布。
//
// 模式：
//   pnpm release                          → dry-run：纯打印「会做啥」清单（不 build / 不写盘）
//   pnpm release --publish                → 真发：e2e + build + zip + sha256 + tag + push + Gitee create-release + 上传
//   pnpm release --publish --skip-e2e     → 紧急 hotfix 跳 e2e（dogfood 阻塞场景）
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
//
// 认证方式说明（v0.4.8 后整理）：
//   - git push / git tag：走 git 协议。当 remote 是 SSH（git@gitee.com:...）时用 SSH key 自动认证；
//     HTTPS remote 走 credential helper（HTTPS 密码 / PAT），用 SSH 后**完全不需要 token**。
//   - Step 5 Gitee REST API（POST /api/v5/repos/.../releases + attach_files）：**必须 token**，
//     SSH key 在 REST API 上没用。token 最小权限范围可以缩到「projects:write」/「releases」。
//   建议：remote 用 SSH（`git remote set-url origin git@gitee.com:OWNER/REPO.git`）+ token 仅作 API 用。

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync, openAsBlob, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// ---------- 参数解析 ----------
const argv = process.argv.slice(2)
const publish = argv.includes('--publish')
const skipBuild = argv.includes('--skip-build')
// v0.5.1：默认 --publish 时跑 e2e（之前发版前必跑 e2e 是人脑承诺无机器化）。
// 紧急 hotfix 可用 --skip-e2e 跳过（同事 dogfood 阻塞场景）。
const skipE2E = argv.includes('--skip-e2e')
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
    // v0.5.1：提示 PII 流程顺序（PII 检查在下面 — 如果你刚脱敏过命中词，脏树是正常的）
    console.error('提示：如果你刚做完 PII 脱敏出现脏树，先 commit 这些脱敏改动再重跑 pnpm release。')
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
// v0.4.5：扩展覆盖到 yaml workflow / shell 脚本 / html / css / txt / sh 等。
// 之前漏了这些 → .github/workflows/*.yml、scripts/*.sh、src/styles/*.css 都不会被 PII 扫到
const PII_INCLUDE_EXTS = ['md', 'ts', 'tsx', 'vue', 'json', 'mjs', 'js', 'yml', 'yaml', 'html', 'sh', 'css', 'txt']
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
  // v0.5.1：改 git grep — respect .gitignore + 不扫 release/ / dist/ / .test-output/ 等
  // ignored 路径。之前 grep -rEn 会扫 ignored 假阳（test 残留 / build artifact）
  const pathspecs = PII_INCLUDE_EXTS.map((e) => `'*.${e}'`).join(' ')
  const grepPattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  let raw = ''
  try {
    raw = execSync(
      `git grep -nE "${grepPattern}" -- ${pathspecs} 2>/dev/null || true`,
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

// ---------- pre-flight 模式扫描（warn-only，找潜在未知 PII）----------
// 起因：v0.4.0 复盘 — 黑名单只能拦「已知」，遇到没列进词表的真名/手机号/内部 IP 漏网。
// 这段扫常见 PII 模式，命中只 warn 不 abort（假阳率高，靠人工审）。
// MOO_RELEASE_SKIP_PII_PATTERN=1 完全跳过；MOO_RELEASE_PII_VERBOSE=1 打印每条命中细节。
const PII_PATTERN_CHECKS = [
  {
    name: '可疑手机号（11 位 1[3-9] 开头）',
    regex: '\\b1[3-9][0-9]{9}\\b',
    // 整行包含占位号即跳过（138/139 + 全 0 / 全 1）
    allowlistRegex: '(138|139)(00000000|11111111)'
  },
  {
    name: '可疑邮箱（@非 example/anthropic/noreply/gitee 等公共服务域）',
    regex: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.(com|cn|net|org|edu)',
    // 整行包含 allowlist 模式即跳过。
    // v0.4.5：去掉 gmail/qq/163/126/sina —— 之前这些是 free-mail provider 全 allowlist，
    // 同事用 gmail/QQ/163 的真名邮箱直接绕过 PII 扫，跟 hard rule 冲突。
    // 真人 gmail 应该入 .release-pii-deny 黑名单（按具体地址匹配，不靠域 allowlist）。
    // 保留：example（文档示例域）/ anthropic/sentry.io/gitee.com/github.com（服务方域）/
    //       noreply（机器人提交方常用）/ huawei（公司域举例 — 你公司域应保留）/ user|alice|bob|admin|test 测试占位前缀
    allowlistRegex: '@(example\\.|anthropic\\.|noreply|huawei\\.|sentry\\.io|gitee\\.com|github\\.com)|(user|alice|bob|admin|test)@'
  },
  {
    name: '私网 IP（192.168 / 10.x / 172.16-31）',
    regex: '\\b(192\\.168|10\\.[0-9]+|172\\.(1[6-9]|2[0-9]|3[01]))\\.[0-9]+\\.[0-9]+\\b'
  },
  {
    name: '身份证号（18 位）',
    regex: '\\b[1-9][0-9]{16}[0-9Xx]\\b'
  }
]

function runPiiPatternScan() {
  if (process.env.MOO_RELEASE_SKIP_PII_PATTERN) {
    console.warn('⚠ MOO_RELEASE_SKIP_PII_PATTERN=1 已设，跳过模式扫描')
    console.warn('')
    return
  }
  const verbose = !!process.env.MOO_RELEASE_PII_VERBOSE
  const exts = PII_INCLUDE_EXTS.map((e) => `--include=*.${e}`).join(' ')
  const summaries = []
  for (const check of PII_PATTERN_CHECKS) {
    let raw = ''
    try {
      raw = execSync(
        `grep -rEn ${exts} "${check.regex}" . 2>/dev/null || true`,
        { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
      )
    } catch {}
    let lines = raw.split('\n').filter(Boolean)
      .filter((line) => !PII_EXCLUDE_PATH_PATTERNS.some((p) => line.includes(p)))
    if (check.allowlistRegex) {
      // grep 整行 + matched 部分二次 regex；为简化，只对整行做 allowlist match（false-negative 风险低）
      const allow = new RegExp(check.allowlistRegex)
      lines = lines.filter((l) => !allow.test(l))
    }
    if (lines.length > 0) summaries.push({ name: check.name, lines })
  }
  if (summaries.length === 0) {
    console.log('✓ pre-flight 模式扫描通过（4 类潜在 PII 模式无可疑命中）')
    console.log('')
    return
  }
  const total = summaries.reduce((sum, s) => sum + s.lines.length, 0)
  console.warn(`⚠ pre-flight 模式扫描命中 ${total} 条潜在 PII（仅 warn 不 abort，假阳率高人工审）`)
  for (const s of summaries) {
    console.warn(`  ✦ ${s.name}: ${s.lines.length} 处`)
    const show = verbose ? s.lines : s.lines.slice(0, 2)
    for (const l of show) console.warn(`    | ${l}`)
    if (!verbose && s.lines.length > 2) console.warn(`    | ...（共 ${s.lines.length} 条，MOO_RELEASE_PII_VERBOSE=1 看全部）`)
  }
  console.warn('  如果都是占位 / 已知假阳，照常发版。')
  console.warn('  确认是真 PII：加进 .release-pii-deny + 走 filter-repo 清 history。')
  console.warn('')
}
runPiiPatternScan()

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

// ---------- e2e 预跑（v0.5.1 加）----------
// 之前发版前必跑 e2e 是人脑承诺无机器化（RELEASE_TEST_CHECKLIST 写了但靠记忆）。
// 现在默认 --publish 走 e2e，紧急 hotfix 可 --skip-e2e 跳过。dry-run 不跑（开发体验）
if (publish && !skipE2E) {
  console.log('━━━ pre-build e2e 预跑（v0.5.1 加，跳用 --skip-e2e）━━━')
  try {
    execSync('pnpm test:e2e', { cwd: root, stdio: 'inherit' })
  } catch {
    console.error('❌ e2e 失败 — release 中止。修完 e2e 再重跑，或紧急 hotfix 用 --skip-e2e')
    process.exit(1)
  }
}

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

// v0.7.3：dev 产物检测 — `pnpm dev` 留下的 service-worker-loader.js 长这样：
//   import 'http://localhost:5273/@vite/env'
//   import 'http://localhost:5273/@crx/client-worker'
//   import 'http://localhost:5273/src/background/index.ts'
// 装上后 SW registration 立刻炸（v0.7.1 用户撞过）。--skip-build 或者 pnpm dev
// 后没 pnpm build 都可能进 release zip。
// v0.7.4：扫范围从 SW loader 一个文件扩到全 dist（content loader / popup html /
//        devtools html / chunks 也可能在 dev 模式下含 localhost 引用 — 同款扫）
const DEV_MARKERS = ['localhost:5273', '@vite/env', '@crx/client-worker', '@vite/client']
function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) yield* walkFiles(path)
    else if (entry.isFile() && /\.(js|html)$/.test(entry.name)) yield path
  }
}
const devArtifactHits = []
for (const filePath of walkFiles(distDir)) {
  const content = readFileSync(filePath, 'utf-8')
  for (const marker of DEV_MARKERS) {
    if (content.includes(marker)) {
      devArtifactHits.push({ file: filePath.replace(distDir, 'dist'), marker })
      break  // 一个文件命中一个 marker 就够，不重复列
    }
  }
}
if (devArtifactHits.length > 0) {
  console.error('🔴 dist/ 含 dev 产物特征（pnpm dev 留下的 HMR import），装上后 chrome 立刻炸：')
  for (const hit of devArtifactHits) console.error(`   - ${hit.file}（命中 "${hit.marker}"）`)
  console.error('   修法：跑 `pnpm build` 重新出 prod dist/ 再 release。')
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
// v0.4.9：remote 是 SSH 时预检连通性（v0.4.8 remote 切 SSH 后才有意义；HTTPS 跳过）。
// 之前 push 失败已经 build+zip 完，污染 release/。预检 fail 立即 abort，省 zip 步骤
try {
  const remoteUrl = execSync('git remote get-url origin', { cwd: root, encoding: 'utf8' }).trim()
  if (remoteUrl.startsWith('git@')) {
    // ssh -T -o BatchMode=yes -o ConnectTimeout=5 git@gitee.com
    // gitee 即使成功也 exit 1（"GITEE.COM does not provide shell access"），但 stderr 含 "successfully authenticated"
    let sshOk = false
    try {
      execSync('ssh -T -o BatchMode=yes -o ConnectTimeout=5 git@gitee.com', { cwd: root, encoding: 'utf8', stdio: 'pipe' })
      sshOk = true
    } catch (e) {
      const stderr = e && e.stderr ? String(e.stderr) : ''
      if (/successfully authenticated/i.test(stderr)) sshOk = true
    }
    if (!sshOk) {
      console.error('❌ SSH 预检失败：跑 ssh -T git@gitee.com 看是否能连通。可能 SSH key 没在 ~/.ssh 或没注册到 Gitee')
      process.exit(1)
    }
    console.log('✓ SSH 连通性预检通过')
  }
} catch (e) {
  console.warn('⚠ SSH 预检跳过（remote 解析失败）：', e.message)
}
// 检查 tag 是否已存在（本地），存在就跳过创建免重复
let tagExists = false
try {
  execSync(`git rev-parse ${tagName}`, { cwd: root, stdio: 'pipe' })
  tagExists = true
} catch {
  // 不存在
}
// v0.5.1：记录本次脚本是否真新建了 tag（不是已存在）—— push 失败时 rollback 用
let tagCreatedByThisRun = false
if (tagExists) {
  console.log(`tag ${tagName} 已存在（本地），跳过 git tag -a`)
} else {
  console.log(`创建 annotated tag ${tagName}`)
  execSync(`git tag -a ${tagName} -F -`, { cwd: root, input: tagMessage })
  tagCreatedByThisRun = true
}
console.log('推送 master + tags …')
try {
  execSync('git push origin master --tags', { cwd: root, stdio: 'inherit' })
} catch (e) {
  // v0.5.1：push 失败 rollback —— 之前本地 tag + zip 已建，重跑撞 462 行「tag 已存在跳过」
  //   → Gitee release 关联到远端不存在的 tag。现在主动 cleanup
  console.error('❌ git push 失败')
  if (tagCreatedByThisRun) {
    console.log(`回滚本次创建的本地 tag ${tagName}…`)
    try { execSync(`git tag -d ${tagName}`, { cwd: root, stdio: 'inherit' }) } catch { /* best-effort */ }
  }
  console.log(`清理本次产物 release/${zipName}*…`)
  try {
    if (existsSync(resolve(root, 'release', zipName))) rmSync(resolve(root, 'release', zipName))
    if (existsSync(resolve(root, 'release', `${zipName}.sha256.txt`))) rmSync(resolve(root, 'release', `${zipName}.sha256.txt`))
    if (existsSync(resolve(root, 'release', `${zipName}.sha256`))) rmSync(resolve(root, 'release', `${zipName}.sha256`))
  } catch { /* ignore */ }
  console.error('请排查 git push 失败原因（SSH key / 权限 / 网络）后重跑 pnpm release --publish')
  process.exit(1)
}
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
// v0.5.1：attach_files 任一失败立即 abort（之前 return false 不阻塞 → 同事按提示更新 HANDOFF 但 zip 没传完）
const zipOk = await attachFile(releaseId, zipPath)
if (!zipOk) {
  console.error(`❌ release zip 上传失败。release ${tagName} 已创建但**没有 zip 文件**。`)
  console.error(`手动补救：去 https://gitee.com/${owner}/${repo}/releases/${tagName} 点「上传附件」`)
  console.error(`本地文件：${zipPath}`)
  process.exit(1)
}
const shaOk = await attachFile(releaseId, sha256TxtPath)
if (!shaOk) {
  console.error(`❌ sha256.txt 上传失败。zip 已上传 OK，仅 sha256 缺。`)
  console.error(`手动补救：去 https://gitee.com/${owner}/${repo}/releases/${tagName} 点「上传附件」`)
  console.error(`本地文件：${sha256TxtPath}`)
  process.exit(1)
}

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
