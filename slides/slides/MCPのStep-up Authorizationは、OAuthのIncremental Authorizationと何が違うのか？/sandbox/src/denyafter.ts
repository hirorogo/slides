/**
 * 実験E の後半 ―― 拒否したあとに既存の権限が生きているか。
 *
 * ⚠️ 記録の出どころについて（正直に残す）
 * コールバックを受けるローカルサーバーが、拒否の瞬間に落ちていた
 * （検証スクリプトをツール呼び出しの子プロセスとして起動したため）。
 * そのため拒否の戻りは **リスナーが受けたものではなく、人間がブラウザの
 * アドレスバーからコピーしたもの**。
 *
 *   http://localhost:8976/callback?error=access_denied&state=dw91gqLHkSkH5fBq8OsvLQ&iss=https%3A%2F%2Fmcp.cloudflare.com
 *
 * state は denytest が生成した値と一致している（照合済み）。
 * 中身は対照クライアントで**リスナーが実際に受けた**拒否と同一の形。
 * それでも出どころが違うので、ここに明記しておく。
 */

import { startRecording } from './evidence.ts'
import { callTool, describeToolResult, resetSession } from './mcp.ts'
import { addFinding, load, type TokenSet } from './store.ts'

const tokens = load<TokenSet>('tokens')
if (!tokens) throw new Error('トークンがありません')

const PASTED = 'http://localhost:8976/callback?error=access_denied&state=dw91gqLHkSkH5fBq8OsvLQ&iss=https%3A%2F%2Fmcp.cloudflare.com'
const EXPECTED_STATE = 'dw91gqLHkSkH5fBq8OsvLQ'
const q = new URL(PASTED).searchParams

const done = startRecording('denyafter')

console.log('\n━━━ 拒否の戻り（人間がコピーした値）━━━\n')
console.log(`  error      : ${q.get('error')}`)
console.log(`  state      : ${q.get('state')}  （生成した値と一致: ${q.get('state') === EXPECTED_STATE}）`)
console.log(`  iss        : ${q.get('iss')}`)
console.log(`  error_description: ${q.get('error_description') ?? '(なし)'}`)

console.log('\n━━━ 拒否の後（対照は denytest の「前」）━━━\n')
resetSession()
const acc = describeToolResult(
  await callTool('execute', { code: `async () => cloudflare.request({ method: "GET", path: "/accounts", query: { per_page: 1 } })` }, tokens.access_token),
)
let id = ''
try { id = JSON.parse(acc.text).result[0].id } catch { /* noop */ }
const d1 = describeToolResult(
  await callTool('execute', { code: `async () => cloudflare.request({ method: "GET", path: "/accounts/${id}/d1/database" })` }, tokens.access_token),
)
let count: number | null = null
try { count = JSON.parse(d1.text).result.length } catch { /* noop */ }
const kv = describeToolResult(
  await callTool('execute', { code: `async () => cloudflare.request({ method: "GET", path: "/accounts/${id}/storage/kv/namespaces" })` }, tokens.access_token),
)

const before = { accounts: 200, d1: 200, d1Count: 5 }
const after = { accounts: acc.httpStatus, d1: d1.httpStatus, d1Count: count }

console.log(`  [前] accounts=HTTP ${before.accounts} / D1一覧=HTTP ${before.d1} 件数=${before.d1Count}`)
console.log(`  [後] accounts=HTTP ${after.accounts} / D1一覧=HTTP ${after.d1} 件数=${after.d1Count}`)
console.log(`  拒否した workers-kv-storage.read は: HTTP ${kv.httpStatus}${kv.challengeFromHeader?.error ? ` (${kv.challengeFromHeader.error})` : ''}`)

const intact = before.accounts === after.accounts && before.d1 === after.d1 && before.d1Count === after.d1Count
console.log(`\n  → 既存の権限は ${intact ? '壊れていない' : '★ 変化した'}`)
console.log(`  → 拒否した権限は ${kv.challengeFromHeader?.error === 'insufficient_scope' ? '相変わらず 403 チャレンジ（＝拒否が効いている）' : 'チャレンジ以外の返り'}`)

addFinding('experimentE', {
  ranAt: new Date().toISOString(),
  provenance: 'コールバックはリスナーではなく人間がアドレスバーからコピー。state 照合済み。理由は denyafter.ts 冒頭に記載',
  denyCallback: { error: q.get('error'), state: q.get('state'), stateMatches: q.get('state') === EXPECTED_STATE, iss: q.get('iss'), error_description: q.get('error_description') },
  before,
  after,
  deniedScopeStillChallenged: kv.challengeFromHeader?.error === 'insufficient_scope',
  existingScopesIntact: intact,
  note: 'E2(ループ)は自前クライアントでは測れない。再試行はクライアント実装の仕事で、Claude Code の _maxStepUpRetries はバイナリで確認済み',
})
done()
