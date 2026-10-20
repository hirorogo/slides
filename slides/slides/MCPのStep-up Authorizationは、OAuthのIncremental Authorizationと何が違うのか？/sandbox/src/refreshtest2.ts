/**
 * 実験D1 の測り直し。
 *
 * ── 最初の run で何をやらかしたか ──────────────────────────
 * 3ケースを連続で投げたら、2本目以降が
 *   429 temporarily_unavailable "Token refresh is already in progress; retry shortly"
 * になった。**本題のケース③は一度も実行されていない。**
 * なのにスクリプトは「広がっていない（= widenedBy が空）」から
 * 「refresh では広げられない」と結論を出していた。
 *
 * 429 で落ちたから空なのであって、挙動を見たわけではない。
 * → 判定を取り下げ、間隔を空けて測り直す。
 *
 * 併せて分かったこと（これはこれで収穫）:
 *   - Cloudflare は refresh を直列化していて、重なると 429 を返す
 *   - refresh_token は**回転する**（1回使うと値が変わる）
 *
 * ── 順番 ─────────────────────────────────────────────
 * refresh のたびにトークンが回るので、**本題を先に**やる。
 *   ① 対照: scope 省略
 *   ② 本題: 広げる
 *   ③ 最後: 狭める（成功すると付与Scopeが減るので最後）
 */

import { postForm } from './http.ts'
import { MCP_SERVER_URL, defaultResourceMetadataUrl } from './config.ts'
import { fingerprint, startRecording } from './evidence.ts'
import { discoverAuthorizationServer, discoverProtectedResource, scopeDiff } from './oauth.ts'
import { addFinding, load, save, type ClientInfo, type TokenSet } from './store.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const client = load<ClientInfo>('client')
let current = load<TokenSet>('tokens')
if (!client || !current?.refresh_token) throw new Error('refresh_token を持つトークンがありません')

const done = startRecording('refreshtest2')
const prm = await discoverProtectedResource(defaultResourceMetadataUrl(MCP_SERVER_URL))
const asm = await discoverAuthorizationServer(prm.authorization_servers![0])

const baseline = current.granted_scope ?? ''
console.log(`\n━━━ 出発点 ━━━\n\n  付与Scope: ${baseline}\n`)

/** 429 は「まだ測れていない」。空振りを結論にしないよう、必ず成否を返す。 */
async function refresh(label: string, scope?: string, attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    const form: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: current!.refresh_token!,
      client_id: client!.client_id,
      resource: MCP_SERVER_URL,
    }
    if (scope) form.scope = scope
    const res = await postForm(`token: refresh ${label} (try ${i})`, asm.token_endpoint, form)
    const b = res.body as Record<string, unknown>
    if (res.status === 429 || b?.error === 'temporarily_unavailable') {
      const wait = 5000 * i
      console.log(`      429（直列化）。${wait / 1000}s 待って再試行 ${i}/${attempts}`)
      await sleep(wait)
      continue
    }
    if (res.status === 200) {
      current = {
        ...current!,
        access_token: String(b.access_token),
        refresh_token: b.refresh_token ? String(b.refresh_token) : current!.refresh_token,
        granted_scope: typeof b.scope === 'string' ? b.scope : current!.granted_scope,
        obtainedAt: new Date().toISOString(),
      }
      save('tokens', current)
    }
    return { status: res.status, body: b, scope: typeof b.scope === 'string' ? b.scope : null, measured: true }
  }
  return { status: 429, body: { error: 'temporarily_unavailable' }, scope: null, measured: false }
}

const results: Array<Record<string, unknown>> = []

console.log('  ▸ ① 対照: scope を省略して refresh')
const c1 = await refresh('omit-scope')
console.log(`      HTTP ${c1.status}  付与: ${c1.scope ?? '(なし)'}`)
console.log(`      → 対照として${c1.status === 200 ? '成立（refresh 自体は通る）' : '不成立。ここが通らないと以降は測れない'}`)
results.push({ case: '① scope省略', ...c1, widenedBy: [] })

await sleep(12000)

console.log('\n  ▸ ② 本題: 未付与の workers-kv-storage.read を足して refresh')
const widerScope = `${current.granted_scope ?? baseline} workers-kv-storage.read`
const c2 = await refresh('widen', widerScope)
const widened = c2.scope ? scopeDiff(baseline, c2.scope) : []
console.log(`      要求: …+ workers-kv-storage.read`)
console.log(`      HTTP ${c2.status}  付与: ${c2.scope ?? '(なし)'}`)
if (!c2.measured) {
  console.log('      ⚠️ 429 のまま。**測れていない**（結論を書かない）')
} else if (c2.status !== 200) {
  console.log(`      → 拒否された: ${JSON.stringify(c2.body).slice(0, 200)}`)
} else {
  console.log(`      → ${widened.length ? `★ 広がった（${widened.join(' ')}）＝RFC 6749 §6 からの逸脱` : '広がらなかった（要求は無視された）'}`)
}
results.push({ case: '② 広げる', requestedScope: widerScope, ...c2, widenedBy: widened })

// 広げられたかを**行動でも**確かめる
let behavioural: Record<string, unknown> | null = null
if (c2.measured && c2.status === 200) {
  const { callTool, describeToolResult, resetSession } = await import('./mcp.ts')
  resetSession()
  const accRes = describeToolResult(
    await callTool('execute', { code: `async () => cloudflare.request({ method: "GET", path: "/accounts", query: { per_page: 1 } })` }, current.access_token),
  )
  let id = ''
  try { id = JSON.parse(accRes.text).result[0].id } catch { /* noop */ }
  const kv = describeToolResult(
    await callTool('execute', { code: `async () => cloudflare.request({ method: "GET", path: "/accounts/${id}/storage/kv/namespaces" })` }, current.access_token),
  )
  behavioural = {
    endpoint: 'GET /accounts/{id}/storage/kv/namespaces',
    needs: 'workers-kv-storage.read',
    httpStatus: kv.httpStatus,
    challenged: kv.challengeFromHeader?.error === 'insufficient_scope',
  }
  console.log(`      行動確認: KV一覧 → HTTP ${kv.httpStatus}${kv.challengeFromHeader?.error ? ` (${kv.challengeFromHeader.error})` : ''}`)
}

await sleep(12000)

console.log('\n  ▸ ③ 狭める: baseline だけを要求して refresh')
const c3 = await refresh('narrow', 'user:read account:read')
console.log(`      HTTP ${c3.status}  付与: ${c3.scope ?? '(なし)'}`)
if (!c3.measured) console.log('      ⚠️ 429 のまま。測れていない')
else if (c3.status === 200) {
  const lost = scopeDiff(c3.scope ?? '', baseline)
  console.log(`      → ${lost.length ? `狭まった（失った: ${lost.join(' ')}）` : '狭まらなかった'}`)
}
results.push({ case: '③ 狭める', requestedScope: 'user:read account:read', ...c3 })

addFinding('experimentD1_refresh_v2', {
  ranAt: new Date().toISOString(),
  supersedes: 'experimentD1_refresh（429で未実行のまま結論を書いていたので取り下げ）',
  grantedBefore: baseline,
  cases: results.map((r) => ({ ...r, body: r.status === 200 ? '(成功)' : r.body })),
  behaviouralCheckAfterWiden: behavioural,
  refreshSerialization: 'refresh が重なると 429 temporarily_unavailable "Token refresh is already in progress"',
  refreshTokenRotates: true,
})

console.log('\n━━━ 結論 ━━━\n')
if (!results[1].measured) console.log('  ⚠️ 本題が測れていない。再実行が必要')
else if (results[1].status !== 200) console.log('  refresh で広げようとすると拒否される')
else console.log(`  ${(results[1].widenedBy as string[]).length ? '★ refresh で広がった' : 'refresh では広がらない（要求は無視され、元の付与のまま）'}`)
done()
