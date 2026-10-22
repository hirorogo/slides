/**
 * 独立再現: 境界を**別の失敗モード**で測り直す。
 *
 * `boundary-probe.ts` は接続断（`controller.error`）で測った。これは
 * `withStreamFallbackLegs` の try/catch 側を通る。
 * ここでは 200 の SSE に載せた `error` パートで測る。こちらは
 * `value.type === "error"` の分岐を通る。**別の経路で同じ線が出るかを見る。**
 *
 * モデル ID も本文も、最初の測定とは別のものを使う。
 */
import { describe, expect, it } from "vitest";
import { createAI } from "agents/models/ai-sdk";
import { streamText } from "ai";
import { errorChunk, finishChunk, metaOnly, sse, textChunk, toolNameOnly, toolWithArgs } from "../sse";
import { makeBinding } from "../fake-binding";

// 最初の測定とは別のモデル ID を使う
const P = "@cf/qwen/qwen2.5-coder-32b-instruct";
const F = "@cf/google/gemma-3-12b-it";

function probe(before: ReturnType<typeof metaOnly>[]) {
  const binding = makeBinding(
    {
      [P]: [{ kind: "sse", body: sse([...before, errorChunk("mid-stream failure")]) }],
      [F]: [{ kind: "sse", body: sse([metaOnly(), textChunk("SECOND-MODEL"), finishChunk()]) }],
    },
    "repro",
  );
  const ai = createAI({ binding: binding as never });
  return { binding, ai };
}

async function text(binding: ReturnType<typeof makeBinding>, ai: ReturnType<typeof createAI>) {
  const res = streamText({ model: ai(P, { fallback: [F] }), prompt: "repro", maxRetries: 0 });
  try { for await (const _ of res.fullStream) { /* drain */ } } catch { /* ignore */ }
  try { return await res.text; } catch { return ""; }
}

describe("独立再現: in-band error でも同じ境界が出るか", () => {
  it("出力前（metadata のみ）なら fallback する", async () => {
    const { binding, ai } = probe([metaOnly()]);
    expect(await text(binding, ai)).toBe("SECOND-MODEL");
    expect(binding.calls[F]).toBe(1);
  });

  it("ツール名だけなら fallback する", async () => {
    const { binding, ai } = probe([metaOnly(), toolNameOnly("lookup")]);
    expect(await text(binding, ai)).toBe("SECOND-MODEL");
    expect(binding.calls[F]).toBe(1);
  });

  it("ツール引数が出たら fallback しない", async () => {
    const { binding, ai } = probe([metaOnly(), toolWithArgs("lookup", '{"q"')]);
    await text(binding, ai);
    expect(binding.calls[F] ?? 0).toBe(0);
  });

  it("本文が 1 文字出たら fallback しない", async () => {
    const { binding, ai } = probe([metaOnly(), textChunk("Z")]);
    await text(binding, ai);
    expect(binding.calls[F] ?? 0).toBe(0);
  });
});
