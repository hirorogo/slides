#!/usr/bin/env node
/**
 * RSS 2.0 のフィードを dist/feed.xml に書く。アプリのディレクトリで実行する。
 *
 * src/data/*.json の一覧をそのまま使うので、記事でもスライドでも同じ形で出せる。
 * 購読者に届けたいのは「新しく出たもの」なので、日付の新しい順に並べる。
 */
import * as fs from "node:fs";
import * as path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "dist");
const site = JSON.parse(fs.readFileSync(path.join(root, "site.config.json"), "utf8"));

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** 一覧データを集める。記事は { articles }、スライドはグループごとの { slides }。 */
const collect = () => {
  const items = [];
  for (const name of ["articles.json", "slides.json"]) {
    const file = path.join(root, "src/data", name);
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    items.push(...(data.articles ?? Object.values(data).flatMap((g) => g.slides ?? [])));
  }
  return items.filter((i) => i.path).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
};

const items = collect();

/** RFC 822。RSS の pubDate はこの形式でないとリーダーが解釈しない。 */
const rfc822 = (date) => {
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(t) ? "" : new Date(t).toUTCString();
};

const entry = (item) => {
  const url = new URL(item.path, site.url).href;
  const categories = (item.keywords ?? [])
    .slice(0, 5)
    .map((k) => `<category>${esc(k)}</category>`)
    .join("");
  return `<item>
<title>${esc(item.title || item.name)}</title>
<link>${esc(url)}</link>
<guid isPermaLink="true">${esc(url)}</guid>
${item.date ? `<pubDate>${rfc822(item.date)}</pubDate>\n` : ""}<dc:creator>${esc(site.author)}</dc:creator>
<description>${esc(item.description ?? "")}</description>
${categories}</item>`;
};

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>${esc(site.title)}</title>
<link>${esc(site.url)}</link>
<description>${esc(site.description)}</description>
<language>ja</language>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
<atom:link href="${esc(new URL("/feed.xml", site.url).href)}" rel="self" type="application/rss+xml"/>
${items.map(entry).join("\n")}
</channel>
</rss>
`;

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, "feed.xml"), feed);
console.log(`wrote feed.xml (${items.length} item)`);
