---
name: article-creater
description: Use this skill whenever the user asks to write or rewrite an `article.md` in this repository — the long-form write-up that accompanies a deck. Triggers include 「記事を書いて」「記事化して」「Qiita向けにまとめて」「Zennに投稿する記事」「登壇内容を記事に」, or any request to turn a `draft.md` / `slide.md` into prose. Covers the three inputs (draft, slide, primary-source research), the house article structure (epigraph → この記事の結論 → numbered sections), the frontmatter that controls publication, and the Markdown features the build supports. Published examples live at https://blog.tanahiro2010.com.
---

# article-creater

記事は `slides/<group>/<名前>/article.md` に書く。スライドと同じフォルダに同居し、
`slug` と `date` は隣の `slide.md` から継承される。書いた記事は
blog.tanahiro2010.com に出る。

**既存の記事が唯一の正解サンプル。** 迷ったら手元の `article.md` か
https://blog.tanahiro2010.com の公開記事を読んで合わせる（`references/examples.md`）。

## Workflow

1. **入力を3つ揃える。** 揃わないまま書き始めない（詳細は下の「3つの入力」）。
2. `references/structure.md` を読み、骨格に沿って `article.md` を書く。
3. frontmatter を設定する（下の「frontmatter」）。**`published: true` は書き上がってから。**
4. ビルドして確認する:
   ```sh
   cd apps/articles && vp run build
   ```
   `WARN` が出たら直す。数式・mermaid・コードフェンスの扱いは
   `references/markdown.md`。
5. 仕上がりを目で見る。`python3 -m http.server --directory dist` で
   `/articles/<slug>/` を開く。

## 3つの入力

| 入力 | 置き場所 | 何に使うか |
| --- | --- | --- |
| ドラフト | `<デッキ>/draft.md` | 書きたいことの原材料。構成も粒度もまだ荒い |
| スライド | `<デッキ>/slide.md` | 発表で実際に話した順序と、削ぎ落とした後の主張 |
| 調べたこと | `<デッキ>/references.md` | 事実確認。無ければ `references-creater` で作る |

記事は **スライドの各セクションを増量し、技術的側面を足したもの**。
LT で話しきれなかった計測・考察・ハマりどころを書き足す場所であって、
スライドの文字起こしではない。

`<デッキ>/sandbox/` に実装が置いてあることが多い。**実際のコードとログを読む。**
記事に貼るコードは sandbox から引用し、記憶で書かない。

`references.md` は**公開されない作業メモ**。「ここは二次ソースしか無い」
「この資料は読めなかった」が書いてある。**その事情は記事に持ち込まない**
（`references/primary-sources.md` の「取得できなかった事情は本文に書かない」）。
記事に持ち込むのは、調べた**中身**と、内容についての留保だけ。

## frontmatter

```yaml
---
published: false            # 書き上がるまで false。true のものだけ公開される
summary: 短縮タイトル        # 任意。長いタイトルのときだけ
---
```

- **`published` が `true` でない記事は一切出力されない。** 書き忘れ = 非公開に倒れる。
  `slide.md` 側にも同じ `published` があり、こちらはスライドサイトの公開を決める。
  デッキが非公開なら、記事から「スライド版」へのリンクは出ない。
- `slug` / `date` / `title` は基本書かない。`slide.md` から継承される。
  記事側に書けばそちらが優先される。
- **`summary` は短縮タイトルを置く場所。** 一覧と OGP カードはこれを見出しとして
  出すので、本タイトルの短い言い換えを書く。**記事の説明文ではない。**

  | | 例 |
  | --- | --- |
  | ○ | `I/O Extended で WebMCP のハンズオン講師をして、今はまだいらないと思った` |
  | ○ | `底辺作家でも、流行に乗れば舞えるのか` |
  | × | `WebMCP を実装して AI エージェントから呼び出した。結論は今はいらない` |

  × の方は記事の説明になっている。**句点で文を連ねず、タイトルとして読める
  1 フレーズにする。** 要約を書きたくなったら、それは `summary` ではなく
  `## この記事の結論` の仕事。

  本タイトルの主張やオチは落とさない。`底辺作家でも、流行に乗れば舞えるのか` は
  短くしても問いが残っている。

- `summary` を付けるかどうか。タイトルの `――` より前で十分短いなら不要
  （公開 12 本中、付いているのは 2 本だけ）。付けるのは次のどちらかのときだけ:
  - `――` で切っても長い（目安 30字超）、または `――` が無くて長い
  - `――` で切ると要点が落ちる（例: `Googleが発表した新Web標準ドラフト――WebMCP…` は
    切ると「WebMCP」が消えるので summary が要る）

## 文体

- **です・ます調。句点 `。` は普通に打つ。** スライド（`slide-creater`）は
  `。` を落とすが、記事は逆。同じ日本語ルールを持ち込まない。
- 挨拶と自己紹介から始めない。「こんにちは。普段は〜」は書かない。
  冒頭は引用のエピグラフ 1 行から入る。
- 短い段落を重ねる。1 段落 1 主張。
- 断定する。「〜かもしれません」を重ねない。推測は**文末で示す**
  （「〜はずです」「〜のではないでしょうか」）。そこに「これは推測です」を
  足さない。二重になるし、保険を増やすほど文章は弱くなる
  （`references/primary-sources.md`）。
- 失敗や未完成を隠さない。動いていないものは「動いていません」と書く。
  うまくいった話より、壊れ方の話の方が読者の役に立つ。

## よくある失敗

- **スライドをそのまま文章にする** — 増量と技術的掘り下げが記事の価値。
- **結論を最後に置く** — 骨格の通り、結論は冒頭。
- **`published: true` のまま書きかけを置く** — 公開されてしまう。
- **`summary` に記事の説明文を書く** — ここは短縮タイトル。一覧でタイトルとして
  表示されるので、説明文を置くと一覧が崩れる。
- **`$` を数式のつもりで使う** — 記事には PHP の `$search` や Makefile の
  `$$(seq ...)` が出てくる。数式は `\[...\]` と `\(...\)`。
- **一次ソースを確認せずに歴史や仕様を書く** — 又聞きで断定しない。
- **資料 1 本を絶対的な基準にする** — 「あのスライドに書いていないから無い」は
  成り立たない。時期・媒体を変えて複数当たる。
- **取材の裏側を本文に書く** — 「テキスト抽出が崩れて読めなかった」は読者に
  関係がない。書くなら内容への留保だけ。読めなければ検索しまくる。
- **裏が取れなかった考察を丸ごと消して、無難な記事にする** — 逆方向の失敗。
  **予想や推測は載せてよい。** ラベルを付けて残す（`references/primary-sources.md`）。
