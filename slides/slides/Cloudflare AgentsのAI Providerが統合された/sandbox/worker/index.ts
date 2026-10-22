/**
 * 実機シナリオ。`wrangler dev --remote` で本物の AI binding に当てる。
 *
 * 測るのは claims.md の C3 / E2 / E3 / D4 だけ。
 * 境界（A 群）と Retry の積（D1〜D3）はローカルで確定済みなので、ここでは触らない。
 *
 * **全呼び出しの結果を JSON で返す。** 画面に出ない観測は結論に使わない。
 */
import { createAI, CloudflareAIError } from "agents/models/ai-sdk";
import { generateText, streamText } from "ai";

export interface Env {
  AI: Ai;
}

/** 無料枠を無駄にしないため、小さいモデルと短いプロンプトで固定する。 */
const SMALL = "@cf/meta/llama-3.2-1b-instruct";
const PROMPT = "Say OK.";

type Obs = Record<string, unknown>;

/** 毎回ユニークなプロンプトにして、Gateway キャッシュの HIT を避ける。 */
const uniq = (tag: string) => `${PROMPT} [${tag}-${crypto.randomUUID().slice(0, 8)}]`;

async function capture(name: string, fn: () => Promise<Obs>): Promise<Obs> {
  const startedAt = Date.now();
  try {
    const out = await fn(); // 先に走らせる。オブジェクトリテラル内だと durationMs が 0 になる
    return { name, ok: true, durationMs: Date.now() - startedAt, ...out };
  } catch (error) {
    const e = error as CloudflareAIError & { name?: string };
    return {
      name,
      ok: false,
      durationMs: Date.now() - startedAt,
      errorName: e?.name,
      isCloudflareAIError: error instanceof CloudflareAIError,
      status: e?.status,
      code: e?.code,
      isRetryable: e?.isRetryable,
      logId: e?.logId,
      model: e?.model,
      attempts: e?.attempts?.map((a) => ({ model: a.model, error: String(a.error).slice(0, 200) })),
      message: String(e?.message ?? error).slice(0, 300),
    };
  }
}

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const ai = createAI({ binding: env.AI });
    const results: Obs[] = [];

    // ── 対照: まず検証したい機能を外した状態で通す ───────────────
    // Workers AI は立ち上がりに 500 を返すことがある。何回目で通ったかを必ず残す。
    results.push(
      await capture("00-control-正常系", async () => {
        let attempt = 0;
        const errors: string[] = [];
        for (;;) {
          attempt += 1;
          try {
            const r = await generateText({ model: ai(SMALL), prompt: uniq("ctrl"), maxRetries: 0 });
            const cf = (r.providerMetadata?.cloudflare ?? {}) as Obs;
            return {
              通るまでの試行回数: attempt,
              途中のエラー: errors,
              text: r.text.slice(0, 60),
              cloudflare: cf,
              responseModelId: r.response?.modelId,
            };
          } catch (e) {
            errors.push(String((e as Error).message).slice(0, 120));
            if (attempt >= 4) throw e;
          }
        }
      }),
    );

    // ── E2 / E3: metadata のキーと、書いた ID との関係 ──────────────
    results.push(
      await capture("E2E3-metadata-WorkersAI直", async () => {
        const r = await generateText({ model: ai(SMALL), prompt: uniq("e2"), maxRetries: 0 });
        const cf = (r.providerMetadata?.cloudflare ?? {}) as Obs;
        return {
          requestedModelId: SMALL,
          metadataModel: cf.model,
          responseModelId: r.response?.modelId,
          一致: cf.model === r.response?.modelId,
          presentKeys: Object.keys(cf).sort(),
          cacheStatus: cf.cacheStatus,
        };
      }),
    );

    // ── C3: ステータス → code の分類 ────────────────────────────
    // 404: 形式は正しいが実在しない Workers AI ID
    results.push(
      await capture("C3-404-存在しないWorkersAIモデル", async () => {
        const r = await generateText({
          model: ai("@cf/nope/does-not-exist" as never),
          prompt: uniq("404"),
          maxRetries: 0,
        });
        return { 予想外に成功: r.text.slice(0, 60) };
      }),
    );

    // 404 相当: 実在しないカタログ ID
    results.push(
      await capture("C3-カタログ存在しない", async () => {
        const r = await generateText({
          model: ai("nope/not-a-real-model" as never),
          prompt: uniq("cat404"),
          maxRetries: 0,
        });
        return { 予想外に成功: r.text.slice(0, 60) };
      }),
    );

    // 400: 実在するが言語モデルではない ID（埋め込みモデル）を chat として呼ぶ
    results.push(
      await capture("C3-400-埋め込みモデルをchatで呼ぶ", async () => {
        const r = await generateText({
          model: ai("@cf/baai/bge-base-en-v1.5" as never),
          prompt: uniq("400"),
          maxRetries: 0,
        });
        return { 予想外に成功: r.text.slice(0, 60) };
      }),
    );

    // ── C3 + fallback: 404 から実在モデルへ切り替わるか（実機版 A1）─
    results.push(
      await capture("C3-fallback-404から復帰", async () => {
        const r = await generateText({
          model: ai("@cf/nope/does-not-exist" as never, { fallback: [SMALL] }),
          prompt: uniq("fb"),
          maxRetries: 0,
        });
        const cf = (r.providerMetadata?.cloudflare ?? {}) as Obs;
        return { text: r.text.slice(0, 60), 答えたモデル: cf.model, presentKeys: Object.keys(cf).sort() };
      }),
    );

    // ── C2 実機版: fallback 未設定だと attempts が入らないか ────────
    results.push(
      await capture("C2-実機-attempts無し", async () => {
        const r = await generateText({
          model: ai("@cf/nope/does-not-exist" as never),
          prompt: uniq("c2"),
          maxRetries: 0,
        });
        return { 予想外に成功: r.text.slice(0, 60) };
      }),
    );

    // ── C1 実機版: 全 leg 失敗で attempts が入るか ──────────────
    results.push(
      await capture("C1-実機-全leg失敗", async () => {
        const r = await generateText({
          model: ai("@cf/nope/does-not-exist" as never, { fallback: ["@cf/also/missing" as never] }),
          prompt: uniq("c1"),
          maxRetries: 0,
        });
        return { 予想外に成功: r.text.slice(0, 60) };
      }),
    );

    // ── D4: gateway の retries オプションを付けたとき ──────────────
    results.push(
      await capture("D4-gateway-retries", async () => {
        const r = await generateText({
          model: ai(SMALL, { retries: { maxAttempts: 2, retryDelayMs: 100, backoff: "constant" } } as never),
          prompt: uniq("d4"),
          maxRetries: 0,
        });
        const cf = (r.providerMetadata?.cloudflare ?? {}) as Obs;
        return { text: r.text.slice(0, 40), presentKeys: Object.keys(cf).sort(), step: cf.step };
      }),
    );

    // ── 実機のストリーミング: 正常系とfallback、パート列を記録 ────────
    results.push(
      await capture("S1-stream-正常系", async () => {
        const res = streamText({ model: ai(SMALL), prompt: uniq("s1"), maxRetries: 0 });
        const parts: string[] = [];
        let firstPartAt = 0;
        const t0 = Date.now();
        for await (const p of res.fullStream) {
          if (firstPartAt === 0) firstPartAt = Date.now() - t0;
          parts.push(p.type);
        }
        const cf = ((await res.providerMetadata)?.cloudflare ?? {}) as Obs;
        return {
          ttfpMs: firstPartAt,
          partKinds: [...new Set(parts)],
          partCount: parts.length,
          presentKeys: Object.keys(cf).sort(),
          runIdあり: "runId" in cf,
          text: (await res.text).slice(0, 40),
        };
      }),
    );

    results.push(
      await capture("S2-stream-fallback実機", async () => {
        const res = streamText({
          model: ai("@cf/nope/does-not-exist" as never, { fallback: [SMALL] }),
          prompt: uniq("s2"),
          maxRetries: 0,
        });
        const parts: string[] = [];
        for await (const p of res.fullStream) parts.push(p.type);
        const cf = ((await res.providerMetadata)?.cloudflare ?? {}) as Obs;
        return {
          答えたモデル: cf.model,
          partKinds: [...new Set(parts)],
          落ちたlegのパートが混ざっていないか: !parts.includes("error"),
          text: (await res.text).slice(0, 40),
        };
      }),
    );

    // ── 最後にもう一度 正常系（枠切れしていないことを示す）─────────
    results.push(
      await capture("99-control-最後の正常系", async () => {
        const r = await generateText({ model: ai(SMALL), prompt: uniq("final"), maxRetries: 0 });
        const cf = (r.providerMetadata?.cloudflare ?? {}) as Obs;
        return { text: r.text.slice(0, 60), cacheStatus: cf.cacheStatus };
      }),
    );

    return Response.json(
      { runAt: new Date().toISOString(), model: SMALL, results },
      { headers: { "content-type": "application/json; charset=utf-8" } },
    );
  },
};
