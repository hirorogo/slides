<!-- 出し先: cloudflare/agents の「Bug report」。
     既存の createAI 系 Issue（#2628 / #2629 / #2631 / #2681）に合わせて、
     タイトルは `createAI: <小文字の説明>`、本文は短く、根本原因をファイルパスで示す。
     PR は受け付けていないので修正提案は文章のみ。

     タイトル:
     createAI: the ai peer range allows ai@6, which the provider cannot work with

     関連: #2647（think docs が ai を v6 と書いていた件）と同じ v6/v7 の取り違え。
           あちらは docs の誤り、こちらは package.json の誤り。
     R6 の Issue は #2687。
-->

**Describe the bug**

`packages/agents/package.json` declares:

```json
"peerDependencies": { "ai": "^6.0.0 || ^7.0.0", "@ai-sdk/provider": "^4.0.0" }
```

`ai@6` satisfies that range but cannot drive the provider. `createAI` builds a
`LanguageModelV4`, and `ai@6` does not accept one, so every call throws. The
install is clean — no peer warning — and the failure only appears at the first
`generateText`.

The [AI SDK page](https://developers.cloudflare.com/agents/models/ai-sdk/)
already says the right thing ("The provider needs `ai@^7` and
`@ai-sdk/provider@^4`"); it is the range that is wrong.

**To Reproduce**

```sh
npm i agents@0.30.0 ai@6.0.312 @ai-sdk/provider@4.0.31   # no peer warning
```

```ts
import { createAI } from "agents/models/ai-sdk";
import { generateText } from "ai";

const binding = {
  aiGatewayLogId: null,
  async fetch() { return new Response("x", { status: 501 }); },
  async run() {
    return new Response(
      JSON.stringify({
        id: "c1", object: "chat.completion", created: 1, model: "@cf/test",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }),
      { headers: { "content-type": "application/json" } }
    );
  }
};

const ai = createAI({ binding: binding as never });
await generateText({ model: ai("@cf/zai-org/glm-4.7-flash"), prompt: "hi", maxRetries: 0 });
```

```
UnsupportedModelVersionError [AI_UnsupportedModelVersionError]: Unsupported
model version v4 for provider "cloudflare" and model
"@cf/zai-org/glm-4.7-flash". AI SDK 5 only supports models that implement
specification version "v2".
```

The binding is a stub, so no account is involved: the throw happens before any
request is sent.

Pinning `@ai-sdk/provider@3.0.19` instead makes no difference. `ai` does not
take `@ai-sdk/provider` as a peer — `ai@6.0.312` depends on `@ai-sdk/provider@3.0.19`
directly — so whichever version sits at the top level, `ai@6` reads models
through its own copy and rejects a v4 one.

**Expected behavior**

Either the range matches what works (`"ai": "^7.0.0"`), or `ai@6` is actually
supported and the v4 model is only built when the installed `ai` can read it.

**Root cause**

`packages/agents/package.json`. The provider is a `ProviderV4` built against
`@ai-sdk/provider@^4` (`LanguageModelV4` in
`packages/agents/src/models/ai-sdk/models/language.ts`), while `ai@6` pins
`@ai-sdk/provider@3` as a direct dependency. The two halves of the range are not
interchangeable, and the `@ai-sdk/provider` peer cannot bridge them, so
`^6.0.0 || ^7.0.0` admits a combination that cannot work.

`@cloudflare/think` already pins `"ai": "^7.0.0"`, which is the shape this
needs.

**Additional context**

Same v6/v7 mix-up as #2647, from the other side: there the docs were behind the
package, here the package range is wider than the code.

**Version:** `agents@0.30.0`, `ai@6.0.312`, `@ai-sdk/provider@4.0.31`, Node 24.
