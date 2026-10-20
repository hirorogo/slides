/**
 * 設定値。
 *
 * この検証では事前登録したOAuthクライアントを使わない。
 * Cloudflare の Authorization Server が Dynamic Client Registration を開けているので、
 * probe.ts が登録して data/client.json に保存する。
 */

export const PORT = Number(process.env.PORT ?? 8976)

/** DCR で登録する redirect_uri。ループバックのみ。 */
export const REDIRECT_URI = `http://localhost:${PORT}/callback`

/** 検証対象の MCP Server（= OAuth の protected resource, RFC 9728）。 */
export const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? 'https://mcp.cloudflare.com/mcp'

/** ネゴシエートするプロトコルバージョン。 */
export const MCP_PROTOCOL_VERSION = process.env.MCP_PROTOCOL_VERSION ?? '2026-07-28'

/**
 * Protected Resource Metadata の場所。
 * 401 の `WWW-Authenticate: resource_metadata=` で上書きされる想定なので、
 * ここはあくまで初期値（RFC 9728 のパス挿入規則）。
 */
export function defaultResourceMetadataUrl(serverUrl: string): string {
  const u = new URL(serverUrl)
  return `${u.origin}/.well-known/oauth-protected-resource${u.pathname}`
}

/** 保存先。すべて gitignore 済み。 */
export const DATA_DIR = 'data'
