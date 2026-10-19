/**
 * ページの部品。
 */

import { decodeProof } from '../dpop.ts'
import type { TokenResult } from '../google.ts'

/** JSON を読みやすく整形して <pre> に出す。 */
export const Json = ({ value }: { value: unknown }) => <pre>{JSON.stringify(value, null, 2)}</pre>

/** 成功なら緑、それ以外は赤。 */
export const Status = ({ code }: { code: number }) => (
  <span class={code === 200 ? 'ok' : 'ng'}>{code}</span>
)

/**
 * トークンエンドポイントのレスポンスを表示する。
 *
 * Refresh Token / Access Token / id_token は中身を出さず、長さだけ記録する。
 * （画面に出したものはスクショ経由で記事に混入する）
 */
export const TokenResultView = ({ result }: { result: TokenResult }) => {
  const body: Record<string, unknown> = { ...result.body }
  for (const key of ['refresh_token', 'access_token', 'id_token']) {
    if (body[key]) body[key] = `<${key} を受領: ${String(body[key]).length} 文字>`
  }

  return (
    <>
      <h2>レスポンス</h2>
      <table>
        <tr>
          <th>HTTP ステータス</th>
          <td>
            <Status code={result.status} />
          </td>
        </tr>
        <tr>
          <th>DPoP-Nonce ヘッダー</th>
          <td>
            <code>{result.dpopNonce ?? '(なし)'}</code>
          </td>
        </tr>
      </table>
      <Json value={body} />

      {result.sentProof ? (
        <>
          <h2>送った DPoP proof</h2>
          <Json value={decodeProof(result.sentProof)} />
        </>
      ) : (
        <p class="note">このリクエストに DPoP proof は付けていません。</p>
      )}
    </>
  )
}
