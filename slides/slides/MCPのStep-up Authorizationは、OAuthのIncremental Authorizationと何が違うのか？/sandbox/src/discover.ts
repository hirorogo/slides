/**
 * 実験B の準備 ―― 403 を踏めそうなAPIを探す。ユーザー操作は不要。
 *
 * どのCloudflare APIがどのScopeを要求するかは公開情報に無い（references.md「取れなかったもの」）。
 * `search()` でエンドポイントを引いて、`execute()` で読み取り専用のものを順に叩く。
 *
 * ⚠️ 読み取り専用（GET / list 系）だけを叩く。設定変更・削除は一切しない。
 */

import { startRecording } from './evidence.ts'
import { callTool, describeToolResult, legacyInitialize, resetSession } from './mcp.ts'
import { addFinding, load, type TokenSet } from './store.ts'

const tokens = load<TokenSet>('tokens')
if (!tokens) throw new Error('先に ./run connect を実行してください')

const done = startRecording('discover')
resetSession()
await legacyInitialize(tokens.access_token)

console.log('\n━━━ 実験B準備  search() でエンドポイントを引く ━━━\n')
console.log(`  いま持っているScope: ${tokens.granted_scope ?? tokens.requested_scope}\n`)

/** 「違うScopeを要求しそうな読み取り専用API」を狙う。 */
const queries = [
  'list dns records for a zone',
  'list workers scripts',
  'list zones',
  'list r2 buckets',
  'get user details',
  'list account members',
]

const found: Array<{ query: string; status: number; excerpt: string }> = []
for (const q of queries) {
  const res = await callTool('search', { query: q }, tokens.access_token)
  const d = describeToolResult(res)
  const excerpt = d.text.replace(/\s+/g, ' ').slice(0, 220)
  found.push({ query: q, status: res.status, excerpt })
  console.log(`  ▸ ${q}`)
  console.log(`    HTTP ${res.status}${d.isError ? ' (isError)' : ''}  ${excerpt}`)
  if (d.challengeFromHeader?.error) {
    console.log(`    ★ WWW-Authenticate: ${JSON.stringify(d.challengeFromHeader)}`)
  }
  console.log()
}

addFinding('experimentB_discover', { ranAt: new Date().toISOString(), queries: found })
console.log('  次: ./run stepup   （見つかったエンドポイントを execute() で叩いて403を踏む）')
done()
