import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * 真机实测用的本地后端 + 页面。
 * - /            业务页（fetch / xhr / error / 元素 / 滚动）
 * - /mask        密码遮罩专用页（顶层 / 同源 iframe / open shadow 各一个密码框，坐标固定）
 * - /frame       同源 iframe 内容页
 * - /api/bug     webhook 接收端（JSON / multipart 都收；可控失败次数）
 * - /api/bug/:id/status-public   webhook 状态回查
 * - /api.php/...  最小 mock 禅道（login / users / projects / modules / bugs / file-ajaxUpload）
 */

export interface WebhookState {
  requests: Array<{ contentType: string; body: Buffer }>
  failFirstN: number
  remoteStatus: 'open' | 'in_progress' | 'done' | 'deleted'
}

export interface ZentaoState {
  logins: number
  bugPayloads: Array<Record<string, unknown>>
  uploads: Array<{ filename: string; bytes: number; hadCookie: boolean }>
  status: 'active' | 'resolved' | 'closed'
  token: string
}

export interface RealServer {
  port: number
  webhook: WebhookState
  zentao: ZentaoState
  close: () => Promise<void>
}

const MAIN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Moo 真机测试页</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 0; padding: 24px; background:#f8fafc; }
  h1 { font-size: 22px; }
  .spacer { height: 1400px; }
  button { margin-right: 8px; }
  #pwd { margin-top: 8px; }
</style></head>
<body>
  <h1 id="headline">Moo 真机测试页</h1>
  <p id="hint">这个页面用于验证采集、截图、标注、提交全链路。</p>
  <label>邮箱 <input id="email" type="text" value="dev@example.com"></label><br>
  <label>密码 <input id="pwd" type="password" value="real-secret-password"></label>
  <div id="shadow-host" style="margin-top:12px"></div>
  <iframe id="same-frame" src="/frame" style="width:360px;height:120px;border:1px solid #cbd5e1;margin-top:12px"></iframe>
  <p>
    <button id="btn-fetch">发 fetch</button>
    <button id="btn-xhr">发 XHR</button>
    <button id="btn-error">抛错误</button>
  </p>
  <div class="spacer"></div>
  <script>
    const host = document.getElementById('shadow-host')
    const sr = host.attachShadow({ mode: 'open' })
    sr.innerHTML = '<label>Shadow 密码 <input id="shadow-pwd" type="password" value="shadow-secret"></label>'
    document.getElementById('btn-fetch').onclick = () => fetch('/api/echo?token=secret-token', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer sk-test' },
      body: JSON.stringify({ password: 'p@ss', hello: 'world' })
    })
    document.getElementById('btn-xhr').onclick = () => {
      const x = new XMLHttpRequest(); x.open('GET', '/api/echo2'); x.send()
    }
    document.getElementById('btn-error').onclick = () => {
      console.error('真机错误 token=secret-token url=/x?access_token=abc')
      setTimeout(() => { throw new Error('真机 uncaught boom Bearer sk-live-123') })
    }
  </script>
</body></html>`

const MASK_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Moo mask</title>
<style>
  body { margin:0; padding:0; background:#ffffff; }
  .box { position:absolute; width:240px; height:32px; }
  #top-pwd { left:40px; top:120px; }
  #frame { left:40px; top:220px; width:360px; height:140px; border:1px solid #ccc; position:absolute; }
  #shadow-host { position:absolute; left:40px; top:420px; width:260px; height:40px; }
</style></head>
<body>
  <input id="top-pwd" class="box" type="password" value="top-secret">
  <iframe id="frame" src="/frame"></iframe>
  <div id="shadow-host"></div>
  <script>
    const host = document.getElementById('shadow-host')
    const sr = host.attachShadow({ mode: 'open' })
    sr.innerHTML = '<input id="shadow-pwd" type="password" value="shadow-secret" style="width:240px;height:32px">'
  </script>
</body></html>`

const FRAME_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>body{margin:0;padding:10px;background:#fff}input{width:200px;height:30px}</style></head>
<body><label>iframe 密码 <input id="frame-pwd" type="password" value="frame-secret"></label></body></html>`

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

export async function startRealServer(): Promise<RealServer> {
  const webhook: WebhookState = { requests: [], failFirstN: 0, remoteStatus: 'done' }
  const zentao: ZentaoState = { logins: 0, bugPayloads: [], uploads: [], status: 'active', token: 'token-real-machine' }

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const p = url.pathname

      if (req.method === 'GET' && p === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(MAIN_HTML)
        return
      }
      if (req.method === 'GET' && p === '/mask') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(MASK_HTML)
        return
      }
      if (req.method === 'GET' && p === '/frame') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(FRAME_HTML)
        return
      }
      if (p.startsWith('/api/echo')) {
        json(res, 200, { ok: true, path: p, query: url.search })
        return
      }

      // ── webhook ─────────────────────────────────────────────
      if (req.method === 'POST' && p === '/api/bug') {
        const body = await readBody(req)
        webhook.requests.push({ contentType: req.headers['content-type'] ?? '', body })
        if (webhook.failFirstN > 0) {
          webhook.failFirstN--
          json(res, 500, { ok: false, error: 'real-machine mock 500' })
          return
        }
        json(res, 200, { ok: true, id: `real-${webhook.requests.length}` })
        return
      }
      const statusMatch = /^\/api\/bug\/([^/]+)\/status-public$/.exec(p)
      if (req.method === 'POST' && statusMatch) {
        await readBody(req)
        json(res, 200, { ok: true, status: webhook.remoteStatus })
        return
      }

      // ── mock 禅道 v2/v1 ─────────────────────────────────────
      if (req.method === 'POST' && p === '/api.php/v2/users/login') {
        await readBody(req)
        zentao.logins++
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 'zentaosid=real-machine-session; Path=/; SameSite=Lax'
        })
        res.end(JSON.stringify({
          status: 'success',
          token: zentao.token,
          user: { id: 1, account: 'tester', realname: '测试员' }
        }))
        return
      }
      if (req.method === 'GET' && p === '/api.php/v2/users/1') {
        json(res, 200, { id: 1, account: 'tester', realname: '测试员' })
        return
      }
      if (req.method === 'GET' && p === '/api.php/v2/users') {
        json(res, 200, {
          users: [
            { id: 1, account: 'tester', realname: '测试员', role: 'dev' },
            { id: 2, account: 'alice', realname: '爱丽丝', role: 'qa' }
          ]
        })
        return
      }
      if (req.method === 'GET' && /^\/api\.php\/v2\/projects\/\d+$/.test(p)) {
        json(res, 200, { status: 'success', project: { id: 42, products: [7] } })
        return
      }
      if (req.method === 'GET' && p === '/api.php/v2/projects') {
        json(res, 200, { projects: [{ id: 42, name: '真实项目', type: 'project', status: 'doing' }] })
        return
      }
      if (req.method === 'GET' && p === '/api.php/v1/products') {
        json(res, 200, { products: [{ id: 7, name: '真实产品' }] })
        return
      }
      if (req.method === 'GET' && p === '/api.php/v1/modules') {
        json(res, 200, {
          modules: [
            { id: 0, name: '/', path: '/', parent: 0 },
            { id: 11, name: '登录页', path: '/登录页', parent: 0 }
          ]
        })
        return
      }
      if (req.method === 'POST' && p === '/api.php/v2/bugs') {
        const raw = (await readBody(req)).toString('utf8')
        let parsed: Record<string, unknown> = {}
        try { parsed = JSON.parse(raw) as Record<string, unknown> } catch { parsed = { _raw: raw.slice(0, 200) } }
        if (req.headers['token'] !== zentao.token) {
          json(res, 200, { result: false, message: '登录已超时，请重新登入!' })
          return
        }
        zentao.bugPayloads.push(parsed)
        json(res, 200, { status: 'success', id: 101 })
        return
      }
      if (req.method === 'POST' && p === '/file-ajaxUpload.html') {
        const body = await readBody(req)
        const text = body.toString('latin1')
        const filename = /filename="([^"]+)"/.exec(text)?.[1] ?? 'unknown'
        const hadCookie = /zentaosid=real-machine-session/.test(req.headers.cookie ?? '')
        zentao.uploads.push({ filename, bytes: body.length, hadCookie })
        // 禅道 zui editor 返回 {error:0, url}
        json(res, 200, { error: 0, url: `/file-read-${zentao.uploads.length}.png` })
        return
      }
      const bugGet = /^\/api\.php\/v2\/bugs\/(\d+)$/.exec(p)
      if (req.method === 'GET' && bugGet) {
        json(res, 200, {
          bug: {
            id: Number(bugGet[1]),
            status: zentao.status,
            deleted: false,
            assignedTo: { account: 'tester', realname: '测试员' }
          }
        })
        return
      }
      if (req.method === 'GET' && p === '/api.php/v1/bugs') {
        json(res, 200, { bugs: [] })
        return
      }

      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
    })()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    webhook,
    zentao,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  }
}
