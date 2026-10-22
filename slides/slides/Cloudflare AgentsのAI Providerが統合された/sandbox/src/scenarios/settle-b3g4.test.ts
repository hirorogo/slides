/**
 * B3 と G4 の詰め直し。最初の測定で主張が外れたので、条件を分けて測る。
 *
 * B3: 「leg の fallback が再展開されない」は**誤りだった**。
 *     実装が剥がすのは per-call の fallback であって、leg が自分で持つ
 *     per-model の fallback ではない。2 つを分けて測る。
 * G4: `streamRetries` を省略すると stream retry が全無効になるため、
 *     `onError` の `{ retry: true }` も効かない。`0` を渡して測り直す。
 */
import { describe, expect, it } from "vitest";
import { createAI } from "agents/models/ai-sdk";
import { generateText, streamText } from "ai";
import { errorChunk, metaOnly, sse, textChunk } from "../sse";
import { errJson, makeBinding, okJson } from "../fake-binding";

const P = "@cf/zai-org/glm-4.7-flash";
const F = "@cf/meta/llama-3.1-8b-instruct";
const F2 = "@cf/mistral/mistral-7b-instruct-v0.2";

describe("B3 詰め直し: どの fallback が継承されるか", () => {
  it("B3a: leg が自分で持つ per-model fallback は展開される", async () => {
    const binding = makeBinding(
      { [P]: [errJson(500)], [F]: [errJson(500)], [F2]: [okJson("DEEP")] },
      "b3a",
    );
    const ai = createAI({ binding: binding as never });
    const leg = ai(F, { fallback: [F2] }); // leg 自身がチェーンを持つ

    const r = await generateText({ model: ai(P, { fallback: [leg] }), prompt: "x", maxRetries: 0 });

    expect(r.text).toBe("DEEP");
    expect(binding.order).toEqual([P, F, F2]); // 入れ子が展開されている
  });

  it("B3b: per-call の fallback は leg に継承されない（無限展開しない）", async () => {
    const binding = makeBinding(
      { [P]: [errJson(500)], [F]: [errJson(500)] },
      "b3b",
    );
    const ai = createAI({ binding: binding as never });

    // 呼び出し側の fallback に F を置く。F がこれを再度読むと無限に増える
    const err = await generateText({
      model: ai(P),
      prompt: "x",
      maxRetries: 0,
      providerOptions: { cloudflare: { fallback: [F] } },
    }).catch((e) => e);

    expect(binding.order).toEqual([P, F]); // ちょうど 2 回。再展開されていない
    expect(err.attempts).toHaveLength(2);
  });

  it("B3c: 入れ子は 3 段でも展開される", async () => {
    const F3 = "@cf/qwen/qwen2.5-coder-32b-instruct";
    const binding = makeBinding(
      { [P]: [errJson(500)], [F]: [errJson(500)], [F2]: [errJson(500)], [F3]: [okJson("DEEPEST")] },
      "b3c",
    );
    const ai = createAI({ binding: binding as never });
    const inner = ai(F2, { fallback: [F3] });
    const mid = ai(F, { fallback: [inner] });

    const r = await generateText({ model: ai(P, { fallback: [mid] }), prompt: "x", maxRetries: 0 });
    expect(r.text).toBe("DEEPEST");
    expect(binding.order).toEqual([P, F, F2, F3]);
  });

  it("B3d: 入れ子 × maxRetries はリクエスト数が積になる", async () => {
    const binding = makeBinding(
      { [P]: [errJson(500)], [F]: [errJson(500)], [F2]: [errJson(500)] },
      "b3d",
    );
    const ai = createAI({ binding: binding as never });
    const leg = ai(F, { fallback: [F2] });

    await generateText({ model: ai(P, { fallback: [leg] }), prompt: "x", maxRetries: 2 }).catch(() => {});
    // 3 モデル × (1 + 2) = 9
    expect(binding.order).toHaveLength(9);
  });
});

describe("G4 詰め直し: onError の retry 要求", () => {
  const failing = () => ({ kind: "sse" as const, body: sse([metaOnly(), textChunk("P-"), errorChunk()]) });

  const probe = async (streamRetries: number | undefined) => {
    const f = failing();
    const binding = makeBinding({ [P]: [f, f, f] }, `g4-${streamRetries}`);
    const ai = createAI({ binding: binding as never });
    let asked = 0;
    const opts: Record<string, unknown> = {
      model: ai(P),
      prompt: "x",
      maxRetries: 0,
      onError: () => { asked += 1; return asked === 1 ? { retry: true } : undefined; },
    };
    if (streamRetries !== undefined) opts.streamRetries = streamRetries;
    const res = streamText(opts as never);
    try { for await (const _ of res.fullStream) { /* drain */ } } catch { /* ignore */ }
    return { asked, calls: binding.calls[P] ?? 0 };
  };

  it("streamRetries を省略すると onError の retry は効かない", async () => {
    const r = await probe(undefined);
    console.log(`  [G4 省略] onError=${r.asked} 呼び出し=${r.calls}`);
    expect(r.calls).toBe(1);
  });

  it("streamRetries: 0 なら onError が 1 回だけ retry を要求できる", async () => {
    const r = await probe(0);
    console.log(`  [G4 zero] onError=${r.asked} 呼び出し=${r.calls}`);
    expect(r.calls).toBe(2); // doc: 自動再試行ゼロでも onError は 1 回要求できる
  });
});
