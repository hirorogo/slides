/**
 * Google OAuth + DPoP の検証用サーバー（Hono）。
 *
 * ブラウザから順に踏んでいくだけで、認可 → Refresh Token 取得 → Refresh まで通せる。
 *
 *   1. http://localhost:3000 を開く
 *   2. 「認可する」で Google の同意画面へ
 *   3. 戻ってくると、DPoP proof 付きで認可コードを交換する
 *   4. 「Refresh する」で Refresh Token を使ってみる
 *
 * 失敗ケースの検証（鍵違い・jti 再利用・iat のスキューなど）は
 * `npm run experiments` の方でやる。
 */

import { Hono } from 'hono'
import { serve } from '@hono/node-server'

import { PORT, REDIRECT_URI, SCOPE, TOKEN_ENDPOINT } from './config.ts'
import {
  exportPrivateJwk,
  exportPublicJwk,
  generateKeyPair,
  importKeyPair,
} from './dpop.ts'
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  generatePkce,
  refreshWithNonceRetry,
} from './google.ts'
import { loadSession } from './session.ts'
import { loadState, resetState, updateState } from './store.ts'
import { layout } from './views/Layout.tsx'
import { Status, TokenResultView } from './views/parts.tsx'

const app = new Hono()
app.use('*', layout)

// ---------------------------------------------------------------------------
// トップ: 現在の状態
// ---------------------------------------------------------------------------

app.get('/', (c) => {
  const state = loadState()
  const hasKey = Boolean(state.privateKeyJwk)
  const hasToken = Boolean(state.refreshToken)

  return c.render(
    <>
      <h1>Google OAuth × DPoP 検証</h1>
      <p>
        Refresh Token を DPoP 鍵にバインドして、実際にトークン交換を通してみるための example です。
      </p>

      <h2>いまの状態</h2>
      <table>
        <tr>
          <th>DPoP 鍵ペア</th>
          <td class={hasKey ? 'ok' : 'ng'}>{hasKey ? 'あり（EC P-256）' : 'まだ無い'}</td>
        </tr>
        <tr>
          <th>Refresh Token</th>
          <td class={hasToken ? 'ok' : 'ng'}>
            {hasToken ? '取得済み（上の鍵にバインド）' : 'まだ無い'}
          </td>
        </tr>
        <tr>
          <th>DPoP-Nonce</th>
          <td>
            <code>{state.dpopNonce ?? '(なし)'}</code>
          </td>
        </tr>
        <tr>
          <th>最後にトークンを取った時刻</th>
          <td>{state.lastTokenAt ?? '-'}</td>
        </tr>
        <tr>
          <th>token_type</th>
          <td>
            <code>{state.lastTokenType ?? '-'}</code>
          </td>
        </tr>
      </table>

      <h2>操作</h2>
      <p>
        <a class="button" href="/api/auth/google">
          1. 認可する
        </a>
        {hasToken ? (
          <a class="button" href="/api/refresh">
            2. Refresh する
          </a>
        ) : null}
        <a class="button secondary" href="/api/reset">
          状態をリセット
        </a>
      </p>

      <h2>設定</h2>
      <table>
        <tr>
          <th>scope</th>
          <td>
            <code>{SCOPE}</code>
          </td>
        </tr>
        <tr>
          <th>redirect_uri</th>
          <td>
            <code>{REDIRECT_URI}</code>
          </td>
        </tr>
        <tr>
          <th>token endpoint</th>
          <td>
            <code>{TOKEN_ENDPOINT}</code>
          </td>
        </tr>
      </table>

      <p class="note">
        失敗ケースの検証（proof 省略・鍵違い・jti 再利用・iat のスキュー測定など）は{' '}
        <code>npm run experiments</code> で実行します。先にここで Refresh Token を取ってください。
      </p>
    </>,
    { title: 'Google OAuth × DPoP 検証' },
  )
})

// ---------------------------------------------------------------------------
// 1. 認可リクエスト
// ---------------------------------------------------------------------------

app.get('/api/auth/google', async (c) => {
  // DPoP 鍵ペアをここで作る。この鍵に Refresh Token がバインドされる
  const keyPair = await generateKeyPair()
  const { codeVerifier, codeChallenge } = await generatePkce()
  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url')

  updateState({
    privateKeyJwk: await exportPrivateJwk(keyPair.privateKey),
    publicKeyJwk: await exportPublicJwk(keyPair.publicKey),
    pendingAuth: { state, codeVerifier },
    // 鍵を作り直したので、古い Refresh Token と Nonce は無効
    refreshToken: undefined,
    dpopNonce: undefined,
    nonceFromCodeExchange: undefined,
  })

  return c.redirect(buildAuthorizationUrl({ state, codeChallenge }))
})

// ---------------------------------------------------------------------------
// 2. コールバック: 認可コードを DPoP 付きで交換する
// ---------------------------------------------------------------------------

const ErrorPage = ({ message }: { message: string }) => (
  <>
    <h1>認可に失敗しました</h1>
    <pre>{message}</pre>
  </>
)

app.get('/api/auth/callback/google', async (c) => {
  const code = c.req.query('code')
  const returnedState = c.req.query('state')
  const error = c.req.query('error')

  if (error || !code) {
    return c.render(<ErrorPage message={error ?? 'code がありません'} />, { title: '認可に失敗' })
  }

  const stored = loadState()
  const pending = stored.pendingAuth

  // state の検証。DPoP とは別の話だが、必ずやる
  if (!pending || pending.state !== returnedState) {
    return c.render(<ErrorPage message="state が一致しません" />, { title: 'state 不一致' })
  }
  if (!stored.privateKeyJwk || !stored.publicKeyJwk) {
    return c.render(<ErrorPage message="DPoP 鍵が見つかりません" />, { title: '鍵がない' })
  }

  const keyPair = await importKeyPair(stored.privateKeyJwk, stored.publicKeyJwk)
  const result = await exchangeAuthorizationCode({
    code,
    codeVerifier: pending.codeVerifier,
    keyPair,
  })

  if (result.status === 200) {
    updateState({
      refreshToken: result.body.refresh_token,
      dpopNonce: result.dpopNonce ?? undefined,
      // 初回 Refresh に持ち越せるかを検証したいので、別枠でも取っておく
      nonceFromCodeExchange: result.dpopNonce ?? undefined,
      lastTokenAt: new Date().toISOString(),
      lastTokenType: result.body.token_type,
      lastExpiresIn: result.body.expires_in,
      pendingAuth: undefined,
    })
  }

  return c.render(
    <>
      <h1>認可コードを DPoP 付きで交換しました</h1>
      <p>ここで返ってくる Refresh Token が、proof の署名に使った鍵にバインドされます。</p>
      {result.body.token_type === 'Bearer' ? (
        <p class="note">
          <strong>
            token_type は <code>Bearer</code>
          </strong>{' '}
          ― DPoP を使っても Access Token は Bearer のままです。バインドされるのは Refresh Token だけ。
        </p>
      ) : null}
      <TokenResultView result={result} />
    </>,
    { title: '認可コードの交換' },
  )
})

// ---------------------------------------------------------------------------
// 3. Refresh
// ---------------------------------------------------------------------------

app.get('/api/refresh', async (c) => {
  const session = await loadSession()
  if (!session) return c.redirect('/')

  const before = loadState()

  // 保存してある Nonce を使って Refresh する。
  // use_dpop_nonce が返ったら、新しい Nonce でちょうど 1 回だけやり直す
  const { attempts, final } = await refreshWithNonceRetry({
    refreshToken: session.refreshToken,
    keyPair: session.keyPair,
    nonce: session.nonce,
  })

  if (final.dpopNonce) updateState({ dpopNonce: final.dpopNonce })
  if (final.status === 200) {
    updateState({
      lastTokenAt: new Date().toISOString(),
      lastTokenType: final.body.token_type,
      lastExpiresIn: final.body.expires_in,
    })
  }

  // 認可コード交換で得た Nonce をそのまま使った初回 Refresh かどうか
  const isCarryOver =
    Boolean(before.nonceFromCodeExchange) && before.dpopNonce === before.nonceFromCodeExchange

  return c.render(
    <>
      <h1>Refresh Token を使いました</h1>
      <p>
        リクエスト回数: <strong>{attempts.length}</strong> 回
        {attempts.length === 1 ? (
          <span class="ok">（1 往復で成功）</span>
        ) : (
          <span>
            （1 回目が <code>{String(attempts[0].body?.error)}</code> で、新しい Nonce で再送）
          </span>
        )}
      </p>

      {isCarryOver ? (
        <p class="note">
          これは<strong>認可コード交換で得た Nonce をそのまま持ち越した</strong>初回の Refresh です。
          <br />
          1 往復で通ったなら web-server doc の記述が、400 が返ったなら DPoP Adoption Guide の
          「workflow isolation」の記述が正しいことになります。
          <br />
          公式ドキュメント同士が矛盾しているので、ここが実測する価値のある箇所です。
        </p>
      ) : null}

      {attempts.map((attempt, i) => (
        <section>
          <h2>
            試行 {i + 1} — <Status code={attempt.status} />
          </h2>
          <TokenResultView result={attempt} />
        </section>
      ))}
    </>,
    { title: 'Refresh' },
  )
})

// ---------------------------------------------------------------------------
// リセット
// ---------------------------------------------------------------------------

app.get('/api/reset', (c) => {
  resetState()
  return c.redirect('/')
})

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`\n  Google OAuth × DPoP 検証サーバー`)
  console.log(`  http://localhost:${info.port}\n`)
})
