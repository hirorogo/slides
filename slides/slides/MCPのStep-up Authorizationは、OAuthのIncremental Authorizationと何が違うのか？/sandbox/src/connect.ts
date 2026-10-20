/**
 * 実験A ―― Minimal で接続する。★ブラウザ操作が要る
 *
 * 手順の設計で1つだけ譲れないのが **順序**。
 *
 *   1. まず最小Scopeで繋いで、MCPが**普通に動く**ことを確認する
 *   2. それから 403 を踏みに行く（./run stepup）
 *
 * これをやらないと、403 が出なかったときに
 * 「権限が足りていた」のか「そもそも繋がっていない」のかが切り分けられない。
 *
 * 要求Scopeと付与Scopeは**別々に記録する**。同じとは限らない。
 */

import { randomBytes } from 'node:crypto'

import { MCP_SERVER_URL, defaultResourceMetadataUrl } from './config.ts'
import { startRecording } from './evidence.ts'
import { legacyInitialize, listTools, resetSession } from './mcp.ts'
import {
  buildAuthorizationUrl,
  createPkce,
  discoverAuthorizationServer,
  discoverProtectedResource,
  exchangeCode,
  scopeDiff,
  waitForCallback,
} from './oauth.ts'
import { addFinding, load, save, type ClientInfo, type TokenSet } from './store.ts'

const client = load<ClientInfo>('client')
if (!client) throw new Error('先に ./run probe を実行してください（DCRでクライアントを登録します）')

const done = startRecording('connect')

const prm = await discoverProtectedResource(defaultResourceMetadataUrl(MCP_SERVER_URL))
const asm = await discoverAuthorizationServer(prm.authorization_servers![0])

/** 初回に要求するのは、401 / PRM が名指しした最小Scopeだけ。 */
const requestedScope = (prm.scopes_supported ?? []).join(' ')
const pkce = createPkce()
const state = randomBytes(16).toString('base64url')
const authUrl = buildAuthorizationUrl({
  authorizationEndpoint: asm.authorization_endpoint,
  clientId: client.client_id,
  scope: requestedScope,
  pkce,
  state,
})

console.log('\n━━━ 実験A  Minimal で接続する ━━━\n')
console.log(`  要求するScope: ${requestedScope}（${requestedScope.split(' ').length} 個）`)
console.log(`  カタログ全体:   ${asm.scopes_supported?.length ?? '?'} 個`)
console.log('\n  ★ ブラウザで次のURLを開いてください:\n')
console.log(`  ${authUrl}\n`)
console.log('  同意画面で確認してほしいこと:')
console.log('    - 「Minimal」という選択肢があるか。他に何が並んでいるか')
console.log('    - 既定でどれが選ばれているか')
console.log('    - 表示されている権限の数（2個か、もっと多いか）')
console.log('  → Minimal を選んで承認してください。コールバックはこのプロセスが受け取ります。\n')
console.log('  待機中…（10分でタイムアウト）')

const cb = await waitForCallback(state)
if (!cb.ok) {
  console.log(`\n  × 認可されませんでした: error=${cb.error} ${cb.errorDescription ?? ''}`)
  addFinding('experimentA', { ok: false, callback: cb, requestedScope })
  done()
  process.exit(1)
}

console.log('\n  ✓ 認可コードを受け取りました')

const { tokens, status, body } = await exchangeCode({
  tokenEndpoint: asm.token_endpoint,
  clientId: client.client_id,
  code: cb.code,
  pkce,
  requestedScope,
  round: 1,
})
if (!tokens) {
  console.log(`\n  × トークン交換に失敗: HTTP ${status} ${JSON.stringify(body)}`)
  addFinding('experimentA', { ok: false, tokenExchange: { status, body }, requestedScope })
  done()
  process.exit(1)
}

save('tokens', tokens)

console.log('\n━━━ 要求Scope と 付与Scope ━━━\n')
console.log(`  要求した scope : ${tokens.requested_scope}`)
console.log(`  付与された scope: ${tokens.granted_scope ?? '(レスポンスに scope が無い)'}`)
console.log(`  一致するか      : ${tokens.granted_scope === tokens.requested_scope}`)
const extra = scopeDiff(tokens.requested_scope, tokens.granted_scope)
if (extra.length) console.log(`  要求していないのに付いた: ${extra.join(' ')}`)
console.log(`  token_type      : ${tokens.token_type}`)
console.log(`  refresh_token   : ${tokens.refresh_token ? 'あり' : 'なし'}`)
console.log(`  expires_in      : ${tokens.expires_in ?? '(なし)'}`)

console.log('\n━━━ まずMCPが普通に動くことを確認する（403を踏みに行く前に）━━━\n')
resetSession()
const init = await legacyInitialize(tokens.access_token)
console.log(`  initialize : HTTP ${init.status}`)
if (init.status === 200) {
  const result = (init.body as any)?.result
  console.log(`    negotiated protocolVersion: ${result?.protocolVersion}`)
  console.log(`    serverInfo: ${JSON.stringify(result?.serverInfo)}`)
}

const tools = await listTools(tokens.access_token)
console.log(`  tools/list : HTTP ${tools.status}`)
const toolList = ((tools.body as any)?.result?.tools ?? []) as Array<{ name: string; description?: string }>
for (const t of toolList) {
  console.log(`    - ${t.name}: ${(t.description ?? '').split('\n')[0].slice(0, 90)}`)
}

addFinding('experimentA', {
  ok: true,
  ranAt: new Date().toISOString(),
  requestedScope: tokens.requested_scope,
  grantedScope: tokens.granted_scope ?? null,
  scopesMatch: tokens.granted_scope === tokens.requested_scope,
  tokenType: tokens.token_type,
  hasRefreshToken: Boolean(tokens.refresh_token),
  expiresIn: tokens.expires_in ?? null,
  initialize: {
    status: init.status,
    negotiatedProtocolVersion: (init.body as any)?.result?.protocolVersion ?? null,
    serverInfo: (init.body as any)?.result?.serverInfo ?? null,
  },
  toolsList: { status: tools.status, tools: toolList.map((t) => t.name) },
})

console.log('\n  次: ./run discover  （403 を踏めそうなAPIを探す。ユーザー操作は不要）')
done()
