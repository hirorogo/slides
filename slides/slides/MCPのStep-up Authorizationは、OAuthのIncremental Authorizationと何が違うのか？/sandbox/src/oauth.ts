/**
 * OAuth 側。MCP 2026-07-28 の認可フローを、SDKを使わず手で踏む。
 *
 * SDKを使わないのは意図的。
 * `@modelcontextprotocol/client` は 403 を見たら自動で和集合を作って再認可してしまう。
 * **和集合を作らない対照**（実験D-1）が、それだと作れない。
 * ここでは「何を要求したか」を毎回こちらが決める。
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

import { MCP_SERVER_URL, PORT, REDIRECT_URI, defaultResourceMetadataUrl } from './config.ts'
import { postForm, postJson, send } from './http.ts'
import { save, type ClientInfo, type TokenSet } from './store.ts'

export type ProtectedResourceMetadata = {
  resource: string
  authorization_servers?: string[]
  scopes_supported?: string[]
  resource_name?: string
  [k: string]: unknown
}

export type AuthorizationServerMetadata = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  scopes_supported?: string[]
  code_challenge_methods_supported?: string[]
  [k: string]: unknown
}

/** RFC 9728: 401 が指してきた URL を優先する。無ければ規則で組み立てる。 */
export async function discoverProtectedResource(
  resourceMetadataUrl = defaultResourceMetadataUrl(MCP_SERVER_URL),
): Promise<ProtectedResourceMetadata> {
  const res = await send('discovery: protected resource metadata', resourceMetadataUrl)
  if (res.status !== 200) throw new Error(`PRM が取れない: HTTP ${res.status}`)
  return res.body as ProtectedResourceMetadata
}

export async function discoverAuthorizationServer(
  issuer: string,
): Promise<AuthorizationServerMetadata> {
  const u = new URL(issuer)
  const candidates = [
    `${u.origin}/.well-known/oauth-authorization-server${u.pathname === '/' ? '' : u.pathname}`,
    `${u.origin}/.well-known/openid-configuration${u.pathname === '/' ? '' : u.pathname}`,
  ]
  for (const url of candidates) {
    const res = await send('discovery: authorization server metadata', url)
    if (res.status === 200) return res.body as AuthorizationServerMetadata
  }
  throw new Error('AS metadata が取れない')
}

/** RFC 7591 Dynamic Client Registration。ユーザー操作は要らない。 */
export async function registerClient(
  registrationEndpoint: string,
  scope: string,
): Promise<ClientInfo> {
  const res = await postJson('DCR: register', registrationEndpoint, {
    client_name: 'mcp-stepup-sandbox (verification)',
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope,
  })
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`DCR 失敗: HTTP ${res.status} ${JSON.stringify(res.body)}`)
  }
  const body = res.body as Record<string, unknown>
  const info: ClientInfo = {
    client_id: String(body.client_id),
    client_secret: body.client_secret ? String(body.client_secret) : undefined,
    registration_access_token: body.registration_access_token
      ? String(body.registration_access_token)
      : undefined,
    registration_client_uri: body.registration_client_uri
      ? String(body.registration_client_uri)
      : undefined,
    redirect_uris: [REDIRECT_URI],
    issuedAt: new Date().toISOString(),
  }
  save('client', info)
  return info
}

export type Pkce = { verifier: string; challenge: string }

export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/**
 * 認可URLを組む。
 *
 * ⚠️ `scope` は呼び出し側が決める。ここで和集合を作らない。
 *    和集合を作るかどうかが実験D の論点なので、暗黙にやってはいけない。
 */
export function buildAuthorizationUrl(args: {
  authorizationEndpoint: string
  clientId: string
  scope: string
  pkce: Pkce
  state: string
  resource?: string
}): string {
  const u = new URL(args.authorizationEndpoint)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', args.clientId)
  u.searchParams.set('redirect_uri', REDIRECT_URI)
  u.searchParams.set('scope', args.scope)
  u.searchParams.set('state', args.state)
  u.searchParams.set('code_challenge', args.pkce.challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  // RFC 8707 / MCP: どのリソース向けのトークンかを明示する
  u.searchParams.set('resource', args.resource ?? MCP_SERVER_URL)
  return u.toString()
}

export type CallbackResult =
  | { ok: true; code: string; state: string; raw: string }
  | { ok: false; error: string; errorDescription?: string; state?: string; raw: string }

/**
 * コールバックを1回だけ受ける。
 *
 * 拒否された場合も**正常な観測結果**として返す（実験E）。例外にしない。
 */
export function waitForCallback(expectedState: string, timeoutMs = 10 * 60_000): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404).end('not found')
        return
      }
      const url = new URL(req.url, `http://localhost:${PORT}`)
      const params = Object.fromEntries(url.searchParams.entries())
      const raw = url.search

      let result: CallbackResult
      if (params.error) {
        result = {
          ok: false,
          error: params.error,
          errorDescription: params.error_description,
          state: params.state,
          raw,
        }
      } else if (!params.code) {
        result = { ok: false, error: 'missing_code', raw }
      } else if (params.state !== expectedState) {
        result = { ok: false, error: 'state_mismatch', state: params.state, raw }
      } else {
        result = { ok: true, code: params.code, state: params.state, raw }
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
        `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:3rem">
         <h1>${result.ok ? '受け取りました' : '認可されませんでした'}</h1>
         <p>${result.ok ? 'ターミナルに戻ってください。' : `error = <code>${params.error ?? 'なし'}</code>（これも観測結果です）`}</p>
         </body>`,
      )
      clearTimeout(timer)
      server.close()
      resolve(result)
    })
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('コールバックが来ないままタイムアウトしました'))
    }, timeoutMs)
    server.listen(PORT)
  })
}

export async function exchangeCode(args: {
  tokenEndpoint: string
  clientId: string
  code: string
  pkce: Pkce
  requestedScope: string
  round: number
  resource?: string
}): Promise<{ tokens: TokenSet | null; status: number; body: unknown }> {
  const res = await postForm('token: authorization_code', args.tokenEndpoint, {
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: REDIRECT_URI,
    client_id: args.clientId,
    code_verifier: args.pkce.verifier,
    resource: args.resource ?? MCP_SERVER_URL,
  })
  if (res.status !== 200) return { tokens: null, status: res.status, body: res.body }

  const b = res.body as Record<string, unknown>
  const tokens: TokenSet = {
    access_token: String(b.access_token),
    refresh_token: b.refresh_token ? String(b.refresh_token) : undefined,
    token_type: String(b.token_type ?? ''),
    expires_in: typeof b.expires_in === 'number' ? b.expires_in : undefined,
    granted_scope: b.scope ? String(b.scope) : undefined,
    requested_scope: args.requestedScope,
    obtainedAt: new Date().toISOString(),
    round: args.round,
  }
  return { tokens, status: res.status, body: res.body }
}

/** スペース区切りScopeの和集合。SEP-2350 がクライアントに求めているもの。 */
export function scopeUnion(...scopes: Array<string | undefined>): string {
  const seen = new Set<string>()
  for (const s of scopes) {
    if (!s) continue
    for (const t of s.split(/\s+/)) if (t) seen.add(t)
  }
  return [...seen].join(' ')
}

export function scopeDiff(a: string | undefined, b: string | undefined): string[] {
  const left = new Set((a ?? '').split(/\s+/).filter(Boolean))
  const right = new Set((b ?? '').split(/\s+/).filter(Boolean))
  return [...right].filter((s) => !left.has(s))
}
