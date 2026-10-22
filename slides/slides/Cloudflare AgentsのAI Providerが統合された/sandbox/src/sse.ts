/**
 * chat-completions の SSE を 1 チャンクずつ組み立てる。
 *
 * createAI は Workers AI / カタログ ID / dynamic route を全部この形で読む
 * （`wires/chat-completions.ts`）。ここを握れば、AI SDK に届くパート列を
 * 正確に作れる。
 */

export type Chunk = Record<string, unknown>;

const BASE = {
  id: "chatcmpl-test",
  object: "chat.completion.chunk",
  created: 1_760_000_000,
  model: "@cf/test/fake",
};

/** id と model だけを載せたチャンク。`response-metadata` だけが出る。 */
export const metaOnly = (): Chunk => ({ ...BASE, choices: [{ index: 0, delta: {} }] });

/** 本文を載せたチャンク。`text-start` と `text-delta` が続けて出る。 */
export const textChunk = (content: string): Chunk => ({
  ...BASE,
  choices: [{ index: 0, delta: { content } }],
});

/** reasoning を載せたチャンク。`reasoning-start` と `reasoning-delta` が対で出る。 */
export const reasoningChunk = (content: string): Chunk => ({
  ...BASE,
  choices: [{ index: 0, delta: { reasoning_content: content } }],
});

/**
 * 名前だけのツール呼び出し。引数が空なので `tool-input-start` **だけ**が出る。
 * ここが preamble に単独で到達できる唯一の「出力らしい」パートになる。
 */
export const toolNameOnly = (name = "get_weather"): Chunk => ({
  ...BASE,
  choices: [
    {
      index: 0,
      delta: {
        tool_calls: [{ index: 0, id: "call_1", function: { name, arguments: "" } }],
      },
    },
  ],
});

/** 引数まで載せたツール呼び出し。`tool-input-delta` が出て leg が確定する。 */
export const toolWithArgs = (name = "get_weather", args = '{"city":'): Chunk => ({
  ...BASE,
  choices: [
    {
      index: 0,
      delta: {
        tool_calls: [{ index: 0, id: "call_1", function: { name, arguments: args } }],
      },
    },
  ],
});

export const finishChunk = (reason = "stop"): Chunk => ({
  ...BASE,
  choices: [{ index: 0, delta: {}, finish_reason: reason }],
});

/** SSE 本文を組み立てる。`broken` を立てると [DONE] の前で本文を壊す。 */
export function sse(chunks: Chunk[], opts: { done?: boolean } = {}): string {
  const lines = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`);
  if (opts.done !== false) lines.push("data: [DONE]\n\n");
  return lines.join("");
}

/** 途中で reject するストリーム本文。出力前にネットワークが切れた状況を作る。 */
export function brokenStream(chunks: Chunk[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(chunks[i++])}\n\n`));
        return;
      }
      controller.error(new Error("upstream connection reset"));
    },
  });
}

/**
 * 200 の SSE の中に載るアップストリーム失敗。
 * wire はこれを `error` パートに変換する（`wires/chat-completions.ts`）。
 * ストリームが「始まってから」失敗する状況は、これで作るのが本物に近い。
 */
export const errorChunk = (message = "rate limited mid-generation"): Chunk => ({
  ...BASE,
  error: { message, type: "upstream_error", code: "rate_limit_exceeded" },
});

/**
 * チャンクごとに遅延を入れて流すストリーム。
 * 「プリアンブルは早く来るが本文は遅い」状況を作り、
 * fallback 設定の有無で利用者への到達時刻が変わるかを測る。
 */
export function pacedStream(steps: { chunk: Chunk; delayMs: number }[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= steps.length) {
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }
      const s = steps[i++]!;
      if (s.delayMs > 0) await new Promise((r) => setTimeout(r, s.delayMs));
      controller.enqueue(enc.encode(`data: ${JSON.stringify(s.chunk)}\n\n`));
    },
  });
}
