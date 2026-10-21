The copy script in `docs/shell/migrating-to-computer.md` mishandles symlinks in two
ways. Both are fixed here. I verified the current behaviour and the fix on a deployed
Durable Object with `@cloudflare/shell@0.4.3` and `@cloudflare/computer@0.6.0`.

## 1. `resolveTarget` does not normalise absolute targets

```ts
if (target.startsWith("/")) return target;
```

Shell normalises every target, absolute or not (`packages/shell/src/filesystem.ts`,
`resolveSymlink`):

```js
const resolved = target.startsWith("/")
  ? normalizePath(target)
  : normalizePath(getParent(path) + "/" + target);
```

`normalizePath` clamps `..` at `/`. The script does not, so a `..` that climbs above
the root survives into the new path and escapes `root`.

Measured with `root = "/workspace"`:

| link | Shell target | migrated target | readable |
| --- | --- | --- | --- |
| `/links/rel.md` | `../notes.md` | `/workspace/notes.md` | yes |
| `/links/abs.md` | `/notes.md` | `/workspace/notes.md` | yes |
| `/links/dotdot.md` | `/src/../notes.md` | `/workspace/src/../notes.md` | yes |
| `/links/esc.md` | `/../notes.md` | `/workspace/../notes.md` | **no — ENOENT** |

Relative targets, and absolute targets whose `..` stays inside the root, are already
correct. Only the root-escaping case breaks.

It fails quietly. `symlink()` stores the target without validating it, and path
resolution clamps `..` at the root rather than throwing, so the copy reports success
and the link simply points outside the migrated tree. A post-migration check that
compares paths, types and content hashes does not catch it: the link exists, it just
does not resolve.

Making the branch uniform is enough:

```ts
const parts = target.startsWith("/") ? [] : link.split("/").slice(1, -1);
```

I compared this against Shell's `normalizePath` and `getParent` over all 114
combinations of 6 link paths and 19 targets, including `..` chains, `.`, empty
segments, doubled slashes and root-escaping targets. The output is identical in every
case.

## 2. The copy cannot be re-run

`mkdir({ recursive: true })` and `writeFile` are idempotent, but `symlink` always
throws `EEXIST` when the path exists, and it has no `force` option:

```
1st run: ok
2nd run: EEXIST path exists: /workspace/links/abs.md
```

The page recommends running the copy from `onStart` and recording a flag afterwards.
If the copy throws, the flag is never written, so every start retries and fails at the
same link. Clearing the link first makes the copy safe to repeat:

```ts
const link = at(entry.path);
if (await to.fs.readlink(link).then(() => true, () => false)) {
  await to.fs.rm(link);
}
await to.fs.symlink(at(target), link);
```

## After the change

All four links above resolve, and a second run completes without error. The rest of
the migration is unaffected: text, binary, nested directories and empty directories
already copied correctly, with matching SHA-256 for every file.

This is a documentation-only change. `copyShellWorkspace` is not shipped in any
package, so readers copy it into their own agent. A migration runs once, which is why
it seemed worth fixing the snippet rather than only noting the limitation.
