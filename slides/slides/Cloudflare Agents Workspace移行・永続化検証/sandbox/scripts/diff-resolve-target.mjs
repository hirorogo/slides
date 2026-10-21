// Phase 3（実機なし）: 公式移行ガイドの resolveTarget() が、
// @cloudflare/shell の実際のシンボリックリンク解決と一致するかの差分テスト。
//
// 比較は「文字列」ではなく「移行後に実際に辿り着く先」で行う。
// 文字列が違っても着地点が同じなら実害は無い。
//
// 写した実装（いずれも dist から。行番号は該当バージョンのもの）:
//   @cloudflare/shell@0.4.3   normalizePath / getParent          dist/index.js:782-800
//   @cloudflare/shell@0.4.3   resolveSymlink の解決式             dist/index.js:153
//   @cloudflare/computer@0.6.0 symlink() は target を正規化せず格納 dist/index.js:2431-2453
//   @cloudflare/computer@0.6.0 追従時の .. はルートでクランプ       dist/index.js:519-531

// --- Shell 側 ---
function normalizePath(path) {
  if (!path.startsWith("/")) path = "/" + path;
  const r = [];
  for (const p of path.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") r.pop();
    else r.push(p);
  }
  return "/" + r.join("/");
}
function getParent(path) {
  const n = normalizePath(path);
  if (n === "/") return "";
  const i = n.lastIndexOf("/");
  return i === 0 ? "/" : n.slice(0, i);
}
const shellResolve = (link, target) =>
  target.startsWith("/") ? normalizePath(target) : normalizePath(getParent(link) + "/" + target);

// --- 公式移行ガイドのサンプル（一字一句そのまま）---
function resolveTarget(link, target) {
  if (target.startsWith("/")) return target;
  const parts = link.split("/").slice(1, -1);
  for (const part of target.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "" && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}

// --- Computer が「追従するとき」の解決（.. はルートでクランプ、throw しない）---
function followResolve(path) {
  const stack = [];
  for (const name of path.split("/")) {
    if (name === "" || name === ".") continue;
    if (name === "..") { if (stack.length > 0) stack.pop(); continue; }
    stack.push(name);
  }
  return "/" + stack.join("/");
}

const ROOT = "/workspace";
const at = (p) => (ROOT === "/" ? p : `${ROOT}${p}`);

const cases = [
  // 典型的なもの
  ["/links/notes.md", "../notes.md"],
  ["/links/notes.md", "/notes.md"],
  ["/links/notes.md", "notes.md"],
  ["/a/b/c/link",     "../../d/e.txt"],
  ["/link",           "../../../etc/passwd"],
  ["/a/link",         "./x.txt"],
  ["/a/link",         "sub//x.txt"],
  ["/deep/a/b/link",  ".."],
  // 絶対ターゲットに . / .. / // が混ざる（公式は正規化しない）
  ["/a/link",         "/a/../b/x.txt"],
  ["/a/link",         "/./a/x.txt"],
  ["/a/link",         "//double/slash"],
  ["/a/link",         "/a/b/../../c"],
  // 絶対ターゲットがルートを超える（Shell は / で止める）
  ["/link",           "/../etc/passwd"],
  ["/a/link",         "/../../x"],
  ["/a/b/link",       "/../b/x"],
  ["/a/link",         "/../workspace/y"],
];

const rows = [];
let strDiff = 0, harm = 0;
for (const [link, target] of cases) {
  const a = resolveTarget(link, target);
  const b = shellResolve(link, target);
  const landedOfficial = followResolve(at(a));
  const landedCorrect  = followResolve(at(b));
  if (a !== b) strDiff++;
  const bad = landedOfficial !== landedCorrect;
  if (bad) harm++;
  rows.push({ link, target, a, b, landedOfficial, landedCorrect, bad });
}

const w = (s, n) => String(s).padEnd(n);
const out = [];
out.push("link            target                 公式の着地点              あるべき着地点            実害");
out.push("-".repeat(106));
for (const r of rows)
  out.push(`${w(r.link,15)} ${w(JSON.stringify(r.target),22)} ${w(r.landedOfficial,25)} ${w(r.landedCorrect,25)} ${r.bad ? "❌ ズレる" : "✅"}`);
out.push("-".repeat(106));
out.push(`${cases.length} 件中: 文字列が違う ${strDiff} 件 / 着地点がズレる ${harm} 件`);
console.log(out.join("\n"));

import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("results", { recursive: true });
writeFileSync("results/c14-resolve-target.json", JSON.stringify({
  claim: "C14",
  phase: 3,
  env: "desk",
  versions: { "@cloudflare/shell": "0.4.3", "@cloudflare/computer": "0.6.0" },
  note: "純関数の差分テスト。実機不要。着地点は Computer の追従時セマンティクス（.. はルートでクランプ）で評価",
  stringMismatches: strDiff,
  landingMismatches: harm,
  rows,
}, null, 2) + "\n");
