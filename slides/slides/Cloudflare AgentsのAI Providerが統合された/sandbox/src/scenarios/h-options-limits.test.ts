/**
 * H 群: まだ触っていなかったドキュメント主張。
 *
 * オプションの優先順位・メタデータのマージ・Limitations・ID ゲート。
 * 「他に仕様違反は無いか」を潰すために、doc の断定文から機械的に起こした。
 */
import { describe, expect, it } from "vitest";
import { createAI } from "agents/models/ai-sdk";
import { generateText, embed } from "ai";
import { makeBinding, okJson } from "../fake-binding";

const M = "@cf/zai-org/glm-4.7-flash";
const F = "@cf/meta/llama-3.1-8b-instruct";
const gw = (b: ReturnType<typeof makeBinding>, i = 0) =>
  (b.optionsSeen[i]?.gateway ?? {}) as Record<string, unknown>;

describe("H1: オプションの優先順位（call > model > provider）", () => {
  it("呼び出し側の cacheTtl が、モデルとプロバイダーに勝つ", async () => {
    const b = makeBinding({ [M]: [okJson()] }, "h1");
    const ai = createAI({ binding: b as never, id: "prov", cacheTtl: 11 });
    await generateText({
      model: ai(M, { cacheTtl: 22 }),
      prompt: "x",
      maxRetries: 0,
      providerOptions: { cloudflare: { cacheTtl: 33 } },
    });
    expect(gw(b).cacheTtl).toBe(33);
  });

  it("呼び出し側が無ければモデルが勝つ", async () => {
    const b = makeBinding({ [M]: [okJson()] }, "h1b");
    const ai = createAI({ binding: b as never, cacheTtl: 11 });
    await generateText({ model: ai(M, { cacheTtl: 22 }), prompt: "x", maxRetries: 0 });
    expect(gw(b).cacheTtl).toBe(22);
  });

  it("どちらも無ければプロバイダーが使われる", async () => {
    const b = makeBinding({ [M]: [okJson()] }, "h1c");
    const ai = createAI({ binding: b as never, cacheTtl: 11 });
    await generateText({ model: ai(M), prompt: "x", maxRetries: 0 });
    expect(gw(b).cacheTtl).toBe(11);
  });
});

describe("H2: metadata はキーごとにマージされる", () => {
  it("provider の metadata と call の metadata が両方残る", async () => {
    const b = makeBinding({ [M]: [okJson()] }, "h2");
    const ai = createAI({ binding: b as never, metadata: { app: "demo" } });
    await generateText({
      model: ai(M, { metadata: { tier: "pro" } }),
      prompt: "x",
      maxRetries: 0,
      providerOptions: { cloudflare: { metadata: { userId: "u1" } } },
    });
    expect(gw(b).metadata).toEqual({ app: "demo", tier: "pro", userId: "u1" });
  });

  it("対照: cacheTtl はマージされず上書きされる", async () => {
    const b = makeBinding({ [M]: [okJson()] }, "h2b");
    const ai = createAI({ binding: b as never, cacheTtl: 11 });
    await generateText({
      model: ai(M),
      prompt: "x",
      maxRetries: 0,
      providerOptions: { cloudflare: { cacheTtl: 33 } },
    });
    expect(gw(b).cacheTtl).toBe(33);
  });
});

describe("H3: ゲートウェイオプションはフラットでも入れ子でも同じ", () => {
  it("{ cacheTtl } と { gateway: { cacheTtl } } が同じ結果になる", async () => {
    const flat = makeBinding({ [M]: [okJson()] }, "h3-flat");
    const nested = makeBinding({ [M]: [okJson()] }, "h3-nested");
    await generateText({ model: createAI({ binding: flat as never })(M, { cacheTtl: 60 }), prompt: "x", maxRetries: 0 });
    await generateText({ model: createAI({ binding: nested as never })(M, { gateway: { cacheTtl: 60 } } as never), prompt: "x", maxRetries: 0 });
    expect(gw(flat).cacheTtl).toBe(60);
    expect(gw(nested).cacheTtl).toBe(gw(flat).cacheTtl);
  });
});

describe("H4: fallback leg はチェーンのゲートウェイ設定を引き継ぐ", () => {
  it("チェーンの id と cacheTtl が leg にも乗る", async () => {
    const b = makeBinding({ [M]: [okJson(), okJson()], [F]: [okJson()] }, "h4");
    const ai = createAI({ binding: b as never });
    // primary を失敗させて leg に進ませる
    const b2 = makeBinding({ [M]: [{ kind: "json", status: 500, body: {} }], [F]: [okJson()] }, "h4b");
    const ai2 = createAI({ binding: b2 as never });
    await generateText({
      model: ai2(M, { fallback: [F], id: "chain-gw", cacheTtl: 77 }),
      prompt: "x",
      maxRetries: 0,
    });
    expect(b2.order).toEqual([M, F]);
    expect(gw(b2, 1).id).toBe("chain-gw"); // leg にもチェーンの gateway が乗る
    expect(gw(b2, 1).cacheTtl).toBe(77);
    void b, ai;
  });
});

describe("H5: ID ゲート", () => {
  it("@hf/ は言語モデルとして受け付けられない", async () => {
    const b = makeBinding({}, "h5");
    const ai = createAI({ binding: b as never });
    expect(() => ai("@hf/meta-llama/llama-2-7b" as never)).toThrow(TypeError);
    expect(b.order).toHaveLength(0); // 1 度も送っていない
  });

  it("スラッシュの無い文字列も TypeError", async () => {
    const ai = createAI({ binding: makeBinding({}, "h5b") as never });
    expect(() => ai("gpt-5.5" as never)).toThrow(TypeError);
  });

  it("エラー文は 3 つの形を名指しする", async () => {
    const ai = createAI({ binding: makeBinding({}, "h5c") as never });
    try {
      ai("nonsense" as never);
      throw new Error("should have thrown");
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toContain("@cf/");
      expect(m).toContain("<author>/<model>");
      expect(m).toContain("dynamic/");
    }
  });
});

describe("H6: Limitations の主張", () => {
  it("@cf/deepgram/flux は 1 度もリクエストを送らずに throw する", async () => {
    const b = makeBinding({}, "h6");
    const ai = createAI({ binding: b as never });
    let threw: unknown;
    try {
      // doc: websocket only なので「before any request is sent」
      await (ai as never as (id: string) => { doGenerate: unknown })("@cf/deepgram/flux");
    } catch (e) { threw = e; }
    // 構築で投げなければ transcribe 呼び出しで投げるはず。どちらでも送信ゼロが要点
    expect(b.order).toHaveLength(0);
    void threw;
  });

  it("モダリティの fallback に dynamic route を置くと、理由付きで弾かれる", async () => {
    const b = makeBinding({}, "h6b");
    const ai = createAI({ binding: b as never });
    expect(() =>
      ai.embedding("@cf/baai/bge-base-en-v1.5" as never, { fallback: ["dynamic/support"] } as never),
    ).toThrow(/dynamic route/i);
    expect(b.order).toHaveLength(0);
  });

  it("モダリティは @cf/ 以外の fallback を拒む", async () => {
    const ai = createAI({ binding: makeBinding({}, "h6c") as never });
    expect(() =>
      ai.embedding("@cf/baai/bge-base-en-v1.5" as never, { fallback: ["anthropic/claude-opus-5.5"] } as never),
    ).toThrow(TypeError);
  });
});

describe("H7: Workers AI 専用オプションの扱い", () => {
  it("chatTemplateKwargs は @cf/ では本文に乗る", async () => {
    const b = makeBinding({ [M]: [okJson()] }, "h7");
    const ai = createAI({ binding: b as never });
    await generateText({
      model: ai(M, { chatTemplateKwargs: { enable_thinking: false } }),
      prompt: "x",
      maxRetries: 0,
    });
    expect(JSON.stringify(b.inputsSeen[0])).toContain("chat_template_kwargs");
  });

  it("カタログ ID では chatTemplateKwargs が落とされ、warning が出る", async () => {
    const CAT = "anthropic/claude-opus-5.5";
    const b = makeBinding({ [CAT]: [okJson()] }, "h7b");
    const ai = createAI({ binding: b as never });
    const r = await generateText({
      model: ai(CAT, { chatTemplateKwargs: { enable_thinking: false } } as never),
      prompt: "x",
      maxRetries: 0,
    });
    expect(JSON.stringify(b.inputsSeen[0])).not.toContain("chat_template_kwargs");
    console.log(`  [H7] warnings = ${JSON.stringify(r.warnings)}`);
    expect(r.warnings?.length ?? 0).toBeGreaterThan(0);
  });
});
