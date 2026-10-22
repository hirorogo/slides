/**
 * 00: 偽 binding そのものの対照。
 *
 * **fallback を外した状態で先に通す。** これを飛ばすと、あとで結果が出ないときに
 * 「偽 binding が壊れている」のか「fallback が動いていない」のか切り分けられない。
 */
import { describe, expect, it } from "vitest";
import { createAI } from "agents/models/ai-sdk";
import { generateText, streamText } from "ai";
import { makeBinding, okJson } from "../fake-binding";
import { finishChunk, sse, textChunk } from "../sse";
import { collectRecording } from "../evidence";

const MODEL = "@cf/zai-org/glm-4.7-flash";

describe("00 偽 binding の対照", () => {
  it("fallback 無しで generateText が通る", async () => {
    const { log, stop } = collectRecording();
    const binding = makeBinding({ [MODEL]: [okJson("hi")] }, "smoke-generate");
    const ai = createAI({ binding: binding as never });

    const res = await generateText({
      model: ai(MODEL),
      prompt: "hello",
      maxRetries: 0, // 既定は 2。数を数える前に必ず 0 に固定する
    });

    expect(res.text).toBe("hi");
    expect(binding.calls[MODEL]).toBe(1);
    expect(log).toHaveLength(1);
    expect(log[0]!.response.status).toBe(200);
    stop();
  });

  it("fallback 無しで streamText が通り、パート列が観測できる", async () => {
    const binding = makeBinding(
      { [MODEL]: [{ kind: "sse", body: sse([textChunk("he"), textChunk("llo"), finishChunk()]) }] },
      "smoke-stream",
    );
    const ai = createAI({ binding: binding as never });

    const res = streamText({ model: ai(MODEL), prompt: "hello", maxRetries: 0 });
    const parts: string[] = [];
    for await (const p of res.fullStream) parts.push(p.type);

    expect(parts).toContain("text-delta");
    expect(await res.text).toBe("hello");
    expect(binding.calls[MODEL]).toBe(1);
  });

  it("対照: 登録していないモデルは 404 になる", async () => {
    const binding = makeBinding({}, "smoke-404");
    const ai = createAI({ binding: binding as never });

    await expect(
      generateText({ model: ai("nope/not-a-model"), prompt: "x", maxRetries: 0 }),
    ).rejects.toThrow();
    expect(binding.calls["nope/not-a-model"]).toBe(1);
  });
});
