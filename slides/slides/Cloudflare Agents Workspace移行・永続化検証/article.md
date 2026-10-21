---
published: false
summary: Cloudflare AgentsのWorkspaceを移行して測ってみる
---

# Cloudflare AgentsのWorkspaceが刷新されたので、移行して全部測ってみた。保存の形が変わると何が変わるのか

> 違うのは、テーブル名ではありませんでした

## この記事の結論

2026年10月20日、Cloudflare Agents の Workspace が `@cloudflare/shell` から `@cloudflare/computer` に切り替わりました。変わったのは API の名前ではなく、**ファイルの持ち方**です。旧はパス1本につき1行で、中身を同じ行に base64 で持っていました。新は inode とチャンクに分けて、512 KiB ごとの content-addressed な blob に置きます。

実際の Durable Object に新旧を同居させて、移行の前後を1件ずつ突き合わせました。

- **テーブルが別なので、移行せずに切り替えると旧ファイルは見えない。** ただし消えてはいない
- **1行に全部入れるかどうかで、上限も速度も変わる。** 旧は約 6 MiB で頭打ち、1MB の読み書きは 13.5 倍遅い
- **スキーマにバージョンがあるので、前には自動で進むが後ろには戻れない**

| 観点 | 旧 `@cloudflare/shell` | 新 `@cloudflare/computer` |
| --- | --- | --- |
| テーブル | `cf_workspace_<namespace>` | `vfs_*` / `_vfs_*` |
| 1ファイルの表現 | 1行（`path TEXT PRIMARY KEY`） | inode + 512 KiB のチャンク |
| 中身の置き場 | 同じ行の `content` に base64 | sha256 をキーにした blob |
| 実測の上限 | 約 6 MiB（R2 を渡さない場合） | チャンクに割れるので頭打ちなし |
| 1MB の書き込み+読み込み | 87.25ms | 6.45ms |
| 同じ内容を2箇所に置く | 2行ぶん | blob は1行を共有 |
| 古い実装に戻す | できる | `EIO` で開けない |

検証コードはこちらです: https://github.com/tanahiro2010/slides/tree/main/slides/slides/Cloudflare%20Agents%20Workspace%E7%A7%BB%E8%A1%8C%E3%83%BB%E6%B0%B8%E7%B6%9A%E5%8C%96%E6%A4%9C%E8%A8%BC/sandbox

そして、この記事で一番伝えたいことを先に書いておきます。

**新旧の差は、API ではなく保存形式です。** そこさえ押さえれば、移行しないと見えなくなる理由も、ファイルサイズの上限が変わる理由も、速くなる理由も、古い実装に戻せない理由も、すべて同じ1つの変更から導けます。移行ガイドは「テーブルが違うので手でコピーしてください」としか書いていませんが、違うのはテーブル名ではなく構造のほうです。

> この記事は「Cloudflare AgentsのWorkspaceを移行してみる」の登壇内容に、発表で話しきれなかった計測値を足したものです。対象は Cloudflare Agents を使っていて、これから `@cloudflare/computer` に移る人です。

---

## 1. 発端

2026年10月20日、Changelog が出ました。

> Think and Agent Skills now use the workspace from `@cloudflare/computer` as well as the filesystem tools.
> `@cloudflare/shell` is deprecated, and so is Think's `createExecuteTool`. These will no longer be developed nor supported from today onwards.

同じ日に `@cloudflare/think@0.21.0`、`@cloudflare/computer@0.6.0`、`agents@0.29.0` が公開されています。`@cloudflare/shell` も同日に `0.5.0` が出ていて、これが非推奨を告知するリリースです。npm の deprecated フラグは過去のバージョンにも遡って付くので、`0.4.3` を見ても同じ警告が出ます。

移行ガイド自体はもう少し前、10月14日の PR #2564 で入っていました。発表と同時にガイドが出たわけではありません。

そして Changelog にはこう書いてあります。

> This is a breaking change. `@cloudflare/computer` stores files in different tables from `@cloudflare/shell`, and there is no automatic data migration between workspace formats.

「テーブルが違う」。ここが出発点です。どう違うのかを見ていきます。

## 2. 旧 Workspace は、1ファイル1行だった

Workspace はエージェントのファイル置き場です。モデルが `read` `write` `edit` `ls` で触り、実体は Durable Object の SQLite に載っています。

旧 `@cloudflare/shell` の定義は移行ガイドに載っています。

```sql
CREATE TABLE cf_workspace_default (
  path             TEXT PRIMARY KEY,
  parent_path      TEXT NOT NULL,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL CHECK(type IN ('file','directory','symlink')),
  mime_type        TEXT NOT NULL DEFAULT 'text/plain',
  size             INTEGER NOT NULL DEFAULT 0,
  storage_backend  TEXT NOT NULL DEFAULT 'inline' CHECK(storage_backend IN ('inline','r2')),
  r2_key           TEXT,
  target           TEXT,
  content_encoding TEXT NOT NULL DEFAULT 'utf8',
  content          TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  modified_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
```

素直です。パスが主キーで、メタデータも中身も同じ行に乗っています。`content` にはファイルの中身が入り、バイナリなら base64 です。

大きいファイルだけ別扱いになります。既定の閾値は 1,500,000 バイトで、これを超えると R2 に逃がし、行には `r2_key` だけ残ります。R2 を渡していない場合は警告を出して、そのまま inline に入れます。

```js
if (size >= this.threshold && !r2)
  console.warn(`[Workspace] File ${path} is ${size} bytes but no R2 bucket was provided. Storing inline.`);
```

この「1行に全部入れる」という性質が、後で響いてきます。

## 3. 新 Workspace は、inode とチャンクに分かれている

新 `@cloudflare/computer` はテーブルを分けます。

| テーブル | 持つもの |
| --- | --- |
| `vfs_dirents` | 親 inode + 名前 → 子 inode |
| `vfs_nodes` | inode のメタデータ（type / mode / mtime / size / link_target） |
| `vfs_chunks` | inode + 何番目のチャンクか → blob の sha256 |
| `vfs_blobs` | sha256 → サイズと最終参照時刻 |
| `vfs_blob_bytes` | sha256 → 実バイト列 |
| `vfs_meta` | `schema_version` とリビジョンカウンタ |

パスの解決は `vfs_dirents` をルート（inode = 1）から辿る形です。ファイルの中身は 512 KiB ごとに切られ、それぞれが sha256 をキーにした blob として `vfs_blob_bytes` に入ります。

```js
const CHUNK_SIZE = 524288;
```

名前が `vfs_` と `_vfs_` で始まるので、`cf_workspace_*` とは衝突しません。移行の最中は両方が並んで存在できます。

ここから先は、この構造の違いから何が導けるかを1つずつ測りました。

## 4. 帰結①：切り替えても、旧ファイルは見えない

同じ Durable Object の上に新旧を並べました。別の DO namespace に分けると「同じストレージを使った移行」になりません。1つのクラスの中で切り替えています。

旧で13個書いてから、新を構築して読みます。

```
対照: 旧から読む                → {found: true, length: 23}
新 Workspace を構築
新から読む /workspace/notes.md  → ENOENT no such file
新から読む /notes.md            → ENOENT no such file
新側のツリー                    → [{path: "/workspace", type: "dir"}]
```

新からは見えません。

ここで止めると「データが消えた」という記事になります。早い。そして違います。

### 対照を2本置く

「新から見えない」だけでは、そもそも書き込みが失敗していた可能性と区別できません。同じ run の中で、旧 Workspace から読めることを切り替えの前後で確認しました。

```
切り替え前に旧から読む          → {found: true, length: 23}
切り替え後に旧から読む          → {found: true, length: 23}
cf_workspace_default の行数     → 14（切り替え前と同じ）
```

切り替えた後も旧からは読めます。行数も減っていません。

消えてはいない。読みに行く先が変わっただけです。テーブル一覧を見ると、両方が同居しています。

```
cf_workspace_default
computer_execution_runtime
sqlite_sequence
vfs_blob_bytes   vfs_blobs    vfs_changes   vfs_chunks
vfs_dirents      vfs_manifests  vfs_meta    vfs_nodes
_vfs_fetch_cursor  _vfs_mounts  _vfs_push_cursor
_vfs_sync_operations  _vfs_sync_skips  _vfs_watermark
```

ついでに1つ分かりました。`vfs_*` は `new Workspace()` を呼んだ時点で全部作られます。最初の `fs` 操作を待ちません。`schema_version` は `10` でした。

## 5. 帰結②：1行に入れるかどうかで、上限が変わる

旧はファイルの中身を base64 にして1つのセルに入れます。4MB のファイルなら base64 で 5,592,408 文字です。

一方、Durable Objects の Limits ページにはこう書いてあります。

| 項目 | 記載値 |
| --- | --- |
| Maximum string, `BLOB` or table row size | 2 MB |
| Key size（KV） | Key and value combined cannot exceed 2 MB |

2 MB を超えるので、4MB のファイルは旧 Shell に保存できないはずでした。ベンチマークの設計でそう予測して、1KB・100KB・1MB・4MB を並べました。

通りました。

予測が外れました。

```
4MB → storage_backend=inline, content_encoding=base64,
      content_len=5,592,408 → 読み戻しの SHA-256 も一致
8MB → Error: string or blob too big: SQLITE_TOOBIG
```

ローカルの miniflare でも、デプロイした本番の Durable Object でも同じです。

### 計測：本当の上限はどこか

段階的なプローブで止めると実装の定数が見えないので、ライブラリを通さず `ctx.storage.sql` と `ctx.storage.kv` を直接叩いて境界を詰めました。プローブごとに新しい Durable Object を使っています。

```
通る最大  8,388,627 バイト
落ちる最小 8,388,628 バイト
```

8 MiB は 8,388,608 です。TEXT も BLOB も KV の値も、同じところで落ちます。

ドキュメントの 2 MB とは4倍ちがいます。新しい Durable Object で境界の前後だけを叩き直して、同じ結果になることも確認しました。この件は [cloudflare-docs#34502](https://github.com/cloudflare/cloudflare-docs/issues/34502) に出しています。2 MB が保証値で 8 MiB が実装の緩さ、という可能性を潰せていないので、数値を断定する PR にはせず、参考ブランチを添えるだけにしました。

### 考察：なぜ旧だけ 6 MiB で止まるのか

旧 Shell 自身の境界は、素の SQL より低いところにありました。

```
shell.writeFileBytes が通る最大  6,291,408 バイト（base64 8,388,544 文字）
落ちる最小                       6,291,409 バイト（base64 8,388,548 文字）
```

base64 が 4/3 に膨らむので、ファイルとしては約 6 MiB が上限です。

ただし、なぜ素の SQL（8,388,627）より手前で落ちるのかは分かりませんでした。Shell の DDL、インデックス、INSERT 文、`ON CONFLICT DO UPDATE` 句、そして Shell が実際に作る base64 文字列まで完全に複製して同じ Durable Object で流しても、**素の SQL は通ります。** UPSERT が `excluded` で値を二重に持つのではないかという仮説も立てましたが、行が既にある状態の UPSERT も同じサイズで通りました。

スタックトレースは Shell の INSERT を指しています。

```
Error: string or blob too big: SQLITE_TOOBIG
  at Object.run (index.js:367:17)
  at Workspace.writeFileBytes (index.js:652:22)
```

ここは諦めました。実用上は「旧 Shell に R2 を渡さない場合、ファイルは約 6 MiB が上限」と覚えておけば足ります。

新 Computer は 512 KiB のチャンクに割るので、この壁がありません。8MB も 16MB も 32MB も通りました。チャンク化は速度の工夫に見えますが、変わったのは上限のほうです。

## 6. 帰結③：毎回 base64 に変換するので、遅い

ここで1つ引っかかりました。**Worker の中では `Date.now()` が進みません。** 本番では 4MB の書き込みすら `0ms` と記録されます。ローカルの miniflare では進むので、最初は本番のログを見て目を疑いました。

なので外から測り直しました。同じ操作を60回繰り返すリクエストと、0回で素通しするリクエストを投げて、その差を60で割ります。7回の中央値です。

| サイズ | 旧 Shell | 新 Computer |
| --- | ---: | ---: |
| 1KB | 1.58ms | -0.75ms |
| 100KB | 4.92ms | 0.80ms |
| 1MB | **87.25ms** | **6.45ms** |

1KB と 100KB は結論を出せません。負の値が出ている通り、HTTP の往復のばらつきに埋もれています。

1MB では差が出ました。13.5倍です。旧 Shell は毎回 1MB を base64 に変換して1行に入れ、読むときに戻しているので、その分が乗ります。書きと読みは分離していません。どちらが遅いかまでは言えません。

## 7. 帰結④：content-addressed なので、重複排除が効く

新は blob の主キーが sha256 です。同じバイト列はツリーのどこにあっても1行を共有します。

512 KiB の同じ内容を2つのパスに書いて、`vfs_blobs` の行数を数えました。

```
blobs 初期                    → 0
同じ内容を1パス目             → 1
同じ内容を2パス目             → 1   ← 増えない
対照: 違う内容                → 2   ← 増える
```

対照を置かないと「そもそも blob が増えない実装」と区別できないので、違うバイト列で2行になることも確認しています。

旧はパスごとに `content` を持つので、同じファイルを2箇所に置けば2回分の容量を使います。

## 8. 帰結⑤：メタデータの置き場が無くなった

旧の `FileInfo` は `mimeType` `createdAt` `updatedAt` を持っています。新の `WorkspaceStatResult` はこれだけです。

```ts
{ name, inode, mode, mtime, size, isFile, isDirectory, isSymbolicLink }
```

MIME を読み書きする API が、`workspace.fs` のどこにもありません。時刻も `mtime` の1本だけです。

移行ガイドも「保持されない」と書いています。

> Things the copy does not keep:
> - `created_at` and `modified_at`. Computer stamps the time of the copy.
> - `mime_type`. Computer does not store a MIME type per file.

実測でも、移行後の `mtime` は全件コピー実行時刻になっていました。「保持されない」というより、**新スキーマに置く場所がありません。**

## 9. 帰結⑥：前には進めるが、後ろには戻れない

新はスキーマにバージョンを持ちます。初期化のコードはこうです。

```js
const onDiskVersion = db.one("SELECT v FROM vfs_meta WHERE k = ?", "schema_version")?.v ?? 0;
if (onDiskVersion > 10) throw createWorkspaceError("EIO", `Unsupported workspace filesystem schema version ${onDiskVersion}`);
if (onDiskVersion > 0 && onDiskVersion < 10) runMigrations(db, onDiskVersion, 10);
```

前方への移行は自動です。v1 から v10 まで、マイグレータが9本登録されています。

後方はありません。

実際に古い版をデプロイする代わりに、on-disk の `schema_version` を 11 に書き換えて「このバイナリより新しい DB」を作り、同じ構築経路を通しました。

```
schema_version（現在）        → 10
対照: 同じ版で再構築          → {read: "hello"}
schema_version を 11 に偽装
古いバイナリで開き直す        → EIO Unsupported workspace filesystem schema version 11
schema_version を 10 に戻す
戻したら開けるか              → {read: "hello"}
```

測ったのは「on-disk の `schema_version` がバイナリの対応版より新しいと `EIO` で開けない」ことです。これが「古い版にロールバックできない」を意味するのは、新しい版がスキーマを上げた場合に限ります。過去に9回上げているので、次も上がると見るのが自然です。

移行ガイドにも Changelog にも、この記述はありません。実装ドキュメントの `03_filesystem_schema.md` に1行あるだけです。

> Open() refuses to run if the binary is older than the on-disk `schema_version`.

旧データは残るので、移行に失敗しても最悪は旧テーブルから読み直せます。戻れないほうは取り返しがつきません。

## 10. 移行ガイドのスクリプトを流す

構造の違いは分かりました。実際に移します。

移行ガイドに `copyShellWorkspace()` というコピー用のコードが載っています。旧を `glob("/**")` で歩いて、新の `fs` に書き直すだけのものです。移行先は `/workspace` 配下で、Think もそこを作業ディレクトリとして使います。

手を入れずにそのまま流しました。題材は、UTF-8 の日本語を含むテキスト、ネストしたディレクトリに置いた TypeScript、内容の完全一致を見るための JSON、決定的な疑似乱数で生成した 64KB のバイナリ、中身を持たない空ディレクトリ、そして相対・絶対・ルート超えを撃ち分けたシンボリックリンク4本です。

```
comparison → {
  total: 13, missing: [], typeChanged: [],
  contentMismatch: [], extra: []
}
```

13件すべて存在し、型も変わらず、64KB のバイナリも SHA-256 が一致しています。空ディレクトリも残りました。ローカルの `wrangler dev` でも、デプロイした本番でも同じ結果です。

ハッシュ比較が機能していることも確認しました。1ビットだけ変えたバイト列を用意して、ハッシュが別物になることを見ています。`af2ba40f…` と `73734ea1…` です。比較が不一致を検出できないまま「一致した」と言っても、何も示したことになりません。

スクリプトが暗黙に頼っている前提も確かめました。コードのコメントに「glob returns rows ordered by path, so parents come before children」とあります。これが崩れると `mkdir` の前に `writeFile` が走ります。実測では辞書順でソートされていて、親は必ず子より先に来ていました。

### ハマりポイント：シンボリックリンクだけ、別の扱いが要る

リンクを個別に辿ってみると、1本だけ落ちました。

| リンク | Shell でのリンク先 | 移行後のリンク先 | 辿れるか |
| --- | --- | --- | --- |
| `/links/rel.md` | `../notes.md` | `/workspace/notes.md` | 辿れる |
| `/links/abs.md` | `/notes.md` | `/workspace/notes.md` | 辿れる |
| `/links/dotdot.md` | `/src/../notes.md` | `/workspace/src/../notes.md` | 辿れる |
| `/links/esc.md` | `/../notes.md` | `/workspace/../notes.md` | **ENOENT** |

`/workspace/../notes.md` は `/notes.md` に解決されます。移行先の `/workspace` の外です。

原因はスクリプトの `resolveTarget()` にあります。

```ts
// Shell resolves a relative target against the link's directory and never
// goes above `/`.
function resolveTarget(link: string, target: string): string {
  if (target.startsWith("/")) return target;   // 絶対パスは素通し
  const parts = link.split("/").slice(1, -1);
  for (const part of target.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "" && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}
```

`@cloudflare/shell` の本体（`resolveSymlink`）は、絶対パスも `normalizePath` に通します。`normalizePath` は `..` をルートで止めるので、Shell にとって `/../notes.md` は `/notes.md` です。スクリプトはそれを素通しするので、`/workspace` を前置したときに外へ出ます。

条件は狭いです。相対パスは全件正しく、`.` や `//` を含む絶対パスも、ルートを超えない `..` を含む絶対パスも正しく移ります。崩れるのは「絶対パスで、かつルートより上に登る `..` を含む」場合だけです。

そして、これはエラーになりません。`symlink()` はリンク先を検証せずに保存し、辿るときも例外を投げずルートで止まります。POSIX のダングリングリンクが合法なのと同じです。コピーは正常終了します。

**パス・型・ハッシュの照合では捕まりません。** リンクは存在するので欠落にならず、型は symlink のままなので型違いにもならず、中身を持たないのでハッシュ比較の対象にすら入りません。実際、私の照合スクリプトも `missing: [], contentMismatch: []` を返しました。確かめるなら、辿って読むしかありません。

```ts
await to.fs.readFile(linkPath, "utf8");   // 辿れなければ ENOENT
```

もう1つ、再実行も止まります。

```
1回目の移行  →  ok
2回目の移行  →  EEXIST path exists: /workspace/links/abs.md
```

`mkdir({ recursive: true })` は既存ディレクトリなら黙って返ります。`writeFile` は `exclusive` を指定しない限り上書きします。`symlink(target, path)` には `force` に相当するオプションがなく、パスが既にあれば必ず `EEXIST` を投げます。Node の `fs.symlink` と同じ挙動で、ライブラリ側のバグではありません。

ガイドの `onStart` の例はコピー完了後にフラグを立てるので、途中で落ちるとフラグが立たず、起動のたびに同じリンクで失敗します。張る前に消せば済みます。

```ts
const link = at(entry.path);
if (await to.fs.readlink(link).then(() => true, () => false)) {
  await to.fs.rm(link);
}
await to.fs.symlink(at(target), link);
```

この2点は [cloudflare/agents#2645](https://github.com/cloudflare/agents/issues/2645) に出しました。出す前に重複を調べたら、どちらも過去のレビューで指摘されていました。片方は PR の差し替えで引き継がれず、もう片方は「絶対パスは既に rebase されている」という誤った前提のまま解決済みになっていました。新発見として書かずに済んだのは、調べたからです。

シンボリックリンクを含まない Workspace なら、ここは踏みません。

## 11. 永続化は保たれている

保存形式が変わっても、Durable Object の SQLite に載っている点は同じです。再起動をまたいで残るかを確かめました。

「別のリクエストから読めた」だけでは証拠になりません。同じインスタンスがメモリに残っていて、そこから返しただけかもしれないからです。コンストラクタで `crypto.randomUUID()` を1つ生成して、レスポンスに載せました。値が変わっていれば、新しい incarnation です。

```
                   bootId                                 読めたか
① 書く             1cadfbdd-7595-4879-94c1-43abca4688c0   ok
② 直後に読む        1cadfbdd-7595-4879-94c1-43abca4688c0   ok   ← 同じ
③ 15秒後           e4f5f2ab-3d7d-4389-8e2d-ee32fdd97b02   ok   ← 変わった
④ 150秒後          c602f7f1-c9f6-465e-9b36-0c3259706d64   ok   ← また変わった
```

③と④は別の incarnation から読めています。④の中身には書いたときの古い bootId が入っていたので、同じデータだと示せます。

記録するフィールドは最初から決めておきました。判定を書き戻すための C 番号、再起動の有無を示す `bootId`、ローカルか本番かを示す `env`、ファイルの同一性を示す `sha256` と `size`、操作そのものにかかった時間、そして例外を投げずに結果として持つ `ok` と `error` です。

この対照は実際に仕事をしました。再デプロイ後に読めるかを試したとき、1回目は待たずに読んで成功したのですが、bootId が同じでした。DO は旧コードのままメモリに居座っていて、再起動していません。対照が無ければ「再デプロイしても残る」と書いて終わっていました。15秒待ってから取り直して、bootId が変わったうえで読めることを確認しています。

### 計測：hibernate は何秒か

待ち時間を変えて bootId を見ました。対照は待ち0秒です。

```
待ち(s)   再起動   読めた
     0    しない    ok   ← 対照
     3    しない    ok
     6    しない    ok
     9    しない    ok
    11    する      ok
    13    する      ok
    15    する      ok
```

境界は9秒と11秒の間にあります。ドキュメントの「無活動10秒で hibernate」と一致しました。

## 12. 移行する前にやること

- **シンボリックリンクがあるか数える。** `glob("/**")` して `type === "symlink"` を数えるだけです。0本なら公式スクリプトをそのまま使って構いません
- **リンクがあるなら、移行後に辿って読む。** パス・型・ハッシュの照合では捕まりません
- **6 MiB を超えるファイルがないか確認する。** 旧で R2 に逃がしていたなら、移行時も同じ `r2` と `name` を渡します
- **古い実装に戻せない前提でデプロイする。** 新スキーマを一度書いたら、その Durable Object は古い `@cloudflare/computer` では開けません
- **旧データはすぐ消さない。** 旧テーブルは残るので、照合が終わるまで `DROP TABLE` を待ちます

依存の形も変わっています。旧 `@cloudflare/think@0.20.2` では `@cloudflare/shell` が直接依存で、自分でインストールするものではありませんでした。`0.21.0` では `@cloudflare/computer` が peer dependency になります。「上げたら Workspace が空になった」が起きる構造が、ここにそのまま出ています。

## 13. まとめ

変わったのは保存形式です。そこから全部が導けました。

- **テーブルが別** → 移行せずに切り替えると見えない。ただし旧テーブルは残り、旧 Workspace からは読める
- **1行に全部入れる / チャンクに割る** → 旧は約 6 MiB で頭打ち。新は 32MB でも通る
- **毎回 base64 に変換する** → 1MB の読み書きで 13.5 倍の差
- **blob が content-addressed** → 同じ内容を2箇所に置いても1行で済む
- **メタデータの列が減った** → `mime_type` と `created_at` は置く場所がない
- **スキーマにバージョンがある** → 前には自動で進み、後ろには戻れない

移行ガイドは「テーブルが違うので手でコピーしてください」としか書いていません。違うのはテーブル名ではなく構造のほうで、そこを見ておくと、移行のときに何を確かめればいいかが先に分かります。

ドキュメントとずれていた点も2つ出ました。Durable Object SQLite の値の上限は 2 MB ではなく 8 MiB でしたし、新スキーマを書いた Durable Object が古い実装で開けないことは、ユーザー向けのどこにも書かれていません。

一番こたえたのは、4MB が通ったところです。公式の数字から予測を立てて、外しました。前提を公式に置いていたぶん、崩れたときに他の予測まで信用できなくなって、上限も速度も結局は自分で測り直しています。移行そのものより、そっちに時間を使いました。

### 参考

- [Think agents now use a @cloudflare/computer workspace](https://developers.cloudflare.com/changelog/post/2026-10-20-think-computer-workspace/) — 切り替えの告知。自動移行が無いことと `createExecuteTool` の非推奨
- [Migrating from @cloudflare/shell to @cloudflare/computer](https://github.com/cloudflare/agents/blob/main/docs/shell/migrating-to-computer.md) — 新旧両方の DDL と、10章で流したコピースクリプト
- [cloudflare/computer docs/03_filesystem_schema.md](https://github.com/cloudflare/computer/blob/main/docs/03_filesystem_schema.md) — `vfs_*` の全テーブル定義。チャンクサイズとスキーマバージョンの扱い
- [Durable Objects — Limits](https://developers.cloudflare.com/durable-objects/platform/limits/) — 行サイズ 2 MB の記載元。5章で突き合わせた相手
- [Durable Objects — Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) — hibernate 10秒、eviction 70〜140秒の出典
- [cloudflare/computer#217](https://github.com/cloudflare/computer/issues/217) / [#219](https://github.com/cloudflare/computer/issues/219) — R2 への書き出しと namespace が未対応であることの自己申告
- [cloudflare/agents#2645](https://github.com/cloudflare/agents/issues/2645) — 10章のシンボリックリンクの件を報告したもの
