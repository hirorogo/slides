#!/usr/bin/env node
/** C05 — hibernate の閾値。待ち時間を変えて bootId が変わるかを見る。
 *  対照: 待ち 0 秒では bootId が変わらないこと。 */
import { writeFileSync, mkdirSync } from "node:fs";
const BASE = process.argv.find((a) => a.startsWith("--base="))?.slice(7);
const RUN = new Date().toISOString().replace(/[:.]/g, "-");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hit = async (doName, mode) =>
  (await (await fetch(`${BASE}/run/persist?do=${doName}&mode=${mode}`)).json());

const WAITS = [0, 3, 6, 9, 11, 13, 15];
const rows = [];
console.log("待ち(s)  1回目 bootId                              2回目 bootId                            再起動  読めた");
console.log("-".repeat(108));
for (const w of WAITS) {
  const doName = `hib-${w}s-${RUN}`;
  const a = await hit(doName, "write");
  await sleep(w * 1000);
  const b = await hit(doName, "read");
  const restarted = a.bootId !== b.bootId;
  const read = b.records?.find((r) => r.claim === "C02");
  rows.push({ waitSeconds: w, boot1: a.bootId, boot2: b.bootId, restarted, readOk: read?.ok, text: read?.result?.text });
  console.log(`${String(w).padStart(6)}   ${a.bootId}  ${b.bootId}  ${restarted ? "はい  " : "いいえ"}  ${read?.ok ? "✅" : "❌"}`);
}
mkdirSync("results", { recursive: true });
writeFileSync("results/deployed-hibernate.json", JSON.stringify({ runId: RUN, waits: WAITS, rows }, null, 2) + "\n");
