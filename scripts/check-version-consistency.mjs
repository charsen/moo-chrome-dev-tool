#!/usr/bin/env node
// 检查仓库内所有提到「当前版本号」的位置是否一致。
//
// 来源 of truth：package.json#version。
// 检查点：
//   1. manifest.json#version 必须 === package.json#version
//   2. docs/ZENTAO_SETUP.md / README.md 等不应**硬写**老版本号 vN.N.N
//      （历史 changelog 段除外 —— CHANGELOG / HANDOFF 里列旧版本号是合法的）
//
// 落地：pre-commit + CI 都跑。命中老版本号硬写 → fail。
//
// 这个脚本是 v0.4.4 复盘的产物 —— ZENTAO_SETUP 还指 v0.3.0 让同事下错版本，
// 该类问题靠自动化挡住，不靠人脑记。

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const currentVersion = pkg.version
if (!currentVersion) {
  console.error('package.json 缺 version 字段')
  process.exit(1)
}

console.log(`当前版本：v${currentVersion}`)

const errors = []

// ---- 检查 1：manifest.json ----
const manifestRaw = readFileSync(resolve(root, 'manifest.json'), 'utf8')
const mfMatch = manifestRaw.match(/"version"\s*:\s*"([^"]+)"/)
if (!mfMatch) {
  errors.push('manifest.json 没找到 version 字段')
} else if (mfMatch[1] !== currentVersion) {
  errors.push(`manifest.json#version (${mfMatch[1]}) 跟 package.json#version (${currentVersion}) 不一致`)
} else {
  console.log(`✓ manifest.json v${mfMatch[1]}`)
}

// ---- 检查 2：docs/ZENTAO_SETUP.md 和 README 不应**指引下载**老版本 ----
//
// 这是 v0.4.4 复盘的核心痛点 —— ZENTAO_SETUP 还说「建议用 v0.3.0...latest = v0.3.0」让同事
// 按链接下错版本。允许的「历史性引用」（讨论 feature 演进，例：「v0.3.0 起历史 Tab...」）
// 不算坑，因为不引导下载。
//
// 检查方法：grep 「指引下载老版本」的高风险表达式：
//   - releases/download/vN.N.N/moo-chrome-dev-tool-N.N.N.zip 这种硬链接
//   - 「当前 latest = vN.N.N」「建议用 vN.N.N」这种带 marker 词的
//
// 注意：CHANGELOG.md 含所有版本号链接是合法的（changelog 性质，每条都该指向对应版本）。

const FORBIDDEN_DOWNLOAD_FILES = ['docs/ZENTAO_SETUP.md', 'README.md', 'README.en.md']
const DOWNLOAD_PATTERN = /releases\/download\/v(\d+\.\d+\.\d+)\//g
const RECOMMEND_PATTERN = /(?:当前\s*latest\s*=|建议用|推荐用|当前版本是)[\s*]*v(\d+\.\d+\.\d+)/g

for (const f of FORBIDDEN_DOWNLOAD_FILES) {
  let content
  try { content = readFileSync(resolve(root, f), 'utf8') } catch { continue }
  const stale = new Set()
  let m
  DOWNLOAD_PATTERN.lastIndex = 0
  while ((m = DOWNLOAD_PATTERN.exec(content)) !== null) {
    if (m[1] !== currentVersion) stale.add(m[1])
  }
  RECOMMEND_PATTERN.lastIndex = 0
  while ((m = RECOMMEND_PATTERN.exec(content)) !== null) {
    if (m[1] !== currentVersion) stale.add(m[1])
  }
  if (stale.size > 0) {
    errors.push(
      `${f} 含「指引下载老版本」表达式 v${[...stale].join(', v')}（当前 v${currentVersion}）。` +
      `历史性引用（讨论 feature 演进）OK；但硬下载链接 / 「建议用 vX.Y.Z」要更新到 v${currentVersion}`
    )
  }
}

// ---- 检查 3：CHANGELOG / HANDOFF 顶部段必须有当前版本号 ----
const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8')
if (!new RegExp(`##\\s+v${currentVersion.replace(/\./g, '\\.')}\\b`).test(changelog)) {
  errors.push(`CHANGELOG.md 没找到 ## v${currentVersion} 段（发版前必须先写 CHANGELOG）`)
} else {
  console.log(`✓ CHANGELOG.md 含 ## v${currentVersion}`)
}

try {
  const handoff = readFileSync(resolve(root, 'HANDOFF.md'), 'utf8')
  if (!handoff.includes(`v${currentVersion}`)) {
    errors.push(`HANDOFF.md 没提 v${currentVersion}（一句话现状段应该更新到新版号）`)
  } else {
    console.log(`✓ HANDOFF.md 含 v${currentVersion}`)
  }
} catch {
  // HANDOFF.md 不存在不强制
}

// ---- 检查 4：⌘⇧B / Ctrl+Shift+B 这种过期快捷键文案不应再出现 ----
//
// manifest.json#commands 是 ground truth。v0.3.1 复盘发现 5 处文档/注释还写 ⌘⇧B 没改。
// v0.4.4 大复盘清干净 — 这里加规则挡住未来复发。
// CHANGELOG / HANDOFF / handoff-archive 含 ⌘⇧B 是合法的（历史文档，记述当时表述）
// 只检查活文档 / 代码 / 注释里复发的过期快捷键描述
try {
  const out = execSync(
    `git grep -lE '⌘⇧B|⌘\\+⇧\\+B|Ctrl\\+Shift\\+B|Cmd\\+Shift\\+B' -- ` +
    `':!CHANGELOG.md' ':!HANDOFF.md' ':!docs/handoff-archive/' ` +
    `':!scripts/check-version-consistency.mjs' ':!CLAUDE.md' || true`,
    { cwd: root, encoding: 'utf8' }
  ).trim()
  if (out) {
    errors.push(
      `活文档 / 代码里还有 ⌘⇧B / Ctrl+Shift+B 文案（manifest.json 实际没注册）：\n  ` +
      out.split('\n').join('\n  ')
    )
  } else {
    console.log('✓ 无过期 ⌘⇧B 快捷键文案（活文档 + 代码）')
  }
} catch {
  // git 不可用时不检查
}

if (errors.length > 0) {
  console.error('\n❌ 一致性检查失败：')
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

console.log('\n✓ 全部一致性检查通过')
