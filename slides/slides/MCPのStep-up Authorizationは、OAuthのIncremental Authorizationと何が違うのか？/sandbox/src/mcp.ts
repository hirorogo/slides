/**
 * MCP 側。Streamable HTTP で JSON-RPC を投げる最小クライアント。
 *
 * SDKを使わない理由は oauth.ts の冒頭に書いた。
 * ここでは「403 が返ってきた」を**例外にせず観測結果として返す**ことが一番大事。
 *
 * ── 2026-07-28 で手が1つ増えた ──────────────────────────────
 *
 * 最初 `initialize` を投げたら 400 が返ってきた。
 *
 *   -32020 "the request headers and body disagree: an initialize request
 *           (legacy handshake) was sent with a modern MCP-Protocol-Version header"
 *   -32602 "the MCP-Protocol-Version header names protocol revision 2026-07-28,
 *           but the request is missing the required per-request envelope key(s): _meta"
 *
 * 2026-07-28 は**ステートレス**で、`initialize` ハンドシェイクが無い。
 * 代わりに **毎リクエストの `params._meta`** にプロトコル版とケイパビリティを載せる。
 *
 *   io.modelcontextprotocol/protocolVersion      必須
 *   io.modelcontextprotocol/clientCapabilities   必須
 *   io.modelcontextprotocol/clientInfo           SHOULD
 *
 * 旧版（2025-11-25 以前）の `initialize` 経路も残してある。
 * **どちらの版でも 403 の出方が同じか**を比べる対照に使う。
 */

import { MCP_PROTOCOL_VERSION, MCP_SERVER_URL } from './config.ts'
import { send, type Sent } from './http.ts'

const META = {
  protocolVersion: 'io.modelcontextprotocol/protocolVersion',
  clientInfo: 'io.modelcontextprotocol/clientInfo',
  clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
} as const

const CLIENT_INFO = { name: 'mcp-stepup-sandbox', version: '0.1.0' }

/** 2026-07-28 はステートレスだが、旧版の経路ではセッションIDを引き回す。 */
let sessionId: string | null = null

export function resetSession(): void {
  sessionId = null
}

function headers(accessToken: string | undefined, protocolVersion: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (protocolVersion) h['MCP-Protocol-Version'] = protocolVersion
  if (accessToken) h.Authorization = `Bearer ${accessToken}`
  if (sessionId) h['Mcp-Session-Id'] = sessionId
  return h
}

/**
 * 2026-07-28 は **本文の内容をヘッダーにも書く**ことを要求する。
 *
 *   Mcp-Method: tools/call
 *   Mcp-Name:   <ツール名 / resources/read なら URI>
 *
 * 無いと 400 `-32020` "the body names method tools/list but the required
 * Mcp-Method header is absent"。
 *
 * 📌 これは中間装置（WAF・プロキシ・レート制限）が **JSON本文を開かずに**
 *    ルーティングや制限をかけられるようにするためのはず。
 *    Claude Code のバイナリにも同じ処理がある（`_applyBodyDerivedHeaders`）。
 */
function bodyDerivedHeaders(method: string, params: Record<string, unknown> | undefined): Record<string, string> {
  const h: Record<string, string> = { 'Mcp-Method': method }
  const name =
    method === 'resources/read'
      ? params?.uri
      : method.startsWith('tasks/')
        ? params?.taskId
        : params?.name
  if (typeof name === 'string') h['Mcp-Name'] = name
  return h
}

let nextId = 1

function isModern(version: string): boolean {
  return version >= '2026-07-28'
}

/** 2026-07-28 以降の envelope を付ける。 */
function withEnvelope(params: Record<string, unknown> | undefined, version: string) {
  return {
    ...(params ?? {}),
    _meta: {
      [META.protocolVersion]: version,
      [META.clientCapabilities]: {},
      [META.clientInfo]: CLIENT_INFO,
    },
  }
}

export async function rpc(
  label: string,
  method: string,
  params: Record<string, unknown> | undefined,
  accessToken?: string,
  version: string = MCP_PROTOCOL_VERSION,
): Promise<Sent> {
  const modern = isModern(version)
  const body = {
    jsonrpc: '2.0',
    id: nextId++,
    method,
    params: modern ? withEnvelope(params, version) : (params ?? {}),
  }
  const res = await send(`mcp: ${label}`, MCP_SERVER_URL, {
    method: 'POST',
    headers: {
      ...headers(accessToken, modern ? version : sessionId ? version : null),
      ...(modern ? bodyDerivedHeaders(method, params) : {}),
    },
    body: JSON.stringify(body),
  })
  const sid = res.headers['mcp-session-id']
  if (sid) sessionId = sid
  return res
}

/**
 * 旧版（2025-11-25 以前）のハンドシェイク。
 * `MCP-Protocol-Version` ヘッダーを**付けずに** `initialize` を投げるのが正解。
 */
export async function legacyInitialize(accessToken: string | undefined, version = '2025-11-25'): Promise<Sent> {
  const res = await send('mcp: initialize (legacy handshake)', MCP_SERVER_URL, {
    method: 'POST',
    headers: headers(accessToken, null),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextId++,
      method: 'initialize',
      params: { protocolVersion: version, capabilities: {}, clientInfo: CLIENT_INFO },
    }),
  })
  const sid = res.headers['mcp-session-id']
  if (sid) sessionId = sid
  if (res.status === 200) {
    await send('mcp: notifications/initialized', MCP_SERVER_URL, {
      method: 'POST',
      headers: headers(accessToken, null),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })
  }
  return res
}

/** 認可なしで叩いて 401 チャレンジを取るための最小リクエスト。 */
export async function unauthenticatedProbe(version = MCP_PROTOCOL_VERSION): Promise<Sent> {
  resetSession()
  return isModern(version)
    ? rpc('tools/list (unauthenticated)', 'tools/list', {}, undefined, version)
    : legacyInitialize(undefined, version)
}

export async function listTools(accessToken: string, version = MCP_PROTOCOL_VERSION): Promise<Sent> {
  return rpc('tools/list', 'tools/list', {}, accessToken, version)
}

export async function callTool(
  name: string,
  args: unknown,
  accessToken: string,
  version = MCP_PROTOCOL_VERSION,
): Promise<Sent> {
  return rpc(`tools/call ${name}`, 'tools/call', { name, arguments: args }, accessToken, version)
}

/**
 * ツール呼び出しの結果を読む。
 *
 * ⚠️ 罠：`tools/call` は HTTP 200 を返しつつ、本文の `isError` と
 *    テキストの中で権限不足を伝えてくることがある。
 *    HTTPステータスだけ見ていると Step-up を取りこぼす。
 */
export function describeToolResult(res: Sent): {
  httpStatus: number
  challengeFromHeader: Record<string, string> | null
  isError: boolean
  text: string
  mentionsScope: boolean
} {
  const body = res.body as Record<string, any> | null
  const result = body?.result ?? body?.error ?? null
  const content = result?.content
  const text = Array.isArray(content)
    ? content.map((c: any) => (typeof c?.text === 'string' ? c.text : JSON.stringify(c))).join('\n')
    : typeof result?.message === 'string'
      ? result.message
      : JSON.stringify(result ?? body ?? null)
  return {
    httpStatus: res.status,
    challengeFromHeader: res.challenge,
    isError: Boolean(result?.isError ?? body?.error),
    text,
    mentionsScope: /insufficient_scope|403|forbidden|permission|scope|unauthor/i.test(text),
  }
}
