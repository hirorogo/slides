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
 * タイトルの文字サイズの候補。大きい順に試して、3行以内かつ帯に収まる
 * 最初のものを使う。短いタイトルがカードの中で小さく浮かないようにする。
 */
const TITLE_SIZES = [76, 68, 60, 54];
const MAX_LINES = 3;

/** タイトルを置ける縦の帯。上はラベル箱の下、下は著者行の上。 */
const BAND_TOP = 128;
const BAND_BOTTOM = HEIGHT - 170;

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
 * @returns {Promise<(item: {title: string, label?: string, date?: string, subtitle?: string, maxLines?: number}) => Buffer>}
 */
export async function createOgRenderer(site) {
  const fontFiles = await prepareFonts();
  const { Resvg } = require("@resvg/resvg-js");

  // 一覧ページのカードは見出しが短いブランド句なので maxLines: 1 で呼ぶ。
  // 折り返すと「…登壇・発 / 表資料」のように語の途中で割れる。
  return function renderOg({ title, label = site.name, subtitle = "", maxLines = MAX_LINES }) {
    const text = normalize(title);
    const subText = normalize(subtitle);

    // サブタイトルは見出しの下に添える。折り返さず 1 行。
    // 一覧ページのカードは見出しが短く、帯の真ん中に一語だけ浮いて見えるため。
    const subSize = 30;
    const subGap = 34;
    // 行数の計算に使う帯は、サブタイトルの分だけ狭くしておく。
    const band = BAND_BOTTOM - BAND_TOP - (subText ? subGap + subSize : 0);

    // 入る中で一番大きいサイズを選ぶ。最後の候補は収まらなくても使う（…で切れる）。
    //
    // ただし最終行が極端に短いとき（`…もの` の `の` だけが落ちるような孤立行）は
    // 一段小さいサイズを試す。行数が減るなら、文字が小さくなっても読みやすい。
    const maxEm = (WIDTH - PADDING * 2 - 8) / 1;
    const isOrphan = (wrapped, candidate) =>
      wrapped.length > 1 &&
      textWidth(wrapped[wrapped.length - 1], candidate) < (maxEm / candidate) * candidate * 0.15;

    let size = TITLE_SIZES[TITLE_SIZES.length - 1];
    let lines = wrap(text, (WIDTH - PADDING * 2 - 8) / size, maxLines);
    let fallback = null;
    for (const candidate of TITLE_SIZES) {
      const wrapped = wrap(text, (WIDTH - PADDING * 2 - 8) / candidate, maxLines);
      const needed = (wrapped.length - 1) * candidate * 1.42 + candidate;
      const fits = wrapped.join("").length === text.length && needed <= band;
      if (!fits) continue;
      if (isOrphan(wrapped, candidate)) {
        // 孤立行が出る。もっと小さいサイズで行数が減らなければ、これを使う。
        fallback ??= { size: candidate, lines: wrapped };
        continue;
      }
      size = candidate;
      lines = wrapped;
      fallback = null;
      break;
    }
    if (fallback && lines.length >= fallback.lines.length) {
      ({ size, lines } = fallback);
    }

    const lineHeight = size * 1.42;
    // 行数が変わってもタイトルの塊が帯の中心に来るようにする。
    // y は baseline なので、見た目の中心に合わせるぶんだけ下げる。
    // 見出しとサブタイトルを一つの塊として、帯の中央に置く。
    const blockHeight = (lines.length - 1) * lineHeight + (subText ? subGap + subSize : 0);
    const firstBaseline = (BAND_TOP + BAND_BOTTOM) / 2 - blockHeight / 2 + size * 0.36;

    // 著者名とハンドルは色を変えたいので別々に置く。
    // 後ろの開始位置は実測ではなく見積もりなので、全角込みで数える。
    const name = normalize(site.author).split("/")[0].trim();
    // SVG のテキストは先頭の空白を落とすので、間隔は x 座標でとる。
    const handle = site.twitter ? `/ ${site.twitter}` : "";

    // サブタイトルはタイトルの最終行の下に置く。折り返さず 1 行に収める。
    const lastBaseline = firstBaseline + (lines.length - 1) * lineHeight;
    const subSvg = subText
      ? `<text x="100" y="${lastBaseline + subGap + subSize * 0.36}" font-family="${FONT_FAMILY}" font-size="${subSize}" fill="#666666">${esc(
          wrap(subText, (WIDTH - PADDING * 2 - 8) / subSize, 1)[0] ?? "",
        )}</text>`
      : "";

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
      `<text x="100" y="${firstBaseline + i * lineHeight}" font-family="${FONT_FAMILY}" font-size="${size}" font-weight="700" fill="#111111">${esc(line)}</text>`,
  )
  .join("\n")}
${subSvg}

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
