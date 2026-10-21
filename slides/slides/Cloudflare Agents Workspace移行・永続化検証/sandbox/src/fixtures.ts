/**
 * 移行テスト用の固定データ。PRD §5 の表 + C14（シンボリックリンク）の追加ケース。
 * 内容は決定的に生成する（毎回同じバイト列になる）。
 */

export type Fixture =
  | { kind: "file"; path: string; text: string; mime?: string }
  | { kind: "bytes"; path: string; size: number; seed: number }
  | { kind: "dir"; path: string }
  | { kind: "symlink"; path: string; target: string; note: string };

/** 決定的な疑似ランダムバイト列（xorshift32）。同じ seed なら必ず同じ中身 */
export function makeBytes(size: number, seed: number): Uint8Array {
  const out = new Uint8Array(size);
  let x = seed || 1;
  for (let i = 0; i < size; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;  x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

export const FIXTURES: Fixture[] = [
  // PRD §5 の表
  { kind: "file",  path: "/notes.md",          text: "# notes\n\n日本語とUTF-8の確認。\n" },
  { kind: "dir",   path: "/src" },
  { kind: "file",  path: "/src/index.ts",      text: "export const x = 1;\n", mime: "text/typescript" },
  { kind: "dir",   path: "/data" },
  { kind: "file",  path: "/data/config.json",  text: '{"a":1,"b":[2,3],"c":"あ"}\n', mime: "application/json" },
  { kind: "dir",   path: "/assets" },
  { kind: "bytes", path: "/assets/sample.bin", size: 64 * 1024, seed: 0xC0FFEE },
  { kind: "dir",   path: "/empty" },

  // C14: シンボリックリンク。相対/絶対/ルート超えを撃ち分ける
  { kind: "dir",     path: "/links" },
  { kind: "symlink", path: "/links/rel.md",    target: "../notes.md",       note: "相対。公式サンプルが正しく扱えるはず" },
  { kind: "symlink", path: "/links/abs.md",    target: "/notes.md",         note: "絶対・正規形。問題ないはず" },
  { kind: "symlink", path: "/links/dotdot.md", target: "/src/../notes.md",  note: "絶対・.. を含むがルートは超えない" },
  { kind: "symlink", path: "/links/esc.md",    target: "/../notes.md",      note: "絶対・ルートを超える ← Phase 3 の予測ではここがズレる" },
];

/** C18: サイズ別。旧 Shell の inlineThreshold は 1_500_000、DO SQLite の行上限は 2MB */
export const SIZE_CASES = [
  { label: "1KB",    size: 1024 },
  { label: "100KB",  size: 100 * 1024 },
  { label: "1MB",    size: 1024 * 1024 },
  { label: "1.4MB",  size: 1_400_000 },   // 閾値直下。base64 で約 1.87MB（行上限直前）
  { label: "1.6MB",  size: 1_600_000 },   // 閾値超え。R2 が無ければ inline のまま
  { label: "4MB",    size: 4 * 1024 * 1024 },
];
