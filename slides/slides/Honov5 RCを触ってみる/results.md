# Hono v5 RC 検証結果

draft.md の「検証前チェックリスト」を実際に走らせた結果。生データは [results.json](./results.json)、
実験コードは [sandbox/](./sandbox/) にある。

| 項目 | 値 |
| --- | --- |
| 検証日 | 2026-10-18 |
| v4 | `hono@4.13.13` |
| v5 | `hono@5.0.0-rc.1`（`npm install hono@next`） |
| アダプター | `@hono/bun@1.0.1` |
| Node.js | v24.22.0 |
| TypeScript | 7.0.2 |
| tsx | 4.23.15 |
| マシン | Apple M4 (arm64) / macOS Darwin 25.5.0 |

> ⚠️ v5 は RC 版。正式リリース時に挙動が変わる可能性がある。
> ⚠️ ベンチマークは `app.fetch()` を使ったインプロセス計測。実 HTTP サーバーや Cloudflare Workers 本番の性能ではない。

---

## 結論を先に

1. **型で捕まる変更は、ちゃんと全部型で捕まった。** `c.req.json()`、`c.req.query()`、v4 スタイルの `onError()` ――
   すべて `tsc --strict` が検出した。移行の第一歩は型チェックを通すこと。
2. **一番危ないのは `c.json(undefined)`。** これだけは型エラーにならず、実行時に 500 になる。
3. **`onError()` は「上書き」から「合成」に変わった。** v4 で 2 回登録して後勝ちを期待していたコードは、v5 では両方走る。
4. **ワイルドカードは本当に統一された。** v4 は Router 4 種でバラバラだったが、v5 は全部一致した。
5. **性能差は誤差。** v5 が中央値で 1.5% 速いが、分布が大きく重なっており有意差とは言えない。
6. **「軽くなった」は install サイズの話。** `hono` パッケージは 2.8M → 1.5M（-46%）だが、
   最終バンドルは 18,528 → 18,830 bytes と**むしろ微増**した。

---

## 実験① 型安全性

`npx tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022`

| ケース | v4 | v5 |
| --- | --- | --- |
| `c.req.json()` → `body.name.toUpperCase()` | ✅ 通る | ❌ `TS18046: 'body' is of type 'unknown'.` |
| `c.req.query()` の分割代入 | ✅ 通る | ❌ `TS18048` + `TS2322`（下記） |
| 型ガードを書いた版 | ✅ 通る | ✅ 通る |
| v4 スタイルの `onError((err, c) => ...)` | ✅ 通る | ❌ `TS2339` ×2（下記） |

### `c.req.query()` の分割代入（v5）

```
src/typecheck-query.ts(7,25): error TS18048: 'name' is possibly 'undefined'.
src/typecheck-query.ts(10,9): error TS2322: Type 'string[] | undefined' is not assignable to type 'string[]'.
  Type 'undefined' is not assignable to type 'string[]'.
```

> 💭 draft の「既存コードが一斉に赤くなるやつでは？」は**当たり**。
> `const { name } = c.req.query()` を書いている箇所は全部赤くなる。

### v4 スタイルの `onError()`（v5）

```
src/typecheck-onerror-v4style.ts(7,21): error TS2339: Property 'message' does not exist on type 'Context<BlankEnv, string, any>'.
src/typecheck-onerror-v4style.ts(8,12): error TS2339: Property 'json' does not exist on type 'Next'.
```

**第 1 引数が `Context`、第 2 引数が `Next` になった**ことがそのままエラーに出ている。
型を見ていれば移行時に必ず気づける。

### ただし型を無視して実行すると

`@ts-expect-error` で黙らせて実行すると、こうなる：

```
Context is not finalized. Did you forget to return a Response object or `await next()`?
```

実際に観測された引数は `{ firstArgCtor: "Context", firstArgIsContext: true, secondArgType: "function" }`。
つまり v4 の `c` のつもりで触っているものが `next` 関数なので `c.text()` が存在せず、
結果として**原因を指さないエラーメッセージ**が出る。

> 💭 型エラーを握りつぶすと、デバッグがかなり辛くなるパターン。記事ではここを強調したい。

---

## 実験② `onError()` / `notFound()`

### パス指定

| | v4 | v5 |
| --- | --- | --- |
| `app.onError('/api/*', handler)` | ❌ `this.errorHandler is not a function` | ✅ 動く |
| `app.notFound('/api/*', mw, handler)` | ❌ `TypeError: onNotFound is not a function` | ✅ 動く |

v4 は文字列をハンドラとして受け取ってしまい、**登録時ではなくリクエスト時に落ちる**。

v5 の実測：

| リクエスト | `X-Error-Handler` | status | body |
| --- | --- | --- | --- |
| `/api/error` | `api` | 500 | `{"error":"Internal Server Error"}` |
| `/other/error` | （なし） | 500 | `{"error":"Internal Server Error"}` |

`notFound()` も同様にスコープが効いた：

| リクエスト | `x-not-found` | status | body |
| --- | --- | --- | --- |
| `/api/zzz` | `api` | 404 | `API resource not found` |
| `/other/zzz` | （なし） | 404 | `Not Found` |

### 上書き or 合成 ★重要

`onError()` を 2 回登録して、実行順を記録した。

| | 実行されたハンドラ | レスポンス |
| --- | --- | --- |
| **v4** | `["second"]` | `second` |
| **v5** | `["first", "second"]` | `second` |

**v4 は後勝ちの上書き、v5 は合成。** 1 つ目が `next()` を呼べば 2 つ目も走る。

1 つ目がレスポンスを返した場合は：

| | 実行されたハンドラ | レスポンス |
| --- | --- | --- |
| v5 | `["first"]` | `first` |

レスポンスを返すとチェーンはそこで止まる。

> 💭 draft の「v4 で後から登録して上書きしてたコードは v5 では両方走る」は**当たり**。
> しかもこれは**型エラーにならない**（シグネチャさえ直せば通る）ので、実際に動かすまで気づけない。

### 非 Error の throw

| | v4 | v5 |
| --- | --- | --- |
| `throw 'oops'` | `app.fetch()` の外に漏れる | `Error` にラップ。`message: 'oops'` / `cause: 'oops'` |
| `throw { code: 42 }` | `app.fetch()` の外に漏れる | `Error` にラップ。`message: ''` / `cause: { code: 42 }` |

> 💭 draft の「オブジェクトを投げた場合は `cause` にだけ入る（`message` は入らない）→ 要検証」は**当たり**。
> `message` は空文字になる。ログに出しても何も分からないので、`c.error.cause` を見る必要がある。

---

## 実験③ `c.json()` と `c.req.query()` の実行時挙動

### `c.json(undefined)` ★一番危ない

| | v4 | v5 |
| --- | --- | --- |
| `c.json(undefined)` | 200 / body 長 0 | **500** / `Internal Server Error` |
| `c.json(() => 1)` | 200 / body 空 | **500** / `Internal Server Error` |

v5 側で実際に投げられている例外：

```
TypeError: Value is not JSON serializable
```

`onError` を登録していなければ、組み込みハンドラが 500 を返す。

> ⚠️ **これは型エラーにならない。** `c.json()` の引数が `undefined` になり得るコードは、
> テストを書いていないと本番で初めて 500 になる。移行時の最優先チェック項目。

### `c.req.query()` の実行時の値

`GET /q?a=1&a=2` に対して：

| | v4 | v5 |
| --- | --- | --- |
| `c.req.query()` | `{"a":"1"}` | `{"a":"1"}` |
| `c.req.queries()` | `{"a":["1","2"]}` | `{"a":["1","2"]}` |

**実行時の値は完全に同じ。** v5 の変更は型だけで、挙動は変わっていない。

> 💭 つまり「型が正直になった」だけ。v4 でも `undefined` は返り得たのに、型が嘘をついていた。

---

## 実験④ ワイルドカードのマッチング ★LT の山場

### v4：Router によってバラバラ

| ルート | パス | SmartRouter | RegExpRouter | TrieRouter | PatternRouter |
| --- | --- | --- | --- | --- | --- |
| `/x*/y` | `/x/y` | ❌ | ❌ | ❌ | ❌ |
| `/x*/y` | `/xz/y` | ✅ | ✅ | ❌ | ❌ |
| `/x*/y` | `/x/z/y` | ❌ | ❌ | ❌ | ❌ |
| `/x*y` | `/xay` | ✅ | ✅ | ❌ | ❌ |
| `/wild/*/card` | `/wild//card` | ❌ | ❌ | ✅ | ❌ |
| `/wild/*/card` | `/wild/a/card` | ✅ | ✅ | ✅ | ✅ |

**3 ケースで Router 間の結果が割れている。**

### v5：完全に統一

| ルート | パス | SmartRouter | RegExpRouter | TrieRouter | PatternRouter |
| --- | --- | --- | --- | --- | --- |
| `/x*/y` | `/x/y` | ✅ | ✅ | ✅ | ✅ |
| `/x*/y` | `/xz/y` | ✅ | ✅ | ✅ | ✅ |
| `/x*/y` | `/x/z/y` | ❌ | ❌ | ❌ | ❌ |
| `/x*y` | `/xay` | ❌ | ❌ | ❌ | ❌ |
| `/wild/*/card` | `/wild//card` | ❌ | ❌ | ❌ | ❌ |
| `/wild/*/card` | `/wild/a/card` | ✅ | ✅ | ✅ | ✅ |

**4 Router すべてが一致。** 公式ドキュメントの表とも完全に一致した。

v4 → v5 で挙動が変わったのは `/x*/y` vs `/x/y`（全 Router で ❌ → ✅）と
`/x*y` vs `/xay`（RegExp 系で ✅ → ❌）。

### `UnsupportedPathError` と TrieRouter フォールバック ★再現成功

`/x*/y` と `/x/*` を同時に登録した場合：

| Router | v4 | v5 |
| --- | --- | --- |
| RegExpRouter（単体） | 200 / `b` | **`UnsupportedPathError: /x/*`** |
| SmartRouter | 200 / `b`（RegExpRouter を選択） | 200 / `a`（**TrieRouter にフォールバック**） |
| TrieRouter | 200 / `b` | 200 / `a` |
| PatternRouter | 200 / `b` | 200 / `a` |

SmartRouter が最終的に選んだ Router：

| 登録したルート | v5 で選ばれた Router |
| --- | --- |
| `/x/*` のみ | `SmartRouter + RegExpRouter` |
| `/x*/y` + `/x/*` | `SmartRouter + TrieRouter` |

> 🔥 **ルートを 1 行足しただけで、実行時に選ばれる Router が変わる。**
> しかも v4 と v5 で**マッチするハンドラ自体が変わっている**（`b` → `a`）。
> これは型でもテストでも気づきにくい。

### フォールバックの性能コスト

`GET /users/:id` を 50,000 回、**12 ラウンド**（v5）：

| | Router | 中央値 | 平均 | 最小 | Requests/sec（中央値） |
| --- | --- | ---: | ---: | ---: | ---: |
| 競合なし | `SmartRouter + RegExpRouter` | 138.68 ms | 152.28 ms | 132.35 ms | 360,573 |
| 競合あり | `SmartRouter + TrieRouter` | 148.57 ms | 163.99 ms | 146.25 ms | 336,540 |
| **差** | | **+7.1%** | **+7.7%** | **+10.5%** | |

中央値・平均・最小値のすべてでフォールバック側が遅く、方向は一貫している。

> ⚠️ **測り直した値。** 最初に 3 ラウンドで測ったときは差が 3.3% しか出なかった。
> ラウンド数が少ないと結論がぶれるので 12 ラウンドに増やしている。
> 生データには 287 ms / 271 ms といった外れ値（GC か OS のスケジューリング）も含まれるため、
> 外れ値の影響を受けにくい**最小値での比較（+10.5%）**が実態に近いと思われる。

> 💭 draft の「性能特性も変わる」は**当たり**。実測できる差が出た。ここが LT のクライマックス。

---

## 実験⑤ パフォーマンス比較

`app.fetch()` で `GET /users/:id` を 100,000 回（ウォームアップ 20,000 回）、**v4 / v5 を交互に 10 ラウンド**。

各ラウンドの所要時間（ソート済み, ms）：

| | 計測値 |
| --- | --- |
| v4 | 258.31, 262.13, 263.35, 267.46, 269.22, 271.84, 271.85, 272.70, 284.91, 360.60 |
| v5 | 255.59, 255.80, 259.35, 263.16, 264.70, 268.30, 269.94, 282.37, 284.31, 315.01 |

| 統計量 | v4 | v5 | 差 |
| --- | ---: | ---: | ---: |
| 中央値 | 270.53 ms | 266.50 ms | v5 が **1.5%** 速い |
| 平均 | 278.24 ms | 271.85 ms | v5 が **2.3%** 速い |
| 最小 | 258.31 ms | 255.59 ms | v5 が **1.1%** 速い |
| Requests/sec（中央値） | 369,644 | 375,235 | |

**結論：差は誤差の範囲。**

v4 の最小値（258.31 ms）が v5 の中央値（266.50 ms）より速く、分布が大きく重なっている。
どの統計量で見ても v5 がわずかに速い方向ではあるが、この測り方で「v5 は速くなった」と主張するのは無理がある。

> 💭 draft の「正直、差は出ないと予想してる」は**当たり**。
> 「コアのルーティング性能は v4 から据え置き」が妥当な結論。
> 5 ラウンドで測ったときは 2.9% 差だったが、10 ラウンドに増やすと 1.5% に縮んだ。
> **マイクロベンチで数 % を語るときはラウンド数を書かないと意味がない**という教訓込みで記事に書きたい。

## 実験⑥ サイズ

### バンドルサイズ

`esbuild --bundle --format=esm --minify`

| エントリ | v4 | v5 | 差分 |
| --- | ---: | ---: | ---: |
| コアのみ（`--platform=neutral`） | 18,528 B<br>(gzip 7,791) | 18,830 B<br>(gzip 7,910) | **+302 B (+1.6%)** |
| アダプター込み（`--platform=node`） | 22,760 B<br>(gzip 9,512) | 22,923 B<br>(gzip 9,570) | **+163 B (+0.7%)** |

アダプター込みは `serveStatic` を import したもの（v4: `hono/bun` / v5: `@hono/bun`）。

### インストールサイズ

| | サイズ |
| --- | ---: |
| v4 `node_modules/hono` | 2.8 M |
| v5 `node_modules/hono` | **1.5 M（-46%）** |
| v5 `node_modules/@hono/bun` | 60 K |

> 💭 draft の「アダプター別パッケージ化＝バンドルが小さくなる、ではない」は**当たり**。
> 減ったのは **install サイズ**（CJS ビルド削除とアダプター分離の効果）で、
> **バンドルサイズはむしろ微増した。**
> 「Hono v5 で軽量化！」と書くときにどちらの話をしているかは明確にする必要がある。

---

## 実験⑦ モジュール形式

| 確認内容 | 結果 |
| --- | --- |
| v4 で `import('hono/bun')` | ✅ 解決できる |
| v5 で `import('hono/bun')` | ❌ `ERR_PACKAGE_PATH_NOT_EXPORTED` |
| v4 で `require('hono')` | ✅ OK |
| v5 で `require('hono')` | ✅ **OK** |

> 💭 draft の「ESM only なのに require できるのが面白い」は**当たり**。
> Node.js 24.22.0 は ESM を `require()` できるので、v5 でも `require('hono')` が通る。
> 公式ガイドが「Node.js 22.12 以降なら `require('hono')` も動く」と書いている通りだった。
> ただし `hono/bun` のようなサブパスは `exports` から消えているので、こちらは確実に壊れる。

---

## 移行チェックリスト（実測版）

優先度順。

### 1. まず `tsc --strict` を通す（型で捕まる）

- [ ] `c.req.json()` の結果に直接プロパティアクセスしている箇所
- [ ] `const { x } = c.req.query()` の分割代入
- [ ] `c.req.queries()` の戻り値を `string[]` として扱っている箇所
- [ ] `app.onError((err, c) => ...)` を `(c) => ...` + `c.error` に書き換え

### 2. 次に実行時の地雷を潰す（型では捕まらない）★

- [ ] **`c.json()` に `undefined` が渡り得る箇所**（→ 500 になる）
- [ ] **`onError()` / `notFound()` を複数回登録している箇所**（→ 上書きではなく合成される）
- [ ] **ワイルドカードを含むルート**（→ `/x*/y` vs `/x/y` のマッチ結果が変わる）
- [ ] **`/x*/y` と `/x/*` のような競合ルート**（→ Router がフォールバックして約 8% 遅くなる）
- [ ] 非 Error を throw している箇所（→ `onError` に流れるようになる。`c.error.cause` を見る）

### 3. import を書き換える

- [ ] `hono/<runtime>` → `@hono/<runtime>`（8 パッケージ）
- [ ] `hono/cloudflare-pages` を使っている場合は**代替なし**。Workers への移行が必要
- [ ] `app.mount()` → `hono/mount` の `mount()`
- [ ] `app.fire()` → `@hono/service-worker` の `fire(app)`
- [ ] `c.req.routePath` / `c.req.matchedRoutes` → `hono/route`

---

## 未検証・積み残し

- `route()` でサブアプリの `notFound()` を取り込んだときの優先順位（「深いネストが優先」「同じ深さなら登録順」）
- `basePath()` と `onError()` のパス解決の組み合わせ
- 実 HTTP サーバー経由のベンチマーク（今回は `app.fetch()` のみ）
- Cloudflare Workers 実環境での計測
- `@hono/zod-validator` と `c.req.valid()` の組み合わせ
- `toSSG()` の `plugins` 移行

---

## 再現方法

```sh
cd sandbox/v4 && npm install && cd ../v5 && npm install && cd ../..

# 型チェック
(cd sandbox/v5 && npx tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 src/typecheck-json.ts)

# ランタイム挙動
(cd sandbox/v4 && npx tsx src/probe.ts)
(cd sandbox/v5 && npx tsx src/probe.ts)

# ワイルドカード / Router
(cd sandbox/v4 && npx tsx src/wildcard.ts)
(cd sandbox/v5 && npx tsx src/wildcard.ts)

# ベンチマーク
(cd sandbox/v4 && npx tsx src/benchmark.ts)
(cd sandbox/v5 && npx tsx src/benchmark.ts)

# Router フォールバックの性能
(cd sandbox/v5 && npx tsx src/router-perf.ts)
```

## 出典

- [Migrating to v5 — Hono](https://hono.dev/docs/guides/migrating-to-v5)
- [honojs/hono releases](https://github.com/honojs/hono/releases)
