# slides

tanahiro2010 の登壇スライドと記事の原稿、およびそれを配信する 2 つの静的サイト。

| サイト                                                     | 中身         | 公開数 |
| ---------------------------------------------------------- | ------------ | -----: |
| [slides.tanahiro2010.com](https://slides.tanahiro2010.com) | 発表スライド |     21 |
| [blog.tanahiro2010.com](https://blog.tanahiro2010.com)     | 記事         |     12 |

原稿はどちらも `slides/<group>/<名前>/` に同居しています。1 つの発表から
スライドと記事の両方が生まれるので、フォルダを分けていません。

## 構成

```
slides/
├── speakerdeck/<名前>/      Marp で作るデッキ
│   ├── slide.md             スライド原稿
│   ├── article.md           記事原稿
│   ├── draft.md             両方の素材
│   ├── img/                 画像
│   └── sandbox/             記事に出てくる実装
└── slides/<名前>/           ippon-slides で作るデッキ（同じ構成）

apps/
├── slides/                  slides.tanahiro2010.com
└── articles/                blog.tanahiro2010.com

packages/ssg/                両サイトで共有する SSG の足回り
```

bun のワークスペースです。lint / fmt / commit フックの設定はルートの
`vite.config.ts` に集約してあり、`vp check` はルートから走らせます。

## 作り方

### 新しい発表を始める

```sh
python3 main.py --create
```

名前・URL スラッグ・種類（speakerdeck / slides）を聞かれ、雛形一式ができます。
**生成される `slide.md` と `article.md` は `published: false`** です。書き上がったら
`true` にすると公開対象になります。

### スライドを書く

`slide.md` を書きます。Marp のテンプレートと作法は `slide-creater` スキルに
まとまっています。ローカルで HTML / PDF を出すとき:

```sh
make slide '<名前>'          # HTML と PDF を原稿フォルダに出す
python3 main.py --export     # 変更のあったデッキだけ PDF に出す
```

### 記事を書く

`article.md` を書きます。骨格・文体・一次ソースの当たり方は `article-creater`
スキルにまとまっています。要点だけ:

- 冒頭は引用のエピグラフ 1 行から。挨拶と自己紹介は書かない
- `## この記事の結論` を先に置く。結論を最後まで引っ張らない
- `## 1.` のように h2 に連番を振る
- 数式は `\[...\]` と `\(...\)`。**`$` は使わない**（PHP の `$search` などと衝突する）

## ビルドと確認

```sh
cd apps/articles      # または apps/slides
vp run build          # 8 工程をまとめて実行
vp run preview:cf     # workerd で配信して本番に近い状態を見る
```

`vp run build` は `packages/ssg/bin/build.sh` を呼びます。工程ごとに `[n/8]` と
名前が出るので、落ちた場所がログで分かります。アプリごとに違うのは
「本文を生成」の 1 工程だけです。

出力される `dist/` には、ページのほかに `sitemap.xml` / `robots.txt` /
`llms.txt` / `feed.xml` / OGP 画像 / `404.html` が入ります。

## 公開の仕組み

`main` に push すると GitHub Actions が Cloudflare Pages にデプロイします。

- **`published: true` でないものは出力されません。** 書き忘れは非公開に倒れます
- そのサイトの入力が変わっていない push では、ビルドもデプロイも飛ばします
- デッキの HTML は内容ハッシュでキャッシュされ、変わったものだけ作り直します

`CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` の Secrets が必要です。

## 知っておくと困らないこと

- **日付は `slide.md` の `date:` → 無ければ git に入った日**。記事は隣の
  `slide.md` から継承します。`article.md` は雛形として先に作られるので、
  その git 日付は当てになりません
- **CI の checkout は `fetch-depth: 0` が必須**。浅いクローンだと git から
  日付を引けず、全部同じ日になります
- **`slug` は URL になります。** 一度公開したら変えないでください
- 一覧と OGP に出る見出しは `summary` → タイトルの `――` より前、の順で決まります。
  ほとんどのタイトルは後者で足ります

## 使っているもの

Vite+ / React 19（SSG）/ Marp / [ippon-slides](https://github.com/tanahiro2010/ippon-slides) /
markdown-it / Shiki / KaTeX / resvg / Cloudflare Pages
