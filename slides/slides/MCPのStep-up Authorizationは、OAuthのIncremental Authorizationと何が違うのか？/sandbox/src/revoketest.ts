/**
 * 主張 C1'（claims.md）―― **失効したトークン**は 401 invalid_token か、403 insufficient_scope か。
 *
 * 実験0-6 で分かっていたのは「一度も発行されていない 40文字以上の文字列」が
 * `403 insufficient_scope` を返すこと。だが実務で起きるのはこっちではない。
 * クライアントが実際に持っていたトークンが**失効した**ときどうなるか、が本番。
 *
 * これが 403 insufficient_scope なら、MCP 仕様ではそれは **step-up の発火点**なので、
 * クライアントは「サインインし直して」ではなく「**追加の権限をください**」とユーザーに出す。
 *
 * ⚠️ **不可逆。** 他の検証を全部終えてから実行する（ユーザー合意済み・2026-10-20）。
 *
 * ── 順番と対照 ───────────────────────────────────────
 *   ① 失効前に同じ操作が通ることを確認（対照）
 *   ② access_token だけを revoke
 *   ③ 失効した access_token で同じ操作 → ここが本題
 *   ④ refresh がまだ効くか（access_token だけの失効か）
 *   ⑤ refresh_token も revoke
 *   ⑥ もう一度 refresh → 本当に全部切れたか
 *
 * 送ったトークンは指紋で記録する。「同じものを送った」が後から示せるように。
 */

import { MCP_SERVER_URL, defaultResourceMetadataUrl } from './config.ts'
import { fingerprint, startRecording } from './evidence.ts'
import { postForm } from './http.ts'
import { callTool, describeToolResult, resetSession } from './mcp.ts'
import { discoverAuthorizationServer, discoverProtectedResource } from './oauth.ts'
import { addFinding, load, type ClientInfo, type TokenSet } from './store.ts'

const client = load<ClientInfo>('client')
const tokens = load<TokenSet>('tokens')
if (!client || !tokens) throw new Error('トークンがありません')

const done = startRecording('revoketest')
const prm = await discoverProtectedResource(defaultResourceMetadataUrl(MCP_SERVER_URL))
const asm = await discoverAuthorizationServer(prm.authorization_servers![0])
const revocationEndpoint = (asm.revocation_endpoint as string) ?? asm.token_endpoint

const probe = async (when: string, token: string) => {
  resetSession()
  const res = await callTool('whoami', {}, token)
  const d = describeToolResult(res)
  const row = {
    when,
    httpStatus: d.httpStatus,
    error: d.challengeFromHeader?.error ?? null,
    wwwAuthenticate: res.headers['www-authenticate'] ?? null,
    bodyError: (res.body as any)?.error ?? null,
    bodyErrorDescription: (res.body as any)?.error_description ?? null,
  }
  console.log(`  [${when}] HTTP ${row.httpStatus}  error=${row.error ?? '(なし)'}  ${row.bodyErrorDescription ?? ''}`)
  return row
}

console.log('\n━━━ 対象のトークン（指紋のみ）━━━\n')
console.log(`  access_token : ${JSON.stringify(fingerprint(tokens.access_token))}`)
console.log(`  refresh_token: ${tokens.refresh_token ? JSON.stringify(fingerprint(tokens.refresh_token)) : '(なし)'}`)
console.log(`  付与Scope    : ${tokens.granted_scope}`)
console.log(`  revocation_endpoint: ${revocationEndpoint}`)

console.log('\n━━━ ① 失効前（対照）━━━\n')
const before = await probe('失効前', tokens.access_token)

console.log('\n━━━ ② access_token を revoke（RFC 7009）━━━\n')
const rev1 = await postForm('revoke: access_token', revocationEndpoint, {
  token: tokens.access_token,
  token_type_hint: 'access_token',
  client_id: client.client_id,
})
console.log(`  HTTP ${rev1.status}  ${JSON.stringify(rev1.body).slice(0, 160)}`)

console.log('\n━━━ ③ 失効した access_token で同じ操作（本題）━━━\n')
const after = await probe('失効後', tokens.access_token)

const verdict =
  after.httpStatus === 401 && after.error === 'invalid_token'
    ? '401 invalid_token（RFC 6750 どおり。step-up は起動しない）'
    : after.httpStatus === 403 && after.error === 'insufficient_scope'
      ? '★ 403 insufficient_scope（step-up の発火点。「権限をください」になる）'
      : `その他（HTTP ${after.httpStatus} / ${after.error}）`
console.log(`\n  → ${verdict}`)

console.log('\n━━━ ④ refresh はまだ効くか ━━━\n')
let refreshAfterAccessRevoke: Record<string, unknown> | null = null
if (tokens.refresh_token) {
  const r = await postForm('token: refresh (access revoked)', asm.token_endpoint, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: client.client_id,
    resource: MCP_SERVER_URL,
  })
  refreshAfterAccessRevoke = { status: r.status, error: (r.body as any)?.error ?? null }
  console.log(`  HTTP ${r.status}  ${(r.body as any)?.error ?? '成功（新しいaccess_tokenが出た）'}`)
}

console.log('\n━━━ ⑤ refresh_token も revoke ━━━\n')
let rev2status: number | null = null
if (tokens.refresh_token) {
  const r = await postForm('revoke: refresh_token', revocationEndpoint, {
    token: tokens.refresh_token,
    token_type_hint: 'refresh_token',
    client_id: client.client_id,
  })
  rev2status = r.status
  console.log(`  HTTP ${r.status}  ${JSON.stringify(r.body).slice(0, 160)}`)
}

console.log('\n━━━ ⑥ もう一度 refresh ━━━\n')
let refreshAfterFullRevoke: Record<string, unknown> | null = null
if (tokens.refresh_token) {
  const r = await postForm('token: refresh (fully revoked)', asm.token_endpoint, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: client.client_id,
    resource: MCP_SERVER_URL,
  })
  refreshAfterFullRevoke = { status: r.status, error: (r.body as any)?.error ?? null, description: (r.body as any)?.error_description ?? null }
  console.log(`  HTTP ${r.status}  ${(r.body as any)?.error ?? '(まだ通る)'}  ${(r.body as any)?.error_description ?? ''}`)
}

addFinding('experimentC1prime_revoke', {
  ranAt: new Date().toISOString(),
  accessTokenFingerprint: fingerprint(tokens.access_token),
  grantedScope: tokens.granted_scope,
  revocationEndpoint,
  before,
  revokeAccessStatus: rev1.status,
  after,
  verdict,
  refreshAfterAccessRevoke,
  revokeRefreshStatus: rev2status,
  refreshAfterFullRevoke,
  comparisonWithNeverIssued: {
    neverIssued40plus: '403 insufficient_scope "Token lacks required user:read or account:read scope"',
    malformed: '401 invalid_token "Access token appears malformed"',
  },
})
done()
