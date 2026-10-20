/**
 * data/ に置く状態。すべて gitignore 済み。
 *
 *   data/client.json      DCR で登録したクライアント
 *   data/tokens.json      現在のトークンと、要求Scope / 付与Scope の履歴
 *   data/findings.json    各実験の観測結果（report.ts がこれを読む）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import { DATA_DIR } from './config.ts'

function path(name: string) {
  return `${DATA_DIR}/${name}.json`
}

export function load<T>(name: string): T | null {
  const p = path(name)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8')) as T
}

export function save(name: string, value: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(path(name), JSON.stringify(value, null, 2) + '\n')
}

export type ClientInfo = {
  client_id: string
  client_secret?: string
  registration_access_token?: string
  registration_client_uri?: string
  redirect_uris: string[]
  issuedAt: string
}

export type TokenSet = {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in?: number
  /** 認可サーバーが実際に付与したScope（レスポンスの scope）。無いこともある */
  granted_scope?: string
  /** こちらが /authorize に載せたScope。付与と一致するとは限らない */
  requested_scope: string
  obtainedAt: string
  /** 何回目の認可か。1 = 初回、2以降 = step-up */
  round: number
}

export type Findings = Record<string, unknown>

export function addFinding(key: string, value: unknown): void {
  const current = load<Findings>('findings') ?? {}
  current[key] = value
  save('findings', current)
}
