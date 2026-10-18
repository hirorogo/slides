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
| 一次ソース | 自分で調べる | 事実確認。`references/primary-sources.md` |

記事は **スライドの各セクションを増量し、技術的側面を足したもの**。
LT で話しきれなかった計測・考察・ハマりどころを書き足す場所であって、
スライドの文字起こしではない。

`<デッキ>/sandbox/` に実装が置いてあることが多い。**実際のコードとログを読む。**
記事に貼るコードは sandbox から引用し、記憶で書かない。

## frontmatter

```yaml
---
published: false            # 書き上がるまで false。true のものだけ公開される
summary: 短い見出し          # 任意。長いタイトルのときだけ
---
```

- **`published` が `true` でない記事は一切出力されない。** 書き忘れ = 非公開に倒れる。
  `slide.md` 側にも同じ `published` があり、こちらはスライドサイトの公開を決める。
  デッキが非公開なら、記事から「スライド版」へのリンクは出ない。
- `slug` / `date` / `title` は基本書かない。`slide.md` から継承される。
  記事側に書けばそちらが優先される。
- `summary` は**一覧と OGP カードの見出し**になる。タイトルの `――` より前で
  十分短いなら不要。付けるのは次のどちらかのときだけ:
  - `――` で切っても長い（目安 30字超）
  - `――` で切ると要点が落ちる（例: `Googleが発表した新Web標準ドラフト――WebMCP…` は
    切ると「WebMCP」が消えるので summary が要る）

## 文体

- **です・ます調。句点 `。` は普通に打つ。** スライド（`slide-creater`）は
  `。` を落とすが、記事は逆。同じ日本語ルールを持ち込まない。
- 挨拶と自己紹介から始めない。「こんにちは。普段は〜」は書かない。
  冒頭は引用のエピグラフ 1 行から入る。
- 短い段落を重ねる。1 段落 1 主張。
- 断定する。「〜かもしれません」を重ねない。確認できていないことは
  **「確認できていません」「推測です」とはっきり書く**（`references/primary-sources.md`）。
- 失敗や未完成を隠さない。動いていないものは「動いていません」と書く。
  うまくいった話より、壊れ方の話の方が読者の役に立つ。

## よくある失敗

- **スライドをそのまま文章にする** — 増量と技術的掘り下げが記事の価値。
- **結論を最後に置く** — 骨格の通り、結論は冒頭。
- **`published: true` のまま書きかけを置く** — 公開されてしまう。
- **`$` を数式のつもりで使う** — 記事には PHP の `$search` や Makefile の
  `$$(seq ...)` が出てくる。数式は `\[...\]` と `\(...\)`。
- **一次ソースを確認せずに歴史や仕様を書く** — 又聞きで断定しない。
