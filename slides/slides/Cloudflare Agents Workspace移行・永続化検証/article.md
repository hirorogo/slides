---
published: false
summary: 全部移ったように見えて、リンクだけ壊れていた
---

# Cloudflare AgentsのWorkspaceを移行したら、13件すべて一致したのにリンクだけ壊れていた

> 照合が通ったことは、移行できた証拠になりません

## この記事の結論

2026年10月20日に Cloudflare Agents の Workspace が `@cloudflare/shell` から `@cloudflare/computer` に切り替わりました。自動のデータ移行は無く、公式ドキュメントがコピー用のスクリプトを配っています。それを実際の Durable Object で流して、移行前後を1件ずつ突き合わせました。

- 移行せずに切り替えても**データは消えない**。旧テーブルは残り、旧 Workspace からは読める
- 公式スクリプトは13件すべてを移す。バイナリの SHA-256 まで一致する
- **それでもシンボリックリンクが1本、黙って壊れる**。存在もするし型も合うので、照合では捕まらない

| 検証項目 | 結果 |
| --- | --- |
| 移行せずに切り替え | 新から `ENOENT`／旧テーブルは14行のまま |
| 公式スクリプトでの移行 | 13件一致・欠落 0・内容不一致 0 |
| シンボリックリンク4本 | 3本は成功、1本が `/workspace` の外を指す |
| 移行の再実行 | 2回目が `EEXIST` で中断 |
| DO SQLite の値の上限 | ドキュメント 2 MB → 実測 **8 MiB** |
| 1MB の書き込み+読み込み | 旧 87.25ms → 新 6.45ms |

検証コードはこちらです: `sandbox/`（この記事と同じリポジトリ）

そして、この記事で一番伝えたいことを先に書いておきます。

**移行の検証でパスと型と内容ハッシュを突き合わせても、シンボリックリンクの破損は見つかりません。** リンクは「存在する」ので欠落にならず、「型は symlink のまま」なので型違いにもならず、中身を持たないのでハッシュ比較の対象にすらなりません。壊れているのは指し先だけで、そこは3つのどの軸にも乗っていません。実際、私の照合スクリプトも `missing: [], contentMismatch: []` を返しました。

> この記事は「Cloudflare AgentsのWorkspaceを移行してみる」の登壇内容に、発表で話しきれなかった計測値と調査の過程を足したものです。対象は Cloudflare Agents を使っていて、これから `@cloudflare/computer` に移る人です。

---

## 1. 発端

2026年10月20日、Changelog が出ました。

> Think and Agent Skills now use the workspace from `@cloudflare/computer` as well as the filesystem tools.
> `@cloudflare/shell` is deprecated, and so is Think's `createExecuteTool`. These will no longer be developed nor supported from today onwards.

同じ日に `@cloudflare/think@0.21.0`、`@cloudflare/computer@0.6.0`、`agents@0.29.0` が公開されています。`@cloudflare/shell` も同日に `0.5.0` が出ていて、これが非推奨を告知するリリースです。npm の deprecated フラグは過去のバージョンにも遡って付くので、`0.4.3` を見ても同じ警告が出ます。

移行ガイド自体はもう少し前、10月14日の PR #2564 で入っていました。発表と同時にガイドが出たわけではありません。

そして Changelog にはこう書いてあります。

> This is a breaking change. `@cloudflare/computer` stores files in different tables from `@cloudflare/shell`, and there is no automatic data migration between workspace formats.

自動では移らない。では、移さないまま上げたらどうなるのか。

確かめました。

## 2. Workspace は Durable Object の SQLite に載っている

Workspace は、エージェントがファイルを置く場所です。モデルは `read` `write` `edit` `ls` といったツールでここを触ります。実体は Durable Object の SQLite で、だから DO が落ちてもファイルは残ります。

新旧でテーブルの持ち方がまったく違います。

| | 旧 `@cloudflare/shell` | 新 `@cloudflare/computer` |
| --- | --- | --- |
| テーブル | `cf_workspace_<namespace>` | `vfs_*` / `_vfs_*` |
| ファイルの表現 | パス1本で1行 | inode（`vfs_nodes`）とチャンク（`vfs_chunks`） |
| 中身の置き場 | 同じ行の `content` 列 | 512 KiB ごとの content-addressed blob |
| 大きいファイル | 1.5MB 超は R2 へ退避 | R2 への書き出しは未対応 |

旧は素直です。`path TEXT PRIMARY KEY` があって、`content` にファイルの中身が base64 で入っています。

新は inode を挟みます。`vfs_dirents` が名前から inode を引き、`vfs_nodes` が inode のメタデータを持ち、`vfs_chunks` が 512 KiB ごとのチャンクを指します。チャンクの実体は `vfs_blobs` と `vfs_blob_bytes` に sha256 をキーとして入ります。同じバイト列はツリーのどこにあっても1行を共有します。

この重複排除は実際に効いていました。512 KiB の同じ内容を2つのパスに書いても `vfs_blobs` は1行のままで、違う内容を足すと2行になります。

```
blobs 初期                    → 0
同じ内容を1パス目             → 1
同じ内容を2パス目             → 1   ← 増えない
対照: 違う内容                → 2   ← 増える
```

## 3. 移行せずに切り替えると、どう見えるか

同じ Durable Object の上に新旧の Workspace を並べました。別の DO namespace に分けてしまうと「同じストレージを使った移行」になりません。1つのクラスの中で、リクエストごとにどちらを使うか切り替えています。

旧で13個のファイルを書いてから、新の `Workspace` を構築して読みます。

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

「新から見えない」だけでは、そもそも書き込みが失敗していた可能性と区別できません。同じ run の中で、旧 Workspace から読めることを前後で確認しました。

```
切り替え前に旧から読む          → {found: true, length: 23}
切り替え後に旧から読む          → {found: true, length: 23}
cf_workspace_default の行数     → 14（切り替え前と同じ）
```

切り替えた後も旧からは読めます。行数も減っていません。

消えてはいない。場所が変わっただけです。

テーブル一覧を見ると、両方が同居しています。

```
cf_workspace_default
vfs_nodes  vfs_dirents  vfs_chunks  vfs_blobs  vfs_blob_bytes
vfs_manifests  vfs_meta  vfs_changes
_vfs_watermark  _vfs_fetch_cursor  _vfs_push_cursor  ...
```

名前が被らないので衝突しません。移行ガイドも「両方のテーブルが同じ Durable Object に共存できる」と書いています。

ついでに分かったことが1つ。`vfs_*` は `new Workspace()` を呼んだ時点で全部作られます。最初の `fs` 操作を待ちません。`schema_version` は `10` でした。

## 4. 公式スクリプトを流す

移行ガイドに `copyShellWorkspace()` というコピー用のコードが載っています。旧を `glob("/**")` で歩いて、新の `fs` に書き直すだけのものです。移行先は `/workspace` 配下で、Think もそこを作業ディレクトリとして使います。

手を入れずにそのまま流しました。題材は、UTF-8 の日本語を含むテキスト、ネストしたディレクトリに置いた TypeScript、内容の完全一致を見るための JSON、決定的な疑似乱数で生成した 64KB のバイナリ、中身を持たない空ディレクトリ、そして相対・絶対・ルート超えを撃ち分けたシンボリックリンク4本です。

- テキスト（UTF-8、日本語入り）、JSON、TypeScript
- 64KB のバイナリ
- 空ディレクトリ
- シンボリックリンク4本

結果はきれいでした。

```
comparison → {
  total: 13, missing: [], typeChanged: [],
  contentMismatch: [], extra: []
}
```

13件すべて存在し、型も変わらず、64KB のバイナリも SHA-256 が一致しています。空ディレクトリも残りました。ローカルの `wrangler dev` でも、デプロイした本番でも同じ結果です。

ハッシュ比較が機能していることも確認しました。1ビットだけ変えたバイト列を用意して、ハッシュが別物になることを見ています。`af2ba40f…` と `73734ea1…` です。比較が不一致を検出できないまま「一致した」と言っても意味がないので。

スクリプトが暗黙に頼っている前提も確かめました。コードのコメントに「glob returns rows ordered by path, so parents come before children」とあります。これが崩れると `mkdir` の前に `writeFile` が走ります。実測では辞書順でソートされていて、親は必ず子より先に来ていました。

ここまでなら「移行できました」で終わる話です。実際、私もそう書きかけました。

## 5. それでも1本、読めない

シンボリックリンクを個別に辿ってみました。

| リンク | Shell でのリンク先 | 移行後のリンク先 | 読めるか |
| --- | --- | --- | --- |
| `/links/rel.md` | `../notes.md` | `/workspace/notes.md` | 読める |
| `/links/abs.md` | `/notes.md` | `/workspace/notes.md` | 読める |
| `/links/dotdot.md` | `/src/../notes.md` | `/workspace/src/../notes.md` | 読める |
| `/links/esc.md` | `/../notes.md` | `/workspace/../notes.md` | **ENOENT** |

4本目だけ落ちます。

`/workspace/../notes.md` は `/notes.md` に解決されます。移行先の `/workspace` の外です。

### 原因

公式スクリプトの `resolveTarget()` はこうなっています。

```ts
// Shell resolves a relative target against the link's directory and never
// goes above `/`.
function resolveTarget(link: string, target: string): string {
  if (target.startsWith("/")) return target;   // ← 絶対パスは素通し
  const parts = link.split("/").slice(1, -1);
  for (const part of target.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "" && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}
```

一方、`@cloudflare/shell` の本体（`packages/shell/src/filesystem.ts` の `resolveSymlink`）はこうです。

```js
const resolved = target.startsWith("/")
  ? normalizePath(target)                              // ← 絶対でも正規化する
  : normalizePath(getParent(path) + "/" + target);
```

`normalizePath` は `..` をルートで止めます。空の配列に `pop()` をかけても何も起きないからです。だから Shell にとって `/../notes.md` は `/notes.md` です。

スクリプトは絶対パスを正規化しません。`/../notes.md` がそのまま返り、`at()` で `/workspace` を前置して `/workspace/../notes.md` になります。これを辿ると `/notes.md`。移行されたファイルは `/workspace/notes.md` にあるので、すれ違います。

条件は狭いです。相対パスは全件正しく、`.` や `//` を含む絶対パスも、ルートを超えない `..` を含む絶対パスも正しく移ります。崩れるのは「絶対パスで、かつルートより上に登る `..` を含む」場合だけです。

### なぜ気づけないか

このバグは例外を投げません。

`@cloudflare/computer` の `symlink(target, path)` は、`path` のほうは正規化しますが、**`target` は検証せずそのまま `link_target` 列に入れます**。辿るときも `..` はルートでクランプされるだけで、例外にはなりません。POSIX のダングリングリンクが合法なのと同じです。

結果として、移行は成功したと報告されます。ログには何も残りません。

### ハマりポイント：照合が通っても、移行できたことにならない

私の突き合わせスクリプトは、移行前後でこの3つを比べていました。

1. パスが存在するか
2. 型が変わっていないか
3. ファイルなら SHA-256 が一致するか

このどれにも引っかかりません。リンクは存在するので1番は通ります。型は symlink のままなので2番も通ります。シンボリックリンクは中身を持たないので、3番の比較対象にすら入りません。

だから `missing: [], typeChanged: [], contentMismatch: []` が返りました。壊れているのは指し先だけで、そこを見る軸が無かったからです。

リンクを検証するなら、**実際に辿って中身が読めるか**を見るしかありません。移行後のチェックに1行足すなら、これです。

```ts
await to.fs.readFile(linkPath, "utf8");   // 辿れなければ ENOENT
```

## 6. 2回流すと止まる

移行ガイドは `onStart` で1回だけ流して、終わったらフラグを立てることを勧めています。ではフラグ無しで2回流すとどうなるか。

```
1回目の移行  →  ok
2回目の移行  →  EEXIST path exists: /workspace/links/abs.md
```

`mkdir({ recursive: true })` は既存ディレクトリなら黙って返ります。`writeFile` は `exclusive` を指定しない限り上書きします。`symlink()` だけが違います。

```ts
symlink(target: string, path: string): Promise<void>;
```

`force` に相当するオプションがありません。パスが既にあれば必ず `EEXIST` を投げます。これは Node の `fs.symlink` と同じ挙動で、ライブラリ側のバグではありません。手元の Node v24 でも2回目は `EEXIST` でした。

問題は、ガイドの `onStart` の例がコピー**完了後**にフラグを立てることです。

```ts
async onStart() {
  if (this.ctx.storage.kv.get("shellMigrated")) return;
  const shell = new ShellWorkspace({ sql: this.ctx.storage.sql, name: () => this.name });
  await copyShellWorkspace(shell, this.workspace);   // ← ここで落ちると
  this.ctx.storage.kv.put("shellMigrated", true);    // ← ここに来ない
}
```

途中で落ちるとフラグが立たず、起動のたびに同じリンクで失敗し続けます。シンボリックリンクを含まない Workspace なら冪等なので、この問題は踏みません。

修正は、張る前に消すだけです。

```ts
const link = at(entry.path);
if (await to.fs.readlink(link).then(() => true, () => false)) {
  await to.fs.rm(link);
}
await to.fs.symlink(at(target), link);
```

これと `resolveTarget` の1行を直した版を実際の Durable Object で流して、4本すべてが辿れること、2回流しても落ちないことを確認しました。

## 7. 新発見だと思ったら、2回とも指摘済みだった

Issue を出す前に、重複を調べました。同じ報告が無いかの確認のつもりでした。

無かったのですが、代わりに別のものが出てきました。**この2件は過去のレビューで指摘されています。**

再実行の件は、移行ガイドを最初に書いた PR #2552 でレビューボットが指摘していました。

> 🔴 Interrupted symlink copies block migration retries

この PR は `#2559` から `#2565` のスタックに差し替えられて closed になり、作者のコメントは「Replaced by a cleaner stack」の1行だけです。指摘は引き継がれませんでした。

リンクの件は、実際にマージされた PR #2564 で指摘され、修正され、解決済みとして閉じられています。

> 🟡 Relative links escape the migrated workspace

修正のコメントはこうです。「the script resolves each target the way Shell does (against the link's directory, never above `/`), then moves it under `root`」。相対パスについてはその通りになりました。

そして、レビュー本文にこう書いてありました。

> **Absolute targets are already rebased by the copy script.**

この前提が外れています。絶対パスは rebase されず素通しです。前提が誤っていたので、絶対パスのケースは視界に入らないまま「解決済み」になりました。

調べる前のドラフトは「新しく2件見つけた」という書き出しでした。そのまま出していたら、既知として閉じられていた可能性が高いです。書き直して、「過去の判定の訂正」と「引き継ぎ漏れの指摘」として [cloudflare/agents#2645](https://github.com/cloudflare/agents/issues/2645) に出しました。

## 8. 脇道：ドキュメントの 2 MB は、実測 8 MiB だった

ここから2つ、本筋から外れた話を書きます。移行の作業そのものには効きません。興味が無ければ10章まで飛ばしてください。

旧 Shell はファイルの中身を base64 にして1つのセルに入れます。4MB のファイルなら base64 で 5,592,408 文字です。

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

### 二分探索して詰める

段階的なプローブで止めると実装の定数が見えないので、ライブラリを通さず `ctx.storage.sql` と `ctx.storage.kv` を直接叩いて境界を詰めました。プローブごとに新しい Durable Object を使っています。

```
通る最大  8,388,627 バイト
落ちる最小 8,388,628 バイト
```

8 MiB は 8,388,608 です。TEXT も BLOB も KV の値も、同じところで落ちます。

ドキュメントの 2 MB とは4倍ちがいます。

新しい Durable Object で境界の前後だけを叩き直して、同じ結果になることも確認しました。

### 分からなかったこと

旧 Shell 自身の境界は、これより低いところにありました。

```
shell.writeFileBytes が通る最大  6,291,408 バイト（base64 8,388,544 文字）
落ちる最小                       6,291,409 バイト（base64 8,388,548 文字）
```

base64 の長さで 8,388,548 です。素の SQL は 8,388,627 まで通るのに、Shell 経由だとその手前で落ちます。

Shell の DDL、インデックス、INSERT 文、`ON CONFLICT DO UPDATE` 句、そして Shell が実際に作る base64 文字列まで完全に複製して、同じ Durable Object で流してみました。**素の SQL は通ります。** UPSERT が `excluded` で値を二重に持つのではないかという仮説も立てましたが、行が既にある状態の UPSERT も同じサイズで通りました。

スタックトレースは Shell の INSERT を指しています。

```
Error: string or blob too big: SQLITE_TOOBIG
  at Object.run (index.js:367:17)
  at Workspace.writeFileBytes (index.js:652:22)
```

原因は特定できていません。ここは諦めました。

実用上は「旧 Shell に R2 を渡さない場合、ファイルは約 6 MiB が上限」と覚えておけば足ります。新 Computer は 512 KiB のチャンクに割るので、8MB でも 16MB でも 32MB でも通ります。

ドキュメントの数値のほうは [cloudflare-docs#34502](https://github.com/cloudflare/cloudflare-docs/issues/34502) に出しました。2 MB が保証値で 8 MiB が実装の緩さ、という可能性を潰せていないので、数値を断定する PR にはせず、参考ブランチを添えるだけにしています。

## 9. 脇道：新スキーマを書くと、戻れない

もう1つ脇道です。

`@cloudflare/computer@0.6.0` のスキーマ初期化はこうなっています。

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

移行で怖いのはデータが消えることだと思っていましたが、戻れないほうが怖いと思い直しました。旧データは残るので、最悪でも旧テーブルから読み直せます。戻れないのは取り返しがつきません。

## 10. 永続化と速度

脇道はここまでです。残りの計測を置いておきます。

### 計測：Durable Object が再起動しても読めるか

「別のリクエストから読めた」だけでは永続化の証拠になりません。同じインスタンスがメモリに残っていて、そこから返しただけかもしれないからです。

コンストラクタで `crypto.randomUUID()` を1つ生成して、レスポンスに載せました。値が変わっていれば、新しい incarnation です。

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

9秒と11秒の間。ドキュメントの「無活動10秒で hibernate」と一致しました。

### 計測：速度

ここで1つ引っかかりました。**Worker の中では `Date.now()` が進みません。** 本番では 4MB の書き込みすら `0ms` と記録されます。ローカルの miniflare では進むので、最初は本番のログを見て目を疑いました。

なので外から測り直しました。同じ操作を60回繰り返すリクエストと、0回で素通しするリクエストを投げて、その差を60で割ります。7回の中央値です。

| サイズ | 旧 Shell | 新 Computer |
| --- | ---: | ---: |
| 1KB | 1.58ms | -0.75ms |
| 100KB | 4.92ms | 0.80ms |
| 1MB | **87.25ms** | **6.45ms** |

1KB と 100KB は結論を出せません。負の値が出ている通り、HTTP の往復のばらつきに埋もれています。1MB では差が出ました。13.5倍です。旧 Shell は毎回 1MB を base64 に変換して1行に入れ、読むときに戻しているので、その分が乗ります。

書きと読みは分離していません。どちらが遅いかまでは言えません。

## 11. 移行する前にやること

- **シンボリックリンクがあるか数える。** `glob("/**")` して `type === "symlink"` を数えるだけです。0本なら公式スクリプトをそのまま使って構いません
- **移行後に、リンクを辿れるか確かめる。** パス・型・ハッシュの照合では捕まりません。`readFile` して読めるかを見ます
- **古い実装に戻せない前提でデプロイする。** 新スキーマを一度書いたら、その Durable Object は古い `@cloudflare/computer` では開けません
- **旧データはすぐ消さない。** 旧テーブルは残るので、照合が終わるまで `DROP TABLE` を待ちます

旧 `@cloudflare/think@0.20.2` では `@cloudflare/shell` が直接依存で、自分でインストールするものではありませんでした。`0.21.0` では `@cloudflare/computer` が peer dependency に変わります。「上げたら Workspace が空になった」が起きる構造が、依存の形にそのまま出ています。

## 12. まとめ

- `@cloudflare/shell` から `@cloudflare/computer` への移行で、データは消えません。見えなくなるだけで、旧テーブルは残ります
- 公式スクリプトは13件すべてを移しました。バイナリも空ディレクトリも、階層構造も維持されます
- それでもシンボリックリンクが1本、黙って壊れました。絶対パスでルートより上に登る `..` を含む場合だけです
- 2回流すと `EEXIST` で止まります。ガイドが勧める `onStart` 運用だと、フラグが立たずに失敗し続けます
- この2件は過去のレビューで指摘されていました。片方は PR の差し替えで消え、もう片方は前提の誤りで「解決済み」になっていました
- Durable Object SQLite の値の上限は、ドキュメントの 2 MB ではなく 8 MiB でした
- 新スキーマを書いた Durable Object は、古い実装では開けません

一番刺さったのは5章です。13件すべてハッシュまで一致したのを見て、移行できたと判断しかけました。照合が通ったことは、移行できた証拠になりません。

### 参考

- [Think agents now use a @cloudflare/computer workspace](https://developers.cloudflare.com/changelog/post/2026-10-20-think-computer-workspace/) — 切り替えの告知。自動移行が無いことと `createExecuteTool` の非推奨
- [Migrating from @cloudflare/shell to @cloudflare/computer](https://github.com/cloudflare/agents/blob/main/docs/shell/migrating-to-computer.md) — 新旧両方の DDL と、この記事で検証したコピースクリプト
- [cloudflare/computer docs/03_filesystem_schema.md](https://github.com/cloudflare/computer/blob/main/docs/03_filesystem_schema.md) — `vfs_*` の全テーブル定義。チャンクサイズとスキーマバージョンの扱い
- [Durable Objects — Limits](https://developers.cloudflare.com/durable-objects/platform/limits/) — 行サイズ 2 MB の記載元。8章で突き合わせた相手
- [Durable Objects — Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) — hibernate 10秒、eviction 70〜140秒の出典
- [cloudflare/agents#2645](https://github.com/cloudflare/agents/issues/2645) — 5章と6章の内容を報告したもの
- [cloudflare/computer#217](https://github.com/cloudflare/computer/issues/217) / [#219](https://github.com/cloudflare/computer/issues/219) — R2 への書き出しと namespace が未対応であることの自己申告
