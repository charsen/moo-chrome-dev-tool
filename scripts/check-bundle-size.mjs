#!/usr/bin/env node
// dist/ bundle size 阈值守门员。
//
// 防 chunk 突然爆涨（依赖膨胀 / accidental import / large image inline）。
// 当前基线（v0.4.4）：dist/ 总 ~576KB；最大 chunk Panel ~57KB / styles ~57KB / vue runtime ~69KB。
//
// 阈值定的相对宽松，留头允许正常 feature 增加；突破就 fail 提醒人评估。

import { readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const distDir = resolve(root, 'dist')

const TOTAL_LIMIT = 1024 * 1024  // 1 MB 总大小（当前 576KB，留 1.7x 头）
const SINGLE_FILE_LIMIT = 150 * 1024  // 150 KB 单 chunk（当前最大 ~69KB，留 2x 头）

function walkSize(dir) {
  let total = 0
  const files = []
  function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      const s = statSync(p)
      if (s.isDirectory()) walk(p)
      else {
        total += s.size
        files.push({ path: p.replace(distDir + '/', ''), size: s.size })
      }
    }
  }
  walk(dir)
  return { total, files }
}

let result
try {
  result = walkSize(distDir)
} catch (e) {
  console.error('dist/ 不存在，先跑 pnpm build')
  process.exit(1)
}

console.log(`dist/ 总大小: ${(result.total / 1024).toFixed(1)} KB`)
console.log(`阈值: 总 ${TOTAL_LIMIT / 1024} KB / 单文件 ${SINGLE_FILE_LIMIT / 1024} KB`)

const errors = []

if (result.total > TOTAL_LIMIT) {
  errors.push(`总大小超阈值：${(result.total / 1024).toFixed(1)} KB > ${TOTAL_LIMIT / 1024} KB`)
}

const big = result.files.filter(f => f.size > SINGLE_FILE_LIMIT && !f.path.endsWith('.png') && !f.path.endsWith('.jpg'))
if (big.length > 0) {
  errors.push(
    `单文件超阈值：\n  ` +
    big.map(f => `${f.path} = ${(f.size / 1024).toFixed(1)} KB`).join('\n  ')
  )
}

// Top 5 最大 chunks 信息用（不算 fail）
const sortedFiles = [...result.files].sort((a, b) => b.size - a.size).slice(0, 5)
console.log(`\nTop 5 chunks:`)
for (const f of sortedFiles) {
  console.log(`  ${(f.size / 1024).toFixed(1).padStart(7)} KB  ${f.path}`)
}

if (errors.length > 0) {
  console.error('\n❌ bundle size 守门员失败：')
  for (const e of errors) console.error(`  - ${e}`)
  console.error(`\n💡 突破阈值通常意味：① 新加了大依赖 ② 误把图片 inline ③ 没 lazy load。`)
  console.error(`如果是合理增长，去 scripts/check-bundle-size.mjs 调阈值。`)
  process.exit(1)
}

console.log('\n✓ bundle size 在阈值内')
