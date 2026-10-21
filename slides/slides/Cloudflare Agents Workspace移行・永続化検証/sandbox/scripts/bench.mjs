#!/usr/bin/env node
/**
 * C22 — ベンチ。
 *
 * Worker の中では Date.now() が進まない（本番で 4MB の書き込みが 0ms と記録された）。
 * なのでドライバの壁時計で測り、**rounds=0 の素通しリクエストを対照に引く**。
 *   1 サイクルあたり = (T_rounds - T_0) / rounds
 * これで HTTP RTT と DO 起動分が落ちる。
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";

const BASE = process.argv.find((a) => a.startsWith("--base="))?.slice(7)
  ?? "http://localhost:8787";
const ENV = process.argv.find((a) => a.startsWith("--env="))?.slice(6) ?? "local";
const ROUNDS = Number(process.argv.find((a) => a.startsWith("--rounds="))?.slice(9) ?? 20);
const REPEATS = Number(process.argv.find((a) => a.startsWith("--repeats="))?.slice(10) ?? 5);
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const SIZES = [
  { label: "1KB", size: 1024 },
  { label: "100KB", size: 100 * 1024 },
  { label: "1MB", size: 1024 * 1024 },
];
const SIDES = ["shell", "computer"];

const hit = async (side, size, rounds, tag) => {
  const qs = new URLSearchParams({ do: `bench-${side}-${size}-${tag}-${RUN_ID}`, side, size, rounds });
  const t = Date.now();
  const res = await fetch(`${BASE}/run/loop?${qs}`);
  await res.text();
  return Date.now() - t;
};

const median = (xs) => { const s=[...xs].sort((a,b)=>a-b); const m=s.length>>1;
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2; };

const rows = [];
console.log(`# bench  env=${ENV}  rounds=${ROUNDS}  repeats=${REPEATS}`);
console.log(`size    side      素通し(ms)  ${ROUNDS}回(ms)   1サイクル(ms)`);
console.log("-".repeat(60));
for (const { label, size } of SIZES) {
  for (const side of SIDES) {
    const base = [], full = [];
    for (let i = 0; i < REPEATS; i++) {
      base.push(await hit(side, size, 0, `b${i}`));       // 対照: 0 回
      full.push(await hit(side, size, ROUNDS, `f${i}`));  // 本番: ROUNDS 回
    }
    const b = median(base), f = median(full);
    const per = (f - b) / ROUNDS;
    rows.push({ label, size, side, baselineMs: b, fullMs: f, perCycleMs: per, base, full });
    console.log(`${label.padEnd(7)} ${side.padEnd(9)} ${String(b).padStart(9)}  ${String(f).padStart(8)}   ${per.toFixed(2).padStart(10)}`);
  }
}
mkdirSync("results", { recursive: true });
writeFileSync(`results/${ENV}-bench.json`, JSON.stringify({
  runId: RUN_ID, env: ENV, rounds: ROUNDS, repeats: REPEATS,
  method: "ドライバの壁時計。rounds=0 を対照に引いて 1 サイクルを出す（Worker 内では Date.now() が進まないため）",
  versions: JSON.parse(readFileSync("package.json", "utf8")).dependencies,
  rows,
}, null, 2) + "\n");
