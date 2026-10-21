#!/usr/bin/env node
/**
 * ドライバ。claims.md の順序どおりにシナリオを叩き、生の結果を results/ に落とす。
 *
 * 鉄則: ログに残らない観測は結論に使わない。
 *   - DO が返した records をそのまま JSONL に流す（整形は別ファイル）
 *   - HTTP 総時間と Workspace 操作時間を分けて持つ
 *   - 失敗も結果。例外で止めない
 *
 * 使い方:
 *   node scripts/run.mjs --base=http://localhost:8787 --env=local
 *   node scripts/run.mjs --base=https://....workers.dev --env=deployed --only=persist
 */
import { appendFileSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "1"];
  })
);
const BASE = args.base ?? "http://localhost:8787";
const ENV = args.env ?? "local";
const ONLY = args.only ? args.only.split(",") : null;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");

const pkgVersion = (name) =>
  JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version;

const VERSIONS = {
  "@cloudflare/shell": pkgVersion("@cloudflare/shell"),
  "@cloudflare/computer": pkgVersion("@cloudflare/computer"),
  wrangler: pkgVersion("wrangler"),
  node: process.version,
};

mkdirSync("results", { recursive: true });
const RAW = `results/run-${ENV}-${RUN_ID}.raw.jsonl`;
const transcript = [];
const log = (s = "") => { console.log(s); transcript.push(s); };

/** 1 シナリオ = 1 HTTP。DO 名はシナリオごとに新しくする（移行は不可逆） */
async function run(scenario, params = {}) {
  // DO 名はシナリオ+パラメータごとに必ず新しくする。
  // 使い回すと「移行は不可逆」という前提が壊れる（実際に一度やらかした）。
  const variantKey = Object.entries(params).map(([k, v]) => `${k}${v}`).join("-");
  const doName = `${scenario}${variantKey ? "-" + variantKey : ""}-${RUN_ID}`;
  const qs = new URLSearchParams({ do: doName, ...params });
  const url = `${BASE}/run/${scenario}?${qs}`;
  const startedAt = Date.now();
  let status = 0, body;
  try {
    const res = await fetch(url);
    status = res.status;
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 2000) }; }
  } catch (e) {
    body = { _fetchError: String(e?.message ?? e) };
  }
  const httpTotalMs = Date.now() - startedAt;

  // ⚠️ URL をそのまま残さない。workers.dev のサブドメインはアカウント識別子になる。
  const safeUrl = url.replace(/^https?:\/\/[^/]+/, `<${ENV}>`);
  const record = { runId: RUN_ID, env: ENV, scenario, params, doName, url: safeUrl, status, httpTotalMs, versions: VERSIONS, body };
  appendFileSync(RAW, JSON.stringify(record) + "\n");
  writeFileSync(`results/${ENV}-${scenario}${params.variant ? "-" + params.variant : ""}${params.flag ? "-flag" : ""}${params.r2 ? "-r2" : ""}.json`, JSON.stringify(record, null, 2) + "\n");

  log(`\n### ${scenario} ${JSON.stringify(params)}  [HTTP ${status}, ${httpTotalMs}ms]`);
  log(`DO=${doName}  bootId=${body?.bootId ?? "?"}  tables=${JSON.stringify(body?.tables ?? [])}`);
  for (const r of body?.records ?? []) {
    const mark = r.ok ? "  " : "!!";
    const res = r.result === undefined ? "" : ` → ${short(r.result)}`;
    const err = r.ok ? "" : ` → ${r.errorName ?? ""} ${r.error}`;
    log(`${mark} ${String(r.seq).padStart(3)} [${r.claim}] ${r.step}${res}${err}  (${r.durationMs}ms)`);
  }
  if (body?.error) log(`!! ${body.error}`);
  return body;
}

const short = (v) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 400 ? s.slice(0, 400) + `…(${s.length})` : s;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// claims.md「1 回しか試せない検証」の順序に従う
const PLAN = [
  // ⓪ まず検証したい機能を外した状態で通す
  ["baseline-shell", {}],
  // ① 無移行アップデート（一度移行すると戻せない）
  ["tables", {}],
  ["no-migration", {}],
  // ② 移行
  ["migrate", {}],
  ["migrate", { variant: "fixed" }],
  ["migrate-twice", {}],
  ["migrate-twice", { variant: "fixed" }],
  ["migrate-twice", { flag: "1" }],
  // ③ 新スキーマを書いた後にしか試せない
  ["rollback", {}],
  // ④ 独立
  ["sizes", {}],
  ["dedup", {}],
  // ⑤ 最後にもう一度 正常系（ここまでの結果が有効だと示す）。DO は新しくする
  ["baseline-shell", { tag: "final" }],
];

const DEPLOY_ONLY = new Set(["persist", "bench", "r2"]);

async function main() {
  log(`# run ${RUN_ID}  env=${ENV}  base=${BASE}`);
  log(`versions: ${JSON.stringify(VERSIONS)}`);
  for (const [scenario, params] of PLAN) {
    if (ONLY && !ONLY.includes(scenario)) continue;
    if (DEPLOY_ONLY.has(scenario) && ENV !== "deployed") continue;
    await run(scenario, params);
  }

  if (ONLY?.includes("persist")) {
    // C02 / C03 / C05: 起動識別子が変わったかで再起動を立証する
    const doName = `persist-${RUN_ID}`;
    log(`\n### persist (C02/C03/C05)  DO=${doName}`);
    const seen = [];
    const hit = async (label, mode) => {
      const qs = new URLSearchParams({ do: doName, mode });
      const t = Date.now();
      const res = await fetch(`${BASE}/run/persist?${qs}`);
      const body = await res.json();
      const row = { label, mode, httpMs: Date.now() - t, bootId: body.bootId, aliveMs: body.aliveMs,
        read: body.records?.find((r) => r.claim === "C02")?.result ?? null,
        ok: body.records?.find((r) => r.claim === "C02")?.ok };
      seen.push(row);
      appendFileSync(RAW, JSON.stringify({ runId: RUN_ID, env: ENV, scenario: "persist", label, doName, body }) + "\n");
      log(`  ${label.padEnd(22)} bootId=${row.bootId}  alive=${row.aliveMs}ms  read.ok=${row.ok}`);
      return row;
    };
    await hit("① 書く", "write");
    await hit("② 直後に読む", "read");
    log("  …15 秒待つ（hibernate は無活動 10 秒）");
    await sleep(15_000);
    await hit("③ 15 秒後", "read");
    log("  …150 秒待つ（eviction は 70-140 秒）");
    await sleep(150_000);
    await hit("④ 150 秒後", "read");
    const boots = new Set(seen.map((s) => s.bootId));
    log(`\n  bootId の種類: ${boots.size}（1 なら再起動していない = 永続化の証拠にならない）`);
    writeFileSync(`results/${ENV}-persist.json`, JSON.stringify({ runId: RUN_ID, env: ENV, doName, seen, versions: VERSIONS }, null, 2) + "\n");
  }

  writeFileSync(`results/transcript-${ENV}-${RUN_ID}.md`, "```\n" + transcript.join("\n") + "\n```\n");
  log(`\n生ログ: ${RAW}`);
}

main().catch((e) => {
  console.error(e);
  writeFileSync(`results/transcript-${ENV}-${RUN_ID}.md`, "```\n" + transcript.join("\n") + "\n```\n");
  process.exit(1);
});
