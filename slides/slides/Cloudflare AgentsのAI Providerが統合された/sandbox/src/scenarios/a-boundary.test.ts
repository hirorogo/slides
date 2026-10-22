/**
 * A 群: Fallback の発火境界。記事の軸。
 *
 * ドキュメントは「a stream that fails before its first output part」としか書かない。
 * 実装は preamble パートを 6 種類並べている。
 * ここでは **chat-completions wire で実際にどこに線が引かれるか** を測る。
 *
 * 対照の置き方: 同じ「接続が切れる」事象を、切れる位置だけ変えて並べる。
 * 位置以外を揃えないと、切り替わった理由が位置だと言えない。
 */
import { describe, expect, it } from "vitest";
import { createAI } from "agents/models/ai-sdk";
import { streamText, generateText } from "ai";
import { brokenStream, finishChunk, metaOnly, reasoningChunk, sse, textChunk, toolNameOnly, toolWithArgs } from "../sse";
import { errJson, makeBinding, okJson } from "../fake-binding";

const P = "@cf/zai-org/glm-4.7-flash"; // primary
const F = "@cf/meta/llama-3.1-8b-instruct"; // fallback

/** primary を「指定チャンクまで流して接続断」、fallback を「正常に answered」にする。 */
function chain(primaryChunks: Parameters<typeof brokenStream>[0]) {
  const binding = makeBinding(
    {
      [P]: [{ kind: "stream", body: brokenStream(primaryChunks) }],
      [F]: [{ kind: "sse", body: sse([metaOnly(), textChunk("answered"), finishChunk()]) }],
    },
    "a-boundary",
  );
  const ai = createAI({ binding: binding as never });
  return { binding, ai };
}

/** fullStream を最後まで読み、出たパートの type を並べて返す。例外は投げない。 */
async function drain(res: ReturnType<typeof streamText>) {
  const parts: string[] = [];
  let threw: unknown;
  try {
    for await (const p of res.fullStream) parts.push(p.type);
  } catch (e) {
    threw = e;
  }
  let text = "";
  try {
    text = await res.text;
  } catch {
    /* 確定後に落ちたストリームは text も落ちる */
  }
  return { parts, text, threw };
}

describe("A 群: Fallback の境界", () => {
  it("A2: 出力前（response-metadata まで）に切れたら fallback する", async () => {
    const { binding, ai } = chain([metaOnly()]);
    const res = streamText({ model: ai(P, { fallback: [F] }), prompt: "x", maxRetries: 0 });
    const { text } = await drain(res);

    expect(text).toBe("answered"); // fallback が答えた
    expect(binding.calls[F]).toBe(1);
  });

  it("A3: 本文が 1 文字でも出た後に切れたら fallback しない", async () => {
    const { binding, ai } = chain([metaOnly(), textChunk("h")]);
    const res = streamText({ model: ai(P, { fallback: [F] }), prompt: "x", maxRetries: 0 });
    const { parts, threw } = await drain(res);

    expect(parts).toContain("text-delta"); // primary の出力が届いている
    expect(binding.calls[F] ?? 0).toBe(0); // fallback は呼ばれていない
    expect(threw ?? parts).toBeTruthy();
  });

  it("A4b: text-start は単独で出ず、必ず text-delta と連続する", async () => {
    // 対照なしの観測。wire が実際に出すパート列をそのまま見る。
    const binding = makeBinding(
      { [P]: [{ kind: "sse", body: sse([metaOnly(), textChunk("h"), finishChunk()]) }] },
      "a-wire",
    );
    const ai = createAI({ binding: binding as never });
    const { parts } = await drain(streamText({ model: ai(P), prompt: "x", maxRetries: 0 }));

    const s = parts.indexOf("text-start");
    const d = parts.indexOf("text-delta");
    expect(s).toBeGreaterThanOrEqual(0);
    expect(d).toBe(s + 1); // 間に何も挟まらない
  });

  it("A5: response-metadata だけなら preamble 扱いで fallback する", async () => {
    const { binding, ai } = chain([metaOnly()]);
    const { text } = await drain(
      streamText({ model: ai(P, { fallback: [F] }), prompt: "x", maxRetries: 0 }),
    );
    expect(text).toBe("answered");
    expect(binding.calls[F]).toBe(1);
  });

  it("A5c: ツール名だけ届いた段階（tool-input-start）なら、まだ fallback する", async () => {
    const { binding, ai } = chain([metaOnly(), toolNameOnly()]);
    const { text } = await drain(
      streamText({ model: ai(P, { fallback: [F] }), prompt: "x", maxRetries: 0 }),
    );

    expect(text).toBe("answered"); // ← ここが記事の見どころ
    expect(binding.calls[F]).toBe(1);
  });

  it("A5c対照: ツールの引数が出たら確定して fallback しない", async () => {
    const { binding, ai } = chain([metaOnly(), toolWithArgs()]);
    await drain(streamText({ model: ai(P, { fallback: [F] }), prompt: "x", maxRetries: 0 }));

    expect(binding.calls[F] ?? 0).toBe(0);
  });

  it("A5b: reasoning-start は reasoning-delta と対で出る（単独到達なし）", async () => {
    const binding = makeBinding(
      { [P]: [{ kind: "sse", body: sse([metaOnly(), reasoningChunk("th"), finishChunk()]) }] },
      "a-reasoning",
    );
    const ai = createAI({ binding: binding as never });
    const { parts } = await drain(streamText({ model: ai(P), prompt: "x", maxRetries: 0 }));

    const s = parts.indexOf("reasoning-start");
    if (s >= 0) expect(parts[s + 1]).toBe("reasoning-delta");
  });

  it("A1: 非ストリームでベンダーが拒否したら fallback する", async () => {
    const binding = makeBinding(
      { [P]: [errJson(400, "vendor rejected")], [F]: [okJson("answered")] },
      "a-generate",
    );
    const ai = createAI({ binding: binding as never });
    const res = await generateText({
      model: ai(P, { fallback: [F] }),
      prompt: "x",
      maxRetries: 0,
    });

    expect(res.text).toBe("answered");
    expect(binding.order).toEqual([P, F]); // 宣言順に試されている
  });

  it("A1対照: fallback 無しなら同じ 400 がそのまま例外になる", async () => {
    const binding = makeBinding({ [P]: [errJson(400, "vendor rejected")] }, "a-generate-ctrl");
    const ai = createAI({ binding: binding as never });

    await expect(
      generateText({ model: ai(P), prompt: "x", maxRetries: 0 }),
    ).rejects.toThrow();
    expect(binding.calls[P]).toBe(1);
  });

  it("A8: 答えた leg の metadata に差し替わる", async () => {
    const binding = makeBinding(
      { [P]: [errJson(500)], [F]: [okJson("answered")] },
      "a-metadata",
    );
    const ai = createAI({ binding: binding as never });
    const res = await generateText({
      model: ai(P, { fallback: [F] }),
      prompt: "x",
      maxRetries: 0,
    });

    expect((res.providerMetadata?.cloudflare as Record<string, unknown>)?.model).toBe(F);
  });
});
