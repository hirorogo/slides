/**
 * R 群: ストリームの resume。doc の断定文を割った。
 *
 *   > If the connection drops mid-stream, the provider reconnects through the
 *   > binding and replays the run from the last complete event. Your stream
 *   > continues with nothing lost or repeated.
 *   > The provider gives up and throws a CloudflareAIError after five drops in
 *   > one stream, or once the gateway no longer holds the run.
 *   > Aborting the call never resumes it.
 *
 * 軸（ストリームがどこまで守られるか）の延長線にあるので、ここも潰す。
 */
import { describe, expect, it } from "vitest";
import { createAI, CloudflareAIError } from "agents/models/ai-sdk";
import { APICallError } from "@ai-sdk/provider";
import { streamText } from "ai";
import { finishChunk, metaOnly, sse, textChunk } from "../sse";
import { makeBinding } from "../fake-binding";

const CAT = "anthropic/claude-opus-5.5"; // run 経路。run id が付くのはカタログ/dynamic
const RUN_ID = "run_test_0001";

const enc = new TextEncoder();

/** 指定のイベントを流したあと、[DONE] を出さずに本文を切る。 */
function dropAfter(chunks: ReturnType<typeof metaOnly>[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i < chunks.length) { c.enqueue(enc.encode(`data: ${JSON.stringify(chunks[i++])}\n\n`)); return; }
      c.error(new Error("connection dropped"));
    },
  });
}

const withRunId = (body: ReadableStream<Uint8Array>) => ({
  kind: "stream" as const,
  body,
  headers: { "cf-aig-run-id": RUN_ID },
});

const drain = async (res: ReturnType<typeof streamText>) => {
  const deltas: string[] = [];
  let threw: unknown;
  try {
    for await (const p of res.fullStream) {
      if (p.type === "text-delta") deltas.push((p as { text: string }).text);
      if (p.type === "error") threw = (p as { error: unknown }).error;
    }
  } catch (e) { threw = e; }
  return { text: deltas.join(""), threw };
};

describe("R1: 切れたストリームは最後の完全イベントから再開する", () => {
  it("取りこぼしも重複もなく続く", async () => {
    const b = makeBinding(
      { [CAT]: [withRunId(dropAfter([metaOnly(), textChunk("AAA")]))] },
      "r1",
    );
    // resume は残り（BBB と finish）を返す
    b.onResume = () => new Response(sse([textChunk("BBB"), finishChunk()]), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const ai = createAI({ binding: b as never });
    const out = await drain(streamText({ model: ai(CAT), prompt: "x", maxRetries: 0 }));

    expect(b.resumeFroms.length).toBe(1);
    expect(out.text).toBe("AAABBB"); // AAA が重複していない
    console.log(`  [R1] resume from=${b.resumeFroms.join(",")} / text=${JSON.stringify(out.text)}`);
  });

  it("resume は切れた位置のイベント数を from= で渡す", async () => {
    const b = makeBinding(
      { [CAT]: [withRunId(dropAfter([metaOnly(), textChunk("A"), textChunk("B")]))] },
      "r1b",
    );
    b.onResume = () => new Response(sse([finishChunk()]), {
      status: 200, headers: { "content-type": "text/event-stream" },
    });
    const ai = createAI({ binding: b as never });
    await drain(streamText({ model: ai(CAT), prompt: "x", maxRetries: 0 }));
    console.log(`  [R1b] from = ${b.resumeFroms.join(",")}（流したイベントは 3）`);
    expect(b.resumeFroms[0]).toBeGreaterThan(0);
  });
});

describe("R2: 5 回ドロップで諦める", () => {
  it("resume が毎回また切れると、6 回目は投げずにエラーになる", async () => {
    const b = makeBinding(
      { [CAT]: [withRunId(dropAfter([metaOnly(), textChunk("A")]))] },
      "r2",
    );
    // resume も毎回切れる本文を返す
    b.onResume = () =>
      new Response(dropAfter([textChunk("x")]), {
        status: 200, headers: { "content-type": "text/event-stream" },
      });
    const ai = createAI({ binding: b as never });
    const out = await drain(streamText({ model: ai(CAT), prompt: "x", maxRetries: 0 }));

    console.log(`  [R2] resume 回数 = ${b.resumeFroms.length} / message = ${(out.threw as Error)?.message}`);
    expect(b.resumeFroms.length).toBe(5); // resume の試行は 5 回
    // doc は「five drops」と書くが、実装のメッセージは 6 回目のドロップで諦めると言う
    expect((out.threw as Error).message).toMatch(/dropped 6 times/);
    // ↓ R6 の仕様違反。公開 CloudflareAIError ではない
    expect(out.threw).not.toBeInstanceOf(CloudflareAIError);
  });
});

describe("R3: バッファが消えていたら諦める", () => {
  it("resume が 404 ならエラーになる", async () => {
    const b = makeBinding(
      { [CAT]: [withRunId(dropAfter([metaOnly(), textChunk("A")]))] },
      "r3",
    );
    b.onResume = () => new Response("gone", { status: 404 });
    const ai = createAI({ binding: b as never });
    const out = await drain(streamText({ model: ai(CAT), prompt: "x", maxRetries: 0 }));

    expect(b.resumeFroms.length).toBe(1); // 1 回試して諦める
    expect((out.threw as Error).name).toBe("CloudflareAIError");
    expect(out.threw).not.toBeInstanceOf(CloudflareAIError); // ↓ R6
    console.log(`  [R3] 404 → ${(out.threw as Error)?.message?.slice(0, 80)}`);
  });
});

describe("R4: run id が無ければ resume しない", () => {
  it("Workers AI のストリーム（run id 無し）は再接続を試みない", async () => {
    const WAI = "@cf/zai-org/glm-4.7-flash";
    const b = makeBinding(
      { [WAI]: [{ kind: "stream", body: dropAfter([metaOnly(), textChunk("A")]) }] },
      "r4",
    );
    b.onResume = () => new Response(sse([finishChunk()]), {
      status: 200, headers: { "content-type": "text/event-stream" },
    });
    const ai = createAI({ binding: b as never });
    await drain(streamText({ model: ai(WAI), prompt: "x", maxRetries: 0 }));

    expect(b.resumeFroms).toHaveLength(0); // 1 度も resume していない
  });
});

describe("R5: resume と fallback の関係", () => {
  it("出力後に切れた場合、fallback ではなく resume が使われる", async () => {
    const F = "@cf/meta/llama-3.1-8b-instruct";
    const b = makeBinding(
      {
        [CAT]: [withRunId(dropAfter([metaOnly(), textChunk("PRIMARY")]))],
        [F]: [{ kind: "sse", body: sse([metaOnly(), textChunk("FALLBACK"), finishChunk()]) }],
      },
      "r5",
    );
    b.onResume = () => new Response(sse([textChunk("-RESUMED"), finishChunk()]), {
      status: 200, headers: { "content-type": "text/event-stream" },
    });
    const ai = createAI({ binding: b as never });
    const out = await drain(streamText({ model: ai(CAT, { fallback: [F] }), prompt: "x", maxRetries: 0 }));

    console.log(`  [R5] text=${JSON.stringify(out.text)} / fallback 呼び出し=${b.calls[F] ?? 0} / resume=${b.resumeFroms.length}`);
    expect(b.calls[F] ?? 0).toBe(0); // fallback は使われない
    expect(out.text).toBe("PRIMARY-RESUMED");
  });
});

describe("R6: resume 失敗のエラーが、公開 CloudflareAIError ではない", () => {
  /**
   * doc の断定文:
   *   > The provider throws `CloudflareAIError`, which extends the AI SDK's
   *   > `APICallError`, for Workers AI failures, AI Gateway failures,
   *   > **failed stream resumes**, and a fallback chain where every model failed.
   *
   * 実際には resume の失敗だけ、`models/core/errors.ts` の
   * `CloudflareAIError`（`extends Error`）が投げられる。
   * 公開 export（`extends APICallError`）とは別のクラスなので、
   * doc のサンプルどおりに書いた `instanceof` が通らない。
   */
  const setup = () => {
    const b = makeBinding(
      { [CAT]: [withRunId(dropAfter([metaOnly(), textChunk("A")]))] },
      "r6",
    );
    b.onResume = () => new Response("gone", { status: 404 });
    return b;
  };

  it("通常の失敗は公開クラスで、APICallError でもある（対照）", async () => {
    const b = makeBinding({ [CAT]: [{ kind: "json", status: 500, body: { error: { message: "boom" } } }] }, "r6-ctrl");
    const ai = createAI({ binding: b as never });
    const err = await streamText({ model: ai(CAT), prompt: "x", maxRetries: 0 })
      .consumeStream().then(() => null).catch((e) => e)
      ?? await (async () => {
        const res = streamText({ model: ai(CAT), prompt: "x", maxRetries: 0 });
        try { for await (const _ of res.fullStream) { /* drain */ } } catch (e) { return e; }
        return null;
      })();
    if (err !== null) {
      expect(err).toBeInstanceOf(CloudflareAIError);
      expect(APICallError.isInstance(err)).toBe(true);
    }
  });

  it("resume の失敗は名前だけ CloudflareAIError で、型が違う", async () => {
    const b = setup();
    const ai = createAI({ binding: b as never });
    const out = await drain(streamText({ model: ai(CAT), prompt: "x", maxRetries: 0 }));
    const e = out.threw as Error;

    expect(e.name).toBe("CloudflareAIError");       // 名前は同じ
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(CloudflareAIError); // 公開クラスではない
    expect(APICallError.isInstance(e)).toBe(false);  // APICallError でもない
  });

  it("結果として doc のサンプルどおりの分岐が素通りする", async () => {
    const b = setup();
    const ai = createAI({ binding: b as never });
    const out = await drain(streamText({ model: ai(CAT), prompt: "x", maxRetries: 0 }));

    let handled = false;
    // doc のエラーハンドリング例そのまま
    if (out.threw instanceof CloudflareAIError) handled = true;
    expect(handled).toBe(false); // ← 拾えない
  });
});
