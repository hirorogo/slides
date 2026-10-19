/**
 * 鍵・Refresh Token・Nonce の保存。
 *
 * data/state.json に JSON で書くだけ。検証用なので最小限。
 *
 * ⚠️ 本番でこの書き方をしてはいけない
 *
 * ここでは秘密鍵（JWK の `d`）と Refresh Token を同じファイルに平文で置いている。
 * これは DPoP の意味をほぼ消す構成で、片方が漏れればもう片方も漏れる。
 * 本番では最低でも、
 *   - 秘密鍵は KMS に置いて署名だけ委譲するか、暗号化して別管理にする
 *   - Refresh Token とは別のストレージ・別のアクセス権にする
 * が要る。この話は draft.md の §6 / §10 で扱う。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PublicJwk } from './dpop.ts'

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
const STATE_FILE = join(DATA_DIR, 'state.json')

export type State = {
  /** DPoP 鍵ペア。認可コード交換から Refresh までずっと同じものを使い続ける */
  privateKeyJwk?: Record<string, unknown>
  publicKeyJwk?: PublicJwk

  /** この鍵にバインドされた Refresh Token */
  refreshToken?: string

  /**
   * 最後に Google から受け取った DPoP-Nonce。
   * Refresh のたびに新しいものが返るので上書きしていく。
   */
  dpopNonce?: string

  /** 認可コード交換のレスポンスで返ってきた Nonce（初回 Refresh に持ち越せるかの検証用に別枠で持つ） */
  nonceFromCodeExchange?: string

  /** 直近に取れた Access Token の情報。中身は記録しない */
  lastTokenAt?: string
  lastTokenType?: string
  lastExpiresIn?: number

  /** 認可リクエスト中の一時データ（CSRF 対策の state と PKCE の verifier） */
  pendingAuth?: {
    state: string
    codeVerifier: string
  }
}

export function loadState(): State {
  if (!existsSync(STATE_FILE)) return {}
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as State
}

export function saveState(state: State): void {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 })
}

/** 既存の状態に部分的に上書きする。 */
export function updateState(patch: Partial<State>): State {
  const next = { ...loadState(), ...patch }
  saveState(next)
  return next
}

export function resetState(): void {
  saveState({})
}

export { STATE_FILE }
