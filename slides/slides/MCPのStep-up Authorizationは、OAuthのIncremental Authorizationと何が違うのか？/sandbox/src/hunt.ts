/**
 * 実験B の続き ―― 「MCPレベルの 403 insufficient_scope」を返す操作を探す。
 *
 * 最初の3本では一度も `WWW-Authenticate` が返らなかった。
 *
 *   GET /zones                  → 200 だが result が空（★ 対照が要る。後述）
 *   GET …/workers/scripts       → 200 だが result が空（同上）
 *   GET /user/tokens            → ツール結果の文字列として 403
 *                                 "No OAuth scope covers this endpoint"
 *
 * 最後のは **OAuthカタログに対応Scopeが無い**エンドポイントだった。
 * step-up のしようがないので、チャレンジが返らないのは当然。
 *
 * ここでは **カタログ（384個）に存在する Scope が要る**読み取り操作を総当たりして、
 * ヘッダーのチャレンジが返るものを探す。
 *
 * ⚠️ すべて GET。リソースは作らない・変えない・消さない。
 */

import { startRecording } from './evidence.ts'
import { callTool, describeToolResult, resetSession } from './mcp.ts'
import { addFinding, load, type TokenSet } from './store.ts'

const tokens = load<TokenSet>('tokens')
if (!tokens) throw new Error('先に ./run connect を実行してください')

const done = startRecording('hunt')
resetSession()

console.log('\n━━━ まずアカウントを特定する（account:read は持っている）━━━\n')
const acc = describeToolResult(
  await callTool(
    'execute',
    { code: `async () => cloudflare.request({ method: "GET", path: "/accounts", query: { per_page: 5 } })` },
    tokens.access_token,
  ),
)
console.log(`  HTTP ${acc.httpStatus}${acc.isError ? ' (isError)' : ''}`)
let accountId: string | null = null
try {
  const parsed = JSON.parse(acc.text)
  const list = parsed?.result ?? []
  console.log(`  アカウント数: ${list.length}`)
  for (const a of list) console.log(`    - ${a.id?.slice(0, 8)}…  ${a.name}`)
  accountId = list[0]?.id ?? null
} catch {
  console.log(`  パースできず: ${acc.text.slice(0, 200)}`)
}

if (!accountId) {
  console.log('\n  × アカウントIDが取れないので中断します')
  done()
  process.exit(1)
}

/** カタログ（AS の scopes_supported 384個）に実在する Scope が要る読み取り操作。 */
const candidates: Array<{ name: string; path: string; scope: string }> = [
  { name: 'R2 バケット一覧', path: `/accounts/${accountId}/r2/buckets`, scope: 'workers-r2.read' },
  { name: 'KV 名前空間一覧', path: `/accounts/${accountId}/storage/kv/namespaces`, scope: 'workers-kv-storage.read' },
  { name: 'D1 データベース一覧', path: `/accounts/${accountId}/d1/database`, scope: 'd1.read' },
  { name: 'アカウントメンバー一覧', path: `/accounts/${accountId}/members`, scope: 'memberships.read' },
  { name: 'アカウント設定', path: `/accounts/${accountId}/settings`, scope: 'account-settings.read' },
  { name: 'Access アプリ一覧', path: `/accounts/${accountId}/access/apps`, scope: 'access-app.read' },
  { name: 'Queues 一覧', path: `/accounts/${accountId}/queues`, scope: 'queues.read' },
  { name: 'Images 統計', path: `/accounts/${accountId}/images/v1/stats`, scope: 'images.read' },
]

console.log('\n━━━ 総当たり（すべて GET）━━━\n')
const rows: Array<Record<string, unknown>> = []
for (const c of candidates) {
  const res = await callTool(
    'execute',
    { code: `async () => cloudflare.request({ method: "GET", path: ${JSON.stringify(c.path)} })` },
    tokens.access_token,
  )
  const d = describeToolResult(res)
  const www = res.headers['www-authenticate'] ?? null
  const challenge = d.challengeFromHeader
  const flat = d.text.replace(/\s+/g, ' ')
  const verdict = challenge?.error === 'insufficient_scope'
    ? '★ ヘッダーで insufficient_scope'
    : /HTTP 403/.test(flat)
      ? 'ツール結果の文字列で403'
      : d.isError
        ? 'その他のエラー'
        : '200（成功）'
  rows.push({ ...c, httpStatus: d.httpStatus, wwwAuthenticate: www, verdict, text: d.text.slice(0, 600) })
  console.log(`  ▸ ${c.name.padEnd(22)} ${verdict}`)
  console.log(`      ${flat.slice(0, 210)}`)
  if (www) console.log(`      ★ ${www}`)
  console.log()
}

const headerHits = rows.filter((r) => String(r.verdict).startsWith('★'))
addFinding('experimentB_hunt', {
  ranAt: new Date().toISOString(),
  accountId: `${accountId.slice(0, 8)}…`,
  heldScopes: tokens.granted_scope ?? tokens.requested_scope,
  candidates: rows,
  headerChallengeCount: headerHits.length,
})

console.log('━━━ まとめ ━━━\n')
console.log(`  ヘッダーで insufficient_scope が返った: ${headerHits.length} / ${rows.length}`)
if (headerHits.length) {
  for (const h of headerHits) console.log(`    ${h.name} → ${h.wwwAuthenticate}`)
}
done()
