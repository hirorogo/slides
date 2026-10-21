# Phase 3 — 実機なしで潰した分

| | |
| --- | --- |
| 実施日 | 2026-10-21 |
| 環境 | デスク（Cloudflare 接続なし・認証情報なし） |
| 使用バージョン | `@cloudflare/shell@0.4.3` / `@cloudflare/computer@0.6.0` / typescript 5.9.3 / node v24.22.1 |
| 再現 | `bun install && bunx tsc --noEmit && node scripts/diff-resolve-target.mjs` |

## 1. 公式サンプルの型検証

| サンプル | 結果 |
| --- | --- |
| 移行ガイドの `copyShellWorkspace()`（一字一句そのまま） | ✅ `tsc --noEmit` exit 0 |
| Changelog のコードブロック（`WorkerJavaScriptBackend`） | ✅ 型 OK |
| 移行ガイドの `onStart` フラグ例（`storage.kv.get/put`） | ✅ 現行 API |
| **Changelog 散文の `JavaScriptWorkerBackend`** | ❌ `TS2305: Module '"@cloudflare/computer/backends/worker-javascript"' has no exported member 'JavaScriptWorkerBackend'.` |

公式コピースクリプトは**型レベルでは正しい**。`glob(): Promise<FileInfo[]>` と
`readFileBytes(): Promise<Uint8Array | null>` に対して整合している。

## 2. C14 — 公式 `resolveTarget()` と Shell 実装の差分

純関数なので実機不要。**文字列ではなく「移行後に辿り着く先」で比較**した
（文字列が違っても着地点が同じなら実害は無い）。

写した実装:

| 元 | 場所 |
| --- | --- |
| Shell の解決式 | `@cloudflare/shell@0.4.3` `dist/index.js:153` |
| Shell の `normalizePath` / `getParent` | 同 `:782-800` |
| Computer の `symlink()` — **target を正規化せず生で格納** | `@cloudflare/computer@0.6.0` `dist/index.js:2431-2453` |
| Computer の追従時 `..` — **ルートでクランプ（throw しない）** | 同 `:519-531` |

結果: **16 件中、文字列が違う 8 件 / 着地点がズレる 4 件。**

```
link            target                 公式の着地点              あるべき着地点            実害
/links/notes.md "../notes.md"          /workspace/notes.md       /workspace/notes.md       ✅
/a/link         "/a/../b/x.txt"        /workspace/b/x.txt        /workspace/b/x.txt        ✅
/a/link         "//double/slash"       /workspace/double/slash   /workspace/double/slash   ✅
/link           "/../etc/passwd"       /etc/passwd               /workspace/etc/passwd     ❌
/a/link         "/../../x"             /x                        /workspace/x              ❌
/a/b/link       "/../b/x"              /b/x                      /workspace/b/x            ❌
/a/link         "/../workspace/y"      /workspace/y              /workspace/workspace/y    ❌
```

### 狭めた主張

> 公式移行ガイドの `resolveTarget()` は**絶対ターゲットを正規化せずに素通しする**
> （`if (target.startsWith("/")) return target;`）。一方 Shell は `normalizePath()` を通す。
> そのため **「絶対パスで、かつルートより上へ登る `..` を含む」シンボリックリンクに限り**、
> 移行後のリンク先が `/workspace` の外を指す。

- **当てはまらないもの**: 相対ターゲット（全件一致）、`.` や `//` を含む絶対ターゲット、
  ルートを超えない `..` を含む絶対ターゲット
- **静かに壊れる**。`symlink()` は target を検証せず格納し、追従時も throw せずクランプするだけ
- ⚠️ **机上（dist から写した実装）での導出。実機で再現すること**

## 3. C16 — フラグ無しで移行を 2 回流したときの予測

再実行時の冪等性を実装から読んだ:

| 操作 | 2 回目 | 根拠 |
| --- | --- | --- |
| `mkdir(recursive: true)` | 既存ディレクトリなら黙って return | `dist/index.js:2034` |
| `writeFile()` | 上書き（`options.exclusive` 指定時のみ EEXIST） | `:1087` |
| **`symlink()`** | **常に `EEXIST` を投げる。`force` / `exclusive` は無い** | `:2445`、型は `symlink(target, path)` のみ |

→ **予測: シンボリックリンクを含む Workspace でフラグ無しに 2 回流すと、
最初の symlink で `EEXIST` が投げられ、移行がそこで中断する。**
テキスト・バイナリ・ディレクトリだけなら冪等で壊れない。

ガイドの `onStart` 例はコピー**完了後**にフラグを立てるので、
中断するとフラグが立たず、起動のたびに同じ場所で失敗し続ける。

⚠️ これも机上の予測。実機で確認する。

## 4. C24 — `mime_type` が保持されないことの型での確認

`@cloudflare/computer@0.6.0` には MIME を読み書きする API が**どこにも無い**。

`workspace.fs` の実体は `shared-C-sNJ-xg.d.ts:105` の `WorkspaceFilesystem`:

```
readFile / stat / lstat / readlink / readdir / find / ls /
grep / writeFile / mkdir / rm / rename / chmod / symlink
```

> ⚠️ **最初 `index.d.ts:240` の `WorkspaceFilesystemStub` を読んでいた。**
> こちらは `exists` / `statOrNull` / `lstatOrNull` を持つ別物（RPC 越し用）。
> 同名クラスが 2 つあるので、`workspace.fs` の型がどちらかを確認すること。
> 結論は変わらない（どちらにも MIME は無い）。

戻り値の `WorkspaceStatResult`（`:90-99`）も:

```ts
{ name, inode, mode, mtime, size, isFile, isDirectory, isSymbolicLink }
```

一方 Shell の `FileInfo` は `mimeType` / `createdAt` / `updatedAt` を持つ。

→ **✅ 移行ガイドの記述どおり。実機不要で確定。**
→ さらに強く言える: **`mime_type` も `created_at` も「保持されない」のではなく、
   新スキーマに置き場所が無い。** `mtime` 相当の 1 本しか無い（C23 にも効く）。

## 5. 所見

**2 件の発見が、どちらもシンボリックリンクに着地した。**

- C14: 絶対 + ルート超え `..` のリンクが、静かに `/workspace` の外を指す
- C16: 再実行すると symlink で中断する

公式スクリプトでテキスト・バイナリ・ディレクトリは問題なさそうで、
**弱いのはシンボリックリンクだけ**という形になっている。記事の軸の候補。
