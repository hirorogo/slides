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
 * 修正版（C14 / C16 の対照）。公式との差は 2 点だけ:
 *   1. 絶対ターゲットも Shell と同じく正規化する
 *   2. symlink が EEXIST のとき、同じリンク先なら許容する（再実行の冪等化）
 * ほかは公式と同一にして、差分の原因を 2 点に限定する。
 */
function normalizeAbsolute(path: string): string {
  const resolved: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return "/" + resolved.join("/");
}

export function resolveTargetFixed(link: string, target: string): string {
  if (target.startsWith("/")) return normalizeAbsolute(target);
  return resolveTarget(link, target);
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
      const linkPath = at(entry.path);
      // workspace.fs には exists / lstatOrNull が無い（RPC スタブ側のみ）。
      // lstat を try で受ける。
      const current = await to.fs.readlink(linkPath).catch(() => null);
      if (current !== null) {
        if (current === at(target)) continue;
        await to.fs.rm(linkPath);
      }
      await to.fs.symlink(at(target), linkPath);
    } else {
      const bytes = await from.readFileBytes(entry.path);
      if (bytes !== null) await to.fs.writeFile(at(entry.path), bytes);
    }
  }
}
