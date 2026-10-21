The prose and the code sample on this changelog page disagree about the class
name, and the prose one does not exist.

Line 12:

> A JavaScript execution environment can be configured by adding the `JavaScriptWorkerBackend`.

The sample a few lines below it:

```ts
import { WorkerJavaScriptBackend } from "@cloudflare/computer/backends/worker-javascript";
```

`@cloudflare/computer@0.6.0` exports `WorkerJavaScriptBackend`. Importing the
name from the prose fails to compile:

```
TS2305: Module '"@cloudflare/computer/backends/worker-javascript"'
        has no exported member 'JavaScriptWorkerBackend'.
```

The declaration, from `dist/backends/worker-javascript/index.d.ts`:

```ts
declare class WorkerJavaScriptBackend implements WorkspaceModuleBackend {
  readonly type = "worker-javascript";
  constructor(options: WorkerJavaScriptBackendOptions);
}
```

This changes the prose to match. Nothing else on the page is touched — the code
sample was already correct, so anyone who copied the snippet is unaffected.

Filed as #34504 with the same detail, in case the wording should go a different
way than this.
