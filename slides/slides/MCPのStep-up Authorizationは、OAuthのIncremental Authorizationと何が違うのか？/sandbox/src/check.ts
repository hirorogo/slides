/**
 * 正常系の確認。
 *
 * verify-pipeline フェーズ5 の ⑤「最後にもう一度 正常系」もこれを使う。
 * **途中で対象が無効化されていたら、それまでの観測が全部疑わしくなる。**
 */

import { startRecording } from './evidence.ts'
import { describeToolResult, legacyInitialize, listTools, resetSession } from './mcp.ts'
import { addFinding, load, type TokenSet } from './store.ts'

const tokens = load<TokenSet>('tokens')
if (!tokens) throw new Error('先に ./run connect を実行してください')

const label = process.argv[2] ?? 'check'
const done = startRecording(`check-${label}`)

console.log(`\n━━━ 正常系の確認（${label}）━━━\n`)
console.log(`  いま持っているScope: ${tokens.granted_scope ?? tokens.requested_scope}`)
console.log(`  取得: ${tokens.obtainedAt}（有効期限 ${tokens.expires_in ?? '?'} 秒）\n`)

// --- 2026-07-28（ステートレス・envelope あり）
resetSession()
const modern = await listTools(tokens.access_token, '2026-07-28')
console.log(`  [2026-07-28] tools/list : HTTP ${modern.status}`)
const modernTools = ((modern.body as any)?.result?.tools ?? []) as Array<{ name: string; description?: string }>
for (const t of modernTools) {
  console.log(`      - ${t.name}: ${(t.description ?? '').replace(/\s+/g, ' ').slice(0, 80)}`)
}
if (modern.status !== 200) {
  console.log(`      body: ${JSON.stringify(modern.body).slice(0, 300)}`)
}

// --- 対照: 旧版のハンドシェイク（同じトークンで同じサーバー）
resetSession()
const legacy = await legacyInitialize(tokens.access_token, '2025-11-25')
console.log(`\n  [2025-11-25] initialize : HTTP ${legacy.status}`)
if (legacy.status === 200) {
  const r = (legacy.body as any)?.result
  console.log(`      negotiated: ${r?.protocolVersion}  serverInfo: ${JSON.stringify(r?.serverInfo)}`)
  const legacyTools = await listTools(tokens.access_token, '2025-11-25')
  console.log(`  [2025-11-25] tools/list : HTTP ${legacyTools.status}`)
} else {
  console.log(`      body: ${JSON.stringify(legacy.body).slice(0, 300)}`)
}

// --- 持っているScopeで通る操作が本当に通るか（403の対照になる）
resetSession()
const docs = await (await import('./mcp.ts')).callTool(
  'docs',
  { query: 'what is a zone' },
  tokens.access_token,
)
const d = describeToolResult(docs)
console.log(`\n  docs() : HTTP ${d.httpStatus}${d.isError ? ' (isError)' : ''}  ${d.text.replace(/\s+/g, ' ').slice(0, 120)}`)

addFinding(`normalPath_${label}`, {
  ranAt: new Date().toISOString(),
  grantedScope: tokens.granted_scope ?? null,
  modern: { status: modern.status, tools: modernTools.map((t) => t.name) },
  legacy: { status: legacy.status, negotiated: (legacy.body as any)?.result?.protocolVersion ?? null },
  docsTool: { status: d.httpStatus, isError: d.isError, excerpt: d.text.slice(0, 300) },
})

console.log(`\n  → 正常系: ${modern.status === 200 ? 'OK' : 'NG'}`)
done()
