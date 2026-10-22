/**
 * 境界の位置を 1 つずつずらして、実際に観測されたパート列と fallback の有無を出す。
 *
 * テストの緑は観測ではない。ここが記事と `claims.md` に貼る生の結果になる。
 */
import { createAI } from "agents/models/ai-sdk";
import { streamText } from "ai";
import { brokenStream, finishChunk, metaOnly, reasoningChunk, sse, textChunk, toolNameOnly, toolWithArgs, type Chunk } from "./sse";
import { makeBinding } from "./fake-binding";
import { startRecording } from "./evidence";

const P = "@cf/zai-org/glm-4.7-flash";
const F = "@cf/meta/llama-3.1-8b-instruct";

const CASES: { name: string; chunks: Chunk[] }[] = [
  { name: "何も出さずに切断", chunks: [] },
  { name: "response-metadata のみ", chunks: [metaOnly()] },
  { name: "tool-input-start のみ（名前だけ）", chunks: [metaOnly(), toolNameOnly()] },
  { name: "tool-input-delta まで（引数あり）", chunks: [metaOnly(), toolWithArgs()] },
  { name: "reasoning-delta まで", chunks: [metaOnly(), reasoningChunk("th")] },
  { name: "text-delta まで（本文 1 文字）", chunks: [metaOnly(), textChunk("h")] },
];

const file = startRecording("boundary");

console.log(`\n観測: primary が途中で切断したときの fallback 有無`);
console.log(`primary = ${P} / fallback = ${F}`);
console.log(`証跡: ${file}\n`);

const rows: string[][] = [];

for (const c of CASES) {
  const binding = makeBinding(
    {
      [P]: [{ kind: "stream", body: brokenStream(c.chunks) }],
      [F]: [{ kind: "sse", body: sse([metaOnly(), textChunk("FALLBACK"), finishChunk()]) }],
    },
    `boundary:${c.name}`,
  );
  const ai = createAI({ binding: binding as never });
  const res = streamText({ model: ai(P, { fallback: [F] }), prompt: "x", maxRetries: 0 });

  const parts: string[] = [];
  let threw = "";
  try {
    for await (const p of res.fullStream) parts.push(p.type);
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  let text = "";
  try { text = await res.text; } catch { /* 確定後の失敗 */ }

  const fellBack = (binding.calls[F] ?? 0) > 0;
  rows.push([
    c.name,
    fellBack ? "✅ する" : "❌ しない",
    text === "FALLBACK" ? "fallback" : text === "" ? "(なし)" : "primary",
    parts.join(" → ") || "(なし)",
  ]);
}

const w = [34, 10, 10];
const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)));
console.log(`${pad("切断した位置", w[0]!)}${pad("fallback", w[1]!)}${pad("答えた", w[2]!)}観測されたパート列`);
console.log("-".repeat(110));
for (const r of rows) console.log(`${pad(r[0]!, w[0]!)}${pad(r[1]!, w[1]!)}${pad(r[2]!, w[2]!)}${r[3]}`);
console.log("");
