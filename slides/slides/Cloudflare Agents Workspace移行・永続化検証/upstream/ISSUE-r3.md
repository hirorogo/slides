<!-- cloudflare-docs の「Request content update」テンプレート用。
     3 つの入力欄に、下の ■ ごとにそのまま貼る。 -->

■ Existing documentation URL(s)
-------------------------------------------------------------------------------
- https://developers.cloudflare.com/durable-objects/platform/limits/


■ What changes are you suggesting?
-------------------------------------------------------------------------------
A SQLite-backed Durable Object accepts values about four times larger than this page says. Three rows give 2 MB:

| Row | Current value |
| --- | --- |
| Key size | Key and value combined cannot exceed 2 MB |
| Value size | Key and value combined cannot exceed 2 MB |
| Maximum string, `BLOB` or table row size | 2 MB |

All three accept just over 8 MiB.

**What I measured.** A deployed Durable Object, `wrangler 4.151.3`, `compatibility_date: "2026-10-20"`, writing through `ctx.storage.sql` and `ctx.storage.kv` directly — no library in between. A fresh Durable Object per probe.

| Bytes | `TEXT` | `BLOB` | `kv.put` value |
| ---: | --- | --- | --- |
| 2,097,152 (2 MiB) | ok | ok | ok |
| 4,194,304 | ok | ok | ok |
| 8,388,608 (8 MiB) | ok | ok | ok |
| 8,388,627 | **ok** | **ok** | — |
| 8,388,628 | `SQLITE_TOOBIG` | `SQLITE_TOOBIG` | `SQLITE_TOOBIG` |
| 12,582,912 | `SQLITE_TOOBIG` | `SQLITE_TOOBIG` | `SQLITE_TOOBIG` |

Bisected to the byte between 8,388,609 and 12,582,912. The error is `string or blob too big: SQLITE_TOOBIG`.

**Why it matters.** 2 MB and 8 MiB land on opposite sides of some ordinary designs. Anything that base64-encodes a file into one cell inflates it by 4/3, so the documented limit puts the ceiling at a 1.5 MB file and the measured one puts it near 6 MB. I went looking for this because I predicted a 4 MB file would be rejected, it was not, and the prediction came straight from this page.

**What I am not sure about, and it changes the fix.** Whether 2 MB is the *supported* limit and 8 MiB is merely what is enforced today. If so, the page would want to say that values above 2 MB are not guaranteed, rather than raise the number. You would know; I only know what the runtime did on 2026-10-21.

If raising the number is right, I have the three rows changed to 8 MiB on a branch. I have deliberately not opened it as a PR, because which number belongs there depends on the answer above:

https://github.com/cloudflare/cloudflare-docs/compare/production...tanahiro2010:cloudflare-docs:fix/durable-objects-value-size-limit

Take it if it is useful. If the wording should change instead, tell me what it should say and I will redo it.


■ Additional information
-------------------------------------------------------------------------------
8 MiB is 8,388,608, so the accepted maximum sits 19 bytes above it. The probe row was `(k TEXT PRIMARY KEY, t TEXT)` with an eight-character key, which is consistent with the cap applying to the row rather than to the value on its own — but I did not pin that down, and the three rows on the page are worded per-value.

The KV probe failed at 8,388,624 while `TEXT` and `BLOB` passed at that size, which hints the accounting is not identical between the two paths. I did not bisect the KV boundary separately.
