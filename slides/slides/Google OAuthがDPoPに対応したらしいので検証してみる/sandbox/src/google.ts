/**
 * Google のトークンエンドポイントとのやりとり。
 *
 * このファイルの方針: 例外を投げずに、返ってきたものをそのまま返す。
 * 失敗ケースの観察が目的なので、400 も立派な結果として扱いたい。
 */

import {
  AUTHORIZATION_ENDPOINT,
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI,
  SCOPE,
  TOKEN_ENDPOINT,
} from './config.ts'
import {
  createProof,
  jtiForAuthorizationCode,
  randomJti,
  type DpopKeyPair,
  type ProofOptions,
} from './dpop.ts'

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

/**
 * PKCE の code_verifier / code_challenge を作る。
 *
 * PKCE は認可コードがリダイレクト中に盗まれるのを防ぐ仕組みで、
 * DPoP とは守る対象が違う。DPoP を入れても PKCE はそのまま残す。
 */
export async function generatePkce() {
  const codeVerifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  const codeChallenge = Buffer.from(new Uint8Array(digest)).toString('base64url')
  return { codeVerifier, codeChallenge }
}

/** 認可画面の URL を組み立てる。 */
export function buildAuthorizationUrl(params: { state: string; codeChallenge: string }): string {
  const url = new URL(AUTHORIZATION_ENDPOINT)
  url.searchParams.set('client_id', CLIENT_ID)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('state', params.state)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')

  // Refresh Token を受け取るために必須
  url.searchParams.set('access_type', 'offline')

  // すでに同意済みのユーザーにも Refresh Token を再発行させる。
  // DPoP バインド済みの Refresh Token が欲しいときは、
  // 既存の grant を revoke するか、これを付けるしかない。
  url.searchParams.set('prompt', 'consent')

  return url.toString()
}

// ---------------------------------------------------------------------------
// トークンエンドポイントへの POST
// ---------------------------------------------------------------------------

export type TokenResult = {
  status: number
  /** レスポンスの DPoP-Nonce ヘッダー。成功時も失敗時も返ってくる */
  dpopNonce: string | null
  body: Record<string, any>
  /** 送った proof（デコードして表示するため） */
  sentProof?: string
}

/**
 * トークンエンドポイントに POST する。
 *
 * proof は `DPoP` という HTTP ヘッダーに入れる。
 * フォームのパラメータとして送ってはいけない。
 */
async function postToTokenEndpoint(
  form: Record<string, string>,
  proof?: string,
): Promise<TokenResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (proof) headers.DPoP = proof

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers,
    body: new URLSearchParams(form).toString(),
  })

  const text = await response.text()
  let body: Record<string, any>
  try {
    body = JSON.parse(text)
  } catch {
    body = { _raw: text }
  }

  return {
    status: response.status,
    dpopNonce: response.headers.get('DPoP-Nonce'),
    body,
    sentProof: proof,
  }
}

// ---------------------------------------------------------------------------
// 認可コード交換
// ---------------------------------------------------------------------------

/**
 * 認可コードを Refresh Token に交換する。DPoP proof 付き。
 *
 * ここで渡した鍵に Refresh Token がバインドされる。
 * 以後その Refresh Token を使うには、毎回この鍵で署名した proof が要る。
 */
export async function exchangeAuthorizationCode(args: {
  code: string
  codeVerifier: string
  keyPair: DpopKeyPair
}): Promise<TokenResult> {
  // 認可コード交換の jti は、認可コードの SHA-256（Google 独自仕様）
  const proof = await createProof({
    keyPair: args.keyPair,
    jti: await jtiForAuthorizationCode(args.code),
  })

  return await postToTokenEndpoint(
    {
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: args.codeVerifier,
    },
    proof,
  )
}

/** DPoP なしで認可コードを交換する。「付けた場合との差」を見るための比較用。 */
export async function exchangeAuthorizationCodeWithoutDpop(args: {
  code: string
  codeVerifier: string
}): Promise<TokenResult> {
  return await postToTokenEndpoint({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code_verifier: args.codeVerifier,
  })
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

/**
 * Refresh Token を使って Access Token を取り直す（proof を 1 回だけ送る）。
 *
 * リトライはしない。「このパラメータでどう応答したか」をそのまま見たいときに使う。
 * proofOverrides に何か渡すと、わざと壊れた proof を送れる。
 */
export async function refreshOnce(args: {
  refreshToken: string
  keyPair: DpopKeyPair
  nonce?: string
  /** proof をわざと壊すためのオプション。正常系では渡さない */
  proofOverrides?: Partial<ProofOptions>
  /** true にすると proof を一切送らない */
  withoutProof?: boolean
}): Promise<TokenResult> {
  const form = {
    grant_type: 'refresh_token',
    refresh_token: args.refreshToken,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  }

  if (args.withoutProof) return await postToTokenEndpoint(form)

  const proof = await createProof({
    keyPair: args.keyPair,
    jti: randomJti(),
    nonce: args.nonce,
    ...args.proofOverrides,
  })

  return await postToTokenEndpoint(form, proof)
}

/**
 * Refresh。use_dpop_nonce が返ったら、新しい Nonce でちょうど 1 回だけやり直す。
 *
 * 公式の指示は "exactly once"。無限リトライにしてはいけない。
 * invalid_dpop_proof はこちらの実装バグなので、リトライしても意味がない。
 */
export async function refreshWithNonceRetry(args: {
  refreshToken: string
  keyPair: DpopKeyPair
  nonce?: string
}): Promise<{ attempts: TokenResult[]; final: TokenResult }> {
  const first = await refreshOnce(args)

  const needsNewNonce = first.status === 400 && first.body?.error === 'use_dpop_nonce'
  if (!needsNewNonce || !first.dpopNonce) {
    return { attempts: [first], final: first }
  }

  // 新しい Nonce を使い、jti と iat も作り直して 1 回だけ再送する
  const second = await refreshOnce({ ...args, nonce: first.dpopNonce })
  return { attempts: [first, second], final: second }
}
