/**
 * 実験B ―― 403 insufficient_scope を踏む。
 *
 * 主張 B3 / B4 / B4' / B5（claims.md）。
 *
 * ⚠️ 読み取り専用（GET）しか叩かない。
 *
 * ── 対照の置き方 ─────────────────────────────────────────
 * 「403 が出た」を主張するには「出ないはずの操作が 200 である」が要る。
 * 同じスクリプトの中に並べる。
 *
 *   control: whoami         いま持っている user:read で通るはず
 *   control: docs()         Cloudflare API を叩かないツール。通るはず
 *   target : execute(GET …) 持っていない Scope が要る。403 のはず
 *
 * ── B5 の論点 ────────────────────────────────────────────
 * `execute` の説明にこう書いてある:
 *   "For HTTP 401/403 it also says which permission the endpoint needs
 *    and whether reconnecting will help."
 * つまり **Cloudflare API の 403** は、ツール結果の文字列として返る可能性がある。
 * MCP の **`WWW-Authenticate: insufficient_scope`** とは別物。
 * どちらで返るかで、クライアントが step-up を起動できるかが決まる。
 */

import { startRecording } from './evidence.ts'
import { callTool, describeToolResult, resetSession } from './mcp.ts'
import { addFinding, load, type TokenSet } from './store.ts'

const tokens = load<TokenSet>('tokens')
if (!tokens) throw new Error('先に ./run connect を実行してください')

const held = (tokens.granted_scope ?? tokens.requested_scope).split(/\s+/).filter(Boolean)
const done = startRecording('stepup')
resetSession()

const show = (d: ReturnType<typeof describeToolResult>) => {
  console.log(`    HTTP ${d.httpStatus}${d.isError ? ' (isError)' : ''}`)
  if (d.challengeFromHeader) console.log(`    ★ WWW-Authenticate: ${JSON.stringify(d.challengeFromHeader)}`)
  console.log(`    ${d.text.replace(/\s+/g, ' ').slice(0, 300)}`)
}

console.log('\n━━━ 持っているScope ━━━\n')
console.log(`  ${held.join(' ')}\n`)

// ───────────────────────────────── 対照
console.log('━━━ 対照1  whoami（user:read で通るはず）━━━\n')
const whoami = describeToolResult(await callTool('whoami', {}, tokens.access_token))
show(whoami)

console.log('\n━━━ 対照2  docs（Cloudflare API を叩かない）━━━\n')
const docs = describeToolResult(await callTool('docs', { query: 'dns records api' }, tokens.access_token))
console.log(`    HTTP ${docs.httpStatus}${docs.isError ? ' (isError)' : ''}  ${docs.text.replace(/\s+/g, ' ').slice(0, 100)}`)

// ───────────────────────────────── Scope の対応表を引く
console.log('\n━━━ 実験B-0  x-api-token-group で「どの操作にどのScopeが要るか」を引く ━━━\n')
console.log('  OpenAPI spec に載っている。"OAuth scopes have the same names" とのこと。\n')

const searchCode = `async () => {
  const want = ['/zones', '/accounts', '/user', '/user/tokens', '/memberships'];
  const out = [];
  for (const p of want) {
    const op = spec.paths[p]?.get;
    if (op) out.push({ path: p, summary: op.summary, scopes: op['x-api-token-group'] ?? null });
  }
  return out;
}`
const searchRes = describeToolResult(await callTool('search', { code: searchCode }, tokens.access_token))
console.log(`  HTTP ${searchRes.httpStatus}`)
console.log(`  ${searchRes.text.replace(/\s+/g, ' ').slice(0, 900)}`)

// ───────────────────────────────── 403 を踏みに行く
console.log('\n━━━ 実験B  持っていない Scope が要る読み取り操作 ━━━\n')

const targets: Array<{ name: string; code: string; guess: string }> = [
  {
    name: 'GET /zones（ゾーン一覧）',
    guess: 'zone.read',
    code: `async () => cloudflare.request({ method: "GET", path: "/zones", query: { per_page: 1 } })`,
  },
  {
    name: 'GET /accounts/{id}/workers/scripts（Workers一覧）',
    guess: 'workers-scripts.read',
    code: `async () => cloudflare.request({ method: "GET", path: \`/accounts/\${accountId}/workers/scripts\` })`,
  },
  {
    name: 'GET /user/tokens（APIトークン一覧）',
    guess: 'user-details.read など',
    code: `async () => cloudflare.request({ method: "GET", path: "/user/tokens", query: { per_page: 1 } })`,
  },
]

const observed: Array<Record<string, unknown>> = []
for (const t of targets) {
  console.log(`  ▸ ${t.name}  （要りそうなScope: ${t.guess}）`)
  const res = await callTool('execute', { code: t.code }, tokens.access_token)
  const d = describeToolResult(res)
  show(d)
  observed.push({
    target: t.name,
    guessedScope: t.guess,
    httpStatus: d.httpStatus,
    wwwAuthenticate: res.headers['www-authenticate'] ?? null,
    challenge: d.challengeFromHeader,
    isError: d.isError,
    text: d.text.slice(0, 1200),
  })
  console.log()
}

const headerChallenges = observed.filter((o) => (o.challenge as any)?.error === 'insufficient_scope')
addFinding('experimentB', {
  ranAt: new Date().toISOString(),
  heldScopes: held,
  controls: {
    whoami: { status: whoami.httpStatus, isError: whoami.isError, text: whoami.text.slice(0, 300) },
    docs: { status: docs.httpStatus, isError: docs.isError },
  },
  scopeLookup: searchRes.text.slice(0, 2000),
  targets: observed,
  insufficientScopeViaHeader: headerChallenges.length,
})

console.log('━━━ まとめ ━━━\n')
console.log(`  WWW-Authenticate で insufficient_scope が返った: ${headerChallenges.length} / ${observed.length}`)
console.log(`  対照 whoami: HTTP ${whoami.httpStatus}（${whoami.isError ? 'エラー' : '成功'}）`)
done()
