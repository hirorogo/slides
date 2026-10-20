# Issue ドラフト（cloudflare/mcp 宛・そのまま貼れる形）

**Title:** `A list filtered down to nothing by permissions never raises a scope challenge`

---

Cloudflare filters list endpoints by the credential's permissions rather than refusing them. A connection that holds none of the scopes an endpoint accepts gets `200` and an empty `result`, so nothing is refused, no challenge is raised, and the agent reports that the account is empty.

### What I measured

Against `mcp.cloudflare.com` with a connection holding only `user:read account:read`, then the same calls after granting the scope. Same account, same client, only the grant changed.

| Call | Without the scope | After granting it |
| --- | ---: | ---: |
| `GET /zones` | `200`, **0 results** | `200`, **3 results** |
| `GET /accounts/{id}/workers/scripts` | `200`, **0 results** | `200`, **12 results** |
| `GET /accounts/{id}/d1/database` | `403` + challenge | `200`, 5 results |

The third row is the behaviour I expected everywhere: `403`, `WWW-Authenticate: … scope="… d1.read"`, and the client can step up. The first two are silent.

One more, for contrast: `GET /accounts/{id}/members` returns rows **without** `memberships.read`, so "holds no accepted scope" alone does not mean the result was filtered.

### Why it can't fire today

`explainRefusal()` and `scopeToRequest()` both start from the status:

```ts
function isRefusal(status: number): boolean {
  return status === 401 || status === 403
}
```

`explainRefusedRequest()` returns early for anything else, so a filtered `200` reaches neither. That looks deliberate — the catalog lookup is documented as being for refused requests only — so I may well be missing a reason to leave it as is.

### Why it matters for agents

A human reading an empty list guesses their token is narrow. An agent reports "you have no zones" and stops. The user is never asked for the scope that would have shown them, which is the one thing step-up authorization is there to do.

### What I'd propose

`scopeToRequest()` already answers "this connection holds none of the scopes this endpoint accepts" — only the status gate keeps that answer from a successful read. Split that out and reuse it: set a header on a successful read whose endpoint accepts no scope the connection holds, and have the sandbox turn it into a `messages` entry when `result` is an empty array.

Three conditions keep it off working calls — a `200` is never turned into an error, and a genuinely empty account is not told to reconnect:

- OAuth connections only; a direct credential's permissions aren't known here
- `GET`/`HEAD` only; a write Cloudflare accepted was not filtered
- an empty array only; `GET /accounts/{id}/members` must not be flagged

The catalog is read only once the first two hold, so unaffected requests don't pay for the lookup.

I deliberately kept this to a message rather than a challenge, since turning a `200` into a `403` would break calls that work today. If you'd rather it raise a real challenge for clients in `scopeChallenge: 'tool'` mode, that seems like a natural follow-up.

### Happy to send it as a PR

I have this implemented against `main` — 5 files, +173/−15, with unit tests for the split-out helper and three end-to-end tests (flagged / holds the scope / list has results). `npm run check` passes: 562 tests.

Branch: https://github.com/tanahiro2010/cloudflare-mcp/tree/fix/empty-list-unheld-scope

Would a PR be welcome, or would you rather handle this differently? I'm happy to adjust the shape before opening one.
