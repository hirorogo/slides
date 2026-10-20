/**
 * 実験D-1 の対照 ―― 「過去の付与ゼロ」のクライアントで同じことをする。★ブラウザ操作が要る（承認は不要）
 *
 * D-1 の結果はこうだった：
 *
 *   要求 : d1.read
 *   付与 : d1.read user:read offline_access account:read
 *
 * 要求していない3つが残った。だが**これだけでは「保持された」と言えない。**
 * 候補が3つあって、D-1 では切り分けられない：
 *
 *   ① 前回付与したものを認可サーバーが保持している（＝Changelog の主張）
 *   ② DCR の登録時に `scope: "user:read account:read"` を渡した（← こちらの作り込み。交絡）
 *   ③ リソースの baseline を既定で出しているだけ
 *
 * この対照は ② と ③ を潰す：
 *
 *   - **新しいクライアント**を登録する（過去の付与ゼロ）
 *   - 登録時の `scope` も **d1.read だけ**にする（② を消す）
 *   - 同じ `scope=d1.read` で認可画面を出す
 *
 * 同意画面に Account Read が出るか出ないかで決まる：
 *
 *   出ない → D-1 で残ったのは **①＝認可サーバーが過去の付与を保持している**
 *   出る   → ③。C3 は別の方法で測り直す
 *
 * ⚠️ **承認しない。** 画面を見て Cancel する。
 *    Cancel の戻り（error=access_denied）はそのまま実験E の素材になる。
 */

import { randomBytes } from 'node:crypto'

import { MCP_SERVER_URL, REDIRECT_URI, defaultResourceMetadataUrl } from './config.ts'
import { startRecording } from './evidence.ts'
import { postJson } from './http.ts'
import {
  buildAuthorizationUrl,
  createPkce,
  discoverAuthorizationServer,
  discoverProtectedResource,
  waitForCallback,
} from './oauth.ts'
import { addFinding, load, type TokenSet } from './store.ts'

const previous = load<TokenSet>('tokens')
const done = startRecording('freshclient')

const prm = await discoverProtectedResource(defaultResourceMetadataUrl(MCP_SERVER_URL))
const asm = await discoverAuthorizationServer(prm.authorization_servers![0])

console.log('\n━━━ 対照用に新しいクライアントを登録する ━━━\n')
console.log('  D-1 のクライアントとの違いは2つだけ:')
console.log('    - 過去に一度も認可されていない')
console.log('    - DCR の scope が "d1.read" だけ（baseline を入れない）\n')

const reg = await postJson('DCR: register (control client)', asm.registration_endpoint!, {
  client_name: 'mcp-stepup-sandbox CONTROL (no prior grant)',
  redirect_uris: [REDIRECT_URI],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
  scope: 'd1.read',
})
if (reg.status !== 200 && reg.status !== 201) {
  throw new Error(`DCR 失敗: HTTP ${reg.status} ${JSON.stringify(reg.body)}`)
}
const controlClientId = String((reg.body as any).client_id)
console.log(`  対照クライアント: ${controlClientId}`)
console.log(`  D-1 クライアント: ${load<any>('client')?.client_id}`)

const pkce = createPkce()
const state = randomBytes(16).toString('base64url')
const authUrl = buildAuthorizationUrl({
  authorizationEndpoint: asm.authorization_endpoint,
  clientId: controlClientId,
  scope: 'd1.read',
  pkce,
  state,
})

console.log('\n  ★ ブラウザで開いて、同意画面を見るだけ。**承認しないでください**:\n')
console.log(`  ${authUrl}\n`)
console.log('  見てほしいこと:')
console.log('    - REQUIRED に何が入っているか（User Read / Background Access は出るか）')
console.log('    - ADDITIONAL ACCESS に **Account Read が出るか**  ← ここが本題')
console.log('    - total permissions の数（D-1 は 4 だった）')
console.log('\n  確認したら **Cancel** を押してください（拒否時の挙動＝実験E も同時に取ります）')
console.log('\n  待機中…（10分でタイムアウト）')

const cb = await waitForCallback(state)

console.log('\n━━━ Cancel の戻り（実験E）━━━\n')
if (cb.ok) {
  console.log('  ⚠️ 承認されました。対照としては Cancel のほうが良かったのですが、観測は残します。')
} else {
  console.log(`  error             : ${cb.error}`)
  console.log(`  error_description : ${cb.errorDescription ?? '(なし)'}`)
  console.log(`  生のクエリ        : ${cb.raw}`)
}

addFinding('control_freshClient', {
  ranAt: new Date().toISOString(),
  purpose: 'D-1 で残ったScopeが「過去の付与の保持」か「登録scope/baseline の既定」かを切り分ける',
  controlClientId,
  priorGrantClientId: load<any>('client')?.client_id ?? null,
  registeredScope: 'd1.read',
  requestedScope: 'd1.read',
  callback: cb,
  note: '同意画面の内容は人間の観測（スクリーンショット）で補う',
})

console.log('\n  → 同意画面に Account Read が出たかどうかを教えてください。')
done()
