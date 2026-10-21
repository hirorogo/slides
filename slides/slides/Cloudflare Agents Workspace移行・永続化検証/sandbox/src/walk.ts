import { Workspace } from "@cloudflare/computer";
import type { Workspace as ShellWorkspace } from "@cloudflare/shell";
import { sha256 } from "./evidence";

export type Entry = {
  path: string;
  type: "file" | "dir" | "symlink";
  size?: number;
  sha256?: string;
  target?: string;
  mtime?: number;
  /** Shell だけが持つ。Computer には置き場所が無い（C23 / C24） */
  createdAt?: number;
  updatedAt?: number;
  mimeType?: string;
};

export async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/**
 * Computer 側のツリー列挙。
 * `find()` は type が "file" | "dir" しか返さず **シンボリックリンクを拾えない**ので、
 * `readdir()` を再帰する（こちらは isSymbolicLink を持つ）。
 */
export async function walkComputer(ws: Workspace, root: string): Promise<Entry[]> {
  const out: Entry[] = [];
  const visit = async (dir: string): Promise<void> => {
    const dirents = await ws.fs.readdir(dir).catch(() => []);
    for (const d of dirents) {
      const path = dir === "/" ? `/${d.name}` : `${dir}/${d.name}`;
      if (d.isSymbolicLink) {
        out.push({
          path,
          type: "symlink",
          mtime: d.mtime,
          target: await ws.fs.readlink(path).catch(() => undefined),
        });
      } else if (d.isDirectory) {
        out.push({ path, type: "dir", mtime: d.mtime });
        await visit(path);
      } else {
        const bytes = await readAllBytes(await ws.fs.readFile(path));
        out.push({ path, type: "file", size: bytes.length, mtime: d.mtime, sha256: await sha256(bytes) });
      }
    }
  };
  await visit(root);
  out.sort((a, b) => (a.path < b.path ? -1 : 1));
  return out;
}

/** Shell 側のツリー列挙。glob は FileInfo[] を返す（mimeType / createdAt / updatedAt 付き） */
export async function walkShell(ws: ShellWorkspace): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const info of await ws.glob("/**")) {
    if (info.path === "/") continue;
    const base = {
      path: info.path,
      mimeType: info.mimeType,
      createdAt: info.createdAt,
      updatedAt: info.updatedAt,
    };
    if (info.type === "symlink") {
      out.push({ ...base, type: "symlink", target: await ws.readlink(info.path).catch(() => undefined) });
    } else if (info.type === "directory") {
      out.push({ ...base, type: "dir" });
    } else {
      const bytes = await ws.readFileBytes(info.path);
      out.push({
        ...base,
        type: "file",
        size: bytes?.length ?? 0,
        sha256: bytes ? await sha256(bytes) : undefined,
      });
    }
  }
  out.sort((a, b) => (a.path < b.path ? -1 : 1));
  return out;
}

/** 2 つのツリーを突き合わせる。root 分のプレフィックスを揃えて比較する */
export function compareTrees(before: Entry[], after: Entry[], root: string) {
  const at = (p: string) => (root === "/" ? p : `${root}${p}`);
  const afterByPath = new Map(after.map((e) => [e.path, e]));
  const rows = before.map((b) => {
    const a = afterByPath.get(at(b.path));
    return {
      path: b.path,
      expectedPath: at(b.path),
      present: a !== undefined,
      type: { before: b.type, after: a?.type },
      sha256Match: b.type === "file" ? b.sha256 === a?.sha256 : undefined,
      target: b.type === "symlink" ? { before: b.target, after: a?.target, expected: undefined as string | undefined } : undefined,
      sizeMatch: b.type === "file" ? b.size === a?.size : undefined,
    };
  });
  return {
    rows,
    missing: rows.filter((r) => !r.present).map((r) => r.expectedPath),
    contentMismatch: rows.filter((r) => r.sha256Match === false).map((r) => r.expectedPath),
    extra: after.filter((a) => !before.some((b) => at(b.path) === a.path)).map((a) => a.path),
  };
}
