#!/usr/bin/env node
/**
 * C18 — 旧 Shell（inline base64 格納）が通る最大ファイルサイズを二分探索する。
 * 公式ドキュメントは "Maximum string, BLOB or table row size: 2 MB" と書いているが、
 * 4MB（base64 5,592,408 文字）は通った。実際の境界を 1 バイトまで詰める。
 *
 * 対照: 同じサイズを新 Computer に書くと通ること（チャンク化されるため）。
 */
import { writeFileSync, mkdirSync } from "node:fs";
const BASE = process.argv.find((a) => a.startsWith("--base="))?.slice(7);
const RUN = new Date().toISOString().replace(/[:.]/g, "-");
const b64len = (n) => Math.ceil(n / 3) * 4;

const probe = async (size) => {
  const res = await fetch(`${BASE}/run/probe-size?do=bis-${size}-${RUN}&sizes=${size}`);
  const d = await res.json();
  const shell = d.records.find((r) => r.step.startsWith("旧 Shell に"));
  const comp = d.records.find((r) => r.step.startsWith("対照"));
  return { shellOk: shell?.ok, shellErr: shell?.error, computerOk: comp?.ok };
};

let ok = 4 * 1024 * 1024;        // 通ることを確認済み
let ng = 8 * 1024 * 1024;        // 落ちることを確認済み
const trail = [];
console.log("size(bytes)   base64長      旧Shell   新Computer");
console.log("-".repeat(58));
while (ng - ok > 1) {
  const mid = Math.floor((ok + ng) / 2);
  const r = await probe(mid);
  trail.push({ size: mid, base64Len: b64len(mid), ...r });
  console.log(`${String(mid).padStart(11)} ${String(b64len(mid)).padStart(12)}   ${r.shellOk ? "通った" : "落ちた"}    ${r.computerOk ? "通った" : "落ちた"}`);
  if (r.shellOk) ok = mid; else ng = mid;
}
console.log("-".repeat(58));
console.log(`旧 Shell が通る最大: ${ok} バイト（base64 ${b64len(ok)} 文字）`);
console.log(`落ちる最小:         ${ng} バイト（base64 ${b64len(ng)} 文字）`);
const MiB = (n) => (n / 1048576).toFixed(4);
console.log(`→ ${MiB(ok)} MiB / base64 ${MiB(b64len(ok))} MiB`);
mkdirSync("results", { recursive: true });
writeFileSync("results/deployed-rowlimit.json", JSON.stringify({
  runId: RUN, method: "二分探索。旧 Shell は base64 TEXT を 1 セルに入れる",
  docSays: "Maximum string, BLOB or table row size: 2 MB (developers.cloudflare.com/durable-objects/platform/limits/)",
  maxOk: ok, maxOkBase64: b64len(ok), minNg: ng, minNgBase64: b64len(ng), trail,
}, null, 2) + "\n");
