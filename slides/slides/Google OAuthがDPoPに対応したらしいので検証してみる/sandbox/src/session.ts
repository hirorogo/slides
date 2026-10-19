/**
 * 保存された状態から、検証に必要なものを取り出す薄い層。
 * store（ただの JSON）と dpop（鍵の復元）の橋渡し。
 */

import { importKeyPair, type DpopKeyPair } from './dpop.ts'
import { loadState } from './store.ts'

export type Session = {
  keyPair: DpopKeyPair
  refreshToken: string
  /** 最後に受け取った DPoP-Nonce */
  nonce?: string
}

/**
 * 鍵と Refresh Token が揃っていればセッションを返す。
 * まだ認可が済んでいなければ null。
 */
export async function loadSession(): Promise<Session | null> {
  const state = loadState()
  if (!state.privateKeyJwk || !state.publicKeyJwk || !state.refreshToken) return null

  return {
    keyPair: await importKeyPair(state.privateKeyJwk, state.publicKeyJwk),
    refreshToken: state.refreshToken,
    nonce: state.dpopNonce,
  }
}

/** 認可が済んでいなければエラーにする版。CLI から使う。 */
export async function requireSession(): Promise<Session> {
  const session = await loadSession()
  if (!session) {
    throw new Error(
      'まだ Refresh Token がありません。`npm start` でサーバーを起動して、' +
        'http://localhost:3000 から認可を済ませてください。',
    )
  }
  return session
}
