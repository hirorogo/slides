# claims — Cloudflare Agents Workspace 移行・永続化検証

| | |
| --- | --- |
| フェーズ | **7（開示）まで完了。** 結果は `results.md` |
| 次 | **8. `slide-creater` → `article-creater`**（軸: 「移行は成功したように見える」） |
| 人間待ち | なし（上流の回答待ちだが、公開はブロックしない方針） |
| 開示 | **4 件すべて提出済み**（下記「上流への報告」）。全件 open・回答待ち |
| 作成日 | 2026-10-21 |
| 対象 | `@cloudflare/shell@0.4.3`+`think@0.20.2` → `@cloudflare/computer@0.6.0`+`think@0.21.0` の永続化・移行・互換性 |
| 実機 | **一部のみ要**（下記「実機が要るもの／要らないもの」で分離済み） |

## 決定事項（Phase 0）

| | |
| --- | --- |
| デプロイ先 | Cloudflare アカウント `tanahiro2010`（個人）。**Account ID はコミットしない**（`.gitignore` 済み） |
| R2 | **使う。** バケット `workspace-migration-lab` 作成済み。再ログインは不要だった |
| スコープ | **P0 + P1 + 新発見 2 件**（T01〜T11 + C18 + C19） |
| 上流報告 | 検証後に判断。重要視する方針 → 証跡を報告可能な形で残す |

---

## 一次資料

**更新日を必ず書く。** どちらを先に疑うかの材料になる。

| 資料 | 種別 | 最終更新 |
| --- | --- | --- |
| [Changelog — Think agents now use a `@cloudflare/computer` workspace](https://developers.cloudflare.com/changelog/post/2026-10-20-think-computer-workspace/) | ベンダー changelog | **2026-10-20** |
| [`docs/shell/migrating-to-computer.md`](https://github.com/cloudflare/agents/blob/main/docs/shell/migrating-to-computer.md) | ベンダー移行ガイド | 2026-10-14（PR #2564） |
| [`docs/think/index.md` §Upgrading to a Computer workspace](https://github.com/cloudflare/agents/blob/main/docs/think/index.md) | ベンダー doc | 2026-10-14 |
| [`docs/think/tools.md`](https://github.com/cloudflare/agents/blob/main/docs/think/tools.md) | ベンダー doc | 2026-10-14 |
| [`computer/docs/03_filesystem_schema.md`](https://github.com/cloudflare/computer/blob/main/docs/03_filesystem_schema.md) | 実装 doc | 2026-10-12 |
| [`computer/docs/11_lifecycle.md`](https://github.com/cloudflare/computer/blob/main/docs/11_lifecycle.md) | 実装 doc | 2026-10-01 |
| [Durable Objects — Limits](https://developers.cloudflare.com/durable-objects/platform/limits/) | ベンダー doc | 2026-06-01 |
| [Durable Objects — Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) | ベンダー doc | 2026-10-15 |
| [blog: Your agent needs a computer, not a container](https://blog.cloudflare.com/cloudflare-computer/) | ベンダーブログ | 2026-08-03 |
| [computer#217](https://github.com/cloudflare/computer/issues/217) / [#218](https://github.com/cloudflare/computer/issues/218) / [#219](https://github.com/cloudflare/computer/issues/219) | 一次（制約の自己申告） | 2026-10-08 |
| `@cloudflare/computer@0.6.0` の `dist/`（実コード） | **一次・最強** | 2026-10-20 |
| `@cloudflare/shell@0.5.0` の `dist/`（実コード） | 一次 | 2026-10-20 |

> ⚠️ **実装 doc（computer/docs/*）はベンダー doc より古い。** 03 は 10-12、11 は 10-01。
> Think の切り替えは 10-20。**実装 doc が切り替えを反映していない可能性**を疑う順番で読む。
> 03 の冒頭には「target design を書いたもので、一部は forward-looking」と自分で断っている。

---

## 主張一覧

PRD の T01〜T13 を、検証可能な単位に割り直した。**元の T 番号は「由来」列に残す。**

| # | 主張 | 出典 | 確かめ方 | 対照 | 実機 | 判定 | 由来 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **C01** | 新 Workspace に書いたファイルは同一リクエスト内で読み戻せる | 自明だが土台 | `writeFile` → `readFile` | — | ローカル可 | ✅ | T01 |
| **C02** | 別リクエストから読める | 移行ガイド | 2 回の HTTP で write / read | 起動識別子が**同じ**こと（= 再起動していない） | ローカル可 | ✅ | T02 |
| **C03** | **DO が再起動しても読める** | Changelog「durable filesystem」 | 15 秒放置 → read | **起動識別子が変わっていること。これが無いと C02 と区別できない** | **要デプロイ** | ✅ **確定** | T02 |
| **C04** | 再デプロイしても読める | 同上 | `wrangler deploy` → 同じ DO 名で read | 起動識別子の変化 | **要デプロイ** | ✅ 1 回目は再起動せず | T02 |
| **C05** | hibernate は無活動 **10 秒** で起きる | DO lifecycle doc | 5/10/15/30 秒で起動識別子を見る | 0 秒（連続）では変わらないこと | **要デプロイ** | ✅ 9s/11s | 📭 |
| **C06** | 旧 Shell のテーブルは `cf_workspace_default` | 移行ガイド | `PRAGMA table_list` / `sqlite_master` | — | ローカル可 | ✅ | T05 |
| **C07** | 新 Computer のテーブルは `vfs_*` / `_vfs_*` | 移行ガイド | 同上 | — | ローカル可 | ✅ v10 | T03 |
| **C08** | 両者は**同じ DO 内で衝突せず共存**できる | 移行ガイド | 旧で書く → 新を構築 → 両テーブルを数える | 旧テーブルの行数が減っていないこと | ローカル可 | ✅ | T05 |
| **C09** | **移行せずに切り替えると旧ファイルが見えない** | Changelog | 旧で `/notes.md` → 新で `/workspace/notes.md` と `/notes.md` を read | **旧 Workspace からは同じ DO で読めること。これが無いと「そもそも書けていなかった」と区別できない** | ローカル可 | ✅ **確定** | **T03（記事の中心）** |
| **C10** | 旧データは物理的には残る | Changelog「the original data will still be present in the existing tables」 | 切り替え後に `SELECT * FROM cf_workspace_default` | 行数・内容が切り替え前と一致 | ローカル可 | ✅ | T05 |
| **C11** | 公式コピースクリプトはテキストを維持して移行できる | 移行ガイド | `/notes.md` → `/workspace/notes.md` 内容一致 | — | ローカル可 | ✅ | T04 |
| **C12** | 階層ディレクトリ構造が維持される | 移行ガイド | `/src/index.ts`, `/data/config.json` | — | ローカル可 | ✅ | T06 |
| **C13** | バイナリがバイト一致で移行できる | 移行ガイド | SHA-256 比較 | **わざと 1 バイト変えた対照で不一致になること**（ハッシュ比較が効いている証明） | ローカル可 | ✅ 対照も実施 | T07 |
| **C14** | シンボリックリンクはリンク先を保って移行できる | 移行ガイド `resolveTarget()` | 絶対・相対・`..` 付きの 3 種 | 移行前に Shell 側で `readlink` した値 | ローカル可 | ❌ **確定** | T08 |
| **C15** | **空ディレクトリが維持される** | 移行ガイド（`entry.type === "directory"`） | `/empty/` を作って移行 | Shell 側 `glob("/**")` に `/empty` が出ること | ローカル可 | ✅ | T06 |
| **C16** | 移行を**フラグ無しで 2 回**流しても壊れない | 移行ガイド（フラグを勧めるが、2 回目の挙動は書いていない） | `copyShellWorkspace()` を直接 2 回 | 1 回目が成功していること | ローカル可 | ❌ **確定** | T09 |
| **C17** | `shellMigrated` フラグで 2 回目がスキップされる | 移行ガイド `onStart` 例 | `onStart` を 2 回起こす | フラグを消すと再実行されること | ローカル可 | ✅ | T09 |
| **C18** | **4MB ファイルは旧 Shell（R2 なし）で保存できない** | **記載なし**（DO 2MB 行上限 + base64 格納からの導出） | 1KB/100KB/1MB/1.4MB/1.6MB/4MB を書く | **同じコードで新 Computer は 4MB が通ること** + 1MB は旧でも通ること | ローカル可（workerd が上限を持つか要確認） | ❌ **doc と違う** 実測 8 MiB | **📭 新発見** |
| **C19** | **新スキーマを書いた DO は古い Computer に戻せない（`EIO`）** | **記載なし**（`initializeSchema()` の `onDiskVersion > 10` throw） | `vfs_meta.schema_version` を 11 に書き換えて再構築 | 10 のままなら正常に開くこと | ローカル可 | ✅ **確定** | **📭 新発見** |
| **C20** | 同一バイト列は `vfs_blobs` 1 行を共有する（重複排除） | schema doc「Identical bytes anywhere in the tree share one row」 | 同じ 1MB を 2 パスに書いて `COUNT(*) FROM vfs_blobs` | **違うバイト列なら 2 行になること** | ローカル可 | ✅ | 📭 |
| **C21** | 旧 R2 退避ファイルも移行できる | 移行ガイド「pass the same `r2` and `name`」 | 2MB を R2 退避 → 移行 → SHA-256 | R2 を渡さないと `readFileBytes` が失敗すること | **要 R2** | ✅ 対照は不可 | T11 |
| **C22** | サイズ別の書き込み／読み込み速度 | PRD §6 | 1KB/100KB/1MB、各 10 回・中央値 | **HTTP 総時間と Workspace 操作時間を分ける**／ウォームアップ 1 回除外 | **要デプロイ** | ✅ 1MB で 13.5 倍 | T10 |
| **C23** | `created_at` / `modified_at` は保持されない | 移行ガイド | 旧 `FileInfo.createdAt` と新 `stat().mtime` | 移行時刻と一致すること（= コピー時刻が刻まれている） | ローカル可 | ✅ | T04 |
| **C24** | `mime_type` は保持されない | 移行ガイド | 新側に mime を持つ API が無いことを型で確認 + `stat()` | — | **不要**（型で済む） | ✅ 確定 | T04 |
| **C25** | `glob("/**")` は親が子より先に返る | 移行ガイドのコメント「rows ordered by path, so parents come before children」 | 深い木を作って順序を見る | **これが崩れると `mkdir` 前に `writeFile` が走る** | ローカル可 | ✅ | 📭 |

### 1 文を割った箇所

移行ガイドのこの 1 文は **3 つの主張**:

> Computer only runs inside a Durable Object. It takes `ctx.storage`.
> D1, custom `SqlBackend`s, and `InMemoryFs` have no replacement.

| 割った主張 | 確かめ方 | 判定 |
| --- | --- | --- |
| `WorkspaceOptions` は `storage` を取る（`sql` ではない） | 型定義 | ✅（Phase 1 で確認済み） |
| D1 を渡せない | `WorkspaceOptions` に `D1Database` を受ける口が無い | ✅（型に無い） |
| `InMemoryFs` 相当が無い | export 一覧（31 個）に無い | ✅ |

同じく「copy does not keep」は **2 つ**（C23 / C24）に割った。
`created_at` と `modified_at` は**同じ行で一緒に落ちるとは限らない**ので、観測は別々に取る。

---

## ドキュメント同士の矛盾

**実機を叩く前に、読むだけで取れた。** Phase 1 で 3 件。

### 矛盾① Changelog の散文とコードでクラス名が違う

| 箇所 | 書いてあるもの |
| --- | --- |
| Changelog 散文（10-20） | `JavaScriptWorkerBackend` |
| 同ページのコードブロック | `WorkerJavaScriptBackend` |
| 実際の型定義（0.6.0） | **`WorkerJavaScriptBackend`** |

- 実装への影響: 散文をコピーすると import が解決しない
- 判定: **❌ 散文が誤り。確定（Phase 3）。**
  ```
  TS2305: Module '"@cloudflare/computer/backends/worker-javascript"'
          has no exported member 'JavaScriptWorkerBackend'.
  ```

### 矛盾② `ai` のメジャーバージョン

| 箇所 | 書いてあるもの |
| --- | --- |
| `docs/think/index.md` 依存表（10-14） | `ai` = 「Vercel AI SDK **v6**」 |
| `@cloudflare/think@0.21.0` の `peerDependencies` | `"ai": "**^7.0.0**"` |

- 実装への影響: doc 通りに入れると peer 解決に失敗する
- 判定: **❌ doc が誤り。** `ai@7` を入れる
- ⚠️ 日付は doc の方が新しくない（同日）。**新しい方が正しいとは限らないの実例にはならない**ので、記事ではただの誤記として扱う

### 矛盾③ 「R2 未対応」の粒度

| 箇所 | 書いてあるもの |
| --- | --- |
| PRD / Changelog の読まれ方 | 新 Workspace は R2 **未対応** |
| 移行ガイド + #217 | 「大容量ファイルを R2 に**書かない**」「R2 mounts は**読み取り専用**」 |

- つまり **R2 mount は存在する。書けないだけ。**
- 記事で「R2 が使えない」と書くと不正確。**「書き戻せない」が正しい**
- 判定: ⚠️ 用語の問題。実機検証の対象外（mount の read-only 性は今回のスコープ外とする）

---

## 書かれていなかったこと（沈黙）

実測するしかないもの。**一次情報になるので優先度が高い。**

| # | 項目 | なぜ要るか | 測り方 |
| --- | --- | --- | --- |
| S1 | 2MB 行上限に当たったときの**エラーの形** | 「保存できない」が例外なのか無言の切り捨てなのかで被害が違う | C18 で 4MB を書いて例外を捕まえる |
| S2 | **ロールバックできるか** | 移行の最大のリスク。どの doc にも無い | C19。`schema_version` を 11 に偽装して再構築 |
| S3 | `vfs_*` テーブルが**いつ**作られるか | C09 の「新テーブルができる」の観測タイミングに効く | Workspace 構築直後と初回 `fs` 操作後で `sqlite_master` を比較 |
| S4 | フラグ無しで移行を 2 回流したときの symlink | `to.fs.symlink()` が `EEXIST` を投げるかはガイドに無い | C16 |
| S5 | Think 予約パス（`/workspace/fetched/` 等）と旧ファイルの衝突 | 実運用で踏む | 旧側に `/fetched/x` を置いてから移行 |
| S6 | ローカル `wrangler dev` と本番で hibernation が同じか | ローカルで取った C02/C03 が本番の証拠になるか | C05 を両方で測る |
| S7 | 重複排除が実際に効くか | schema doc の主張。ストレージ見積もりに効く | C20 |
| S8 | `glob()` の順序保証 | 公式コピースクリプトが依存している | C25 |

> **S2 と S8 が今回の目玉。** S8 は「公式スクリプトが暗黙に依存している前提」なので、
> 崩れていたら移行ガイド自体のバグになる。

---

## 公式サンプルの検証

**コピーする前に、サンプル自体を疑う。** 今回検証するサンプルは 3 つ。

| サンプル | 出典 | 状態 |
| --- | --- | --- |
| `copyShellWorkspace()` | 移行ガイド | **✅ 型は通る**（`tsc --noEmit` exit 0）。ただし中身に C14 の欠陥 |
| Changelog の `MyAgent` | Changelog | **✅ コードブロックは型 OK** / **❌ 散文のクラス名は存在しない** |
| `onStart` の移行フラグ例 | 移行ガイド | **✅ `storage.kv.get/put` は現行 API** |

チェック項目:

- [x] 型定義と突き合わせた（`glob(): Promise<FileInfo[]>`、`readFileBytes(): Promise<Uint8Array \| null>` — **一致**）
- [x] 実際に `tsc --noEmit` を通した → exit 0
- [x] 本文のルールとサンプルが一致しているか → `root = "/workspace"` 既定値は本文と一致
- [x] 埋め込み値の確認（該当なし。署名・トークンの類は無い）
- [x] **サンプルのロジックを元実装と差分テストした → C14 で 4/16 ズレた**

> ⚠️ Phase 1 で `glob()` に**2 つの別シグネチャ**（`FileInfo[]` と `string[]`）が
> 同じパッケージ内にあることを確認済み。`Workspace` クラスのものは `FileInfo[]` で、
> ガイドは正しい。**grep だけで判断すると間違える箇所。**

---

## 実機が要るもの／要らないもの

**要らない方から先に潰す（Phase 3）。**

### ローカル（`wrangler dev`）で取れる — 18 件

C01, C02, C06, C07, C08, **C09**, C10, C11, C12, C13, C14, C15, C16, C17, **C18**, **C19**, C20, C23, C25

→ **記事の中心（C09）と新発見 2 件（C18 / C19）が全部ローカルで取れる。**
→ 認証情報もブラウザも要らない。Phase 3 でここまで行く。

### 型チェックだけで済む — 1 件

C24（`mime` を持つ API が新側に無い）

### デプロイが要る — 4 件

C03, C04, C05, C22

理由: hibernation / eviction / 再デプロイ / 実ネットワーク往復。
⚠️ **S6 が未解決なので、ローカルで取った C02 を「永続化の証拠」として記事に書かない。**
永続化の主張は C03（起動識別子が変わったうえで読めた）だけに載せる。

### R2 が要る — 1 件

C21。バケット `workspace-migration-lab` は作成済み。

---

## 1 回しか試せない検証

**今回は該当なし。** OAuth のような再認可のコストが無く、DO は名前を変えれば
いくらでも新品が作れる。

ただし**順番の制約はある**:

```
① C08 / C09 / C10（無移行アップデート）  ← 一度移行すると旧状態に戻せない
② C11〜C17, C23, C25（移行）             ← ①の後
③ C19（ロールバック）                     ← 新スキーマを書いた後にしか試せない
④ C18 / C20（サイズ・重複排除）           ← 独立。いつでも
⑤ C03 / C04 / C05 / C22（デプロイ）       ← 放置時間が要るので最後
⑥ 最後にもう一度 C01                      ← ここまでの結果が有効だと示す
```

**DO ID は検証ごとに新しい名前を使う。** 使い回すと①の前提が壊れる。
名前は `t<番号>-<連番>` 形式にして、結果 JSON に必ず記録する。

---

## 記録の方針（Phase 0 で仕込む）

HTTP 往復ではなく **1 ステップ = 1 レコード**で `results/*.json` に落とす。
各レコードに必ず入れるもの:

| フィールド | なぜ |
| --- | --- |
| `claim`（C 番号） | 判定を claims.md に書き戻すため |
| `bootId` | **再起動の有無。C03 の生命線** |
| `doName` | どのインスタンスか（Account ID は入れない） |
| `versions` | `@cloudflare/shell` / `computer` / `think` / `agents` / wrangler / workerd |
| `env` | `local` か `deployed` か（S6 が未解決なので必須） |
| `sha256` / `size` | ファイルの同一性 |
| `durationMs` | 操作自体の時間（HTTP 総時間と別に持つ） |
| `ok` / `error` | **例外を投げずに結果として返す。失敗も観測** |

秘密は入らない（トークンを扱わない検証）。**ただし Account ID と R2 バケット名は
公開リポジトリに出さない**ので、`results/*.raw.json` を `.gitignore` 済み。

---

## 判定記号

| | 意味 |
| --- | --- |
| ⬜ | 未検証 |
| ✅ | 書いてある通りだった |
| ❌ | **書いてあることと違った** |
| ⚠️ | 対照が足りず、まだ結論を出せない |
| 📭 | 書かれていなかった（実測するしかない） |


---

## 上流報告の候補（Phase 7 — 人間の判断待ち）

**セキュリティ案件は無い。** 4 件とも「ドキュメントと実装の食い違い」または
「公式サンプルのバグ」。深刻度を盛らずに整理する。

| # | 内容 | 相手 | 実害 | おすすめ |
| --- | --- | --- | --- | --- |
| R1 | **公式移行スクリプトが絶対かつルート超え `..` のシンボリックリンクを壊す**（C14） | cloudflare/agents | データ移行が静かに壊れる。条件は狭い | **✅ 済 → #2645** |
| R2 | **移行スクリプトの再実行が `EEXIST` で中断**（C16） | cloudflare/agents | ガイド自身が勧める `onStart` 運用で詰まる | **✅ 済 → #2645（R1 と同じ Issue）** |
| R3 | **DO SQLite の行上限が doc 2 MB・実測 8 MiB**（C18） | developers.cloudflare.com | 設計の見積もりが 4 倍ずれる | **出す価値が高い**。数字が明確 |
| R4 | Changelog の `JavaScriptWorkerBackend` 誤記 / `docs/think/index.md` の `ai` v6 表記 / ロールバック不可が未記載 | 各 doc | 小 | まとめて 1 件、または記事で触れるだけ |

判断してほしいこと:

- R1+R2 を Issue にするか（再現コードは `sandbox/` にある）
- R3 を docs に報告するか
- 報告するなら**公開を回答待ちにするか**、先に公開するか
  （セキュリティ案件ではないので、先に公開しても筋は通る）


### 報告の経緯（重複調査で判明）

出す前に既出を調べたところ、**2 件とも過去にレビューで指摘されていた**。
そのまま「新発見」として出していたら既知として閉じられていた可能性が高い。

| | 経緯 |
| --- | --- |
| C14 | PR #2564 で Devin が指摘 → 相対パスのみ修正 → ✅ Resolved 判定。レビュー本文の **「Absolute targets are already rebased by the copy script」が誤り** |
| C16 | PR #2552 で 🔴 指摘 → #2552 が #2559〜#2565 のスタックに差し替えられて closed → **引き継がれず消えた** |

→ Issue は「新発見の報告」ではなく **「過去の判定の訂正」と「引き継ぎ漏れの指摘」** として書き直した。

> **教訓: 既出調査は Issue 本文より先にやる。** 枠組みが変わる。

## 上流への報告（Phase 7 — 完了）

すべて 2026-10-21 に提出。**セキュリティ案件は無く、4 件とも実装とドキュメントの食い違い。**

| # | 内容 | 提出先 | 状態 |
| --- | --- | --- | --- |
| R1+R2 | 公式移行スクリプトの symlink 欠陥 2 件（C14 / C16） | [cloudflare/agents#2645](https://github.com/cloudflare/agents/issues/2645) | open・`documentation` |
| R3 | DO SQL / KV の値上限が doc 2 MB・実測 約 8 MiB（C18） | [cloudflare-docs#34502](https://github.com/cloudflare/cloudflare-docs/issues/34502) | open・`content:edit` |
| R4a | Changelog のクラス名誤記 | [cloudflare-docs#34504](https://github.com/cloudflare/cloudflare-docs/issues/34504) | open・`content:edit` |
| R4a | 同・修正 PR（1 語） | [cloudflare-docs#34500](https://github.com/cloudflare/cloudflare-docs/pull/34500) | open・CODEOWNERS レビュー待ち |
| R4b | `docs/think/index.md` の `ai` が v6 表記 | [cloudflare/agents#2647](https://github.com/cloudflare/agents/issues/2647) | open |

R3 は参考ブランチのみ添付し、PR にはしていない（2 MB が保証値なら修正の向きが逆になるため）:
`tanahiro2010:cloudflare-docs:fix/durable-objects-value-size-limit`

### 回答が返ってきたら

`verify-judge` のとおり、**却下されてもそれは結論の一部**。理由ごと記事に書く。
とくに R3 は「2 MB は保証値で 8 MiB は実装の緩さ」という回答なら、
こちらの観測ではなく**解釈のほうが更新される**。
