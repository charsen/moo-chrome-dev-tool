// 从 src/assets/eagle-source.jpg 自动方形裁剪（attention 策略聚焦鹰眼+喙），
// 生成 manifest 用的 16/32/48/128 PNG，以及悬浮球用的 96px PNG。
//
// 用法:
//   pnpm icons

import { readFileSync, mkdirSync, existsSync } from 'node:fs'
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

// 先把源图方形裁剪成一张高分辨率正方形 PNG，供后续各尺寸缩放
const baseSize = 512
const squareBuf = await sharp(sourceBuf)
  .resize(baseSize, baseSize, {
    fit: 'cover',
    position: sharp.strategy.attention // 自动定位"最有信息量"的区域（鹰眼/喙）
  })
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
