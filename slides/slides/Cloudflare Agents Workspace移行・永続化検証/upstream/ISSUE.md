**Title:** `docs/shell/migrating-to-computer.md`: the copy script loses symlinks with
root-escaping absolute targets, and cannot be re-run

The copy script in [Migrating from `@cloudflare/shell` to `@cloudflare/computer`](https://github.com/cloudflare/agents/blob/main/docs/shell/migrating-to-computer.md)
has two problems. Both only affect workspaces that contain symlinks. I verified
both on a deployed Durable Object with `@cloudflare/shell@0.4.3` and
`@cloudflare/computer@0.6.0`.

## 1. `resolveTarget` does not normalise absolute targets

```ts
if (target.startsWith("/")) return target;
```

Shell normalises every target, absolute or not
([`packages/shell/src/filesystem.ts`](https://github.com/cloudflare/agents/blob/main/packages/shell/src/filesystem.ts), `resolveSymlink`):

```js
const resolved = target.startsWith("/")
  ? normalizePath(target)
  : normalizePath(getParent(path) + "/" + target);
```

`normalizePath` clamps `..` at `/`. The script does not, so a `..` that climbs
above the root survives into the new path and then escapes `root`.

Measured on a deployed Durable Object, `root = "/workspace"`:

| link | Shell target | migrated target | readable |
| --- | --- | --- | --- |
| `/links/rel.md` | `../notes.md` | `/workspace/notes.md` | yes |
| `/links/abs.md` | `/notes.md` | `/workspace/notes.md` | yes |
| `/links/dotdot.md` | `/src/../notes.md` | `/workspace/src/../notes.md` | yes |
| `/links/esc.md` | `/../notes.md` | `/workspace/../notes.md` | **no — ENOENT** |

Relative targets, and absolute targets whose `..` stays inside the root, are
all fine. Only the root-escaping case breaks.

It fails quietly. `symlink()` stores the target without validating it, and path
resolution clamps `..` at the root rather than throwing, so the copy reports
success and the link simply points outside the migrated tree. A post-migration
check that compares paths, types and content hashes does not catch it: the link
exists, it just does not resolve.

## 2. The copy cannot be re-run

`mkdir({ recursive: true })` and `writeFile` are idempotent, but `symlink`
always throws `EEXIST` when the path exists and has no `force` option:

```
1st run: ok
2nd run: EEXIST path exists: /workspace/links/abs.md
```

The page recommends running the copy from `onStart` and recording a flag
afterwards. If the copy throws, the flag is never written, so every start
retries and fails at the same link.

## Suggested fix

Two changes, both inside the snippet. Making the branch uniform fixes the first
problem:

```ts
const parts = target.startsWith("/") ? [] : link.split("/").slice(1, -1);
```

I checked this against Shell's `normalizePath`/`getParent` over all 114
combinations of 6 link paths and 19 targets: identical output in every case.

For the second, clear the link before creating it:

```ts
const link = at(entry.path);
if (await to.fs.readlink(link).then(() => true, () => false)) {
  await to.fs.rm(link);
}
await to.fs.symlink(at(target), link);
```

With both applied, all four links above resolve, and a second run completes
without error.

I am happy to open a PR with this.
