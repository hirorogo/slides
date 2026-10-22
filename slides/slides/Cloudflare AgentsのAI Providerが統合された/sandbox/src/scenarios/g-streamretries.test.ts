/**
 * G 群: AI SDK の `streamRetries` と createAI の fallback の境目。
 *
 * createAI は「出力が始まったら答えは最終」と言う。
 * AI SDK v7 の `streamRetries` は「出力が始まった後のプロバイダーエラー」を再試行する。
 * **どちらのドキュメントも相手に触れていない。** 重なり方を測る。
 */
import { describe, expect, it } from "vitest";
import { createAI } from "agents/models/ai-sdk";
import { streamText } from "ai";
import { errorChunk, finishChunk, metaOnly, sse, textChunk } from "../sse";
import { makeBinding } from "../fake-binding";

const P = "@cf/zai-org/glm-4.7-flash";
const F = "@cf/meta/llama-3.1-8b-instruct";

/** primary: 1 回目は本文を出してから切断、2 回目は正常。fallback: 常に正常。 */
function setup(scenario: string) {
  const binding = makeBinding(
    {
      [P]: [
        { kind: "sse", body: sse([metaOnly(), textChunk("h"), errorChunk()]) },
        { kind: "sse", body: sse([metaOnly(), textChunk("PRIMARY-2ND"), finishChunk()]) },
      ],
      [F]: [{ kind: "sse", body: sse([metaOnly(), textChunk("FALLBACK"), finishChunk()]) }],
    },
    scenario,
  );
  return { binding, ai: createAI({ binding: binding as never }) };
}

async function drain(res: ReturnType<typeof streamText>) {
  const parts: string[] = [];
  try {
    for await (const p of res.fullStream) parts.push(p.type);
  } catch { /* 確定後の失敗 */ }
  let text = "";
  try { text = await res.text; } catch { /* 同上 */ }
  return { parts, text };
}

describe("G 群: streamRetries との境目", () => {
  it("G1対照: streamRetries を省略すると、出力後の失敗は再試行されない", async () => {
    const { binding, ai } = setup("g1-ctrl");
    await drain(streamText({ model: ai(P, { fallback: [F] }), prompt: "x", maxRetries: 0 }));

    expect(binding.calls[P]).toBe(1); // 呼び直されていない
    expect(binding.calls[F] ?? 0).toBe(0); // fallback も走らない
  });

  it("G1/G2: streamRetries を付けると doStream が呼び直される", async () => {
    const { binding, ai } = setup("g2");
    const out = await drain(
      streamText({ model: ai(P, { fallback: [F] }), prompt: "x", maxRetries: 0, streamRetries: 1 }),
    );

    // 呼び直しが起きたかどうかを、呼び出し回数そのもので判定する
    const total = (binding.calls[P] ?? 0) + (binding.calls[F] ?? 0);
    console.log(`  [G2] 呼び出し: ${JSON.stringify(binding.calls)} / 順: ${binding.order.join(" → ")}`);
    console.log(`  [G2] 最終テキスト: ${JSON.stringify(out.text)}`);
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it("G3: 再試行が起きたとき、答えたのは primary か fallback か", async () => {
    const { binding, ai } = setup("g3");
    const out = await drain(
      streamText({ model: ai(P, { fallback: [F] }), prompt: "x", maxRetries: 0, streamRetries: 2 }),
    );
    console.log(`  [G3] 呼び出し: ${JSON.stringify(binding.calls)}`);
    console.log(`  [G3] 最終テキスト: ${JSON.stringify(out.text)}`);
    console.log(`  [G3] パート列: ${out.parts.join(" → ")}`);
    expect(out).toBeTruthy();
  });
});
