/**
 * 実験D1（claims.md）―― refresh では Scope を広げられないか。ユーザー操作は不要。
 *
 * RFC 6749 §6:
 *   "The requested scope MUST NOT include any scope not originally granted
 *    by the resource owner, and if omitted is treated as equal to the scope
 *    originally granted by the resource owner."
 *
 * これが成り立つなら、**追加認可は必ずブラウザに戻る**。
 * Claude Code が Step-up 保留中に refresh_token を伏せる理由もこれ
 *（バイナリのログ文字列 "Step-up pending (…), omitting refresh_token"）。
 *
 * ── 対照 ─────────────────────────────────────────────
 * 「広げられない」を主張するには「普通の refresh は通る」が要る。
 * 同じスクリプトの中に並べる。
 *
 *   ① scope 省略        → 通るはず（= 元の付与と同じ）
 *   ② 現在より狭い scope → 通るはず（narrowing は許される）
 *   ③ 現在より広い scope → ここが本題
 *
 * ⚠️ refresh でトークンが回転する実装があるので、毎回保存し直す。
 */

import { postForm } from './http.ts'
import { MCP_SERVER_URL, defaultResourceMetadataUrl } from './config.ts'
import { startRecording, fingerprint } from './evidence.ts'
import { discoverAuthorizationServer, discoverProtectedResource, scopeDiff } from './oauth.ts'
import { addFinding, load, save, type ClientInfo, type TokenSet } from './store.ts'

const client = load<ClientInfo>('client')
const tokens = load<TokenSet>('tokens')
if (!client || !tokens?.refresh_token) throw new Error('refresh_token を持つトークンがありません')

const done = startRecording('refreshtest')
const prm = await discoverProtectedResource(defaultResourceMetadataUrl(MCP_SERVER_URL))
const asm = await discoverAuthorizationServer(prm.authorization_servers![0])

const granted = tokens.granted_scope ?? ''
console.log('\n━━━ いまの付与Scope ━━━\n')
console.log(`  ${granted}`)
console.log(`  refresh_token: ${JSON.stringify(fingerprint(tokens.refresh_token))}\n`)

let current = tokens

type Case = { name: string; scope?: string; expect: string }
const cases: Case[] = [
  { name: '① scope 省略（対照）', expect: '通る。元の付与と同じになるはず' },
  { name: '② 狭める（baseline だけ）', scope: 'user:read account:read', expect: '通る。narrowing は許される' },
  { name: '③ 広げる（未付与の workers-kv-storage.read を足す）', scope: `${granted} workers-kv-storage.read`, expect: 'RFC 6749 §6 なら拒否か無視' },
]

const results: Array<Record<string, unknown>> = []
for (const c of cases) {
  const form: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: current.refresh_token!,
    client_id: client.client_id,
    resource: MCP_SERVER_URL,
  }
  if (c.scope) form.scope = c.scope

  const res = await postForm(`token: refresh ${c.name}`, asm.token_endpoint, form)
  const b = res.body as Record<string, unknown>
  const newScope = typeof b.scope === 'string' ? b.scope : null
  const widened = c.scope ? scopeDiff(granted, newScope ?? '') : []

  console.log(`  ▸ ${c.name}`)
  console.log(`      期待      : ${c.expect}`)
  console.log(`      HTTP      : ${res.status}`)
  if (res.status === 200) {
    console.log(`      要求scope : ${c.scope ?? '(省略)'}`)
    console.log(`      付与scope : ${newScope ?? '(なし)'}`)
    console.log(`      広がったか: ${widened.length ? `★ 広がった（${widened.join(' ')}）` : '広がっていない'}`)
    // トークンが回転している可能性があるので保存し直す
    current = {
      ...current,
      access_token: String(b.access_token),
      refresh_token: b.refresh_token ? String(b.refresh_token) : current.refresh_token,
      granted_scope: newScope ?? current.granted_scope,
      obtainedAt: new Date().toISOString(),
    }
    save('tokens', current)
    console.log(`      新refresh : ${b.refresh_token ? (String(b.refresh_token) === tokens.refresh_token ? '同じ値' : '回転した') : '返ってこない'}`)
  } else {
    console.log(`      エラー    : ${JSON.stringify(res.body).slice(0, 200)}`)
  }
  results.push({
    case: c.name,
    requestedScope: c.scope ?? null,
    status: res.status,
    grantedScope: newScope,
    widenedBy: widened,
    body: res.status === 200 ? '(成功・トークンは指紋のみ生ログに)' : res.body,
  })
  console.log()
}

addFinding('experimentD1_refresh', {
  ranAt: new Date().toISOString(),
  grantedBefore: granted,
  cases: results,
  conclusion:
    results[2]?.widenedBy && (results[2].widenedBy as string[]).length === 0
      ? 'refresh では Scope を広げられない（RFC 6749 §6 どおり）→ 追加認可は必ず再認可が要る'
      : '★ refresh で Scope が広がった（RFC 6749 §6 からの逸脱）',
})

console.log('━━━ 結論 ━━━\n')
console.log(`  ${(results[2]?.widenedBy as string[])?.length ? '★ refresh で広がってしまった' : 'refresh では広がらない → 追加認可は必ずブラウザに戻る'}`)
done()
