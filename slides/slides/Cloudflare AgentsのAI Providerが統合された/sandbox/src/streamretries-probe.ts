/**
 * streamRetries が走ったとき、最終的に答えるのは誰か。
 *
 * createAI のドキュメント:
 *   > Once a model has produced output, its answer is final, errors included.
 *
 * これが上のレイヤーの設定で破れるかどうかを測る。
 */
import { createAI } from "agents/models/ai-sdk";
import { streamText } from "ai";
import { errorChunk, finishChunk, metaOnly, sse, textChunk } from "./sse";
import { makeBinding } from "./fake-binding";
import { startRecording } from "./evidence";

const P = "@cf/zai-org/glm-4.7-flash";
const F = "@cf/meta/llama-3.1-8b-instruct";

const file = startRecording("streamretries");

/** primary は毎回「本文を出してから error」。fallback は正常。 */
function setup(scenario: string) {
  const primaryFails = {
    kind: "sse" as const,
    body: sse([metaOnly(), textChunk("PARTIAL-"), errorChunk()]),
  };
  const binding = makeBinding(
    {
      [P]: [primaryFails, primaryFails, primaryFails],
      [F]: [{ kind: "sse", body: sse([metaOnly(), textChunk("FALLBACK-ANSWER"), finishChunk()]) }],
    },
    scenario,
  );
  return { binding, ai: createAI({ binding: binding as never }) };
}

async function probe(label: string, streamRetries: number | undefined) {
  const { binding, ai } = setup(`sr=${streamRetries}`);
  const opts: Record<string, unknown> = {
    model: ai(P, { fallback: [F] }),
    prompt: "x",
    maxRetries: 0,
  };
  if (streamRetries !== undefined) opts.streamRetries = streamRetries;

  const res = streamText(opts as never);
  const deltas: string[] = [];
  const parts: string[] = [];
  try {
    for await (const p of res.fullStream) {
      parts.push(p.type);
      if (p.type === "text-delta") deltas.push((p as { text: string }).text);
    }
  } catch { /* 確定後の失敗 */ }
  let text = "";
  try { text = await res.text; } catch { /* 同上 */ }

  console.log(`\n── ${label}`);
  console.log(`   呼び出し回数 : ${JSON.stringify(binding.calls)}`);
  console.log(`   試行順       : ${binding.order.join(" → ")}`);
  console.log(`   利用者が見た : ${JSON.stringify(deltas.join(""))}`);
  console.log(`   res.text     : ${JSON.stringify(text)}`);
  console.log(`   答えたモデル : ${(binding.calls[F] ?? 0) > 0 ? "fallback" : "primary のみ"}`);
}

console.log(`primary = 本文を出してから error（毎回失敗）`);
console.log(`fallback = 正常に答える`);
console.log(`証跡: ${file}`);

await probe("streamRetries 省略（既定）", undefined);
await probe("streamRetries: 1", 1);
await probe("streamRetries: 2", 2);
console.log("");
