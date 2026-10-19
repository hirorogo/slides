/**
 * 設定値。
 *
 * - 環境変数は .env から読む（`node --env-file=.env` が読み込む）
 * - Google 側で決まっている値はここに定数として置く
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `環境変数 ${name} が設定されていません。.env.example をコピーして .env を作ってください。`,
    )
  }
  return value
}

export const CLIENT_ID = required('GOOGLE_CLIENT_ID')
export const CLIENT_SECRET = required('GOOGLE_CLIENT_SECRET')

/** Refresh Token さえ取れればよいので、API の有効化が要らない最小スコープ。 */
export const SCOPE = process.env.GOOGLE_SCOPE ?? 'openid email'

export const PORT = Number(process.env.PORT ?? 3000)

/** Google Cloud Console の「承認済みのリダイレクト URI」と完全に一致させる。 */
export const REDIRECT_URI = `http://localhost:${PORT}/api/auth/callback/google`

export const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'

/**
 * トークンエンドポイント。
 * DPoP proof の `htu` クレームにもこの文字列をそのまま入れる。
 * クエリやフラグメントが付いていると htu 不一致で invalid_dpop_proof になる。
 */
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
