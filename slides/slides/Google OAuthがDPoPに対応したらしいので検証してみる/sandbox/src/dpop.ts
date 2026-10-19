/**
 * DPoP proof JWT をつくる。
 *
 * proof とは「この秘密鍵を今まさに持っている」ことを示す、使い捨ての署名付き JWT。
 * トークンエンドポイントへのリクエストごとに新しく作り、`DPoP` ヘッダーに載せる。
 * （フォームのパラメータではなく HTTP ヘッダー。ここを間違えやすい）
 *
 *   JOSE ヘッダー : { typ: "dpop+jwt", alg: "ES256", jwk: 公開鍵 }
 *   ペイロード    : { htm, htu, iat, jti, nonce? }
 *
 * RFC 9449 と Google の実装で違うのは jti の決め方だけ。
 *
 *   認可コード交換 : jti = base64url(sha256(認可コード))  ← 決定的な値。Google 独自
 *   Refresh        : jti = ランダム 192bit                ← RFC 9449 どおり
 *
 * 参考:
 *   https://developers.google.com/identity/protocols/oauth2/resources/dpop-adoption
 *   https://www.rfc-editor.org/rfc/rfc9449.html
 */

import { SignJWT, exportJWK, importJWK, decodeJwt, decodeProtectedHeader } from 'jose'
import { TOKEN_ENDPOINT } from './config.ts'

/** DPoP proof の署名に使う鍵ペア。公開鍵は proof のヘッダーに丸ごと入る。 */
export type DpopKeyPair = {
  privateKey: CryptoKey
  publicKey: CryptoKey
}

/** proof のヘッダーに埋め込む公開鍵。秘密鍵成分 `d` は絶対に入れない。 */
export type PublicJwk = {
  kty: 'EC'
  crv: 'P-256'
  x: string
  y: string
}

// ---------------------------------------------------------------------------
// 鍵
// ---------------------------------------------------------------------------

/**
 * DPoP 用の鍵ペア（EC P-256 / ES256）を生成する。
 *
 * ⚠️ extractable: true にしている理由
 *
 * Google 公式の SKILL.md は extractable: false を「CRITICAL SECURITY GUARDRAIL」
 * として要求している。しかし Node.js では非 extractable な鍵は exportKey できない
 * ＝ プロセスの外に永続化できない。
 *
 *   await crypto.subtle.exportKey('jwk', privateKey)
 *   // InvalidAccessError: key is not extractable
 *
 * サーバーを再起動した瞬間に鍵が消えると、その鍵にバインドされた Refresh Token は
 * すべて使用不能になり、全ユーザーに再同意を求めるしかなくなる。
 * なのでサーバーアプリでは extractable: true にして、書き出した JWK を
 * 保護された場所（KMS / 暗号化したストレージ）に置くことになる。
 *
 * そしてその瞬間、「秘密鍵は外に出ない」という DPoP の前提は一段弱くなる。
 * このトレードオフは draft.md の §6 で扱う。
 */
export async function generateKeyPair(): Promise<DpopKeyPair> {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true, // extractable。上のコメントを参照
    ['sign', 'verify'],
  )
  return { privateKey, publicKey }
}

/** 公開鍵を JWK にする。proof のヘッダーに入れるので、余計なメタデータは落とす。 */
export async function exportPublicJwk(publicKey: CryptoKey): Promise<PublicJwk> {
  const jwk = await exportJWK(publicKey)
  // kty / crv / x / y だけを明示的に取り出す。d が混ざる余地をなくす
  return { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! }
}

/** 保存しておいた JWK から鍵ペアを復元する。 */
export async function importKeyPair(
  privateJwk: Record<string, unknown>,
  publicJwk: PublicJwk,
): Promise<DpopKeyPair> {
  return {
    privateKey: (await importJWK(privateJwk, 'ES256')) as CryptoKey,
    publicKey: (await importJWK({ ...publicJwk }, 'ES256')) as CryptoKey,
  }
}

/** 秘密鍵を JWK として書き出す。保存するときだけ使う。 */
export async function exportPrivateJwk(privateKey: CryptoKey) {
  return await exportJWK(privateKey)
}

// ---------------------------------------------------------------------------
// jti
// ---------------------------------------------------------------------------

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString(
    'base64url',
  )
}

/**
 * 認可コード交換に使う jti。
 *
 * Google 独自仕様: jti = BASE64URL(SHA-256(authorization_code))
 *
 * RFC 9449 は jti に「96bit 以上の擬似乱数か UUIDv4」を要求しているので、
 * 決定的な値を入れるこのやり方は RFC には無い。
 * 認可コードが一度しか使えないため、結果として一意性は保たれる。
 */
export async function jtiForAuthorizationCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  return base64url(digest)
}

/** Refresh に使う jti。リクエストごとに新しいランダム値（192bit）。 */
export function randomJti(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(24)))
}

// ---------------------------------------------------------------------------
// proof
// ---------------------------------------------------------------------------

export type ProofOptions = {
  keyPair: DpopKeyPair
  /** 認可コード交換なら sha256(code)、Refresh ならランダム値 */
  jti: string
  /** Google から受け取った DPoP-Nonce。Refresh では必須 */
  nonce?: string

  // --- ここから下は検証用。正常系では触らない ---------------------------------
  /** HTTP メソッド。既定は POST */
  htm?: string
  /** 対象 URI。既定はトークンエンドポイント */
  htu?: string
  /** iat をずらす秒数。負なら過去。許容スキューの測定に使う */
  iatOffsetSeconds?: number
  /** 署名だけ別の鍵でやる。「鍵が違う proof は弾かれるか」の検証に使う */
  signWith?: CryptoKey
}

/**
 * proof JWT を 1 つ作って返す。
 *
 * 署名は jose が ES256 として raw R||S（IEEE P1363、P-256 なら 64 バイト）で出力する。
 * node:crypto の createSign や OpenSSL は ASN.1 DER を返すので、
 * そちらを使う場合は変換が要る。（Google 公式ドキュメントのサンプルは
 * ここを間違えていて、Refresh 側のサンプル proof は 70 バイトの DER になっている）
 */
export async function createProof(options: ProofOptions): Promise<string> {
  const {
    keyPair,
    jti,
    nonce,
    htm = 'POST',
    htu = TOKEN_ENDPOINT,
    iatOffsetSeconds = 0,
    signWith,
  } = options

  const header = {
    typ: 'dpop+jwt',
    alg: 'ES256',
    jwk: await exportPublicJwk(keyPair.publicKey),
  }

  const payload: Record<string, unknown> = { htm, htu, jti }
  if (nonce) payload.nonce = nonce

  const iat = Math.floor(Date.now() / 1000) + iatOffsetSeconds

  return await new SignJWT(payload)
    .setProtectedHeader(header)
    .setIssuedAt(iat)
    .sign(signWith ?? keyPair.privateKey)
}

/** 送った proof の中身を確認するためのデコーダ。検証結果の表示に使う。 */
export function decodeProof(proof: string) {
  const signature = proof.split('.')[2]
  return {
    header: decodeProtectedHeader(proof),
    payload: decodeJwt(proof),
    signatureBytes: Buffer.from(signature, 'base64url').length,
  }
}
