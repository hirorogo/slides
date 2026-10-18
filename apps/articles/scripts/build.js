// articles.json（記事一覧のメタデータ）を作る。
//
// 記事は slides/<group>/<名前>/article.md に、スライドと同じフォルダで同居している。
// slug / title / date は隣の slide.md と同じ規則で決まるので、article.md 側の
// frontmatter に書くのは基本 `published: true` だけでよい。
//
// published が true でないものは一切出力しない（書き忘れ＝非公開に倒す）。

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeDate, readDocMeta } from "@tanahiro2010/ssg/frontmatter";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const outFile = fileURLToPath(new URL("../src/data/articles.json", import.meta.url));
const site = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL("../site.config.json", import.meta.url)), "utf8"),
);

const GROUPS = ["slides/slides", "slides/speakerdeck"];

const isPublished = (value) => String(value).trim().toLowerCase() === "true";

/** 隣の slide.md が公開されているか。非公開ならスライドへのリンクを出さない。 */
const isPublishedSlide = (dir) => {
  const file = path.join(dir, "slide.md");
  if (!fs.existsSync(file)) return false;
  const fm = fs.readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return Boolean(fm && /^published:\s*true\s*$/m.test(fm[1]));
};

/**
 * 隣の slide.md のメタ情報。slug と date はデッキから借りる。
 *
 * article.md は main.py がプロジェクト作成時に空ファイルとして置くので、
 * その git 追加日は「記事を書いた日」でも「登壇した日」でもない。
 * 実際、登壇より前の日付になっているものもある。
 */
const slideMetaOf = (repoRoot, relDir, folder, dir) => {
  const file = path.join(dir, "slide.md");
  if (!fs.existsSync(file)) return { frontmatter: {} };
  return readDocMeta({ repoRoot, relDir, folder, file });
};

/**
 * 一覧と OGP カードに出す見出し。
 *
 * ほとんどのタイトルは `――` の前だけで十分短い。それでも長い、あるいは
 * `――` で切ると要点が落ちるものだけ、frontmatter に summary を書く。
 */
const displayHeading = (title, summary) => summary || title.split("――")[0].trim() || title;

/** 本文先頭の `# 見出し` をタイトルに使う。 */
const headingOf = (md) => {
  const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const h1 = body.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : "";
};

/** 日本語は単語で区切れないので、タグを除いた文字数を語数の代わりにする。 */
const countWords = (md) =>
  md
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, "").length;

/** 見出しからキーワードを拾う。手で書いた keywords があればそちらを優先。 */
const keywordsOf = (md, fm) => {
  if (fm.keywords)
    return fm.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  const heads = [...md.matchAll(/^##\s+(.+)$/gm)].map((m) =>
    m[1]
      .replace(/[*_`[\]()#]/g, "")
      // 「1. 発端：〜」のような採番は見出しの飾りなのでキーワードから外す。
      .replace(/^\s*(?:\d+[.)]|Step\s*\d+[:：]?)\s*/i, "")
      .trim(),
  );
  return [...new Set(heads.filter((h) => h.length >= 3))].slice(0, 10);
};

/**
 * 冒頭の段落をつないで説明文にする。
 *
 * 1段落目だけだと「こんにちは。」で終わってしまう記事が多いので、
 * 検索結果で意味が通る長さになるまで続けて拾う。
 */
const excerptOf = (md) => {
  const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").replace(/```[\s\S]*?```/g, "");

  const parts = [];
  for (const block of body.split(/\r?\n\s*\r?\n/)) {
    const text = block
      .trim()
      .replace(/<[^>]*>/g, " ")
      .replace(/[*_`[\]()]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || text.startsWith("#") || text.startsWith(">") || text.startsWith("|")) continue;
    if (/^[-*+]\s/.test(text)) continue;

    parts.push(text);
    const joined = parts.join(" ");
    if (joined.length >= 60) return joined.slice(0, 140);
  }
  return parts.join(" ").slice(0, 140);
};

const collect = () => {
  const articles = [];
  let skipped = 0;

  for (const group of GROUPS) {
    const dir = path.join(repoRoot, group);
    if (!fs.existsSync(dir)) continue;

    for (const folder of fs.readdirSync(dir)) {
      const file = path.join(dir, folder, "article.md");
      if (!fs.existsSync(file) || fs.statSync(file).size === 0) continue;

      const relDir = `${group}/${folder}`;
      const meta = readDocMeta({ repoRoot, relDir, folder, file });

      if (!isPublished(meta.frontmatter.published)) {
        skipped += 1;
        continue;
      }

      const source = fs.readFileSync(file, "utf8");
      const slide = slideMetaOf(repoRoot, relDir, folder, path.join(dir, folder));

      // slug は記事 > デッキ > フォルダ名の順。デッキと URL を揃えたいので借りる。
      const slug = meta.frontmatter.slug || slide.frontmatter.slug || folder;

      const title = meta.frontmatter.title || headingOf(source) || folder;

      articles.push({
        name: folder,
        slug,
        title,
        // 一覧と OGP が使う短い見出し。
        heading: displayHeading(title, meta.frontmatter.summary || ""),
        // 日付は記事 > デッキの順。記事側に書いていなければ登壇日を使う。
        date: normalizeDate(meta.frontmatter.date) || slide.date || meta.date,
        updated: meta.updated,
        description: meta.frontmatter.description || excerptOf(source),
        summary: meta.frontmatter.summary || "",

        image: `/og/${slug}.png`,
        // デッキが公開されているときだけリンクする。非公開のデッキを
        // 指すと 404 になる。
        slideUrl: isPublishedSlide(path.join(dir, folder))
          ? `${site.slidesUrl}/slides/${slug}/`
          : "",
        wordCount: countWords(source),
        keywords: keywordsOf(source, meta.frontmatter),
        dir: relDir,
        path: `/articles/${slug}/`,
      });
    }
  }

  articles.sort((a, b) => b.date.localeCompare(a.date));
  return { articles, skipped };
};

const { articles, skipped } = collect();
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ articles }, null, 2));
console.log(`wrote src/data/articles.json (published: ${articles.length}, 非公開: ${skipped})`);
