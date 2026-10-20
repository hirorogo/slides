/**
 * いま持っているトークンで「何が通って何が通らないか」を実際に叩いて確かめる。
 *
 * **付与された scope 文字列を信じない。** 行動で確かめる。
 * D-1b で `d1.read` が scope から消えたことは観測したが、
 * 「消えた＝本当に使えなくなった」かは別の主張。
 *
 * 対照の置き方：同じスクリプトの中で、持っている Scope の操作と
 * 持っていない Scope の操作を並べて叩く。
 */

import { startRecording } from './evidence.ts'
import { callTool, describeToolResult, resetSession } from './mcp.ts'
import { addFinding, load, type TokenSet } from './store.ts'

const tokens = load<TokenSet>('tokens')
if (!tokens) throw new Error('先に ./run connect')
const held = (tokens.granted_scope ?? tokens.requested_scope).split(/\s+/).filter(Boolean)

const done = startRecording('scopecheck')
resetSession()

const accountId = (load<any>('findings')?.experimentB_hunt?.accountId ?? '').replace('…', '')
const acc = describeToolResult(
  await callTool('execute', { code: `async () => cloudflare.request({ method: "GET", path: "/accounts", query: { per_page: 1 } })` }, tokens.access_token),
)
let id = accountId
try { id = JSON.parse(acc.text).result[0].id } catch { /* そのまま */ }

const probes: Array<{ name: string; path: string; needs: string }> = [
  { name: 'R2 バケット一覧', path: `/accounts/${id}/r2/buckets`, needs: 'workers-r2.read' },
  { name: 'D1 データベース一覧', path: `/accounts/${id}/d1/database`, needs: 'd1.read' },
  { name: 'KV 名前空間一覧', path: `/accounts/${id}/storage/kv/namespaces`, needs: 'workers-kv-storage.read' },
  { name: 'ゾーン一覧', path: `/zones`, needs: 'zone.read' },
  { name: 'Workers スクリプト一覧', path: `/accounts/${id}/workers/scripts`, needs: 'workers-scripts.read' },
  { name: 'アカウントメンバー一覧', path: `/accounts/${id}/members`, needs: 'memberships.read' },
]

console.log(`\n━━━ 持っているScope: ${held.join(' ')} ━━━\n`)
console.log('  操作                   必要Scope                 持ってる  結果')
console.log('  ' + '─'.repeat(86))

const rows: Array<Record<string, unknown>> = []
for (const p of probes) {
  const res = await callTool(
    'execute',
    { code: `async () => cloudflare.request({ method: "GET", path: ${JSON.stringify(p.path)} })` },
    tokens.access_token,
  )
  const d = describeToolResult(res)
  const challenged = d.challengeFromHeader?.error === 'insufficient_scope'
  let outcome: string
  let count: number | null = null
  if (challenged) outcome = `403 challenge (${d.challengeFromHeader?.scope})`
  else if (d.isError) outcome = `エラー: ${d.text.replace(/\s+/g, ' ').slice(0, 60)}`
  else {
    try {
      const body = JSON.parse(d.text)
      const result = body.result ?? body.buckets ?? body
      count = Array.isArray(result) ? result.length : Array.isArray(result?.buckets) ? result.buckets.length : null
      outcome = `200  件数=${count ?? '?'}`
    } catch {
      outcome = `200  ${d.text.replace(/\s+/g, ' ').slice(0, 50)}`
    }
  }
  const have = held.includes(p.needs) ? '○' : '×'
  console.log(`  ${p.name.padEnd(22)} ${p.needs.padEnd(24)} ${have}        ${outcome}`)
  rows.push({ ...p, held: have === '○', httpStatus: d.httpStatus, challenged, challengeScope: d.challengeFromHeader?.scope ?? null, count, text: d.text.slice(0, 400) })
}

addFinding(`scopecheck_${held.filter((s) => !['user:read', 'account:read', 'offline_access'].includes(s)).join('+') || 'baseline'}`, {
  ranAt: new Date().toISOString(),
  heldScopes: held,
  probes: rows,
})
done()
