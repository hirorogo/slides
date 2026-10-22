/**
 * 偽の AI binding。
 *
 * `createAI({ binding })` が binding に求めるのは 3 つだけ
 * （`models/core/transport.ts` の `bindingTransport`）。
 *
 *   - `run(model, input, options)` → `returnRawResponse: true` なので `Response` を返す
 *   - `fetch(url, init)`           → provider-native path と resume 用
 *   - `aiGatewayLogId`             → log id のフォールバック
 *
 * ここを握ると Cloudflare を一切叩かずに Fallback の状態機械が動く。
 * **全送信がレコーダを通る。** 例外は投げず、4xx も `Response` として返す。
 */
import { record, sha16 } from "./evidence";

export type LegResult =
  | { kind: "json"; status?: number; body: unknown; headers?: Record<string, string> }
  | { kind: "sse"; body: string; headers?: Record<string, string> }
  | { kind: "stream"; body: ReadableStream<Uint8Array>; headers?: Record<string, string> }
  | { kind: "throw"; error: unknown };

/** モデル ID ごとの応答。呼ばれるたびに配列の先頭から消費し、尽きたら最後を繰り返す。 */
export type Script = Record<string, LegResult[]>;

/** resume ルートへの応答。URL の from= に応じて返すものを決める。 */
export type ResumeHandler = (from: number, url: string) => Response;

export type FakeBinding = {
  run(model: string, input: unknown, options?: Record<string, unknown>): Promise<Response>;
  fetch(url: string, init?: RequestInit): Promise<Response>;
  aiGatewayLogId: string | null;
  /** モデル ID ごとの呼び出し回数。D 群でリクエスト数を数えるのに使う。 */
  calls: Record<string, number>;
  /** 呼ばれた順のモデル ID。B 群で順序を見るのに使う。 */
  order: string[];
  /** run() に渡された options をそのまま積む。ゲートウェイオプションの検証用。 */
  optionsSeen: Record<string, unknown>[];
  /** run() に渡された input をそのまま積む。本文に何が乗ったかの検証用。 */
  inputsSeen: unknown[];
  /** resume ルートが叩かれた from= の履歴。 */
  resumeFroms: number[];
  /** resume ルートの応答を差し替える。 */
  onResume?: ResumeHandler;
};

export function makeBinding(script: Script, scenario: string): FakeBinding {
  const cursor: Record<string, number> = {};
  const calls: Record<string, number> = {};
  const order: string[] = [];
  const optionsSeen: Record<string, unknown>[] = [];
  const inputsSeen: unknown[] = [];
  const resumeFroms: number[] = [];

  const binding: FakeBinding = {
    aiGatewayLogId: "01TESTLOGID0000000000000000",
    calls,
    order,
    optionsSeen,
    inputsSeen,
    resumeFroms,
    async run(model, input, options) {
      const startedAt = Date.now();
      calls[model] = (calls[model] ?? 0) + 1;
      order.push(model);
      optionsSeen.push((options ?? {}) as Record<string, unknown>);
      inputsSeen.push(input);

      const queue = script[model];
      if (queue === undefined) {
        // 未登録のモデルは 404。「実在しないカタログ ID」の再現に使う。
        return finish(model, input, options, {
          kind: "json",
          status: 404,
          body: { error: { message: `no such model: ${model}`, code: 5006 } },
        }, startedAt);
      }
      const i = Math.min(cursor[model] ?? 0, queue.length - 1);
      cursor[model] = (cursor[model] ?? 0) + 1;
      return finish(model, input, options, queue[i]!, startedAt);
    },
    async fetch(url, init) {
      const startedAt = Date.now();
      order.push(`fetch:${url}`);
      const m = /\/run\/[^/]+\/resume\?from=(\d+)/.exec(url);
      if (m !== null && binding.onResume !== undefined) {
        const from = Number(m[1]);
        resumeFroms.push(from);
        const res = binding.onResume(from, url);
        record({
          timestamp: new Date(startedAt).toISOString(),
          scenario,
          request: { kind: "native", model: `resume?from=${from}`, body: null, headers: {}, bodySha256_16: sha16(url) },
          response: { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: { _resume: true } },
          durationMs: Date.now() - startedAt,
        });
        return res;
      }
      record({
        timestamp: new Date(startedAt).toISOString(),
        scenario,
        request: {
          kind: "native",
          model: url,
          body: init?.body === undefined ? null : String(init.body),
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
          bodySha256_16: sha16(String(init?.body ?? "")),
        },
        response: { status: 501, headers: {}, body: "fake binding: native path not scripted" },
        durationMs: Date.now() - startedAt,
      });
      return new Response("not scripted", { status: 501 });
    },
  };

  function finish(
    model: string,
    input: unknown,
    options: Record<string, unknown> | undefined,
    leg: LegResult,
    startedAt: number,
  ): Response {
    const headers = new Headers({
      "cf-aig-log-id": "01TESTLOGID0000000000000000",
      "cf-aig-cache-status": "MISS",
      ...(leg.kind === "throw" ? {} : (leg.headers ?? {})),
    });

    const log = (status: number, body: unknown) =>
      record({
        timestamp: new Date(startedAt).toISOString(),
        scenario,
        request: {
          kind: "run",
          model,
          body: input,
          headers: Object.fromEntries(
            Object.entries((options?.extraHeaders as Record<string, string>) ?? {}),
          ),
          bodySha256_16: sha16(JSON.stringify(input)),
        },
        response: {
          status,
          headers: Object.fromEntries(headers.entries()),
          body,
          cacheStatus: headers.get("cf-aig-cache-status") ?? undefined,
        },
        durationMs: Date.now() - startedAt,
      });

    if (leg.kind === "throw") {
      log(0, { thrown: String(leg.error) });
      throw leg.error;
    }
    if (leg.kind === "json") {
      const status = leg.status ?? 200;
      log(status, leg.body);
      headers.set("content-type", "application/json");
      return new Response(JSON.stringify(leg.body), { status, headers });
    }
    headers.set("content-type", "text/event-stream");
    if (leg.kind === "sse") {
      log(200, { _sse: leg.body.length });
      return new Response(leg.body, { status: 200, headers });
    }
    log(200, { _stream: true });
    return new Response(leg.body, { status: 200, headers });
  }

  return binding;
}

/** 正常な非ストリーム応答。対照として毎シナリオに置く。 */
export const okJson = (text = "hello"): LegResult => ({
  kind: "json",
  body: {
    id: "chatcmpl-ok",
    object: "chat.completion",
    created: 1_760_000_000,
    model: "@cf/test/fake",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  },
});

export const errJson = (status: number, message = "boom"): LegResult => ({
  kind: "json",
  status,
  body: { error: { message, type: "test_error" } },
});
