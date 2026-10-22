/**
 * C 群（エラーの型と分類）と D 群（Retry と Fallback の入れ子）。
 *
 * D 群は「リクエスト数を数える」検証なので、**maxRetries を明示しないと測れない**。
 * AI SDK の既定は 2 なので、何も指定しないと最初から 3 倍に見える。
 */
import { describe, expect, it } from "vitest";
import { createAI, CloudflareAIError } from "agents/models/ai-sdk";
import { generateText } from "ai";
import { errJson, makeBinding, okJson } from "../fake-binding";

const P = "@cf/zai-org/glm-4.7-flash";
const F1 = "@cf/meta/llama-3.1-8b-instruct";
const F2 = "@cf/mistral/mistral-7b-instruct-v0.2";

const run = (binding: ReturnType<typeof makeBinding>, model: unknown, maxRetries: number) =>
  generateText({ model: model as never, prompt: "x", maxRetries });

describe("C 群: エラーの型", () => {
  it("C1: 2 本とも落ちると CloudflareAIError になり attempts が入る", async () => {
    const binding = makeBinding({ [P]: [errJson(500)], [F1]: [errJson(500)] }, "c1");
    const ai = createAI({ binding: binding as never });

    const err = await run(binding, ai(P, { fallback: [F1] }), 0).catch((e) => e);
    expect(err).toBeInstanceOf(CloudflareAIError);
    expect(err.attempts).toHaveLength(2);
    expect(err.attempts.map((a: { model: string }) => a.model)).toEqual([P, F1]);
    expect(err.message).toContain("All models failed");
  });

  it("C2: fallback 未設定だと attempts は入らない（doc と食い違う）", async () => {
    const binding = makeBinding({ [P]: [errJson(500)] }, "c2");
    const ai = createAI({ binding: binding as never });

    const err = await run(binding, ai(P), 0).catch((e) => e);
    expect(err).toBeInstanceOf(CloudflareAIError);
    expect(err.attempts).toBeUndefined(); // ← doc は無条件に入ると読める
  });

  it("C4: 形式不正なモデル ID は TypeError で、fallback に拾われない", async () => {
    const binding = makeBinding({ [F1]: [okJson("answered")] }, "c4");
    const ai = createAI({ binding: binding as never });

    // "gpt-5.5" はスラッシュが無いので、チェーンを組む時点で弾かれる
    expect(() => ai("gpt-5.5" as never, { fallback: [F1] })).toThrow(TypeError);
    expect(binding.calls[F1] ?? 0).toBe(0); // 1 度も呼ばれていない
  });

  it("C4対照: 形式が正しく実在しない ID は 404 になり fallback する", async () => {
    const binding = makeBinding({ [F1]: [okJson("answered")] }, "c4-ctrl");
    const ai = createAI({ binding: binding as never });

    const res = await run(binding, ai("nope/not-a-model", { fallback: [F1] }), 0);
    expect(res.text).toBe("answered");
    expect(binding.calls[F1]).toBe(1);
  });

  it("C6: 最後の leg の code と isRetryable を引き継ぐ", async () => {
    const binding = makeBinding({ [P]: [errJson(401)], [F1]: [errJson(404)] }, "c6");
    const ai = createAI({ binding: binding as never });

    const err = await run(binding, ai(P, { fallback: [F1] }), 0).catch((e) => e);
    expect(err.code).toBe("not-found"); // 先頭の 401(auth) ではなく最後の 404
    expect(err.isRetryable).toBe(false);
  });
});

describe("D 群: Retry と Fallback の入れ子", () => {
  it("D1: Retry は fallback チェーン全体を包む（リクエスト数が積になる）", async () => {
    // 500 は isRetryable=true。2 本チェーン × (1 + maxRetries 2) = 6 回
    const binding = makeBinding({ [P]: [errJson(500)], [F1]: [errJson(500)] }, "d1");
    const ai = createAI({ binding: binding as never });

    await run(binding, ai(P, { fallback: [F1] }), 2).catch(() => {});
    expect(binding.calls[P]).toBe(3);
    expect(binding.calls[F1]).toBe(3);
    expect(binding.order).toHaveLength(6);
  });

  it("D1対照: maxRetries 0 なら 2 回で終わる", async () => {
    const binding = makeBinding({ [P]: [errJson(500)], [F1]: [errJson(500)] }, "d1-ctrl");
    const ai = createAI({ binding: binding as never });

    await run(binding, ai(P, { fallback: [F1] }), 0).catch(() => {});
    expect(binding.order).toHaveLength(2);
  });

  it("D3: 404 は fallback するが retry はしない", async () => {
    const binding = makeBinding({ [P]: [errJson(404)], [F1]: [errJson(404)] }, "d3");
    const ai = createAI({ binding: binding as never });

    await run(binding, ai(P, { fallback: [F1] }), 2).catch(() => {});
    expect(binding.order).toHaveLength(2); // retry されていない
  });

  it("D3対照: 429 なら retry される", async () => {
    const binding = makeBinding({ [P]: [errJson(429)], [F1]: [errJson(429)] }, "d3-ctrl");
    const ai = createAI({ binding: binding as never });

    await run(binding, ai(P, { fallback: [F1] }), 1).catch(() => {});
    expect(binding.order.length).toBeGreaterThan(2);
  });

  it("D2: retry されるかは最後の leg のエラーで決まる", async () => {
    // 先頭が 429(retryable) でも、最後が 404 なら retry されない
    const binding = makeBinding({ [P]: [errJson(429)], [F1]: [errJson(404)] }, "d2");
    const ai = createAI({ binding: binding as never });

    await run(binding, ai(P, { fallback: [F1] }), 2).catch(() => {});
    expect(binding.order).toHaveLength(2);
  });

  it("B1: fallback は宣言順に試される", async () => {
    const binding = makeBinding(
      { [P]: [errJson(500)], [F1]: [errJson(500)], [F2]: [okJson("third")] },
      "b1",
    );
    const ai = createAI({ binding: binding as never });

    const res = await run(binding, ai(P, { fallback: [F1, F2] }), 0);
    expect(res.text).toBe("third");
    expect(binding.order).toEqual([P, F1, F2]);
  });

  it("B1対照: 順番を入れ替えると試行順も入れ替わる", async () => {
    const binding = makeBinding(
      { [P]: [errJson(500)], [F1]: [okJson("second")], [F2]: [errJson(500)] },
      "b1-ctrl",
    );
    const ai = createAI({ binding: binding as never });

    await run(binding, ai(P, { fallback: [F2, F1] }), 0);
    expect(binding.order).toEqual([P, F2, F1]);
  });
});
