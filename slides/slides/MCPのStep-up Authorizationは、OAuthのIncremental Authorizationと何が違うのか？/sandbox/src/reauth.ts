/**
 * 実験C / D ―― 追加認可。★ブラウザ操作が要る
 *
 * ここが記事の決着点。claims.md の C2 / C3。
 *
 *   「既に付与したScopeは保たれる」（Cloudflare Changelog）
 *   「和集合を作るのはクライアント」（MCP 2026-07-28 / SEP-2350）
 *
 * この2つは**両立する**ので、文章だけでは誰が保っているのか分からない。
 * 切り分けは1つしかない：**和集合を作らずに再認可してみる。**
 *
 *   ./run reauth --scope "d1.read" --label D1-no-union
 *       → 付与Scopeに user:read / account:read が残っていれば、保っているのは AS
 *       → d1.read だけになれば、保っているのはクライアントの和集合だけ
 *
 *   ./run reauth --challenge --label D2-union
 *       → 403 が名指しした scope をそのまま要求する（普通のクライアントの動き）
 *
 * SDK を使っていないのは、この D-1 を作るため。
 * `@modelcontextprotocol/client` は 403 を見た時点で勝手に和集合にしてしまう。
 *
 * ⚠️ 直前のトークンは data/tokens-history.json に積む。上書きで消さない。
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
  exchangeCode,
  scopeDiff,
  scopeUnion,
  waitForCallback,
} from './oauth.ts'
import { addFinding, load, save, type ClientInfo, type TokenSet } from './store.ts'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (name: string) => args.includes(`--${name}`)

const label = flag('label') ?? 'reauth'
const explicitScope = flag('scope')
const useChallenge = has('challenge')

const client = load<ClientInfo>('client')
const previous = load<TokenSet>('tokens')
if (!client || !previous) throw new Error('先に ./run probe と ./run connect を実行してください')

const done = startRecording(`reauth-${label}`)

const prm = await discoverProtectedResource(defaultResourceMetadataUrl(MCP_SERVER_URL))
const asm = await discoverAuthorizationServer(prm.authorization_servers![0])

/** どのScopeを要求するか。**ここを暗黙に決めないのがこの実験の肝。** */
let requestedScope: string
let challengeScope: string | null = null

if (useChallenge) {
  console.log('\n━━━ 403 を踏んでチャレンジの scope を取る ━━━\n')
  resetSession()
  const res = await callTool(
    'execute',
    { code: `async () => cloudflare.request({ method: "GET", path: "/accounts/${flag('account') ?? ''}/r2/buckets" })` },
    previous.access_token,
  )
  challengeScope = res.challenge?.scope ?? null
  console.log(`  WWW-Authenticate: ${res.headers['www-authenticate'] ?? '(なし)'}`)
  if (!challengeScope) throw new Error('チャレンジが取れませんでした。--scope で明示してください')
  requestedScope = challengeScope
} else if (explicitScope) {
  requestedScope = explicitScope
} else {
  throw new Error('--scope "<scope>" か --challenge を指定してください')
}

const heldBefore = previous.granted_scope ?? previous.requested_scope
const union = scopeUnion(heldBefore, requestedScope)

console.log(`\n━━━ 実験 ${label} ━━━\n`)
console.log(`  いま持っているScope : ${heldBefore}`)
if (challengeScope) console.log(`  チャレンジの scope  : ${challengeScope}`)
console.log(`  今回要求するScope   : ${requestedScope}`)
console.log(`  （和集合なら        : ${union}）`)
const dropped = scopeDiff(requestedScope, heldBefore)
if (dropped.length) {
  console.log(`  ★ 今回あえて要求しない（持っていたもの）: ${dropped.join(' ')}`)
  console.log('     → 再認可後もこれが残っていれば、保っているのは認可サーバー側')
}

const pkce = createPkce()
const state = randomBytes(16).toString('base64url')
const authUrl = buildAuthorizationUrl({
  authorizationEndpoint: asm.authorization_endpoint,
  clientId: client.client_id,
  scope: requestedScope,
  pkce,
  state,
})

console.log('\n  ★ ブラウザで次のURLを開いて承認してください:\n')
console.log(`  ${authUrl}\n`)
console.log('  同意画面で見てほしいこと:')
console.log('    - 初回と同じ画面か、「追加分だけ」の画面か')
console.log('    - 既に許可したはずの権限が、再度チェックされた状態で出るか')
console.log('\n  待機中…（10分でタイムアウト）')

const cb = await waitForCallback(state)
if (!cb.ok) {
  console.log(`\n  × 認可されませんでした: error=${cb.error} ${cb.errorDescription ?? ''}`)
  addFinding(`reauth_${label}`, { ok: false, callback: cb, requestedScope, heldBefore })
  done()
  process.exit(1)
}

const { tokens, status, body } = await exchangeCode({
  tokenEndpoint: asm.token_endpoint,
  clientId: client.client_id,
  code: cb.code,
  pkce,
  requestedScope,
  round: previous.round + 1,
})
if (!tokens) {
  console.log(`\n  × トークン交換に失敗: HTTP ${status} ${JSON.stringify(body)}`)
  addFinding(`reauth_${label}`, { ok: false, tokenExchange: { status, body }, requestedScope, heldBefore })
  done()
  process.exit(1)
}

// 履歴に積んでから差し替える（上書きで消さない）
const history = load<TokenSet[]>('tokens-history') ?? []
history.push(previous)
save('tokens-history', history)
save('tokens', tokens)

const granted = tokens.granted_scope ?? ''
const grantedSet = granted.split(/\s+/).filter(Boolean)
const keptWithoutAsking = dropped.filter((s) => grantedSet.includes(s))

/**
 * ⚠️ 「要求しなかったのに残った」だけでは AS の保持とは言えない。
 *
 * Cloudflare の同意画面は baseline（User Read / Background Access / Account Read）を
 * **過去の付与に関係なく毎回出す**。対照（過去の付与ゼロのクライアント）で確認済み。
 * なので判定は baseline を除いて見る。
 */
const BASELINE = new Set([...(prm.scopes_supported ?? []), 'offline_access'])
const keptBaseline = keptWithoutAsking.filter((s) => BASELINE.has(s))
const keptNonBaseline = keptWithoutAsking.filter((s) => !BASELINE.has(s))
const gainedUnrequested = scopeDiff(requestedScope, granted)

console.log('\n━━━ 結果 ━━━\n')
console.log(`  要求した scope  : ${requestedScope}`)
console.log(`  付与された scope: ${granted || '(レスポンスに scope なし)'}`)
console.log(`  要求=付与か     : ${granted === requestedScope}`)
if (gainedUnrequested.length) console.log(`  ★ 要求していないのに付いた: ${gainedUnrequested.join(' ')}`)
if (dropped.length) {
  const droppedNonBaseline = dropped.filter((s) => !BASELINE.has(s))
  console.log(`\n  ★ あえて要求しなかったもの: ${dropped.join(' ')}`)
  console.log(`     うち baseline     : ${keptBaseline.join(' ') || 'なし'} → 残った（過去の付与と無関係に毎回付く）`)
  console.log(`     うち baseline以外 : ${droppedNonBaseline.join(' ') || 'なし'}`)
  if (droppedNonBaseline.length === 0) {
    console.log('     → baseline しか落としていないので、**この回では保持の有無を判定できない**')
  } else if (keptNonBaseline.length) {
    console.log(`     → ${keptNonBaseline.join(' ')} が残った = **認可サーバーが過去の付与を保持している**`)
  } else {
    console.log(`     → ${droppedNonBaseline.join(' ')} は消えた = **保持しない。和集合を作るのはクライアントの仕事**`)
  }
}

console.log('\n━━━ 新しいトークンで実際に叩く ━━━\n')
resetSession()
const who = describeToolResult(await callTool('whoami', {}, tokens.access_token))
console.log(`  whoami（user:read が要る）: HTTP ${who.httpStatus}${who.isError ? ' (isError)' : ''}`)
console.log(`    ${who.text.replace(/\s+/g, ' ').slice(0, 160)}`)

addFinding(`reauth_${label}`, {
  ok: true,
  ranAt: new Date().toISOString(),
  heldBefore,
  challengeScope,
  requestedScope,
  wouldBeUnion: union,
  grantedScope: granted,
  requestedEqualsGranted: granted === requestedScope,
  deliberatelyDropped: dropped,
  keptWithoutAsking,
  keptBaseline,
  keptNonBaseline,
  baselineConsideredAsAlwaysGranted: [...BASELINE],
  gainedUnrequested,
  round: tokens.round,
  whoamiAfter: { status: who.httpStatus, isError: who.isError, excerpt: who.text.slice(0, 200) },
})

done()
