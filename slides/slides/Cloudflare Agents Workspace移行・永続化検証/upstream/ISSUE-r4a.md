<!-- cloudflare-docs の「Request content update」テンプレート用。
     3 つの入力欄に、下の ■ ごとにそのまま貼る。 -->

■ Existing documentation URL(s)
-------------------------------------------------------------------------------
- https://developers.cloudflare.com/changelog/post/2026-10-20-think-computer-workspace/


■ What changes are you suggesting?
-------------------------------------------------------------------------------
This page names the backend class two different ways, and the one in the prose does not exist.

Prose:

> A JavaScript execution environment can be configured by adding the `JavaScriptWorkerBackend`.

Code sample, on the same page:

```ts
import { WorkerJavaScriptBackend } from "@cloudflare/computer/backends/worker-javascript";
```

The real export is `WorkerJavaScriptBackend`. Importing the other name does not compile:

```
TS2305: Module '"@cloudflare/computer/backends/worker-javascript"'
        has no exported member 'JavaScriptWorkerBackend'.
```

Suggested change: `JavaScriptWorkerBackend` → `WorkerJavaScriptBackend` in that one sentence. Nothing else on the page needs to move — the code sample is already right, so anyone who copied the snippet is unaffected, and only someone typing the name out of the sentence hits it.

I have it open as a draft PR, one word: #34500


■ Additional information
-------------------------------------------------------------------------------
The declaration, from `@cloudflare/computer@0.6.0`, `dist/backends/worker-javascript/index.d.ts`:

```ts
declare class WorkerJavaScriptBackend implements WorkspaceModuleBackend {
  readonly type = "worker-javascript";
  constructor(options: WorkerJavaScriptBackendOptions);
}
```

The subpath `./backends/worker-javascript` is in the package's `exports`, so the import path in the sample is correct too. I ran into this while checking the page against the published types.
