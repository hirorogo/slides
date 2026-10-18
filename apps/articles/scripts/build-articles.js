// 公開記事を1本ずつ完結した HTML にして dist/articles/<slug>/index.html へ置く。
//
// スライドのデッキと同じ考え方で、本文は React のツリーに載せない。
// 載せると articles.json の中身がまるごとクライアントのバンドルに入ってしまう。
// 記事は読むだけのページなので、静的 HTML を一覧の隣に並べれば足りる。
//
// vp build が dist/ を空にするので、必ずプリレンダの後に実行すること。

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { blogPostingSchema, breadcrumbSchema, renderHead } from "@tanahiro2010/ssg/head";
import { createMarkdown, esc } from "./markdown.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const articlesJson = fileURLToPath(new URL("../src/data/articles.json", import.meta.url));
const articleCss = fs.readFileSync(
  fileURLToPath(new URL("../styles/article.css", import.meta.url)),
  "utf8",
);

const site = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL("../site.config.json", import.meta.url)), "utf8"),
);

const md = await createMarkdown();

const { articles } = JSON.parse(fs.readFileSync(articlesJson, "utf8"));

/** 相対パスの画像を、出力先から見たパスに書き換えつつ実体をコピーする。 */
const copyAssets = (srcDir, outDir) => {
  for (const name of ["img", "images", "assets"]) {
    const from = path.join(srcDir, name);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(outDir, name), { recursive: true });
  }
};

/**
 * 下まで読んだ人が戻れるようにする。
 * 本文が長いので、スクロールしたら右下に「上へ」を出す。
 */
const TOP_BUTTON = `<button type="button" id="to-top" aria-label="ページ上部へ戻る" hidden>&uarr;</button>
<script>
(() => {
  const btn = document.getElementById("to-top");
  const onScroll = () => { btn.hidden = window.scrollY < 600; };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  btn.addEventListener("click", () => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });
})();
</script>`;

const KATEX_LINK = '<link rel="stylesheet" href="/katex/katex.min.css">';

/** KaTeX の CSS とフォントを dist/katex/ に複製する。CDN には頼らない。 */
const copyKatex = () => {
  const from = fileURLToPath(new URL("../node_modules/katex/dist", import.meta.url));
  const to = path.join(distDir, "katex");
  fs.mkdirSync(to, { recursive: true });
  fs.copyFileSync(path.join(from, "katex.min.css"), path.join(to, "katex.min.css"));
  fs.cpSync(path.join(from, "fonts"), path.join(to, "fonts"), { recursive: true });
};

const MERMAID_SCRIPT = `<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
mermaid.initialize({ startOnLoad: true, theme: "neutral" });
</script>`;

const page = (article, body, { hasMermaid, hasMath }) => `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
${renderHead({
  site,
  title: `${article.title} | ${site.title}`,
  description: article.description,
  pathname: article.path,
  type: "article",
  image: article.image,
  publishedAt: article.date,
  modifiedAt: article.updated,
  jsonLd: [
    blogPostingSchema(site, article),
    breadcrumbSchema(site, [
      { name: "Blog", path: "/" },
      { name: article.title, path: article.path },
    ]),
  ],
})}
<style>${articleCss}</style>
${hasMath ? KATEX_LINK : ""}
${hasMermaid ? MERMAID_SCRIPT : ""}
</head>
<body>
<main>
<nav class="article-top">
<a href="/">&larr; 記事一覧</a>
${article.slideUrl ? `<a href="${esc(article.slideUrl)}">スライド版</a>` : ""}
</nav>
<article>
<header class="article-header">
<h1>${esc(article.title)}</h1>
<p class="meta"><time datetime="${esc(article.date)}">${esc(article.date)}</time></p>
</header>
<div class="prose">
${body}
</div>
</article>
<nav class="article-nav">
<a href="/">&larr; 記事一覧</a>
${article.slideUrl ? `<a href="${esc(article.slideUrl)}">スライド版を見る &rarr;</a>` : ""}
</nav>
<footer>© tanahiro2010</footer>
</main>
${TOP_BUTTON}
</body>
</html>
`;

const build = () => {
  if (!fs.existsSync(distDir)) {
    throw new Error("dist/ が無い。vp build とプリレンダの後に実行すること");
  }

  for (const article of articles) {
    const srcDir = path.join(repoRoot, article.dir);
    const outDir = path.join(distDir, "articles", article.slug);
    fs.mkdirSync(outDir, { recursive: true });

    const source = fs.readFileSync(path.join(srcDir, "article.md"), "utf8");
    const markdown = source
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
      // 先頭の `# 見出し` はページ上部に別途出すので本文からは落とす。
      .replace(/^\s*#\s+.+$/m, "");
    const env = {};
    const body = md.render(markdown, env);

    fs.writeFileSync(
      path.join(outDir, "index.html"),
      page(article, body, { hasMermaid: env.hasMermaid, hasMath: env.hasMath }),
    );
    copyAssets(srcDir, outDir);
  }

  copyKatex();
  console.log(`built ${articles.length} article(s) -> dist/articles/`);
};

build();
