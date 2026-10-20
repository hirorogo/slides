/**
 * C1 の追試 ―― **別リソース向けの正規トークン**を投げたらどうなるか。★ブラウザ操作が要る
 *
 * これまでに分かっていること:
 *
 *   一度も発行されていない40文字以上の文字列 → 403 insufficient_scope   ← 仕様とズレる
 *   壊れた文字列 / 39文字以下                → 401 invalid_token       ← 仕様どおり
 *   revoke 済みの実トークン                  → 401 invalid_token       ← 仕様どおり
 *
 * 残っている穴：**他のリソース向けに正規発行されたトークン**。
 * Cloudflare は MCP サーバーを複数ホストしていて、それぞれ別の Authorization Server を持つ。
 *
 *   https://mcp.cloudflare.com/mcp           ← 本命
 *   https://browser.mcp.cloudflare.com/mcp   ← 別リソース・別AS
 *
 * 複数を登録したユーザーのクライアントが取り違えるのは**現実に起こりうる**。
 * ここで 403 insufficient_scope が返るなら、C1 は机上の話ではなくなる
 *（クライアントは「サインインし直して」ではなく「**追加の権限をください**」を出す）。
 *
 * ── 対照 ─────────────────────────────────────────────
 * 「他所のトークンが403になる」を言うには「そのトークンが本来の相手では通る」が要る。
 *   ① browser 用トークンを browser に投げる → 200 のはず（対照）
 *   ② 同じトークンを mcp.cloudflare.com に投げる → ここが本題
 * 送ったトークンの指紋を両方に出して、**同じものを投げた**ことを示す。
 */

import { randomBytes } from 'node:crypto'

import { MCP_PROTOCOL_VERSION, REDIRECT_URI } from './config.ts'
import { fingerprint, startRecording } from './evidence.ts'
import { postForm, postJson, send } from './http.ts'
import { buildAuthorizationUrl, createPkce, waitForCallback } from './oauth.ts'
import { addFinding } from './store.ts'

const OTHER = 'https://browser.mcp.cloudflare.com/mcp'
const TARGET = 'https://mcp.cloudflare.com/mcp'

const done = startRecording('crossresource')

const prmRes = await send('discovery: other PRM', 'https://browser.mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp')
const prm = prmRes.body as any
const issuer = prm.authorization_servers[0]
const asmRes = await send('discovery: other AS', `${issuer}/.well-known/oauth-authorization-server`)
const asm = asmRes.body as any

console.log('\n━━━ 別リソース ━━━\n')
console.log(`  resource : ${prm.resource}`)
console.log(`  issuer   : ${asm.issuer}`)
console.log(`  scopes   : ${JSON.stringify(prm.scopes_supported ?? null)}`)

const reg = await postJson('DCR: register (cross-resource)', asm.registration_endpoint, {
  client_name: 'mcp-stepup-sandbox CROSS-RESOURCE',
  redirect_uris: [REDIRECT_URI],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
})
const clientId = String((reg.body as any).client_id)
console.log(`  client_id: ${clientId}`)

const pkce = createPkce()
const state = randomBytes(16).toString('base64url')
const authUrl = buildAuthorizationUrl({
  authorizationEndpoint: asm.authorization_endpoint,
  clientId,
  scope: (prm.scopes_supported ?? []).join(' '),
  pkce,
  state,
  resource: OTHER,
})

console.log('\n  ★ ブラウザで開いて承認してください（browser.mcp.cloudflare.com 向け）:\n')
console.log(`  ${authUrl}\n`)
console.log('  待機中…（10分でタイムアウト）')

const cb = await waitForCallback(state)
if (!cb.ok) {
  console.log(`\n  × 認可されませんでした: ${cb.error}`)
  addFinding('crossResource', { ok: false, callback: cb })
  done()
  process.exit(1)
}

const tok = await postForm('token: cross-resource', asm.token_endpoint, {
  grant_type: 'authorization_code',
  code: cb.code,
  redirect_uri: REDIRECT_URI,
  client_id: clientId,
  code_verifier: pkce.verifier,
  resource: OTHER,
})
if (tok.status !== 200) {
  console.log(`\n  × トークン交換失敗: HTTP ${tok.status} ${JSON.stringify(tok.body)}`)
  addFinding('crossResource', { ok: false, tokenExchange: { status: tok.status, body: tok.body } })
  done()
  process.exit(1)
}
const accessToken = String((tok.body as any).access_token)
const grantedScope = (tok.body as any).scope ?? null
const fp = fingerprint(accessToken)

console.log('\n━━━ 取れたトークン ━━━\n')
console.log(`  指紋   : ${JSON.stringify(fp)}`)
console.log(`  付与   : ${grantedScope ?? '(なし)'}`)
console.log(`  audience(resource): ${OTHER}`)

const callMcp = async (label: string, url: string) => {
  const res = await send(label, url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      'Mcp-Method': 'tools/list',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': { name: 'mcp-stepup-sandbox', version: '0.1.0' },
        },
      },
    }),
  })
  console.log(`  ${label}`)
  console.log(`    送ったトークンの指紋: ${JSON.stringify(fp)}`)
  console.log(`    HTTP ${res.status}  error=${res.challenge?.error ?? '(なし)'}`)
  console.log(`    WWW-Authenticate: ${res.headers['www-authenticate'] ?? '(なし)'}`)
  const b = res.body as any
  if (b?.error_description) console.log(`    ${b.error_description}`)
  return { status: res.status, error: res.challenge?.error ?? null, www: res.headers['www-authenticate'] ?? null, description: b?.error_description ?? null }
}

console.log('\n━━━ ① 対照: 本来の相手に投げる ━━━\n')
const own = await callMcp('browser.mcp.cloudflare.com へ', OTHER)

console.log('\n━━━ ② 本題: 別リソースに投げる ━━━\n')
const cross = await callMcp('mcp.cloudflare.com へ（他所のトークン）', TARGET)

const verdict =
  own.status !== 200
    ? '⚠️ 対照が成立していない（本来の相手でも通らない）。この結果からは何も言えない'
    : cross.status === 401 && cross.error === 'invalid_token'
      ? '401 invalid_token（仕様どおり。step-up は起動しない）'
      : cross.status === 403 && cross.error === 'insufficient_scope'
        ? '★ 403 insufficient_scope（step-up の発火点。C1 の現実的な契機になる）'
        : `その他（HTTP ${cross.status} / ${cross.error}）`

console.log(`\n━━━ 判定 ━━━\n\n  ${verdict}`)

addFinding('crossResource', {
  ok: true,
  ranAt: new Date().toISOString(),
  otherResource: OTHER,
  targetResource: TARGET,
  tokenFingerprint: fp,
  grantedScope,
  control_ownResource: own,
  test_crossResource: cross,
  verdict,
})
done()
