/**
 * 証跡レコーダ。
 *
 * 鉄則: **ログに残らない観測は、結論に使わない。**
 * Workspace への操作はすべて `rec.step()` を通す。通らない呼び出しを作らない。
 *
 * Worker 内ではファイルに書けないので、records をレスポンスに載せて返し、
 * ドライバ（scripts/run.mjs）が JSONL に落とす。
 */

export type StepRecord = {
  seq: number;
  claim: string;
  step: string;
  op: string;
  args?: unknown;
  /** 例外を投げず、失敗も観測として残す */
  ok: boolean;
  error?: string;
  errorName?: string;
  /** 失敗の発生箇所。どのライブラリのどの行かが結論に効くことがある */
  stack?: string;
  result?: unknown;
  durationMs: number;
};

export type RunMeta = {
  bootId: string;
  /** この DO インスタンスが構築されてからの経過ミリ秒 */
  aliveMs: number;
  doName: string;
  scenario: string;
  startedAt: string;
};

export class Recorder {
  #seq = 0;
  readonly records: StepRecord[] = [];

  /**
   * 1 操作 = 1 レコード。例外は握って `ok: false` で返す。
   * 呼び出し側は戻り値の `ok` を見て続きを決める。
   */
  async step<T>(
    claim: string,
    step: string,
    op: string,
    args: unknown,
    fn: () => Promise<T> | T,
    summarize?: (value: T) => unknown
  ): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    const startedAt = Date.now();
    this.#seq += 1;
    const seq = this.#seq;
    try {
      const value = await fn();
      const durationMs = Date.now() - startedAt;
      this.records.push({
        seq,
        claim,
        step,
        op,
        args,
        ok: true,
        result: summarize ? summarize(value) : undefined,
        durationMs,
      });
      return { ok: true, value };
    } catch (e: unknown) {
      const durationMs = Date.now() - startedAt;
      const err = e as { message?: string; name?: string; code?: string };
      const error = String(err?.message ?? e);
      this.records.push({
        seq,
        claim,
        step,
        op,
        args,
        ok: false,
        // エラーコード（EEXIST / EIO など）は結論に直結するので必ず残す
        errorName: err?.code ?? err?.name ?? undefined,
        error,
        stack: (e as Error)?.stack?.split("\n").slice(0, 6).join(" | "),
        durationMs,
      });
      return { ok: false, error };
    }
  }

  /** 観測した事実をそのまま 1 行残す（操作を伴わないもの） */
  note(claim: string, step: string, result: unknown) {
    this.#seq += 1;
    this.records.push({
      seq: this.#seq,
      claim,
      step,
      op: "note",
      ok: true,
      result,
      durationMs: 0,
    });
  }
}

/** 内容の同一性を示す指紋。バイト列をそのまま残さずに一致/不一致が言える */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const enc = new TextEncoder();
export const dec = new TextDecoder();
