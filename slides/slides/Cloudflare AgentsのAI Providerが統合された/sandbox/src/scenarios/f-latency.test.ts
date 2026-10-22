/**
 * F 群の決着。
 *
 * F1 は外れた。理由を押さえるために、**利用者に見えるパート**を数える。
 * chat-completions wire で利用者より手前に届くプリアンブルが無いなら、
 * fallback の覗き見は立ち上がりに影響しようがない。
 */
import { describe, expect, it } from "vitest";
import { createAI } from "agents/models/ai-sdk";
import { streamText, generateText } from "ai";
import { finishChunk, metaOnly, pacedStream, sse, textChunk } from "../sse";
import { errJson, makeBinding, okJson } from "../fake-binding";

const P = "@cf/zai-org/glm-4.7-flash";
const F = "@cf/meta/llama-3.1-8b-instruct";

describe("F1 の理由: response-metadata は利用者に届かない", () => {
  it("fullStream に response-metadata は出ない（AI SDK が内部で消費する）", async () => {
    const binding = makeBinding(
      { [P]: [{ kind: "sse", body: sse([metaOnly(), textChunk("hi"), finishChunk()]) }] },
      "f1-reason",
    );
    const ai = createAI({ binding: binding as never });
    const res = streamText({ model: ai(P), prompt: "x", maxRetries: 0 });
    const parts: string[] = [];
    for await (const p of res.fullStream) parts.push(p.type);

    expect(parts).not.toContain("response-metadata");
    // 利用者から見た最初のプロバイダー由来パートは text-start
    expect(parts.filter((t) => t !== "start" && t !== "start-step")[0]).toBe("text-start");
  });

  it("対照: response-metadata は response.id として届いてはいる", async () => {
    const binding = makeBinding(
      { [P]: [{ kind: "sse", body: sse([metaOnly(), textChunk("hi"), finishChunk()]) }] },
      "f1-reason-ctrl",
    );
    const ai = createAI({ binding: binding as never });
    const res = streamText({ model: ai(P), prompt: "x", maxRetries: 0 });
    for await (const _ of res.fullStream) { /* drain */ }
    expect((await res.response).id).toBe("chatcmpl-test"); // 捨てられてはいない
  });
});

describe("F2: fallback 発火時の追加レイテンシ", () => {
  /** 指定ミリ秒だけ待ってから失敗する leg。 */
  const slowFail = (ms: number) => ({
    kind: "stream" as const,
    body: pacedStream([{ chunk: { ...metaOnly(), error: { message: "boom" } }, delayMs: ms }]),
  });

  it("落ちた leg の待ち時間が、そのまま足し算になる", async () => {
    const DELAY = 200;
    const binding = makeBinding(
      {
        [P]: [slowFail(DELAY)],
        [F]: [{ kind: "sse", body: sse([metaOnly(), textChunk("OK"), finishChunk()]) }],
      },
      "f2",
    );
    const ai = createAI({ binding: binding as never });

    const t0 = Date.now();
    const res = streamText({ model: ai(P, { fallback: [F] }), prompt: "x", maxRetries: 0 });
    let answerAt = -1;
    for await (const p of res.fullStream) {
      if (p.type === "text-delta" && answerAt < 0) answerAt = Date.now() - t0;
    }
    expect(await res.text).toBe("OK");
    // primary の 200ms を待ってから fallback に行くので、200ms 以上かかる
    expect(answerAt).toBeGreaterThanOrEqual(DELAY);
    console.log(`  [F2] fallback の答えが届くまで: ${answerAt}ms（primary の遅延 ${DELAY}ms）`);
  });

  it("対照: primary が即座に成功するなら待ちは入らない", async () => {
    const binding = makeBinding(
      { [P]: [{ kind: "sse", body: sse([metaOnly(), textChunk("OK"), finishChunk()]) }], [F]: [okJson("x")] },
      "f2-ctrl",
    );
    const ai = createAI({ binding: binding as never });
    const t0 = Date.now();
    const res = streamText({ model: ai(P, { fallback: [F] }), prompt: "x", maxRetries: 0 });
    for await (const _ of res.fullStream) { /* drain */ }
    const dt = Date.now() - t0;
    console.log(`  [F2対照] primary 即答: ${dt}ms`);
    expect(dt).toBeLessThan(150);
  });

  it("非ストリームでも、落ちた leg の時間は積み上がる", async () => {
    const binding = makeBinding(
      { [P]: [errJson(500)], [F]: [errJson(500)], ["@cf/x/y"]: [okJson("THIRD")] },
      "f2-generate",
    );
    const ai = createAI({ binding: binding as never });
    const r = await generateText({
      model: ai(P, { fallback: [F, "@cf/x/y" as never] }),
      prompt: "x",
      maxRetries: 0,
    });
    expect(r.text).toBe("THIRD");
    expect(binding.order).toHaveLength(3); // 3 回ぶんの往復が直列に積まれる
  });
});
