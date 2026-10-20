/**
 * 実験0 ―― ユーザー操作なしで取れるものを全部取る。
 *
 * ブラウザを開く前にここを通す。理由は2つ。
 *
 * 1. **検証順序の罠**。Step-up を見る前に「認可なしだとどうなるか」を押さえないと、
 *    403 が出なかったときに「権限が足りていた」のか「そもそも届いていない」のか切り分けられない。
 * 2. **対照**。401 と 403 を区別するには、401 側を先に実測しておく必要がある。
 *
 * 対照は同じスクリプトの中に並べる。別々に走らせると条件が揃わない。
 */

import { randomBytes } from 'node:crypto'

import { MCP_PROTOCOL_VERSION, MCP_SERVER_URL, defaultResourceMetadataUrl } from './config.ts'
import { startRecording } from './evidence.ts'
import { send } from './http.ts'
import { legacyInitialize, resetSession } from './mcp.ts'
import {
  discoverAuthorizationServer,
  discoverProtectedResource,
  registerClient,
} from './oauth.ts'
import { addFinding, load, type ClientInfo } from './store.ts'

function line(label: string, value: unknown) {
  console.log(`  ${label.padEnd(34)} ${value}`)
}

const done = startRecording('probe')

console.log('\n━━━ 実験0-1  認可なしで叩く（対照の基準）━━━\n')
resetSession()
const anon = await legacyInitialize(undefined)
line('HTTP', `${anon.status} ${anon.statusText}`)
line('WWW-Authenticate', anon.headers['www-authenticate'] ?? '(なし)')
line('challenge.scope', anon.challenge?.scope ?? '(なし)')
line('challenge.error', anon.challenge?.error ?? '(なし)')
line('challenge.resource_metadata', anon.challenge?.resource_metadata ?? '(なし)')

console.log('\n━━━ 実験0-2  対照: 壊れたトークン ━━━\n')
console.log('  「403が出ない」が権限の話なのか認証の話なのかを切り分けるための対照。\n')

const controls: Array<{ name: string; token: string }> = [
  { name: '明らかに不正な文字列', token: 'not-a-real-token' },
  { name: 'ランダム32バイト(base64url)', token: randomBytes(32).toString('base64url') },
  { name: '空文字', token: '' },
]
const controlResults: Array<Record<string, unknown>> = []
for (const c of controls) {
  resetSession()
  const res = await legacyInitialize(c.token)
  controlResults.push({
    control: c.name,
    status: res.status,
    error: res.challenge?.error ?? null,
    scope: res.challenge?.scope ?? null,
  })
  line(c.name, `HTTP ${res.status}  error=${res.challenge?.error ?? '(なし)'}`)
}

console.log('\n━━━ 実験0-3  メタデータ（2つの scopes_supported）━━━\n')
const prmUrl = anon.challenge?.resource_metadata ?? defaultResourceMetadataUrl(MCP_SERVER_URL)
const prm = await discoverProtectedResource(prmUrl)
line('PRM resource', prm.resource)
line('PRM resource_name', prm.resource_name ?? '(なし)')
line('PRM scopes_supported', `${prm.scopes_supported?.length ?? 0} 個  ${JSON.stringify(prm.scopes_supported)}`)
line('PRM authorization_servers', JSON.stringify(prm.authorization_servers))

const issuer = prm.authorization_servers?.[0]
if (!issuer) throw new Error('authorization_servers が無い')
const asm = await discoverAuthorizationServer(issuer)
line('AS issuer', asm.issuer)
line('AS scopes_supported', `${asm.scopes_supported?.length ?? 0} 個`)
line('AS registration_endpoint', asm.registration_endpoint ?? '(なし)')
line('AS code_challenge_methods', JSON.stringify(asm.code_challenge_methods_supported))
line('AS CIMD supported', String(asm.client_id_metadata_document_supported ?? '(宣言なし)'))

const prmScopes = prm.scopes_supported ?? []
const asScopes = asm.scopes_supported ?? []
line('→ 比', `PRM ${prmScopes.length} : AS ${asScopes.length}`)
line('→ 401 の scope と PRM は一致?', String((anon.challenge?.scope ?? '') === prmScopes.join(' ')))
line('→ offline_access は AS だけ?', String(asScopes.includes('offline_access') && !prmScopes.includes('offline_access')))

console.log('\n━━━ 実験0-4  プロトコルバージョンを変えても401は同じか ━━━\n')
const versions = ['2026-07-28', '2025-11-25', '2025-06-18']
const byVersion: Array<Record<string, unknown>> = []
for (const v of versions) {
  const res = await send(`mcp: initialize (protocol ${v})`, MCP_SERVER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': v,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: v, capabilities: {}, clientInfo: { name: 'probe', version: '0' } },
    }),
  })
  byVersion.push({ version: v, status: res.status, scope: res.challenge?.scope ?? null })
  line(v, `HTTP ${res.status}  scope=${res.challenge?.scope ?? '(なし)'}`)
}

console.log('\n━━━ 実験0-5  Dynamic Client Registration ━━━\n')
let client = load<ClientInfo>('client')
if (client) {
  line('既存のクライアントを再利用', client.client_id)
} else {
  if (!asm.registration_endpoint) throw new Error('registration_endpoint が無い')
  client = await registerClient(asm.registration_endpoint, prmScopes.join(' '))
  line('登録した client_id', client.client_id)
  line('client_secret', client.client_secret ? '発行された' : '発行されない（public client）')
}
line('redirect_uri', client.redirect_uris[0])

addFinding('experiment0', {
  ranAt: new Date().toISOString(),
  mcpServerUrl: MCP_SERVER_URL,
  protocolVersion: MCP_PROTOCOL_VERSION,
  unauthenticated: {
    status: anon.status,
    wwwAuthenticate: anon.headers['www-authenticate'] ?? null,
    challenge: anon.challenge,
  },
  controls: controlResults,
  protectedResourceMetadata: prm,
  authorizationServerMetadata: {
    ...asm,
    scopes_supported: `${asScopes.length} 個（全文は data/ の生ログ）`,
  },
  scopeCounts: { prm: prmScopes.length, as: asScopes.length },
  byProtocolVersion: byVersion,
  client: { client_id: client.client_id, public: !client.client_secret },
})

console.log('\n━━━ まとめ ━━━\n')
line('初期Scope（401が名指し）', anon.challenge?.scope ?? '(なし)')
line('カタログ全体', `${asScopes.length} 個`)
line('クライアント登録', client.client_id)
console.log('\n  次: ./run connect  （★ブラウザ操作が要る）')

done()
