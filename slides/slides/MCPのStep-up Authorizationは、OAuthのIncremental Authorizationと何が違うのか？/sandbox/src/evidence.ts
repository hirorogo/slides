/**
 * HTTP の往復を、そのまま JSONL で残す。
 *
 * 鉄則：ログに残らない観測は結論に使わない。
 * 通信は全部 http.ts の `send()` を通り、ここに届く。フックを通らない送信を作らない。
 *
 * 出力は 2 本。
 *
 *   data/evidence-<name>-<時刻>.jsonl        指紋化あり。記事・報告に使う
 *   data/evidence-<name>-<時刻>.raw.jsonl    指紋化なし。手元限定
 *
 * 秘密は消さずに **不可逆な指紋に置き換える**。
 *
 *   "access_token": { "_redacted_len": 128, "_sha256_16": "7ec99861890b84a9" }
 *
 * `<redacted>` で潰すと「同じトークンを使い回した」も「毎回別物が発行された」も
 * どちらも示せなくなる。指紋なら両方示せる。
 *
 * 伏せないもの:
 *   - WWW-Authenticate      この検証の主役。秘密を含まない
 *   - scope / code_verifier 以外のPKCE値、client_id
 *   - MCP の JSON-RPC 本文（読み取り専用APIの結果のみを扱う）
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'

import { DATA_DIR } from './config.ts'

/** 中身を出さない値。フォーム・JSONボディ・ヘッダーのどこに出ても指紋化する。 */
const SECRET_KEYS = [
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'code',
  'code_verifier',
  'registration_access_token',
  'authorization',
]

export function fingerprint(value: string) {
  return {
    _redacted_len: value.length,
    _sha256_16: createHash('sha256').update(value).digest('hex').slice(0, 16),
  }
}

/** 送信バイト列そのものの指紋。「同じものを送った」の証明に使う。 */
export function bodyFingerprint(body: string | undefined) {
  return body === undefined ? null : fingerprint(body)
}

function redactDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] =
        SECRET_KEYS.includes(k.toLowerCase()) && typeof v === 'string'
          ? fingerprint(v)
          : redactDeep(v)
    }
    return out
  }
  return value
}

export type Exchange = {
  seq: number
  timestamp: string
  label: string
  request: {
    method: string
    url: string
    headers: Record<string, string>
    body?: string
    bodySha256?: ReturnType<typeof fingerprint> | null
  }
  response: {
    status: number
    statusText: string
    headers: Record<string, string>
    body: unknown
  }
  durationMs: number
  /** WWW-Authenticate をパースした結果。あれば添える（読む側が手で割らずに済む） */
  challenge?: Record<string, string> | null
}

let seq = 0
let redactedPath: string | null = null
let rawPath: string | null = null

export function startRecording(name: string): () => { redacted: string; raw: string } {
  mkdirSync(DATA_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  redactedPath = `${DATA_DIR}/evidence-${name}-${stamp}.jsonl`
  rawPath = `${DATA_DIR}/evidence-${name}-${stamp}.raw.jsonl`
  seq = 0

  return () => {
    const paths = { redacted: redactedPath!, raw: rawPath! }
    console.log(`\n  生ログ ${seq} 件:`)
    console.log(`    ${paths.redacted}      （指紋化あり）`)
    console.log(`    ${paths.raw}  （指紋化なし・手元限定）`)
    redactedPath = null
    rawPath = null
    return paths
  }
}

export function record(exchange: Omit<Exchange, 'seq'>): Exchange {
  seq += 1
  const full: Exchange = { seq, ...exchange }
  if (rawPath) appendFileSync(rawPath, JSON.stringify(full) + '\n')
  if (redactedPath) appendFileSync(redactedPath, JSON.stringify(redactDeep(full)) + '\n')
  return full
}
