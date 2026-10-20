/**
 * 実験E ―― 追加認可を拒否する。★ブラウザ操作が要る（Cancel を押すだけ）
 *
 * 主張 E1 / E2（claims.md）:
 *   E1 拒否しても既存の権限は壊れないか
 *   E2 認可ループにならないか
 *
 * ── 対照 ─────────────────────────────────────────────
 * 「壊れなかった」を言うには「拒否の前に通っていた」が要る。
 * 同じスクリプトの中で、拒否の **前後** に同じ操作を投げる。
 */

import { randomBytes } from 'node:crypto'

import { MCP_SERVER_URL, defaultResourceMetadataUrl } from './config.ts'
import { startRecording } from './evidence.ts'
import { callTool, describeToolResult, resetSession } from './mcp.ts'
import {
  buildAuthorizationUrl,
  createPkce,
  discoverAuthorizationServer,
  discoverProtectedResource,
  waitForCallback,
} from './oauth.ts'
import { addFinding, load, type ClientInfo, type TokenSet } from './store.ts'

const client = load<ClientInfo>('client')
const tokens = load<TokenSet>('tokens')
if (!client || !tokens) throw new Error('先に ./run connect')

const done = startRecording('denytest')
const probe = async (when: string) => {
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
  console.log(`  [${when}] whoami系(account:read)=HTTP ${acc.httpStatus} / D1一覧(d1.read)=HTTP ${d1.httpStatus} 件数=${count ?? '?'}`)
  return { accounts: acc.httpStatus, d1: d1.httpStatus, d1Count: count }
}

console.log('\n━━━ 拒否の前（対照）━━━\n')
const before = await probe('前')

const prm = await discoverProtectedResource(defaultResourceMetadataUrl(MCP_SERVER_URL))
const asm = await discoverAuthorizationServer(prm.authorization_servers![0])
const pkce = createPkce()
const state = randomBytes(16).toString('base64url')
const authUrl = buildAuthorizationUrl({
  authorizationEndpoint: asm.authorization_endpoint,
  clientId: client.client_id,
  scope: `${tokens.granted_scope} workers-kv-storage.read`,
  pkce,
  state,
})

console.log('\n━━━ 追加認可を要求して、拒否してもらう ━━━\n')
console.log('  ★ ブラウザで開いて **Cancel** を押してください:\n')
console.log(`  ${authUrl}\n`)
console.log('  待機中…（10分でタイムアウト）')

const cb = await waitForCallback(state)
console.log('\n━━━ 戻り ━━━\n')
console.log(`  ok                : ${cb.ok}`)
if (!cb.ok) {
  console.log(`  error             : ${cb.error}`)
  console.log(`  error_description : ${cb.errorDescription ?? '(なし)'}`)
  console.log(`  生のクエリ        : ${cb.raw}`)
}

console.log('\n━━━ 拒否の後 ━━━\n')
const after = await probe('後')

const intact = before.accounts === after.accounts && before.d1 === after.d1
console.log(`\n  → 既存の権限は ${intact ? '壊れていない' : '★ 変化した'}`)

addFinding('experimentE', {
  ranAt: new Date().toISOString(),
  before,
  denyCallback: cb,
  after,
  existingScopesIntact: intact,
  note: 'E2(ループ)は自前クライアントでは測れない（再試行するのはクライアント実装の仕事）。Claude Code 側の _maxStepUpRetries はバイナリで確認済み',
})
done()
