<!-- 出し先: cloudflare/agents の「Blank issue」。
     あちらは Bug report と Blank issue の 2 つしかなく、Blank は本文欄が 1 つだけ。
     cloudflare-docs の ISSUE-r4a / ISSUE-r3 のような欄分割は不要。
     下の本文をそのまま丸ごと貼る。

     タイトル:
     Think docs: the dependency table lists ai as v6, but think requires ai@^7
-->

`docs/think/index.md` lists `ai` as "Vercel AI SDK v6" in the dependency table, but `@cloudflare/think` requires `ai@^7`.

### The table

From [Dependencies](https://github.com/cloudflare/agents/blob/main/docs/think/index.md#dependencies):

| Package | Required | Notes |
| --- | --- | --- |
| `ai` | yes | Vercel AI SDK v6 |

### What the package asks for

`@cloudflare/think@0.21.0`:

```json
"peerDependencies": { "ai": "^7.0.0", ... }
```

Installing `ai@6` to match the table leaves the peer unsatisfied.

### Where it came from

This looks like a leftover rather than a disagreement about naming. [#1922](https://github.com/cloudflare/agents/pull/1922) widened the range to `ai@^6 || ^7`, and [#2388](https://github.com/cloudflare/agents/pull/2388) dropped v6:

> Require `ai@^7` and `@ai-sdk/react@^4`, because Think bundles providers that return AI SDK v7 models. See [Think dependencies](https://github.com/cloudflare/agents/blob/main/docs/think/index.md#dependencies).

That changeset links to this table, and the repository uses "AI SDK v7" for `ai@^7` elsewhere in the same file, so the table row appears to have been missed when v6 support was removed.

### Suggested change

`Vercel AI SDK v6` → `Vercel AI SDK v7` in that one row.

I would open a PR, but `CreatePullRequest` is refused for my account on this repository, so this is the best I can do from here.
