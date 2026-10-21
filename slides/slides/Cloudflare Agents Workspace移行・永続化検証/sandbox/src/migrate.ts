/**
 * 公式移行ガイドのコピースクリプト。**一字一句そのまま。**
 *
 * 出典: https://github.com/cloudflare/agents/blob/main/docs/shell/migrating-to-computer.md
 *       cloudflare/agents PR #2564 (2026-10-14)
 *
 * 検証対象なので手を入れない。バグがあるならそれが結果。
 * 修正版は `copyShellWorkspaceFixed()` として別に置く（比較用）。
 */
import { Workspace as ShellWorkspace } from "@cloudflare/shell";
import { Workspace } from "@cloudflare/computer";

// --- ここから公式サンプル（原文ママ）-------------------------------------

// Shell resolves a relative target against the link's directory and never
// goes above `/`.
export function resolveTarget(link: string, target: string): string {
  if (target.startsWith("/")) return target;
  const parts = link.split("/").slice(1, -1);
  for (const part of target.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "" && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export async function copyShellWorkspace(
  from: ShellWorkspace,
  to: Workspace,
  root = "/workspace"
): Promise<void> {
  const at = (path: string) => (root === "/" ? path : `${root}${path}`);
  await to.fs.mkdir(root, { recursive: true });
  // glob returns rows ordered by path, so parents come before children.
  for (const entry of await from.glob("/**")) {
    if (entry.path === "/") continue;
    if (entry.type === "directory") {
      await to.fs.mkdir(at(entry.path), { recursive: true });
    } else if (entry.type === "symlink" && entry.target) {
      // Resolve the target the way Shell does, then move it with the files.
      const target = resolveTarget(entry.path, entry.target);
      await to.fs.symlink(at(target), at(entry.path));
    } else {
      const bytes = await from.readFileBytes(entry.path);
      if (bytes !== null) await to.fs.writeFile(at(entry.path), bytes);
    }
  }
}

// --- ここまで公式サンプル -------------------------------------------------

/**
 * 修正版（C14 / C16 の対照）。**cloudflare/agents に出す PR と同じコード**にしてある。
 * 公式との差は 2 点だけ:
 *   1. 絶対ターゲットも Shell と同じく正規化する（resolveTarget の 1 行）
 *   2. 既存リンクを消してから張り直す（再実行の EEXIST 回避）
 */
export function resolveTargetFixed(link: string, target: string): string {
  const parts = target.startsWith("/") ? [] : link.split("/").slice(1, -1);
  for (const part of target.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "" && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export async function copyShellWorkspaceFixed(
  from: ShellWorkspace,
  to: Workspace,
  root = "/workspace"
): Promise<void> {
  const at = (path: string) => (root === "/" ? path : `${root}${path}`);
  await to.fs.mkdir(root, { recursive: true });
  for (const entry of await from.glob("/**")) {
    if (entry.path === "/") continue;
    if (entry.type === "directory") {
      await to.fs.mkdir(at(entry.path), { recursive: true });
    } else if (entry.type === "symlink" && entry.target) {
      const target = resolveTargetFixed(entry.path, entry.target);
      const link = at(entry.path);
      // `symlink` throws EEXIST, so a second run has to clear the old link.
      if (await to.fs.readlink(link).then(() => true, () => false)) {
        await to.fs.rm(link);
      }
      await to.fs.symlink(at(target), link);
    } else {
      const bytes = await from.readFileBytes(entry.path);
      if (bytes !== null) await to.fs.writeFile(at(entry.path), bytes);
    }
  }
}
