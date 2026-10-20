/**
 * 実験0-6 ―― 「どんなトークンだと 401 で、どんなトークンだと 403 か」
 *
 * 実験0-2 の対照で、**一度も発行されていないランダム43文字**が
 * `403 insufficient_scope` を返した。`not-a-real-token` は `401 invalid_token` だったのに。
 *
 *   401 invalid_token      "Access token appears malformed; reauthenticate and try again"
 *   403 insufficient_scope "Token lacks required user:read or account:read scope"
 *
 * 403 insufficient_scope は MCP 仕様では **Step-up 再認可の発火点**。
 * つまり「形だけ整った無効なトークン」でクライアントを再同意に送れることになる。
 *
 * ここでは主張を広げる前に、境界を実装定数まで詰める。
 *   - 決定的か（同じ入力で同じ答えが返るか）
 *   - 長さが効くのか、文字種が効くのか
 *   - 二分探索で1文字まで詰める
 *
 * 公開エンドポイントなので、リクエストは間隔を空けて最小限に抑える。
 */

import { randomBytes } from 'node:crypto'

import { startRecording } from './evidence.ts'
import { legacyInitialize, resetSession } from './mcp.ts'
import { addFinding } from './store.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Probe = { status: number; error: string | null; description: string | null }

async function probeToken(label: string, token: string): Promise<Probe> {
  resetSession()
  const res = await legacyInitialize(token)
  await sleep(200)
  const body = res.body as Record<string, unknown> | null
  return {
    status: res.status,
    error: res.challenge?.error ?? null,
    description: typeof body?.error_description === 'string' ? body.error_description : null,
  }
}

function verdict(p: Probe): 'malformed(401)' | 'insufficient(403)' | `other(${number})` {
  if (p.status === 401 && p.error === 'invalid_token') return 'malformed(401)'
  if (p.status === 403 && p.error === 'insufficient_scope') return 'insufficient(403)'
  return `other(${p.status})`
}

const done = startRecording('tokenshape')
const results: Array<Record<string, unknown>> = []

function show(name: string, p: Probe) {
  console.log(`  ${name.padEnd(40)} ${String(p.status).padEnd(4)} ${verdict(p).padEnd(18)} ${p.description ?? ''}`)
}

console.log('\n━━━ 0-6-1  決定的か（同じ長さの別の乱数を3本）━━━\n')
for (let i = 0; i < 3; i++) {
  const t = randomBytes(32).toString('base64url') // 43文字
  const p = await probeToken(`random#${i}`, t)
  results.push({ group: 'determinism', length: t.length, token_shape: 'base64url(32B)=43', ...p })
  show(`ランダム43文字 #${i + 1}`, p)
}

console.log('\n━━━ 0-6-2  文字種を変える（長さは43で固定）━━━\n')
const charsets: Array<{ name: string; value: string }> = [
  { name: 'base64url (A-Za-z0-9_-)', value: randomBytes(32).toString('base64url') },
  { name: '16進 43文字', value: randomBytes(32).toString('hex').slice(0, 43) },
  { name: '英小文字のみ 43文字', value: 'a'.repeat(43) },
  { name: 'ハイフン入り 43文字', value: 'a'.repeat(21) + '-' + 'b'.repeat(21) },
  { name: 'ドット入り（JWT風）', value: `${'a'.repeat(13)}.${'b'.repeat(14)}.${'c'.repeat(14)}` },
  { name: 'コロン入り', value: `${'a'.repeat(21)}:${'b'.repeat(21)}` },
  { name: '空白入り', value: `${'a'.repeat(21)} ${'b'.repeat(21)}` },
]
for (const c of charsets) {
  const p = await probeToken(c.name, c.value)
  results.push({ group: 'charset', name: c.name, length: c.value.length, ...p })
  show(c.name, p)
}

console.log('\n━━━ 0-6-3  長さの境界を二分探索（文字は a のみ）━━━\n')
console.log('  「401 で弾かれる最長」と「403 まで通る最短」を1文字まで詰める。\n')

const probeLen = async (n: number) => {
  const p = await probeToken(`len=${n}`, 'a'.repeat(n))
  results.push({ group: 'length', length: n, ...p })
  show(`${n} 文字`, p)
  return verdict(p) === 'insufficient(403)'
}

// まず両端を確認する（前回の答えを知らない範囲から探索し直す）
const lowOk = await probeLen(1)
const highOk = await probeLen(64)

let boundary: { lastMalformed: number; firstInsufficient: number } | null = null
if (!lowOk && highOk) {
  let lo = 1 // 403 にならない
  let hi = 64 // 403 になる
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (await probeLen(mid)) hi = mid
    else lo = mid
  }
  boundary = { lastMalformed: lo, firstInsufficient: hi }
  console.log(`\n  → 境界: ${lo} 文字までは 401、${hi} 文字から 403`)
} else {
  console.log(`\n  → 単純な長さの境界ではない（1文字: ${lowOk ? '403' : '401'} / 64文字: ${highOk ? '403' : '401'}）`)
}

addFinding('experiment0_tokenshape', {
  ranAt: new Date().toISOString(),
  note: '一度も発行されていないトークンで 403 insufficient_scope が返るか',
  boundary,
  results,
})

console.log('\n━━━ まとめ ━━━\n')
const n403 = results.filter((r) => r.status === 403).length
console.log(`  403 insufficient_scope を返した入力: ${n403} / ${results.length}`)
console.log('  ※ いずれも一度も発行されていない文字列。有効なトークンは使っていない。')

done()
