#!/usr/bin/env node
/** R3 — 素の SQL（ライブラリを経由しない）の 1 値あたりの上限を二分探索する。
 *  公式 Limits は "Maximum string, BLOB or table row size: 2 MB"。 */
import { writeFileSync, mkdirSync } from "node:fs";
const BASE = process.argv.find((a) => a.startsWith("--base="))?.slice(7);
const RUN = new Date().toISOString().replace(/[:.]/g, "-");
const probe = async (size) => {
  const r = await fetch(`${BASE}/run/limits?do=raw-${size}-${RUN}&sizes=${size}`);
  const d = await r.json();
  const get = (p) => d.records.find((x) => x.step.startsWith(p))?.ok;
  return { TEXT: get("TEXT"), BLOB: get("BLOB"), KV: get("KV value") };
};
let ok = 8388609, ng = 12582912;
const trail = [];
console.log("size          TEXT   BLOB   KV");
console.log("-".repeat(36));
while (ng - ok > 1) {
  const mid = Math.floor((ok + ng) / 2);
  const r = await probe(mid);
  trail.push({ size: mid, ...r });
  console.log(`${String(mid).padStart(11)}   ${r.TEXT ? "OK  " : "NG  "}   ${r.BLOB ? "OK  " : "NG  "}   ${r.KV ? "OK" : "NG"}`);
  if (r.TEXT) ok = mid; else ng = mid;
}
console.log("-".repeat(36));
const MiB = (n) => (n / 1048576).toFixed(5);
console.log(`通る最大 ${ok} (${MiB(ok)} MiB) / 落ちる最小 ${ng} (${MiB(ng)} MiB)`);
mkdirSync("results", { recursive: true });
writeFileSync("results/deployed-rawlimit.json", JSON.stringify({
  runId: RUN, docSays: "Maximum string, BLOB or table row size: 2 MB",
  note: "ライブラリを経由せず ctx.storage.sql / ctx.storage.kv を直接叩いた",
  maxOk: ok, minNg: ng, trail }, null, 2) + "\n");
