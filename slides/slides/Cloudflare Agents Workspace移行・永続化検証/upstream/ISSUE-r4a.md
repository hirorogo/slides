The [Think computer workspace changelog](https://developers.cloudflare.com/changelog/post/2026-10-20-think-computer-workspace/) names the backend class two different ways, and the one in the prose does not exist.

### The two names

Prose:

> A JavaScript execution environment can be configured by adding the `JavaScriptWorkerBackend`.

Code sample, on the same page:

```ts
import { WorkerJavaScriptBackend } from "@cloudflare/computer/backends/worker-javascript";
```

### Which one is real

`WorkerJavaScriptBackend`. From `@cloudflare/computer@0.6.0`, `dist/backends/worker-javascript/index.d.ts`:

```ts
declare class WorkerJavaScriptBackend implements WorkspaceModuleBackend {
  readonly type = "worker-javascript";
  constructor(options: WorkerJavaScriptBackendOptions);
}
```

Importing the other name does not compile:

```
TS2305: Module '"@cloudflare/computer/backends/worker-javascript"'
        has no exported member 'JavaScriptWorkerBackend'.
```

### Impact

Small. The code sample is correct, so copying the snippet works; only someone typing the name from the sentence hits it. I ran into it while checking the page against the published types and thought it was worth a line.

### PR

Draft, one word: #34500
