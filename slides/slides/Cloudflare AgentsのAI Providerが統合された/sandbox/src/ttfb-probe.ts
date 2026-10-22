/**
 * F1 / F2: fallback 設定がストリームの立ち上がりに与える影響を測る。
 *
 * 仕掛け: プリアンブルは即座に、本文は 300ms 遅れて流す。
 *   - fallback 無し → 実装は覗き見をしないので、プリアンブルがすぐ届くはず
 *   - fallback 有り → 最初の非プリアンブルパートが出るまで待つはず
 *
 * 対照: 同じモック・同じ遅延・同じプロンプトで、fallback の有無だけを変える。
 */
import { createAI } from "agents/models/ai-sdk";
import { streamText } from "ai";
import { finishChunk, metaOnly, pacedStream, textChunk } from "./sse";
import { makeBinding } from "./fake-binding";
import { startRecording } from "./evidence";

const P = "@cf/zai-org/glm-4.7-flash";
const F = "@cf/meta/llama-3.1-8b-instruct";
const BODY_DELAY_MS = 300;
const ROUNDS = 7;

const paced = () => ({
  kind: "stream" as const,
  body: pacedStream([
    { chunk: metaOnly(), delayMs: 0 },
    { chunk: textChunk("hello"), delayMs: BODY_DELAY_MS },
    { chunk: finishChunk(), delayMs: 0 },
  ]),
});

async function once(withFallback: boolean) {
  const binding = makeBinding(
    { [P]: [paced()], [F]: [paced()] },
    `ttfb:${withFallback ? "fallback" : "none"}`,
  );
  const ai = createAI({ binding: binding as never });
  const model = withFallback ? ai(P, { fallback: [F] }) : ai(P);

  const t0 = Date.now();
  const res = streamText({ model, prompt: "x", maxRetries: 0 });
  // `start` と `start-step` は AI SDK 自身が即座に出すので、プロバイダー由来の
  // 最初のパートで測る。ここを分けないと fallback の覗き見が見えない。
  const SDK_OWN = new Set(["start", "start-step"]);
  let sdkFirstMs = -1;
  let providerFirstMs = -1;
  let providerFirstType = "";
  for await (const p of res.fullStream) {
    const dt = Date.now() - t0;
    if (sdkFirstMs < 0) sdkFirstMs = dt;
    if (providerFirstMs < 0 && !SDK_OWN.has(p.type)) {
      providerFirstMs = dt;
      providerFirstType = p.type;
    }
  }
  return { sdkFirstMs, providerFirstMs, providerFirstType, totalMs: Date.now() - t0 };
}

const stat = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { min: s[0]!, median: s[Math.floor(s.length / 2)]!, max: s[s.length - 1]! };
};

const file = startRecording("ttfb");
console.log(`\nF1: fallback 設定で、成功ストリームの立ち上がりが変わるか`);
console.log(`仕掛け: プリアンブルは即時、本文は ${BODY_DELAY_MS}ms 遅延。${ROUNDS} 回ずつ。`);
console.log(`証跡: ${file}\n`);

for (const withFallback of [false, true]) {
  const sdkFirst: number[] = [];
  const provFirst: number[] = [];
  const total: number[] = [];
  let kind = "";
  for (let i = 0; i < ROUNDS; i += 1) {
    const r = await once(withFallback);
    sdkFirst.push(r.sdkFirstMs);
    provFirst.push(r.providerFirstMs);
    total.push(r.totalMs);
    kind = r.providerFirstType;
  }
  const a = stat(sdkFirst);
  const b = stat(provFirst);
  const t = stat(total);
  console.log(
    `fallback ${withFallback ? "あり" : "なし"}\n` +
      `   SDK の start まで        : median ${a.median}ms (min ${a.min} / max ${a.max})\n` +
      `   プロバイダー最初のパート : median ${b.median}ms (min ${b.min} / max ${b.max})  [${kind}]\n` +
      `   完了まで                 : median ${t.median}ms`,
  );
}
console.log("");
