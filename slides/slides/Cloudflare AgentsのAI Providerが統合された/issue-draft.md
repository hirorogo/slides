<!--
投稿済み: https://github.com/cloudflare/agents/issues/2687

cloudflare/agents に出す Issue の下書き。
様式は既存の createAI 系 Issue（#2628 / #2629 / #2631 / #2681）に合わせた。
タイトルは `createAI: <小文字の説明>`、本文は短く、根本原因をファイルパスで示す。
PR は受け付けていないので、修正ブランチはリンクで示すだけにする。

検証の経緯は claims.md、ブランチは sandbox/repos/agents の
fix/lift-stream-body-errors-to-ai-sdk-type。
-->

# createAI: a failed stream resume throws the core `CloudflareAIError`, not the exported one

**Describe the bug**

The docs promise one error type for every failure:

> The provider throws `CloudflareAIError`, which extends the AI SDK's `APICallError`, for Workers AI failures, AI Gateway failures, **failed stream resumes**, and a fallback chain where every model failed.

A failed stream resume doesn't reach it. There are two classes with that name:
`models/core/errors.ts` (`extends Error`, internal) and
`models/ai-sdk/errors.ts` (`extends APICallError`, exported). Resume raises the
first. The `name`, `code` and `status` are all correct, so it reads fine in a
log — only the type is wrong:

- `error instanceof CloudflareAIError` is `false` for the documented import,
  which is the pattern the [Handle errors](https://developers.cloudflare.com/agents/models/ai-sdk/#handle-errors) sample shows.
- It isn't an `APICallError`, so `ai`'s retry loop never reads `isRetryable`.

**To Reproduce**

Fake binding, no account needed. `agents@0.30.0`, `ai@7.0.148`, Node 24.

```ts
import { createAI, CloudflareAIError } from "agents/models/ai-sdk";
import { APICallError } from "@ai-sdk/provider";

const encoder = new TextEncoder();
const chunk = `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" }, index: 0 }] })}\n\n`;

// The run names its run id and then drops; the resume route says the run is gone.
const binding = {
  aiGatewayLogId: "01LOGID",
  async fetch() { return new Response("gone", { status: 404 }); },
  async run() {
    let sent = false;
    return new Response(
      new ReadableStream({
        pull(c) {
          if (sent) return c.error(new TypeError("Network connection lost."));
          sent = true;
          c.enqueue(encoder.encode(chunk));
        }
      }),
      { headers: { "cf-aig-run-id": "run-123", "content-type": "text/event-stream" } }
    );
  }
};

const ai = createAI({ binding: binding as never });
const { stream } = await ai("anthropic/claude-haiku-4.5").doStream({
  prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }]
});

let caught: unknown;
try {
  const reader = stream.getReader();
  for (;;) { const { done } = await reader.read(); if (done) break; }
} catch (error) { caught = error; }

(caught as Error).name;              // "CloudflareAIError"
caught instanceof CloudflareAIError; // false  <- expected true
APICallError.isInstance(caught);     // false  <- expected true
```

A non-2xx from the same model, through the same import, gives `true` for both.

**Expected behavior**

Every failure a caller sees is the exported `CloudflareAIError`, as the docs
state — including the three `resumableBody` exits (buffer gone, replay failed,
out of reconnects).

**Root cause**

`models/core/resume.ts` imports the core error (`import { CloudflareAIError } from "./errors"`)
and raises it from inside the response body, after `run()` has resolved. The lift
in `models/ai-sdk/transport.ts` only wraps the await:

```ts
async run(request) {
  try {
    return await inner.run(request);   // resolves when the response arrives
  } catch (error) {
    throw toAISDKError(error);         // never sees a body-time failure
  }
},
```

So the function whose doc comment reads *"with every failure lifted into the AI
SDK error type"* misses exactly the failures that surface while the caller reads
the stream.

`packages/agents/src/tests/models/core/resume.test.ts` imports
`CloudflareAIError` from `models/core/errors`, so it asserts against the class
that is actually thrown and can't see this. No test goes through the public
export.

**Additional context**

A fix that works: wrap the body the run path returns so an error raised while
the caller reads it goes through `toAISDKError()`. Leaving `models/core`
untouched keeps it framework-neutral for `pi-ai`. One snag — `bindingTransport`
keys a `WeakMap<Response, string>` for `logIdFallback`, so a re-wrapped response
has to map back to the original or `providerMetadata.cloudflare.logId` is lost
whenever the response carries no `cf-aig-log-id` header.

Branch with that change and tests through the public export:
https://github.com/tanahiro2010/agents/tree/fix/lift-stream-body-errors-to-ai-sdk-type

(single commit: https://github.com/tanahiro2010/agents/commit/069a8a19)

Built it and re-ran the repro above: `instanceof` and `APICallError.isInstance`
both become `true`, with `code` and `status` unchanged. I couldn't run the repo
suite — `vitest-pool-workers` fails module resolution on my checkout path, which
has non-ASCII characters and spaces. That looks unrelated.

Adjacent but separate: #2628 is about `isRetryable` getting the wrong *value*
from `normalizeThrownError`; this one is about the error's *type*, so
`isRetryable` is never read at all.

**Version:** `agents@0.30.0`, repo at `9c79ba12`.

---

<!--
別件（docs リポジトリ行き）:
doc は "after five drops in one stream" と書くが、実装は
`options.maxReconnects ?? 5` で、諦めるときのメッセージは
"The stream dropped 6 times; giving up at event 7."。
実測でも resume 試行は 5 回で、ストリームは 5 回のドロップを生き延びて
6 回目で落ちる。doc の表現は 1 つ手前を指している。
`maxReconnects` はオプション表にも無いので変更できない。
-->
