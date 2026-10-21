---
title: Cloudflare AgentsのWorkspaceを移行してみる
description: 〜 全部移ったように見えて、壊れていた 〜
author: 田中博悠 / tanahiro2010
date: 2026-10-22
slug: cf-workspace-migration
published: false
---

::title::

# Cloudflare AgentsのWorkspaceを移行してみる

〜 全部移ったように見えて、壊れていた 〜

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

## エージェントのファイルシステム

- モデルが `read` `write` `edit` で触る置き場
- 実体は Durable Object の SQLite
- 再起動してもファイルが残る

---

## パッケージが変わりました

- 旧 → `@cloudflare/shell`
- 新 → `@cloudflare/computer`
- Think 0.20.2 → 0.21.0 で切り替わった

---

::center::

で、データはどうなる？？

---

## Changelog にこう書いてあります

> 自動のデータ移行はありません。既存のWorkspaceを残したいなら、移行ガイドのスクリプトでファイルをコピーしてください

-# 2026-10-20 Changelog（抄訳）

---

::center size=2 bg=blue::

で

---

::center::

コピーしなかったら、

どうなるんでしょう

---

::center size=1.5 bg=white::

消失

---

## 同じDOの上で並べました

- 旧Workspaceで13個のファイルを書く
- そのまま新Workspaceを構築する
- 新から読んでみる

---

## 結果

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

---

## テーブルを覗く

- 旧 → `cf_workspace_default`
- 新 → `vfs_nodes` `vfs_dirents` `vfs_chunks` ...
- 同じDOの中に、両方ある

---

## 見ている場所が違うだけ

- 旧はパス1本で1行
- 新はinodeとチャンクに分かれている
- 名前が被らないので、黙って共存する

---

::center::

データは残る

見えなくなるだけ

---

::center size=1.5 bg=white::

移行

---

## 公式スクリプトがあります

- 移行ガイドにコピー用のコードが載っている
- 旧を `glob` で歩いて、新の `fs` に書き直す
- 移行先は `/workspace` 配下

-# cloudflare/agents docs/shell/migrating-to-computer.md

---

## 流す題材

- テキスト、JSON、TypeScript
- 64KBのバイナリ
- 空ディレクトリ、シンボリックリンク4本

---

## 結果

```
comparison → {
  total: 13, missing: [], typeChanged: [],
  contentMismatch: [], extra: []
}
```

---

## 全部移っています

- 13件すべて存在する
- バイナリもSHA-256が一致
- 空ディレクトリも残っている

---

::center::

完璧じゃないですか

---

::center size=1.5 bg=white::

破断

---

::center::

1本だけ、読めません

---

## シンボリックリンク4本の行方

- `../notes.md` → 読める
- `/notes.md` → 読める
- `/src/../notes.md` → 読める
- `/../notes.md` → **ENOENT**

---

## 何が違うのか

- 絶対パスで、かつルートより上に登るやつ
- `/../notes.md` が `/workspace/../notes.md` になった
- `/workspace` の外を指している

---

## 公式スクリプトのここ

```ts
function resolveTarget(link: string, target: string): string {
  if (target.startsWith("/")) return target;  // ← ここ
  const parts = link.split("/").slice(1, -1);
  ...
}
```

---

## Shell 本体はこうしています

```js
const resolved = target.startsWith("/")
  ? normalizePath(target)              // ← 絶対でも正規化する
  : normalizePath(getParent(path) + "/" + target);
```

---

## 相対だけ直っていた

- `normalizePath` は `..` をルートで止める
- スクリプトは絶対パスを素通ししている
- だから絶対 + ルート超えだけ落ちる

---

::center::

しかも、エラーが出ません

---

## 静かに壊れる

- `symlink()` はリンク先を検証せず保存する
- 辿るときも例外は出ず、ルートで止まるだけ
- コピーは成功したと報告する

---

::center::

自分の照合も、見逃しました

---

## missing: [] の意味

- パスの有無、型、ハッシュを比べていた
- リンクは「存在する」から引っかからない
- 壊れているのは指し先だけ

---

::center::

もう1つあります

---

## 2回流してみる

```
1回目の移行  →  ok
2回目の移行  →  EEXIST path exists: /workspace/links/abs.md
```

---

## symlink だけ冪等じゃない

- `mkdir(recursive)` は黙って通る
- `writeFile` は上書きする
- `symlink()` は必ず EEXIST を投げる

---

## 移行フラグが立ちません

- ガイドは `onStart` で1回だけ流すことを勧めている
- フラグはコピーが終わった後に立てる
- 途中で落ちると、毎回同じ場所で失敗する

---

::center::

新発見だと思いました

---

::center::

違いました

---

## 公式レビューは、2回とも指摘していた

- 再実行の件 → PR #2552 で 🔴 指摘
- リンクの件 → PR #2564 で指摘、修正、Resolved
- どちらも今のドキュメントに残っている

---

## なぜ残ったか

- #2552 は別のPRスタックに差し替えられて closed
- 指摘が引き継がれなかった
- リンクの件は「相対」だけ直って閉じた

---

## レビューの前提が外れていた

> Absolute targets are already rebased by the copy script.

-# cloudflare/agents #2564 のレビューコメント

---

## Issueを出しました

- cloudflare/agents #2645
- 新発見ではなく、判定の訂正として
- 修正は2行、ブランチも添えた

---

::center::

調べてから書いてよかった

---

::center size=1.5 bg=white::

余談

---

::center::

ここからは脇道です

---

## 4MBのファイルは保存できるか

- 旧Shellは中身をbase64で1セルに入れる
- 4MB → base64で5.6MB
- 公式ドキュメントの行上限は **2MB**

---

::center::

入らないはずでした

---

## 入りました

```
4MB → inline / base64 / content_len 5,592,408 → 読み戻し一致
8MB → SQLITE_TOOBIG
```

---

## 二分探索しました

- ライブラリを通さず `ctx.storage.sql` を直接叩く
- 通る最大 8,388,627 バイト
- 落ちる最小 8,388,628 バイト

---

## 8 MiB でした

- `8388608` が 8 MiB
- TEXT も BLOB も KV値も同じ
- ドキュメントの2MBとは4倍ちがう

-# cloudflare-docs #34502 で報告済み

---

::center::

ドキュメントを信じて予測して、外しました

---

::center::

もう1つ、脇道

---

## 新スキーマを書いた後

```
schema_version → 10
古い実装で開き直す → EIO Unsupported workspace
                     filesystem schema version
```

---

## 前には進めます

- v1 から v10 まで、マイグレータが9本ある
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

判断

---

## 永続化は、ちゃんと効いています

- コンストラクタで起動IDを振って確かめた
- 15秒後・150秒後、IDが変わっても読めた
- 再デプロイをまたいでも残っていた

---

## ちなみに、hibernateは10秒

- 9秒 → 再起動しない
- 11秒 → 再起動する
- ドキュメント通りでした

---

## 速度も測りました

- 1MBの書き込み+読み込み1往復
- 旧 87.25ms → 新 6.45ms
- 1KBと100KBは誤差に埋もれて読めない

---

## 移行する前にやること

- シンボリックリンクがあるか数える
- 移行後に、リンクを辿れるか確かめる
- 古い実装に戻せない前提でデプロイする

---

## まとめ

- 刷新 → shell は非推奨、computer に変わった
- 消失 → 消えてはいない。見えなくなるだけ
- 移行 → 公式スクリプトで13件すべて一致した
- 破断 → それでもリンク1本が静かに壊れていた
- 余談 → 上限は8MiBだった。そして戻れない
- 判断 → 照合はハッシュだけでは足りない

---

::center size=1.5::

ありがとうございました

---

::center bg=white::

One more thing

---

::center::

移行は、成功したように見えました

---

::center::

13件すべて、ハッシュまで一致していました

---

::center::

壊れていたのは、指し先だけです

---

::center::

照合が通ったことは、

移行できた証拠になりません
