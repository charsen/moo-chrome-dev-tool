// 从 src/assets/eagle-source.jpg 生成 manifest 用的 16/32/48/128 PNG
// 以及悬浮球用的 96px PNG，最后套圆形 alpha mask。
//
// 用法:
//   pnpm icons
//
// 源图要求：方形（width === height），主体居中。
// - 方形源图下 fit:'cover' 直接走 resize，不做裁剪
// - 不得不传非方源图时，下面 CROP_POSITION 决定 cover 保留哪一侧
//   （早期版本用 sharp.strategy.attention 自动找重点，但黑底大块容易
//   误判，所以改成固定 position，输出确定可预测）

import { readFileSync, mkdirSync, existsSync, cpSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

let sharp
try {
  sharp = (await import('sharp')).default
} catch {
  console.error('未安装 sharp。请先执行: pnpm add -D sharp')
  process.exit(1)
}

const sourcePath = resolve(root, 'src/assets/eagle-source.jpg')
if (!existsSync(sourcePath)) {
  console.error(`找不到源图: ${sourcePath}`)
  process.exit(1)
}

const outDir = resolve(root, 'public/icons')
mkdirSync(outDir, { recursive: true })

const sourceBuf = readFileSync(sourcePath)

// 非方形源图 cover 时保留哪一侧。可选值：
//   'center' / 'top' / 'right' / 'bottom' / 'left'
//   'right top' / 'right bottom' / 'left top' / 'left bottom'
// 方形源图下不会触发裁剪，此值无影响。
const CROP_POSITION = 'center'

// 先把源图压成一张正方形 PNG（方形源图实质只是 resize，非方源图按
// CROP_POSITION 裁剪），供后续各尺寸缩放
const baseSize = 512
const meta = await sharp(sourceBuf).metadata()
if (meta.width !== meta.height) {
  console.warn(`⚠ 源图 ${meta.width}x${meta.height} 非方形，将按 position='${CROP_POSITION}' 裁剪`)
}
const squareBuf = await sharp(sourceBuf)
  .resize(baseSize, baseSize, { fit: 'cover', position: CROP_POSITION })
  .png()
  .toBuffer()

const sizes = [
  { size: 16, name: 'icon-16.png' },
  { size: 32, name: 'icon-32.png' },
  { size: 48, name: 'icon-48.png' },
  { size: 128, name: 'icon-128.png' },
  { size: 96, name: 'eagle-ball.png' } // 给悬浮球：44px 容器 × 2 DPR ≈ 88，给 96 留余量
]

function circleMask(size) {
  // 留半像素余量，避免边缘锯齿
  const r = size / 2
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/>
    </svg>`
  )
}

for (const { size, name } of sizes) {
  const out = resolve(outDir, name)
  await sharp(squareBuf)
    .resize(size, size)
    .composite([{ input: circleMask(size), blend: 'dest-in' }])
    .png()
    .toFile(out)
  console.log(`✓ ${size.toString().padStart(3)} → ${out}`)
}
console.log(`done. ${sizes.length} icons written to ${outDir}.`)

// 如果 dist/icons 存在（说明 pnpm dev 正在跑），顺手同步过去，避免 CRXJS 不监听 public/ 的坑
const distDir = resolve(root, 'dist/icons')
if (existsSync(distDir)) {
  cpSync(outDir, distDir, { recursive: true })
  console.log(`✓ synced to ${distDir}`)
}

