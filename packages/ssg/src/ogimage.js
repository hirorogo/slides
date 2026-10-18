// OGP 画像をビルド時に作る。
//
// ブラウザは使わない。SVG を組み立てて resvg でラスタライズするだけなので
// 1枚 10ms ほどで済み、CI に Chrome も日本語フォントも要らない。
// 日本語が出せるように、woff2 で配られている Noto Sans JP を TTF に戻して渡す。

import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const require = createRequire(import.meta.url);

const WIDTH = 1200;
const HEIGHT = 630;
const PADDING = 96;
const FONT_FAMILY = "Noto Sans JP";

/**
 * Noto Sans JP の配布サブセットに入っていない約物を、見た目の近い字に寄せる。
 * 入れ忘れるとカードに豆腐(⊠)が出る。増やすときは実際に描いて確かめること。
 */
const GLYPH_FALLBACK = [
  [/\u2015/g, "\u2014"], // ― → —
  [/\uff5e/g, "\u301c"], // ～ → 〜
];

const normalize = (s) =>
  GLYPH_FALLBACK.reduce((acc, [from, to]) => acc.replace(from, to), String(s ?? ""));

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * 文字幅の目安。SVG の <text> は折り返さないので自前で折る必要があり、
 * そのために 1 文字の幅を em 単位で見積もる。
 * 全角はほぼ 1em、ラテン文字と数字はおよそ半分。
 */
const charWidth = (ch) => {
  if (/[　-〿぀-ヿ㐀-䶿一-鿿＀-｠￠-￦]/.test(ch)) {
    return 1;
  }
  if (/[A-Za-z0-9]/.test(ch)) return 0.58;
  if (/\s/.test(ch)) return 0.32;
  return 0.5;
};

/** 文字列の幅をフォントサイズ基準で見積もる。全角を半角幅で数えると要素が重なる。 */
const textWidth = (s, size) => {
  let em = 0;
  for (const ch of String(s)) em += charWidth(ch);
  return em * size;
};

/** 指定した em 幅で折り返す。行数は maxLines まで、あふれたら末尾を … にする。 */
const wrap = (text, maxEm, maxLines) => {
  const lines = [];
  let line = "";
  let width = 0;

  for (const ch of String(text)) {
    const w = charWidth(ch);
    if (width + w > maxEm && line) {
      lines.push(line);
      if (lines.length === maxLines) break;
      line = "";
      width = 0;
    }
    line += ch;
    width += w;
  }
  if (lines.length < maxLines && line) lines.push(line);

  if (lines.length === maxLines) {
    const rest = String(text).slice(lines.join("").length);
    if (rest) lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
  }
  return lines;
};

/**
 * 使うサブセット。
 *
 * japanese だけだと `――`(U+2015) や各種ダッシュが豆腐になる。
 * この手の約物は latin 側に入っているので一緒に読む。
 */
const SUBSETS = ["japanese", "latin", "latin-ext"];

/**
 * 400 だけ渡すと font-weight="700" が黙って無視され、太字指定が効かない。
 * 見出しを太くするには 700 のファイルも渡す必要がある。
 */
const WEIGHTS = ["400", "700"];

/** woff2 の Noto Sans JP を TTF に戻して一時ファイルに置く。resvg はパスしか受け取らない。 */
const prepareFonts = async () => {
  const { decompress } = require("wawoff2");
  const paths = [];

  for (const subset of SUBSETS) {
    for (const weight of WEIGHTS) {
      const woff2 = fs.readFileSync(
        require.resolve(
          `@fontsource/noto-sans-jp/files/noto-sans-jp-${subset}-${weight}-normal.woff2`,
        ),
      );
      // 中身が変われば長さも変わるので、ファイル名に入れて作り直しの判定にする。
      const ttfPath = path.join(os.tmpdir(), `ssg-nsjp-${subset}-${weight}-${woff2.length}.ttf`);
      if (!fs.existsSync(ttfPath)) {
        fs.writeFileSync(ttfPath, Buffer.from(await decompress(woff2)));
      }
      paths.push(ttfPath);
    }
  }
  return paths;
};

/**
 * @param {object} site site.config.json の中身
 * @returns {Promise<(item: {title: string, label?: string, date?: string}) => Buffer>}
 */
export async function createOgRenderer(site) {
  const fontFiles = await prepareFonts();
  const { Resvg } = require("@resvg/resvg-js");

  return function renderOg({ title, label = site.name }) {
    const titleSize = 54;
    const lines = wrap(normalize(title), (WIDTH - PADDING * 2 - 8) / titleSize, 3);
    const lineHeight = titleSize * 1.42;

    // 著者名とハンドルは色を変えたいので別々に置く。
    // 後ろの開始位置は実測ではなく見積もりなので、全角込みで数える。
    const name = normalize(site.author).split("/")[0].trim();
    // SVG のテキストは先頭の空白を落とすので、間隔は x 座標でとる。
    const handle = site.twitter ? `/ ${site.twitter}` : "";

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>

<!-- 四隅の飾り。濃さを変えて白黒のまま奥行きを出す -->
<path d="M0 0 L150 0 L0 150 Z" fill="#2b2b2b"/>
<path d="M${WIDTH} 0 A 120 120 0 0 1 ${WIDTH - 120} 120 L ${WIDTH} 120 Z" fill="#c9c9c9"/>
<path d="M0 ${HEIGHT} A 110 110 0 0 1 110 ${HEIGHT} Z" fill="#ececec"/>
<rect x="${WIDTH - 130}" y="${HEIGHT - 130}" width="130" height="130" fill="#f0f0f0"/>

<rect x="${WIDTH / 2 - 90}" y="36" width="180" height="52" rx="6" fill="#2b2b2b"/>
<text x="${WIDTH / 2}" y="72" font-family="${FONT_FAMILY}" font-size="24" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="4">${esc(normalize(label).toUpperCase())}</text>

${lines
  .map(
    (line, i) =>
      `<text x="100" y="${210 + i * lineHeight}" font-family="${FONT_FAMILY}" font-size="${titleSize}" font-weight="700" fill="#111111">${esc(line)}</text>`,
  )
  .join("\n")}

<!-- 左上の三角と同じ形。アイコン代わりの記号 -->
<path d="M100 ${HEIGHT - 136} L148 ${HEIGHT - 136} L100 ${HEIGHT - 88} Z" fill="#2b2b2b"/>
<text x="168" y="${HEIGHT - 104}" font-family="${FONT_FAMILY}" font-size="28" font-weight="500" fill="#111111">${esc(name)}</text>
<text x="${168 + textWidth(name, 28) + 12}" y="${HEIGHT - 104}" font-family="${FONT_FAMILY}" font-size="28" fill="#777777">${esc(handle)}</text>
</svg>`;

    return new Resvg(svg, {
      font: { fontFiles, loadSystemFonts: false, defaultFontFamily: FONT_FAMILY },
    })
      .render()
      .asPng();
  };
}
