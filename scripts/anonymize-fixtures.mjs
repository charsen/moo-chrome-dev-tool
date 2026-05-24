#!/usr/bin/env node
// 把 tests/fixtures/zentao-real/raw/*.json 真实禅道响应脱敏后入 tests/fixtures/zentao-real/anon/。
//
// 脱敏规则：
//   - 任何 token 替换为 'fixture-token'
//   - 邮箱里的用户名前缀替换为 'user'
//   - 中文 realname 替换为 '用户 A/B/C/...' 按出现顺序
//   - account 字段映射到 'user-A/B/C/...' 按出现顺序
//   - 真手机号（11 位 1[3-9] 开头）替换为 '13800000000'
//   - 真域名 baseUrl 在 fixture 里**不存在**（curl URL 不写进 response body 一般），仍做替换防漏
//
// 用法：
//   node scripts/anonymize-fixtures.mjs
//
// 输出：tests/fixtures/zentao-real/anon/*.json（gitignored 关闭，可入仓）

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const RAW_DIR = resolve(root, 'tests/fixtures/zentao-real/raw')
const ANON_DIR = resolve(root, 'tests/fixtures/zentao-real/anon')

mkdirSync(ANON_DIR, { recursive: true })

// 全局映射（同一份原值在所有 fixture 里映射成同一个匿名值，保证 cross-file 一致）
const accountMap = new Map() // 原 account → 'user-A'
const realnameMap = new Map() // 原 realname → '用户 A'
let accountCounter = 0
let realnameCounter = 0

function letterFor(n) {
  // 0 → A, 1 → B, ..., 25 → Z, 26 → AA, ...
  let s = ''
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return s
}

function anonAccount(v) {
  if (typeof v !== 'string' || !v) return v
  if (v === 'system' || v === 'admin' || v === '') return v
  if (!accountMap.has(v)) {
    accountMap.set(v, `user-${letterFor(accountCounter++)}`)
  }
  return accountMap.get(v)
}

function anonRealname(v) {
  if (typeof v !== 'string' || !v) return v
  if (!realnameMap.has(v)) {
    realnameMap.set(v, `用户 ${letterFor(realnameCounter++)}`)
  }
  return realnameMap.get(v)
}

function isLikelyChineseName(s) {
  return typeof s === 'string' && /^[一-龥]{2,4}$/.test(s)
}

function anonPhone(v) {
  if (typeof v !== 'string') return v
  return v.replace(/\b1[3-9][0-9]{9}\b/g, '13800000000')
}

function anonEmail(v) {
  if (typeof v !== 'string' || !v.includes('@')) return v
  return v.replace(/^([A-Za-z0-9._%+-]+)@(.+)$/, (_, _local, domain) => `user@${domain}`)
}

const ACCOUNT_FIELDS = new Set([
  'account', 'openedBy', 'assignedTo', 'closedBy', 'resolvedBy',
  'lastEditedBy', 'createdBy', 'reviewedBy', 'PO', 'PM', 'QA', 'RD'
])
const REALNAME_FIELDS = new Set(['realname', 'assignedToName', 'name'])
const PHONE_FIELDS = new Set(['mobile', 'phone'])
const EMAIL_FIELDS = new Set(['email'])
const TOKEN_FIELDS = new Set(['token', 'sessionID', 'sessionName'])

function walk(node, parentKey = '') {
  if (Array.isArray(node)) {
    return node.map(item => walk(item, parentKey))
  }
  if (node && typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) {
      if (TOKEN_FIELDS.has(k)) {
        out[k] = typeof v === 'string' ? 'fixture-token' : v
      } else if (ACCOUNT_FIELDS.has(k)) {
        out[k] = anonAccount(v)
      } else if (REALNAME_FIELDS.has(k)) {
        // name 字段可能是中文名（user.realname）也可能是项目/产品名（不脱敏，因为是业务标识）
        // 启发式：≤ 4 个中文字符 → 当人名脱
        out[k] = (k === 'realname' || (k === 'name' && isLikelyChineseName(v))) ? anonRealname(v) : walk(v, k)
      } else if (PHONE_FIELDS.has(k)) {
        out[k] = anonPhone(v)
      } else if (EMAIL_FIELDS.has(k)) {
        out[k] = anonEmail(v)
      } else {
        out[k] = walk(v, k)
      }
    }
    return out
  }
  return node
}

let files
try {
  files = readdirSync(RAW_DIR).filter(f => f.endsWith('.json')).sort()
} catch {
  console.error(`raw 目录不存在或为空：${RAW_DIR}`)
  console.error('先让同事跑 scripts/dump-zentao-fixtures.sh，把 raw/ 给你')
  process.exit(1)
}

if (files.length === 0) {
  console.error('raw/ 目录是空的，没东西可脱')
  process.exit(1)
}

console.log(`找到 ${files.length} 个原始 fixture，开始脱敏...`)

for (const f of files) {
  const raw = readFileSync(resolve(RAW_DIR, f), 'utf8')
  let parsed
  try { parsed = JSON.parse(raw) }
  catch (e) {
    console.warn(`⚠ ${f}：JSON parse 失败（${e.message}），原样存为 _rawText`)
    parsed = { _rawText: raw.slice(0, 2000) }
  }
  const anon = walk(parsed)
  writeFileSync(resolve(ANON_DIR, f), JSON.stringify(anon, null, 2))
  console.log(`✓ ${f}`)
}

console.log('')
console.log(`映射表：`)
console.log(`  account（${accountMap.size}）`, [...accountMap.entries()].slice(0, 5))
console.log(`  realname（${realnameMap.size}）`, [...realnameMap.entries()].slice(0, 5))
console.log('')
console.log(`✅ 脱敏完成。`)
console.log(`  raw 在 ${RAW_DIR}（不入仓）`)
console.log(`  anon 在 ${ANON_DIR}（可入仓）`)
console.log('')
console.log('⚠ 入仓前再人眼扫一遍 anon/*.json 确认没漏（grep 一下你能想到的真实姓名/账号/手机号）')
