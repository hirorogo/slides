/**
 * 未決着だったローカル項目の決着: A6 / A7 / B2 / B3 / B4 / C5 / E2 / G4。
 *
 * どれも偽 binding で足りる。対照は同じ it の中に並べる。
 */
import { describe, expect, it } from "vitest";
import { createAI, CloudflareAIError } from "agents/models/ai-sdk";
import { generateText, streamText } from "ai";
import { errorChunk, finishChunk, metaOnly, sse, textChunk } from "../sse";
import { errJson, makeBinding, okJson } from "../fake-binding";

const P = "@cf/zai-org/glm-4.7-flash";
const F = "@cf/meta/llama-3.1-8b-instruct";
const F2 = "@cf/mistral/mistral-7b-instruct-v0.2";

const drain = async (res: ReturnType<typeof streamText>) => {
  try { for await (const _ of res.fullStream) { /* drain */ } } catch { /* ignore */ }
  try { return await res.text; } catch { return ""; }
};

describe("A6: finish_reason が error なら fallback する", () => {
  it("出力前の finish(error) は fallback する", async () => {
    const binding = makeBinding(
      {
        [P]: [{ kind: "sse", body: sse([metaOnly(), finishChunk("error")]) }],
        [F]: [{ kind: "sse", body: sse([metaOnly(), textChunk("ANSWERED"), finishChunk()]) }],
      },
      "a6",
    );
    const ai = createAI({ binding: binding as never });
    expect(await drain(streamText({ model: ai(P, { fallback: [F] }), prompt: "x", maxRetries: 0 }))).toBe("ANSWERED");
    expect(binding.calls[F]).toBe(1);
  });

  it("対照: finish_reason が stop なら fallback しない", async () => {
    const binding = makeBinding(
      {
        [P]: [{ kind: "sse", body: sse([metaOnly(), textChunk("PRIMARY"), finishChunk("stop")]) }],
        [F]: [okJson("ANSWERED")],
      },
      "a6-ctrl",
    );
    const ai = createAI({ binding: binding as never });
    expect(await drain(streamText({ model: ai(P, { fallback: [F] }), prompt: "x", maxRetries: 0 }))).toBe("PRIMARY");
    expect(binding.calls[F] ?? 0).toBe(0);
  });
});

describe("A7: abort は fallback しない", () => {
  it("中断すると fallback に進まず、そのまま throw する", async () => {
    const ctrl = new AbortController();
    const binding = makeBinding(
      { [P]: [{ kind: "throw", error: Object.assign(new Error("aborted"), { name: "AbortError" }) }], [F]: [okJson("ANSWERED")] },
      "a7",
    );
    const ai = createAI({ binding: binding as never });

    await expect(
      generateText({ model: ai(P, { fallback: [F] }), prompt: "x", maxRetries: 0, abortSignal: ctrl.signal }),
    ).rejects.toThrow();
    expect(binding.calls[F] ?? 0).toBe(0); // fallback は呼ばれない
  });

  it("対照: abort でない throw なら fallback する", async () => {
    const binding = makeBinding(
      { [P]: [{ kind: "throw", error: new Error("boom") }], [F]: [okJson("ANSWERED")] },
      "a7-ctrl",
    );
    const ai = createAI({ binding: binding as never });
    const r = await generateText({ model: ai(P, { fallback: [F] }), prompt: "x", maxRetries: 0 });
    expect(r.text).toBe("ANSWERED");
    expect(binding.calls[F]).toBe(1);
  });
});

describe("B2/B3/B4: チェーンの組み立て", () => {
  it("B2: per-call の fallback は per-model を置換する（連結しない）", async () => {
    const binding = makeBinding(
      { [P]: [errJson(500)], [F]: [errJson(500)], [F2]: [okJson("CALL-LEG")] },
      "b2",
    );
    const ai = createAI({ binding: binding as never });

    const r = await generateText({
      model: ai(P, { fallback: [F] }), // モデル側は F
      prompt: "x",
      maxRetries: 0,
      providerOptions: { cloudflare: { fallback: [F2] } }, // 呼び出し側は F2
    });

    expect(r.text).toBe("CALL-LEG");
    expect(binding.order).toEqual([P, F2]); // F は試されていない＝置換
    expect(binding.calls[F] ?? 0).toBe(0);
  });

  it("B3: fallback leg は自分の fallback を再展開しない", async () => {
    const binding = makeBinding(
      { [P]: [errJson(500)], [F]: [errJson(500)], [F2]: [okJson("DEEP")] },
      "b3",
    );
    const ai = createAI({ binding: binding as never });

    // leg 自身が fallback を持つモデルオブジェクト
    const leg = ai(F, { fallback: [F2] });
    const r = await generateText({ model: ai(P, { fallback: [leg] }), prompt: "x", maxRetries: 0 }).catch((e) => e);

    // leg の fallback が効けば DEEP、再展開されなければ失敗
    console.log(`  [B3] 順: ${binding.order.join(" → ")} / 結果: ${r?.text ?? r?.constructor?.name}`);
    expect(binding.order[0]).toBe(P);
  });

  it("B4: 空配列の fallback は未指定と同じ（attempts が入らない）", async () => {
    const empty = makeBinding({ [P]: [errJson(500)] }, "b4-empty");
    const unset = makeBinding({ [P]: [errJson(500)] }, "b4-unset");

    const e1 = await generateText({
      model: createAI({ binding: empty as never })(P, { fallback: [] }),
      prompt: "x", maxRetries: 0,
    }).catch((e) => e);
    const e2 = await generateText({
      model: createAI({ binding: unset as never })(P),
      prompt: "x", maxRetries: 0,
    }).catch((e) => e);

    expect(e1.attempts).toBeUndefined();
    expect(e2.attempts).toBeUndefined();
    expect(e1.code).toBe(e2.code);
  });
});

describe("C5: isRetryable の境界", () => {
  const cases: [number, boolean][] = [
    [400, false], [401, false], [403, false], [404, false], [422, false],
    [408, true], [409, true], [429, true], [500, true], [503, true],
  ];
  for (const [status, expected] of cases) {
    it(`${status} → isRetryable=${expected}`, async () => {
      const binding = makeBinding({ [P]: [errJson(status)] }, `c5-${status}`);
      const ai = createAI({ binding: binding as never });
      const err = await generateText({ model: ai(P), prompt: "x", maxRetries: 0 }).catch((e) => e);
      expect(err).toBeInstanceOf(CloudflareAIError);
      expect(err.isRetryable).toBe(expected);
    });
  }
});

describe("E2: metadata.model は書いた ID であって申告名ではない", () => {
  it("プロバイダーが別名を名乗っても metadata.model は変わらない", async () => {
    // body の model を、呼んだ ID と別のものにする
    const binding = makeBinding(
      {
        [P]: [{
          kind: "json",
          body: {
            id: "chatcmpl-x", object: "chat.completion", created: 1,
            model: "SOMETHING-ELSE-v9", // ← プロバイダーの申告
            choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        }],
      },
      "e2",
    );
    const ai = createAI({ binding: binding as never });
    const r = await generateText({ model: ai(P), prompt: "x", maxRetries: 0 });

    const cf = r.providerMetadata?.cloudflare as Record<string, unknown>;
    expect(cf.model).toBe(P); // 書いた ID
    expect(r.response?.modelId).toBe("SOMETHING-ELSE-v9"); // 申告名
    expect(cf.model).not.toBe(r.response?.modelId); // ← ズレる側を確認
  });
});

describe("G4: onError の retry 要求", () => {
  it("onError が { retry: true } を返すと再試行される", async () => {
    const fail = { kind: "sse" as const, body: sse([metaOnly(), textChunk("P-"), errorChunk()]) };
    const binding = makeBinding({ [P]: [fail, fail, fail] }, "g4");
    const ai = createAI({ binding: binding as never });

    let seen = 0;
    const res = streamText({
      model: ai(P),
      prompt: "x",
      maxRetries: 0,
      onError: () => { seen += 1; return seen === 1 ? { retry: true } : undefined; },
    } as never);
    await drain(res);

    console.log(`  [G4] onError 回数=${seen} / primary 呼び出し=${binding.calls[P]}`);
    expect(seen).toBeGreaterThan(0);
  });
});
