/**
 * 証跡レコーダ。既定では何もしない。
 *
 * 全送信がここを通る（`fake-binding.ts` と実機クライアントの両方）。
 * **フックを通らない送信を作らないこと。** 直で fetch を書いた瞬間に穴が空く。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

export type Exchange = {
  seq: number;
  timestamp: string;
  scenario: string;
  request: {
    kind: "run" | "native" | "http";
    model: string;
    body: unknown;
    headers: Record<string, string>;
    /** 送信バイト列の指紋。「同じものを送った」を証明するために毎行出す。 */
    bodySha256_16: string;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    /** ストリームなら本文は読まず、代わりに下の parts に出る。 */
    body: unknown;
    /** AI SDK まで届いたストリームパートの type を順番に並べたもの。 */
    parts?: string[];
    /** cf-aig-cache-status。HIT が混ざった観測は捨てる。 */
    cacheStatus?: string;
  };
  durationMs: number;
};

const SECRETS = ["apiToken", "api_key", "authorization", "cf-aig-authorization"];

const fingerprint = (v: string) => ({
  _redacted_len: v.length,
  _sha256_16: createHash("sha256").update(v).digest("hex").slice(0, 16),
});

export const sha16 = (v: string) =>
  createHash("sha256").update(v).digest("hex").slice(0, 16);

/** 秘密は消すのではなく不可逆な指紋に置き換える。同一性と差異の両方を残すため。 */
export function scrub(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(scrub);
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRETS.includes(k.toLowerCase()) && typeof v === "string"
          ? fingerprint(v)
          : scrub(v),
      ]),
    );
  }
  return obj;
}

let recorder: ((e: Exchange) => void) | null = null;
let seq = 0;

export function setRecorder(fn: ((e: Exchange) => void) | null) {
  recorder = fn;
  seq = 0;
}

export function record(e: Omit<Exchange, "seq">) {
  seq += 1;
  recorder?.({ ...e, seq });
}

/** 走らせた分だけ JSONL に落ちる。記事に貼る数値はここから拾う。 */
export function startRecording(name: string) {
  mkdirSync("data", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `data/evidence-${name}-${stamp}.jsonl`;
  setRecorder((e) => {
    appendFileSync(file, `${JSON.stringify(scrub(e))}\n`);
  });
  return file;
}

/** テストから読むための、メモリ上の記録。 */
export function collectRecording(): { log: Exchange[]; stop: () => void } {
  const log: Exchange[] = [];
  setRecorder((e) => log.push(e));
  return { log, stop: () => setRecorder(null) };
}
