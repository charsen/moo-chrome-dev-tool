// 发版打包：跑 build → 把 dist/ 打成 release/moo-chrome-dev-tool-<version>.zip。
// 不动 git——tag / push 由人主导，避免脚本误推。
//
// 用法:
//   pnpm release
//
// 输出:
//   release/moo-chrome-dev-tool-<version>.zip   ← 整包，给别人下载后解压加载
//   release/moo-chrome-dev-tool-<version>.sha256
//
// 版本号取 package.json 的 version。同步到 manifest.json（避免两边漂移）。

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync, createWriteStream } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const version = pkg.version
if (!version) {
  console.error('package.json 缺 version 字段')
  process.exit(1)
}

// 同步 manifest 版本号
const manifestPath = resolve(root, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.version !== version) {
  console.log(`同步 manifest.json: ${manifest.version} → ${version}`)
  manifest.version = version
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

// 清空旧 dist 后重建，避免上次构建残留进 zip
const distDir = resolve(root, 'dist')
if (existsSync(distDir)) {
  console.log('清理旧 dist/')
  rmSync(distDir, { recursive: true, force: true })
}
console.log('运行 vite build…')
execSync('pnpm build', { cwd: root, stdio: 'inherit' })

if (!existsSync(resolve(distDir, 'manifest.json'))) {
  console.error('build 没产出 dist/manifest.json，中止')
  process.exit(1)
}

// 输出目录
const releaseDir = resolve(root, 'release')
mkdirSync(releaseDir, { recursive: true })

const zipName = `moo-chrome-dev-tool-${version}.zip`
const zipPath = resolve(releaseDir, zipName)
if (existsSync(zipPath)) rmSync(zipPath)

// 用系统 zip 命令打包（macOS / Linux 自带，跨平台依赖少）
// -r 递归、-X 不存 macOS 扩展属性、-q 安静
console.log(`打包 → release/${zipName}`)
execSync(`zip -r -X -q "${zipPath}" .`, { cwd: distDir })

const stat = statSync(zipPath)
const hash = createHash('sha256').update(readFileSync(zipPath)).digest('hex')
writeFileSync(resolve(releaseDir, `${zipName}.sha256`), `${hash}  ${zipName}\n`)

console.log('')
console.log(`✓ ${zipName}  ${(stat.size / 1024).toFixed(1)} KB`)
console.log(`  sha256: ${hash}`)
console.log('')
console.log('下一步（手工）：')
console.log(`  git add -A && git commit -m "chore: release v${version}"`)
console.log(`  git tag -a v${version} -m "release v${version}"`)
console.log(`  git push && git push --tags`)
console.log(`  → 上传 ${zipName} 到 Gitee 发行版页面`)
