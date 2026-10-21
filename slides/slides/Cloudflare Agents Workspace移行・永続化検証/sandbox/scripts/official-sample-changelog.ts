// Changelog (2026-10-20) のコードブロックをそのまま。Think 部分だけ外してある
// （Think を入れなくても import 解決とコンストラクタ型は確かめられる）。
import { Workspace } from "@cloudflare/computer";
import { WorkerJavaScriptBackend } from "@cloudflare/computer/backends/worker-javascript";

export function build(storage: DurableObjectStorage, loader: unknown) {
  return new Workspace({
    storage,
    backends: [new WorkerJavaScriptBackend({ id: "js", loader: loader as never })],
  });
}

// 移行ガイドの onStart 例が使っている API。
export function flagApi(storage: DurableObjectStorage) {
  const seen = storage.kv.get("shellMigrated");
  storage.kv.put("shellMigrated", true);
  return seen;
}
