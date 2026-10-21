---
title: Cloudflare AgentsのWorkspaceが刷新されたので移行してみる
description: 〜 保存の形が変わると、何が変わるのか 〜
author: 田中博悠 / tanahiro2010
date: 2026-10-22
slug: cf-workspace-migration
published: false
---

::title::

# Cloudflare AgentsのWorkspaceが刷新されたので移行してみる

〜 保存の形が変わると、何が変わるのか 〜

田中博悠 / tanahiro2010

---

## 田中博悠 / tanahiro2010

- 三田学園高等学校 1年
- GDG Greater Kwansai
- 個人開発で Cloudflare Workers を使ってる

# 移行、こわいです

::right::
![tanahiro2010](./img/tanahiro_hono.jpg)

---

::center size=1.5 bg=white::

刷新

---

::center::

2026年10月20日

---

## Changelog が出ました

- Think と Agent Skills の Workspace が `@cloudflare/computer` に
- `@cloudflare/shell` は非推奨
- 今日からもう開発もサポートもしない

-# Cloudflare Changelog 2026-10-20

---

::center::

Workspaceって何？？

---

## エージェントのファイル置き場

- モデルが `read` `write` `edit` で触る
- 実体は Durable Object の SQLite
- 再起動してもファイルが残る

---

## Changelog にこう書いてあります

> テーブルが違うので、パッケージを替えてもデータは移りません

-# 2026-10-20 Changelog（抄訳）

---

::center::

テーブルが違う

---

::center size=2 bg=blue::

どう違う？？

---

::center size=1.5 bg=white::

構造

---

## 旧は、1ファイル1行でした

```sql
CREATE TABLE cf_workspace_default (
  path     TEXT PRIMARY KEY,
  type     TEXT NOT NULL,
  content  TEXT,          -- 中身がここに入る
  ...
);
```

---

## 素直です

- パスが主キー
- メタデータも中身も同じ行
- バイナリは base64 で `content` へ

---

## 大きいファイルだけ別扱い

- 既定の閾値は 1,500,000 バイト
- 超えたら R2 に逃がして `r2_key` を残す
- R2 が無ければ警告を出して inline のまま

---

::center::

新は、分けます

---

## テーブルが6つ以上に分かれる

- `vfs_dirents` → 親inode + 名前 から 子inode
- `vfs_nodes` → inodeのメタデータ
- `vfs_chunks` → inode から blob の sha256

---

## 中身は512KiBごとのblob

```js
const CHUNK_SIZE = 524288;
```

-# @cloudflare/computer@0.6.0

---

## 1ファイル1行 → inodeとチャンク

- パス解決は `vfs_dirents` をルートから辿る
- 中身は sha256 をキーにした blob
- 名前が被らないので旧と共存できる

---

::center::

ここから全部が導けます

---

::center size=1.5 bg=white::

帰結

---

::center::

帰結① テーブルが別

---

## 移行せずに切り替えると

```
新から読む /workspace/notes.md  →  ENOENT
新から読む /notes.md            →  ENOENT
新側のツリー                    →  /workspace だけ
```

---

::center::

消えた？？

---

## 対照を置きました

- 切り替える前、旧からは読める
- 切り替えた後も、旧からは読める
- `cf_workspace_default` は14行のまま

---

::center::

消えてない

読みに行く先が変わっただけ

---

::center::

帰結② 1行に全部入れる

---

## 4MBのファイルは保存できるか

- 旧は中身をbase64で1セルに入れる
- 4MB → base64で5,592,408文字
- 公式ドキュメントの行上限は **2MB**

---

::center::

入らないはずでした

---

## 入りました

```
4MB → inline / base64 / 読み戻しもSHA-256一致
8MB → SQLITE_TOOBIG
```

---

## 二分探索しました

- `ctx.storage.sql` を直接叩く
- 通る最大 8,388,627 バイト
- 落ちる最小 8,388,628 バイト

---

## 8 MiB でした

- `8388608` が 8 MiB
- TEXT も BLOB も KV値も同じ
- ドキュメントの2MBとは4倍ちがう

-# cloudflare-docs #34502 で報告済み

---

## 旧は約6MiBで頭打ち

- base64が4/3に膨らむ
- 新はチャンクに割るので壁が無い
- 8MBも16MBも32MBも通った

---

::center::

チャンク化は速度の工夫に見えて、

効いているのは上限のほう

---

::center::

帰結③ 毎回base64に変換する

---

## 速度を測りました

- 1MBの書き込み+読み込み1往復
- 旧 87.25ms → 新 6.45ms
- 1KBと100KBは誤差に埋もれて読めない

---

::center::

13.5倍

---

::center::

帰結④ blobがcontent-addressed

---

## 同じ内容を2箇所に置く

```
blobs 初期        → 0
1パス目           → 1
2パス目           → 1   ← 増えない
対照: 違う内容    → 2   ← 増える
```

---

::center::

帰結⑤ メタデータの列が減った

---

## 新の stat が返すもの

```ts
{ name, inode, mode, mtime, size,
  isFile, isDirectory, isSymbolicLink }
```

---

## 置き場所がありません

- 旧は `mimeType` `createdAt` `updatedAt` を持つ
- 新に MIME を読み書きするAPIが無い
- 時刻も `mtime` の1本だけ

---

::center::

帰結⑥ スキーマにバージョンがある

---

## 古い実装で開き直すと

```
schema_version → 10
古い実装で開く → EIO Unsupported workspace
                 filesystem schema version
```

---

## 前には進めます

- v1 から v10 まで、マイグレータが9本
- 上げるのは自動
- 下げる道はない

---

::center::

戻れません

---

## どこにも書いてありません

- 移行ガイドにもChangelogにもない
- 実装ドキュメントに1行だけある
- ユーザー向けの記述ではない

---

::center size=1.5 bg=white::

移行

---

## 公式スクリプトを流します

- 旧を `glob` で歩いて、新の `fs` に書き直す
- 移行先は `/workspace` 配下
- テキスト・バイナリ・空ディレクトリ・リンク4本

-# docs/shell/migrating-to-computer.md

---

## 結果

```
comparison → {
  total: 13, missing: [], typeChanged: [],
  contentMismatch: [], extra: []
}
```

---

## 13件すべて移っています

- 存在する、型も変わらない
- 64KBのバイナリもSHA-256が一致
- 空ディレクトリも残る

---

::center::

リンクだけ、1本辿れません

---

## シンボリックリンク4本の行方

- `../notes.md` → 辿れる
- `/notes.md` → 辿れる
- `/src/../notes.md` → 辿れる
- `/../notes.md` → **ENOENT**

---

## 絶対パスが正規化されていない

```ts
function resolveTarget(link, target) {
  if (target.startsWith("/")) return target;  // ← 素通し
  ...
}
```

---

## Shell 本体は正規化しています

- `normalizePath` が `..` をルートで止める
- だから Shell では `/../notes.md` = `/notes.md`
- 素通しすると `/workspace` の外に出る

---

::center::

エラーにはなりません

---

## 照合では捕まらない

- 存在する → 欠落にならない
- 型は symlink のまま → 型違いにもならない
- 中身が無い → ハッシュ比較の対象外

---

::center::

辿って読むしかない

---

## 2回流すと止まります

```
1回目の移行  →  ok
2回目の移行  →  EEXIST /workspace/links/abs.md
```

---

## symlink だけ冪等じゃない

- `mkdir(recursive)` は黙って通る
- `writeFile` は上書きする
- `symlink()` に `force` が無い

---

## Issueを出しました

- cloudflare/agents #2645
- 出す前に調べたら、2件とも過去に指摘済みだった
- 新発見ではなく、判定の訂正として

---

::center size=1.5 bg=white::

判断

---

## 永続化は効いています

- コンストラクタで起動IDを振って確かめた
- 15秒後・150秒後、IDが変わっても読めた
- 再デプロイをまたいでも残っていた

---

## ちなみに、hibernateは10秒

- 9秒 → 再起動しない
- 11秒 → 再起動する
- ドキュメント通りでした

---

## 移行する前にやること

- シンボリックリンクがあるか数える
- あるなら、移行後に辿って読む
- 古い実装に戻せない前提でデプロイする

---

## まとめ

- 刷新 → shell は非推奨、computer に変わった
- 構造 → パス1行から、inodeとチャンクへ
- 帰結 → 見えない・上限8MiB・13.5倍・戻れない
- 移行 → 13件一致。リンクだけ辿って確かめる
- 判断 → 違うのはテーブル名ではなく構造のほう

---

::center size=1.5::

ありがとうございました

---

::center bg=white::

One more thing

---

::center::

移行ガイドは「テーブルが違う」としか書いていません

---

::center::

違うのは、名前ではなく構造です

---

::center::

そこを見ておくと、

何を確かめればいいかが先に分かります
