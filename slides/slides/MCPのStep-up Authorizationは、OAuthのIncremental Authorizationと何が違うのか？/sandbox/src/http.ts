/**
 * 通信層。
 *
 * **例外を投げない。** 400 も 403 も立派な観測結果なので、
 * status / headers / body をそのまま返す。握りつぶさない。
 *
 * すべての送信はここを通り、evidence.ts に記録される。
 */

import { record, bodyFingerprint, type Exchange } from './evidence.ts'

export type Sent = {
  status: number
  statusText: string
  headers: Record<string, string>
  /** JSON ならパース済み、SSE なら data: 行をパース、それ以外は文字列 */
  body: unknown
  /** 生のレスポンス本文。SSEの枠ごと見たいときに使う */
  rawText: string
  challenge: Record<string, string> | null
  exchange: Exchange
}

/**
 * RFC 9110 の auth-param をパースする。
 *
 *   Bearer realm="OAuth", error="insufficient_scope", scope="a b", resource_metadata="https://…"
 *   → { _scheme: "Bearer", realm: "OAuth", error: "insufficient_scope", scope: "a b", … }
 *
 * この検証の主役なので、値はそのまま（クォートを外すだけ）残す。
 */
export function parseWWWAuthenticate(header: string | null): Record<string, string> | null {
  if (!header) return null
  const out: Record<string, string> = {}
  const scheme = header.match(/^\s*([A-Za-z0-9!#$%&'*+\-.^_`|~]+)\s/)
  if (scheme) out._scheme = scheme[1]
  const re = /([A-Za-z0-9!#$%&'*+\-.^_`|~]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(header)) !== null) {
    out[m[1]] = (m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1')
  }
  return out
}

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  h.forEach((v, k) => {
    out[k] = v
  })
  return out
}

/** SSE (`text/event-stream`) の最初の data: 行を取り出す。Streamable HTTP の応答がこれ。 */
function parseSse(text: string): unknown {
  for (const line of text.split('\n')) {
    if (line.startsWith('data:')) {
      const payload = line.slice(5).trim()
      try {
        return JSON.parse(payload)
      } catch {
        return payload
      }
    }
  }
  return null
}

export async function send(
  label: string,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Sent> {
  const method = init.method ?? 'GET'
  const headers = init.headers ?? {}
  const startedAt = Date.now()
  const timestamp = new Date().toISOString()

  const res = await fetch(url, { method, headers, body: init.body, redirect: 'manual' })
  const rawText = await res.text()
  const durationMs = Date.now() - startedAt

  const contentType = res.headers.get('content-type') ?? ''
  let body: unknown = rawText
  if (contentType.includes('application/json')) {
    try {
      body = JSON.parse(rawText)
    } catch {
      /* パースできなければ文字列のまま残す */
    }
  } else if (contentType.includes('text/event-stream')) {
    body = parseSse(rawText)
  }

  const challenge = parseWWWAuthenticate(res.headers.get('www-authenticate'))

  const exchange = record({
    timestamp,
    label,
    request: {
      method,
      url,
      headers,
      body: init.body,
      bodySha256: bodyFingerprint(init.body),
    },
    response: {
      status: res.status,
      statusText: res.statusText,
      headers: headersToObject(res.headers),
      body,
    },
    durationMs,
    challenge,
  })

  return {
    status: res.status,
    statusText: res.statusText,
    headers: headersToObject(res.headers),
    body,
    rawText,
    challenge,
    exchange,
  }
}

/** フォームPOST。OAuthのトークンエンドポイント用。 */
export async function postForm(
  label: string,
  url: string,
  form: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Promise<Sent> {
  return send(label, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...extraHeaders },
    body: new URLSearchParams(form).toString(),
  })
}

/** JSON POST。 */
export async function postJson(
  label: string,
  url: string,
  json: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Sent> {
  return send(label, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(json),
  })
}
