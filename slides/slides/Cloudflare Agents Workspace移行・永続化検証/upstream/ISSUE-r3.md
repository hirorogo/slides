A SQLite-backed Durable Object accepts values about four times larger than the limits page says. The page gives 2 MB for a SQL string, `BLOB` or table row, and 2 MB for a KV key and value combined. All three accept just over 8 MiB.

### What I measured

A deployed Durable Object, `wrangler 4.151.3`, `compatibility_date: "2026-10-20"`, writing through `ctx.storage.sql` and `ctx.storage.kv` directly — no library in between. Fresh Durable Object per probe.

| Bytes | `TEXT` | `BLOB` | `kv.put` value |
| ---: | --- | --- | --- |
| 2,097,152 (2 MiB) | ok | ok | ok |
| 4,194,304 | ok | ok | ok |
| 8,388,608 (8 MiB) | ok | ok | ok |
| 8,388,627 | **ok** | **ok** | — |
| 8,388,628 | `SQLITE_TOOBIG` | `SQLITE_TOOBIG` | `SQLITE_TOOBIG` |
| 12,582,912 | `SQLITE_TOOBIG` | `SQLITE_TOOBIG` | `SQLITE_TOOBIG` |

Bisected to the byte between 8,388,609 and 12,582,912. The error is `string or blob too big: SQLITE_TOOBIG`.

8 MiB is 8,388,608, so the accepted maximum sits 19 bytes above it. The probe row was `(k TEXT PRIMARY KEY, t TEXT)` with an eight-character key, which is consistent with the cap applying to the row rather than to the value on its own — but I did not pin that down, and the three rows on the page are worded per-value.

### Why this matters

2 MB and 8 MiB land on opposite sides of some ordinary designs. A workspace that base64-encodes a file into one cell inflates it by 4/3, so the documented limit puts the ceiling at a 1.5 MB file and the measured one puts it near 6 MB. I went looking for this because I predicted a 4 MB file would be rejected, it was not, and the prediction came straight from this page.

### What I am not sure about

Whether 2 MB is the **supported** limit and 8 MiB is merely what is enforced today. If that is the case the fix is the opposite of what I am proposing — the page would want to say that values above 2 MB are not guaranteed, rather than raise the number. You would know; I only know what the runtime did on 2026-10-21.

I also did not test whether the cap is per-value or per-row, or whether it differs between the SQL and KV paths (the KV probe failed at 8,388,624 while `TEXT` and `BLOB` passed, which hints the accounting is not identical, but I did not bisect that one separately).

### A branch, if it is useful

I changed the three rows to 8 MiB, on the assumption that the page is meant to describe what the runtime does:

https://github.com/cloudflare/cloudflare-docs/compare/production...tanahiro2010:cloudflare-docs:fix/durable-objects-value-size-limit

I have deliberately not opened it as a PR, because the number to put there depends on the answer above. If 8 MiB is right, take it. If the wording should change instead, tell me what it should say and I will redo it.
