The copy script in [Migrating from `@cloudflare/shell` to `@cloudflare/computer`](https://github.com/cloudflare/agents/blob/main/docs/shell/migrating-to-computer.md)
has two problems. Both only affect workspaces that contain symlinks. I verified
both on a deployed Durable Object with `@cloudflare/shell@0.4.3` and
`@cloudflare/computer@0.6.0`.

This is a documentation issue, not a package one. `packages/shell`'s
`resolveSymlink` normalises targets correctly, and `@cloudflare/computer`'s
`symlink()` throwing `EEXIST` matches `node:fs`. Only the snippet is wrong — but
because readers copy it into their own agent and a migration runs once, a later
fix does not reach anyone who has already run it.

Both have come up in review before, which is why I am filing rather than
assuming they are unknown:

- **(1)** was raised on #2564 as "Relative links escape the migrated workspace",
  fixed for relative targets, and marked resolved. The review's analysis said
  "Absolute targets are already rebased by the copy script", and that premise is
  what this issue corrects — absolute targets are passed through untouched.
- **(2)** was raised on #2552 as "Interrupted symlink copies block migration
  retries". #2552 was closed in favour of the #2559–#2565 stack, and the finding
  did not carry over.

I have the change on a branch, if a PR is welcome:
<https://github.com/cloudflare/agents/compare/main...tanahiro2010:agents:docs/fix-shell-symlink-migration>

## 1. `resolveTarget` does not normalise absolute targets

`resolveTarget` was added to rebase relative targets, and it does that
correctly. The absolute branch returns early:

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

This is the finding from #2552. The suggestion there was to compare `readlink`
against the source target before skipping; the branch below removes the link and
recreates it, which is shorter and reaches the same state.

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
without error. Nothing else in the migration changes: text, binary, nested
directories and empty directories already copied correctly, with matching
SHA-256 for every file.

<details>
<summary>Full diff</summary>

```diff
--- a/docs/shell/migrating-to-computer.md	2026-10-21 23:28:48
+++ b/docs/shell/migrating-to-computer.md	2026-10-21 23:28:48
@@ -61,11 +61,11 @@
 import { Workspace as ShellWorkspace } from "@cloudflare/shell";
 import { Workspace } from "@cloudflare/computer";
 
-// Shell resolves a relative target against the link's directory and never
-// goes above `/`.
+// Shell resolves a target against the link's directory and never goes above
+// `/`. An absolute target is normalised the same way, so `/../notes.md`
+// resolves to `/notes.md` before it moves under `root`.
 function resolveTarget(link: string, target: string): string {
-  if (target.startsWith("/")) return target;
-  const parts = link.split("/").slice(1, -1);
+  const parts = target.startsWith("/") ? [] : link.split("/").slice(1, -1);
   for (const part of target.split("/")) {
     if (part === "..") parts.pop();
     else if (part !== "" && part !== ".") parts.push(part);
@@ -88,7 +88,12 @@
     } else if (entry.type === "symlink" && entry.target) {
       // Resolve the target the way Shell does, then move it with the files.
       const target = resolveTarget(entry.path, entry.target);
-      await to.fs.symlink(at(target), at(entry.path));
+      const link = at(entry.path);
+      // `symlink` throws EEXIST, so a second run has to clear the old link.
+      if (await to.fs.readlink(link).then(() => true, () => false)) {
+        await to.fs.rm(link);
+      }
+      await to.fs.symlink(at(target), link);
     } else {
       const bytes = await from.readFileBytes(entry.path);
       if (bytes !== null) await to.fs.writeFile(at(entry.path), bytes);
```

</details>
