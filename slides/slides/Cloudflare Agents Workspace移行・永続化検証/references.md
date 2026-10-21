# references — Cloudflare Agents Workspace 移行・永続化検証

| | |
| --- | --- |
| 調査日 | 2026-10-21 |
| 対象 | `@cloudflare/shell@0.4.3/0.5.0` → `@cloudflare/computer@0.6.0`、`@cloudflare/think@0.20.2` → `0.21.0` |
| 用途 | slide.md / article.md / claims.md（`verify-claims` に続く） |
| 元ネタ | `PRD.md` |

> **結論: PRD の事実関係はほぼ全部正しかった。** パッケージ・リポジトリ・Changelog・
> 移行ガイド・テーブル名まで実在する。ただし**粒度が粗い箇所と、PRD が拾えていない論点が 3 つ**ある（#13 / #14 / #17）。

## 確認した主張

| # | 主張 | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | 2026-10-20 に Think の Workspace が `@cloudflare/computer` へ | ✅ | 公式 Changelog / npm 公開日 |
| 2 | `@cloudflare/shell` は非推奨 | ✅ | npm `deprecated` フィールド / PR #2564 |
| 3 | 旧 = SQLite + 任意 R2 / 新 = DO SQLite | ⚠️ **粗い** | 新も R2 mount はある（**読み取り専用**） |
| 4 | テーブルは `cf_workspace_*` → `vfs_*` / `_vfs_*` | ✅ | 移行ガイドに両方の DDL |
| 5 | 新は inode・チャンクベース | ✅ | schema doc / 実コード（`CHUNK_SIZE = 524288`） |
| 6 | 新は R2 への大容量退避が未対応 | ✅ | cloudflare/computer#217 |
| 7 | Namespace 相当が未実装 | ✅ | cloudflare/computer#219 |
| 8 | 旧データの自動移行はない | ✅ | Changelog / 移行ガイド |
| 9 | 公式移行スクリプトがあり `/workspace` 配下にコピー | ✅ | 移行ガイド本文 |
| 10 | `created_at` / `modified_at` / `mime_type` は保持されない | ✅ | 移行ガイドに明記 |
| 11 | `WorkerJavaScriptBackend` で JS 実行を足す | ✅ | 型定義で実在。ただし**Changelog 本文の表記が違う** |
| 12 | 旧 Shell は 1.5MB 超を R2 に逃がす | ✅ | 実コード（`DEFAULT_INLINE_THRESHOLD`） |
| 13 | **4MB ファイルは旧 Shell（R2 なし）では保存できない** | ⚠️ **予測・要実測** | DO SQLite の行上限 2MB + base64 格納（一次 2 本からの導出） |
| 14 | **新 Workspace はダウングレード不可** | ⚠️ **コードで確認・要実測** | `schema_version > 10` で `EIO` throw。**どのドキュメントにも無い** |
| 15 | DO 再起動は「十分なアイドル時間」で起こせる | ✅ | 公式 lifecycle doc。**10 秒**で hibernate |
| 16 | 新 Workspace は stable 宣言済み | ✅ | computer 0.6.0 リリースノート（#241） |
| 17 | パッケージが巨大化した（486KB → 11.6MB） | ⚠️ **誤読注意** | コアエントリだけなら 36.8KB → 256KB |
| 18 | 同時書き込みの挙動（PRD T12） | ⬜ 未確認 | `rev` は single-writer と doc にあるが未実測 |
| 19 | Think docs の `ai` が v6 表記 | ❌ **ドキュメント側の誤り** | peerDeps は `^7.0.0` |

---

## 1–2. 移行の事実と非推奨

- [Changelog — Think agents now use a @cloudflare/computer workspace](https://developers.cloudflare.com/changelog/post/2026-10-20-think-computer-workspace/) — 一次。2026-10-20
  > `@cloudflare/shell` is deprecated, and so is Think's `createExecuteTool`.
  > These will no longer be developed nor supported from today onwards.
- npm の `deprecated` フィールドが立っている（**0.4.3 にも遡って付く**ので「いつから非推奨か」は npm からは分からない）:
  > Deprecated: use @cloudflare/computer. Migration guide: https://github.com/cloudflare/agents/blob/main/docs/shell/migrating-to-computer.md
- [cloudflare/agents#2564](https://github.com/cloudflare/agents/pull/2564) — 一次。**設計意図はこっち。** @mattzcarey、2026-10-14 merge。
  7 本の PR スタック（#2559〜#2565）で段階的に切り替えている:

  | PR | 内容 |
  | --- | --- |
  | #2559 | examples を computer 0.5.1 へ |
  | #2560 | think / agents が Computer Workspace で動くように |
  | #2561 | think の workspace ツールを Computer の `createAITools` に |
  | #2562 | think が `@cloudflare/shell` への依存を落とす |
  | #2563 | examples・docs を shell から移す |
  | #2564 | shell を非推奨に（移行ガイド追加） |
  | #2565 | `createExecuteTool` を非推奨に |

- 日付の整理: **移行ガイドは 10-14 に先に入り、パッケージ公開と Changelog が 10-20。**
  記事で「発表と同時に移行ガイドが出た」と書くと不正確。

### 記事に使える切り口

- 「パッケージが変わった」ではなく「**7 本の PR で harness ごと差し替えた**」話。
  PR タイトルを並べるだけで移行の設計が見える。

---

## 3–7. 新旧の差分（PRD の比較表の検証）

一次は [Migrating from `@cloudflare/shell` to `@cloudflare/computer`](https://github.com/cloudflare/agents/blob/main/docs/shell/migrating-to-computer.md)。
raw で取ると DDL が崩れない:

```sh
curl -sL "https://raw.githubusercontent.com/cloudflare/agents/main/docs/shell/migrating-to-computer.md"
```

PRD の比較表に対する判定:

| PRD の記述 | 判定 | 実際 |
| --- | --- | --- |
| ストレージ: 旧 SQLite + オプション R2 / 新 DO SQLite | ⚠️ | 新にも R2 mount はある。**ただし read-only**（#217 に明記）。「未対応」ではなく「書けない」 |
| テーブル: `cf_workspace_*` / `vfs_*`・`_vfs_*` | ✅ | ガイドに両方の DDL あり。`cf_workspace_<namespace>`、既定 namespace は `default` |
| ファイル表現: パス単位 / inode・チャンク | ✅ | 旧は `path TEXT PRIMARY KEY` の 1 行 1 ファイル。新は `vfs_dirents` → `vfs_nodes` → `vfs_chunks` → `vfs_blobs` |
| R2 大容量退避: 未対応 | ✅ | [#217](https://github.com/cloudflare/computer/issues/217)（2026-10-08 open） |
| Namespace: 同等機能は未実装 | ✅ | [#219](https://github.com/cloudflare/computer/issues/219)（同上）。**1 DO storage = 1 Workspace** |
| コード実行: 複数の Backend | ✅ | `backends/worker-javascript` / `worker-shell` / `container` / `container-legacy` |
| 旧データの自動移行: 非対応 | ✅ | Changelog に明記 |

抜けていた制約がもう 1 つ:

- [#218](https://github.com/cloudflare/computer/issues/218) — モデルが動かす `git` 用の
  host-held credential が無い。ホストコードは `onAuth` を渡せる。

### 新スキーマの数字（実コードから）

| | 値 | 出どころ |
| --- | ---: | --- |
| チャンクサイズ | 512 KiB (`524288`) | `dist/index.js:976` `const CHUNK_SIZE = 524288;` |
| ハッシュ | sha256 32 bytes | `vfs_blobs.hash BLOB PRIMARY KEY` |
| schema_version | **10** | `initializeSchema()` |
| ルート inode | 1 | `INSERT ... VALUES (1, 'dir', 493, ...)` |
| 既定 mode | 493 (0o755) | 同上 |

重複排除が効く: 同じバイト列はツリーのどこにあっても `vfs_blobs` の 1 行を共有する。
**→ T07（バイナリ移行）のついでに「同じファイルを 2 箇所に置いたら blob は 1 行か」を見ると面白い。**

---

## 9–10. 移行スクリプト

ガイドの `copyShellWorkspace()` をそのまま使う。型は実際に合っている（確認済み）:

- `ShellWorkspace.glob(pattern): Promise<FileInfo[]>` — `path` / `type` / `target` を持つ。
  ⚠️ **同じ shell パッケージ内に `glob(): Promise<string[]>` の別インターフェースがある**
  （`State` バックエンド側）。grep すると紛らわしいので注意。`Workspace` クラスのものは `FileInfo[]`。
- `readFileBytes(path): Promise<Uint8Array | null>` — ガイドの `if (bytes !== null)` は正しい。
- `FileInfo` は `{ path, name, type, mimeType, size, createdAt, updatedAt, target? }`。
  **つまり旧側は mime/時刻を持っている。落ちるのは新側に受け皿が無いから。**

保持されないもの（ガイドに明記）:

> - `created_at` and `modified_at`. Computer stamps the time of the copy.
> - `mime_type`. Computer does not store a MIME type per file.

コピー先のルートは `/workspace`。Think 自身も `/workspace` 配下に書く:

- `/workspace/attachments/evicted/`（退避メディア）
- `/workspace/fetched/`（fetch 結果）
- `/workspace/.agents/skills`（スキル）

**→ T04 で `/` から `/workspace` に移すと、Think の作業ディレクトリと旧ファイルが同居する。**
衝突の検証（`/workspace/fetched/` と同名のファイルが旧側にあったら？）は PRD に無い。追加候補。

---

## 11. `WorkerJavaScriptBackend` — Changelog 本文の表記が違う

**判定: クラスは実在。ただし Changelog の散文が別名で書いている。**

Changelog 本文:
> A JavaScript execution environment can be configured by adding the **`JavaScriptWorkerBackend`**.

同じページのコードブロック:
```ts
import { WorkerJavaScriptBackend } from "@cloudflare/computer/backends/worker-javascript";
```

型定義（`dist/backends/worker-javascript/index.d.ts`）:
```ts
declare class WorkerJavaScriptBackend implements WorkspaceModuleBackend {
  readonly type = "worker-javascript";
  constructor(options: WorkerJavaScriptBackendOptions);
}
```

→ **正しいのは `WorkerJavaScriptBackend`。** `JavaScriptWorkerBackend` は Changelog の誤記。
PRD はコードブロック側を拾っているので結果的に正しい。

`export` マップにも `./backends/worker-javascript` がある（全 31 エントリ）:

```sh
curl -s https://registry.npmjs.org/@cloudflare%2Fcomputer/0.6.0 | python3 -c \
  "import json,sys; print(sorted(json.load(sys.stdin)['exports']))"
```

> ⚠️ レジストリ JSON を `[:30]` で切って見たとき `./backends/worker-javascript` が
> 無いように見えて一瞬「Changelog のコードが動かない」と判断しかけた。**表示の切り詰めだった。**

---

## 12–13. サイズの壁（PRD のベンチ設計に穴がある）

### 旧 Shell の書き込みパス（実コード）

```js
if (size >= this.threshold && r2) { /* R2 に put、content は NULL */ }
else {
  if (size >= this.threshold && !r2)
    console.warn(`[Workspace] File ${path} is ${size} bytes but no R2 bucket was provided. Storing inline.`);
  const b64 = bytesToBase64(bytes);   // ← base64 で 1 セルに入れる
  ...
}
```

- `inlineThreshold` 既定 **1_500_000 バイト**
- R2 が無ければ警告だけ出して **base64 で inline 格納**
- `content_encoding` は inline 時つねに `base64`（テキストでも）

### DO SQLite の上限（公式）

[Durable Objects — Limits](https://developers.cloudflare.com/durable-objects/platform/limits/):

| | |
| --- | --- |
| Maximum string, BLOB or table row size | **2 MB** |
| Storage per Durable Object | 10 GB |
| Maximum SQL statement length | 100 KB |

### 導出される予測（**要実測**）

PRD §6 のベンチは 1KB / 100KB / 1MB / 4MB を旧新で比較する設計。しかし:

| サイズ | 旧 Shell（R2 なし） | 新 Computer |
| ---: | --- | --- |
| 1 KB | base64 1.4KB → OK | 1 チャンク |
| 100 KB | base64 137KB → OK | 1 チャンク |
| 1 MB | base64 1.37MB → OK（ただし閾値 1.5MB 未満なので警告も出ない） | 2 チャンク |
| 4 MB | base64 **5.6MB** → **2MB 行上限超過で失敗するはず** | 8 チャンク、各 512KiB → OK |

**→ 旧側は R2 を縛らないと 4MB が取れない。PRD の「R2 使用有無を統一できない場合は速度比較を避ける」
では足りず、そもそも書き込みが通らない可能性がある。**
これは「新しい方が速い/遅い」より強い結論になりうる: **チャンク化は性能の話ではなく上限の話。**

> ⚠️ ここは一次ソース 2 本（上限値とコード）からの**導出であって実測ではない**。
> `claims.md` に落として `verify-harness` で潰す。境界（1.5MB ちょうど / 2MB 直前）も測る。

---

## 14. ダウングレードできない（PRD に無い・どのドキュメントにも無い）

`@cloudflare/computer@0.6.0` の `initializeSchema()`:

```js
const onDiskVersion = db.one("SELECT v FROM vfs_meta WHERE k = ?", "schema_version")?.v ?? 0;
if (onDiskVersion > 10) throw createWorkspaceError("EIO", `Unsupported workspace filesystem schema version ${onDiskVersion}`);
if (onDiskVersion > 0 && onDiskVersion < 10) runMigrations(db, onDiskVersion, 10);
```

- 前方移行は自動（v1→v10 のマイグレータが 9 本登録されている）
- **後方は不可。新しい Computer で開いた DO を古い Computer に戻すと `EIO` で落ちる。**
- schema doc にも一行だけある: *"Open() refuses to run if the binary is older than the on-disk `schema_version`."*
  だが移行ガイドにも Changelog にも**ロールバック不可とは書いていない。**

### 記事に使える切り口

- 「移行で一番怖いのはデータが消えることではなく、**戻れないこと**」。
  旧データは残る（Changelog が保証）が、新スキーマを一度書くと Worker をロールバックできない。
- 検証項目として追加: **T14（新）** 新 Workspace で 1 回書き込み → 古い computer に戻して起動 → `EIO` を観測。

---

## 15. 再起動をどう立証するか（T02 の手順が具体化できる）

[Lifecycle of a Durable Object](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)（更新 2026-10-15）:

| 状態遷移 | 時間 | 備考 |
| --- | --- | --- |
| hibernate | **無活動 10 秒** | 条件を満たすときのみ。in-memory state は破棄、**`constructor()` が再実行される** |
| evict（inactive 化） | **無活動 70–140 秒** | hibernate できない場合 |
| pending I/O がある間 | 最大 15 分 | eviction を抑止し、課金も続く |

hibernate の条件（全部満たす必要がある）:
- `setTimeout` / `setInterval` が無い
- 未完了の I/O・`waitUntil()`・outbound 接続が無い
- WebSocket 標準 API を使っていない
- 処理中のリクエストが無い

→ **T02 は「十分なアイドル時間」ではなく「15 秒待つ」で書ける。**
→ 立証方法は PRD の言う通り**起動識別子**。`constructor()` で `crypto.randomUUID()` を
   1 個生成してインスタンス変数に持ち、レスポンスに載せる。**値が変わった = 新しい incarnation。**

Computer 側の doc も同じ整理をしている（[11_lifecycle.md](https://github.com/cloudflare/computer/blob/main/docs/11_lifecycle.md)）:

> A Durable Object's life is a sequence of **incarnations** separated by eviction events.
> The `Workspace` class is constructed in the DO's constructor and holds `#handle`, `#shell`,
> `#readyPromise` in memory. None of those survive an incarnation boundary.

⬜ **未確認: `wrangler dev` のローカル（workerd）で hibernation が同じタイミングで起きるか。**
PRD §3.1 が「ローカルかデプロイか」を記録する方針なのは正しい。T02 はデプロイ側で取るべき。

---

## 16–17. 安定度とパッケージサイズ

### stable 宣言（0.6.0 / [#241](https://github.com/cloudflare/computer/pull/241)）

> `Workspace`, its filesystem, the worker-javascript backend, mounts, agent tools, Git, Assets,
> and Artifacts are now **stable**; `LegacyContainerBackend` is deprecated in favor of
> `ContainerBackend`; the container and worker-shell backends, `ws:container`, sync, and
> `computerd` stay **experimental**.

→ 検証対象（fs・永続化・worker-javascript）はちょうど stable 側。記事で「まだ experimental だから」
と逃げると不正確。**experimental なのは container / worker-shell / sync。**

### サイズは単純比較すると誤る

```sh
curl -s https://registry.npmjs.org/@cloudflare%2Fcomputer/0.6.0 | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print(d['dist']['unpackedSize'], d['dist']['fileCount'])"
```

| | unpackedSize | fileCount | dependencies |
| --- | ---: | ---: | --- |
| `@cloudflare/shell@0.5.0` | 485,684 (486 KB) | 21 | `isomorphic-git`, `@cloudflare/codemode` |
| `@cloudflare/computer@0.6.0` | 11,578,920 (**11.6 MB**) | 139 | `capnweb` のみ |
| `@cloudflare/think@0.21.0` | 2,478,774 | 58 | — |

**24 倍。……だが、これをそのまま書くと嘘になる。** 中身を見ると:

| ファイル | サイズ |
| --- | ---: |
| `dist/backends/worker-shell/shell/core.js` | 1.79 MB |
| `dist/backends/worker-shell/shell/html-to-markdown.js` | 0.56 MB |
| `dist/shared-BnmH5k4S.js` | 0.55 MB |
| **`dist/index.js`（Workspace 本体）** | **0.25 MB** |
| `dist/backends/worker-javascript/index.js` | 0.25 MB |

対する `@cloudflare/shell` の `dist/index.js` は **36.8 KB**。

→ **サブパス export（31 個）で切られているので、`Workspace` だけ import すれば 11.6MB は入らない。**
   正しい比較は「コアエントリ 36.8KB → 256KB（約 7 倍）」。
   Workers のバンドル上限に効くのは後者。

> ⚠️ **二次ソースの数字をそのまま信じない、の実例。** ここは自分で `du` して気づいた。

---

## 計測（自分で取った一次ソース）

### 実行環境

- macOS 25.5.0 (Darwin) / Apple Silicon
- 計測日 2026-10-21
- `npm view` ではなく registry API を直接叩いた
  （このリポジトリはルートの `devEngines.packageManager: bun` で `npm view` が `EBADDEVENGINES` になる）

### バージョン表（検証用のピン留め）

```sh
curl -s https://registry.npmjs.org/@cloudflare%2Fcomputer | python3 -c \
  "import json,sys; d=json.load(sys.stdin); t=d['time']; \
   print([(v,t[v][:10]) for v in sorted(d['versions'],key=lambda v:t[v])][-6:])"
```

| パッケージ | 初版 | 最新（調査時点） | 公開日 |
| --- | --- | --- | --- |
| `@cloudflare/shell` | 2026-03-13 | **0.5.0** | 2026-10-20 |
| `@cloudflare/computer` | 2026-07-29 | **0.6.0** | 2026-10-20 |
| `@cloudflare/think` | 2026-03-18 | **0.21.0** | 2026-10-20 |
| `agents` | — | **0.29.0** | 2026-10-20 |

**旧環境／新環境の組み合わせ（依存関係から確定）:**

| | 旧 | 新 |
| --- | --- | --- |
| `@cloudflare/think` | `0.20.2`（2026-10-09） | `0.21.0`（2026-10-20） |
| Workspace | `@cloudflare/shell@^0.4.3` — **think の直接依存**（自分で入れない） | `@cloudflare/computer@^0.5.1` — **peer（自分で入れる）** |
| `agents` | `0.28.1` | `0.29.0` |

```sh
curl -s https://registry.npmjs.org/@cloudflare%2Fthink/0.20.2 | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print(d['dependencies']); print(d['peerDependencies'])"
```

→ **0.20.2 では shell が dependencies、0.21.0 では computer が peerDependencies。**
   「アップデートしたら Workspace が空になった」が起きる構造がここに出ている:
   旧は勝手に入っていたものが、新は自分で入れるものに変わった。

### パッケージ実測

```sh
curl -sL <tarball> -o pkg.tgz && tar -xzf pkg.tgz -C dir/
du -sh dir/package
find dir/package -type f -not -name "*.map" -exec ls -l {} + | sort -k5 -rn | head
```

結果は上記「16–17」の表。

### まだ測っていない（harness 行き）

永続化・移行・ベンチはすべて実 Workers / Durable Objects が要る。`sandbox/` で取る。

---

## 未確認・積み残し

- [ ] **#13** 4MB ファイルが旧 Shell（R2 なし）で本当に失敗するか。境界（1.5MB / 2MB）も
- [ ] **#14** 新 Workspace 書き込み後に古い `@cloudflare/computer` へ戻すと `EIO` になるか
- [ ] **#18** 同時書き込み（PRD T12）。`vfs_meta.rev` は single-writer 前提と doc にある
      （*"deliberately single-writer, and adding concurrent mutators would require revisiting it"*）
- [ ] `wrangler dev` ローカルで DO の hibernation が 10 秒で起きるか（本番と同じか）
- [ ] 新 Workspace の `vfs_*` テーブルが**いつ**作られるか（constructor か初回 fs 操作か）。
      T03 の「新テーブルが作成される」の観測タイミングに効く
- [ ] 同一バイト列を 2 パスに置いたとき `vfs_blobs` が 1 行で済むか（重複排除の実測）
- [ ] 旧 `/workspace/fetched/` 等 Think の予約パスと旧ファイルが衝突したときの挙動
- [ ] `just-bash` は computer 0.6.0 から optional peer（[#239](https://github.com/cloudflare/computer/pull/239)）。
      worker-shell backend を使うなら手で入れる。T13 をやるなら必要

## 探したが取れなかったもの / 気づいたドキュメントの穴

- **二次ソースが一本も無い。** 日英どちらで検索しても、この移行（2026-10-20）を扱った
  解説記事・参加レポートの類は見つからなかった。Changelog が出て 1 日なので当然だが、
  **逆に言えば日本語の先行記事がゼロ。** そこが記事の価値になる。
  - 検索語: `@cloudflare/computer @cloudflare/shell deprecated migration` /
    `Cloudflare Agents Think workspace @cloudflare/computer 移行 検証`
  - 引っかかるのは [発表ブログ（2026-08-03）](https://blog.cloudflare.com/cloudflare-computer/) と
    その翻訳・要約まとめサイトばかり
- **発表ブログは `@cloudflare/shell` に一切言及していない。** Computer 単体の紹介
  （「エージェントに必要なのはコンテナではなくコンピュータ」「コンテナが要るのは仕事の 10% 未満に」）で、
  移行の話は 10 月まで出てこない。**ブログを根拠に移行を語らないこと。**
  - なおブログのサンプルは `new Workspace({ storage: this.ctx.storage, useThink: true })` だが、
    **`useThink` は computer 0.6.0 で削除されている**（[#255](https://github.com/cloudflare/computer/pull/255)）。
    8 月のブログのコードはもう動かない。アーカイブとして引用するなら日付を添える
- **ドキュメントの食い違い 3 件**（記事では触れず、references に残すだけでもよい）:
  1. Changelog 散文の `JavaScriptWorkerBackend` → 正しくは `WorkerJavaScriptBackend`
  2. `docs/think/index.md` の依存表が `ai` を「Vercel AI SDK v6」としているが、
     `@cloudflare/think@0.21.0` の peerDeps は `"ai": "^7.0.0"`。**v7 を入れる**
  3. ロールバック不可（`schema_version > 10` で `EIO`）がユーザー向けドキュメントに無い
- `cloudflare/computer` は GitHub Releases にタグが `v0.1.1` までしか無く、
  以降は `@cloudflare/computer@0.6.0` 形式。`tags` API だけ見ると古く見える。**releases を見る**
