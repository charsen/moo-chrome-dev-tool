// 极简 mock 上报服务端，用于本地联调。
//
// 启动：
//   node scripts/mock-server.mjs
// 然后在 Moo DevTools "环境" Tab 把服务器 endpoint 配为：
//   http://localhost:8787/bugs/intake
// （本 mock 任意路径都收；/intake 结尾是正式协议的约定，见 docs/SERVER_INTEGRATION.md）
//
// 收到的 JSON 会原样回写控制台，截图保存到 ./mock-uploads/

import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = 8787
const UPLOAD_DIR = 'mock-uploads'

mkdirSync(UPLOAD_DIR, { recursive: true })

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, PUT, PATCH, OPTIONS')
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    console.log(`\n=== ${new Date().toISOString()} ${req.method} ${req.url} ===`)
    console.log('Headers:', req.headers)
    let parsed
    try { parsed = JSON.parse(body) } catch { parsed = null }

    if (parsed && typeof parsed.screenshot === 'string' && parsed.screenshot.startsWith('data:image')) {
      const [, b64] = parsed.screenshot.split(',')
      const filename = `bug-${Date.now()}.png`
      writeFileSync(join(UPLOAD_DIR, filename), Buffer.from(b64, 'base64'))
      console.log(`📷 截图已保存: ${UPLOAD_DIR}/${filename}`)
      parsed.screenshot = `<saved as ${filename}, ${b64.length} bytes>`
    }
    console.log('Body:', parsed ?? body)

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ id: `mock-${Date.now()}`, ok: true }))
  })
})

server.listen(PORT, () => {
  console.log(`Moo mock server listening on http://localhost:${PORT}`)
  console.log(`Endpoint: POST http://localhost:${PORT}/bugs/intake （任意路径都收）`)
})
