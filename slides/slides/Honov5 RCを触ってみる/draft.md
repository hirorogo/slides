# Honov5 RCを触ってみる

**重要：このネタは「実際に触ってみた」記事です。** 下の「検証メモ」のコマンドを実際に走らせて、
出力をそのまま貼れる状態にしてから書き始めてください。実測していない数値は書かないでください。

### 一次ソース

- 公式 Migration Guide: https://hono.dev/docs/guides/migrating-to-v5
  - raw: https://raw.githubusercontent.com/honojs/website/main/docs/guides/migrating-to-v5.md
- リリース: https://github.com/honojs/hono/releases
  - `5.0.0-rc.0` … 2026-10-08
  - `5.0.0-rc.1` … 2026-10-10
  - npm dist-tag は `next`（`latest` はまだ 4.13.13 系）
- Mount Middleware: https://hono.dev/docs/middleware/builtin/mount

## 記事を書くに当たって

記事はスライドの各セクションを増量し、技術的側面を追加して書くことを意識してください。
記事の中では画像を使うことはできません。Mermaid で図を作ることはできます。
https://zenn.dev/meijin/articles/tech-article-output-recommend
これを参考に記事書いてください。

RC 版の記事なので、**「正式リリース時に仕様が変わる可能性がある」** は必ず明記してください。
また、検証日と検証したバージョン（`npm ls hono` の出力）を記事内に残してください。

## 記事・スライド共通ドラフト

- タイトル
  - 題名：Hono v5 RC を触ってみた。v4 から何が変わり、何が壊れるのか？
  - 副題：型安全性・エラーハンドリング・ルーティングを、v4 と並べて確かめる
  - 発表者：田中博悠 / Hirohisa Tanaka / tanahiro2010
  - 💭 感想：（ここに書く）

- 自己紹介
  - 名前：田中博悠（tanahiro2010）
  - 所属：三田学園高等学校 / GDG Greater Kwansai
  - Hono Conference 2026 のコアスタッフ
  - Hono 歴：個人開発（Renovel など）でずっと使ってる
  - 💭 ここで「だからこそ v5 の破壊的変更が他人事じゃない」に繋げる

- つかみ
  - 2026/10/08 に `hono@5.0.0-rc.0`、10/10 に `5.0.0-rc.1` が出た
  - `npm install hono@next` で今すぐ試せる
  - Hono のメジャーアップデートは久しぶり。しかも破壊的変更が結構ある
  - 問いかけ：「あなたのアプリ、v5 にしたら壊れますか？」
  - 💭 感想：もちろん僕はぶっ壊れます（）

- この発表のスタンス
  - 公式 Migration Guide の翻訳記事にはしない
  - v4 と v5 の環境を別々に作って、**同じコードを両方で動かして差分を見る**
  - 「ドキュメントにこう書いてある」ではなく「実際にこうなった」を出す
  - 📌 RC なので正式版で変わる可能性あり、は毎回言う

### 1. v5 の破壊的変更ぜんぶ（全体像）

- まず全体像を一覧で見せる（スライドでは表、記事では表＋解説）
  - 📋 一覧表は「メモ①」参照
- 大きく4つのグループに分けると話しやすい
  - **配布の形が変わった**
    - ESM only（CJS ビルド削除）
    - ランタイムアダプターが別パッケージに
      - 公式の `@hono/node-server` / `@hono/cloudflare` など
      - yusukebeさん曰くこれはサプライチェーン攻撃の対策の意味も含むとのこと
        - Honoコア部分の依存関係を減らすことで、攻撃対象を減らす狙い
        - ただぶっちゃけ今はもうHonoがPRの受付を止めているのでこれはどうなんだ...？という疑問も
          - まあアカウント乗っ取りとかに対しては有効なのかもしれない
        - ソース（本人の登壇スライド）
          - Honoでのサプライチェーン侵害対策 〜 3つのライブラリに学ぶ
          - https://speakerdeck.com/yusukebe/honodenosapuraitienqin-hai-dui-ce-3tunoraiburarinixue-bu

  - **型が厳しくなった**
    - `c.req.json()` が `any` → `unknown`
    - `c.req.query()` が `string` → `string | undefined`
    - `c.json(undefined)` が TypeError
  - **API が設計し直された**
    - `onError()` / `notFound()` がルーティング可能なミドルウェアに
    - 非 Error の throw も `onError` に流れるように
  - **非推奨の掃除**
    - `app.mount()` / `app.fire()` / `c.req.routePath` など
  - 💭 感想：（ここに書く）

- 個人的に気になったのは2つ
  - `c.req.json()` の `unknown` 化（地味だけど効く）
  - `onError()` のミドルウェア化（これが一番面白い）
  - 💭 なぜこの2つが気になったのか：（ここに書く）

### 2. 検証環境を作る

- v4 と v5 の依存が混ざらないよう、別ディレクトリで比較する
  - 📋 ディレクトリ構成とセットアップは「メモ②」参照
  - sandbox/ に実際のコードを置く
- Node.js は 22.12 以降で統一する
  - v5 が ESM only になった関係で、公式も 22.12+ を要求している
  - 22.12 なら `require('hono')` も一応動く（Node が ESM を require できるため）
  - 💭 ここ、「ESM only なのに require できる」のが面白いポイント
- 比較中にバージョンが変わらないよう、実際に入ったバージョンを記録しておく
  - `npm ls hono typescript` の出力を記事に貼る
- ⚠️ v5 で `@hono/*` アダプターを使う場合は、別途インストールが必要
  - 今回の検証は `app.request()` / `app.fetch()` ベースなのでアダプター不要

### 3. 実験①：型安全性 ―― `any` から `unknown` へ

- 優先度：高
- 何が変わったか
  - `c.req.json()` の戻り値が `Promise<any>` → `Promise<unknown>`
- v4 のコード
  - `body.name.toUpperCase()` が**型チェックを通ってしまう**
  - `name` が数値で来たら実行時エラー
  - 📋 コードは「メモ③」参照
- v5 のコード
  - 同じコードが**コンパイルエラーになる**
  - 型を絞り込むまでプロパティにアクセスできない
  - 📋 コードは「メモ④」参照
- 直し方は2通りある
  - A. 型引数を渡す：`c.req.json<{ name: string }>()`
    - 公式ガイドが示しているのはこっち
    - ⚠️ ただしこれは**実行時検証ではない**。嘘をついても通る
  - B. 型ガードを自分で書く
    - 📋 コードは「メモ⑤」参照
  - C. 実務的にはバリデーター（Zod + `@hono/zod-validator`）を使って `c.req.valid()`
    - 公式ガイドも `c.req.valid()` を案内している
  - 💭 感想：A は「型エラーを黙らせる」だけなので、unknown 化の意図を殺してる気がする（ここ掘る）
- 検証する項目
  - v4 では型エラーが出ないこと
  - v5 では型エラーになること（エラーメッセージを実際に貼る）
  - 型ガードを足せば通ること
  - 不正なリクエストが 400 になること
  - 📋 実行コマンドは「メモ⑥」参照
- 💭 ここの結論：（ここに書く）

- 合わせて `c.req.query()` も触る
  - キー無しで呼ぶと `Record<string, string | undefined>` になった
  - `const { name } = c.req.query()` の `name` が `string | undefined` に
  - `c.req.queries()` は `Record<string, string[] | undefined>`
  - 💭 これ、分割代入してる既存コードが一斉に赤くなるやつでは？（要検証）

- `c.json(undefined)` が TypeError になる話
  - v4：空ボディが返っていた
  - v5：`Response.json()` と同じく TypeError
  - 関数・シンボルを渡した場合も同様
  - 💭 「undefined を返してたことに気づいてない箇所」が炙り出されそう
  - ⚠️ これは型エラーではなく**実行時エラー**なので、テストがないと気づけない
    - → ここ、記事的に一番怖いポイントとして書けるかも

### 4. 実験②：エラーハンドリングの再設計 ―― ここが一番の推し

- 優先度：高
- v4 の `onError()`
  - シグネチャは `(err, c)`
  - アプリ全体に1つだけ。登録し直すと上書き
  - 📋 コードは「メモ⑦」参照
- v5 の `onError()`
  - シグネチャが `(c, next)` に。エラーは `c.error` から読む
  - **パスを指定できる**：`app.onError('/api/*', handler)`
  - **複数登録できて、合成される**（上書きではない）
  - `next()` で後続に委譲できる
  - 📋 コードは「メモ⑧」参照
- `notFound()` も同じ仕組みに変わった
  - こっちは PRD で見落としてた。公式ガイドには両方書いてある
  - `notFound((c) => ...)` の単一ハンドラ構文はそのまま使える
  - パス＋複数ミドルウェアも受け付ける
  - 📋 コードは「メモ⑨」参照
  - `notFound()` ミドルウェアは、未マッチのリクエストと明示的な `c.notFound()` の**両方**で走る
- 公式が挙げているルーティング規則（両 API 共通）
  - 登録は**合成**される。レスポンスを返せば止まり、`next()` で委譲する
  - パスは HTTP メソッドに依存せず、`basePath()` からの相対
  - パスを省略すると、現在の basePath 内の `*` として登録される
  - `route()` でサブアプリの `notFound()` も取り込まれる
    - **より深くネストしたサブアプリが優先**
    - 同じ深さなら、パスの具体性ではなく**登録順**で走る
  - スコープはリクエストパスにマッチする（どのアプリが登録したかは問わない）
    - リクエストパラメータは元のルートのもので、フォールバックスコープのものではない
  - チェーンの最後まで到達してレスポンスが確定しなければ、組み込みハンドラが使われる
  - `onError()` ミドルウェアが投げたエラーは組み込みエラーハンドラが処理する（`app.fetch()` の外には漏れない）
  - 💭 「登録順で走る」はハマりそう。実際に試して確かめる
- 非 Error の throw の扱いも変わった
  - v4：`throw 'oops'` は `app.fetch()` の外に漏れていた
  - v5：`Error` にラップされて `onError` に流れる
    - 元の値は `c.error.cause` から取れる
    - 文字列を投げた場合は `c.error.message` にもなる
  - 📋 コードは「メモ⑩」参照
  - 💭 これ地味に嬉しい。サードパーティのライブラリが変なもの投げても拾える
- 検証スクリプトで assert する
  - 📋 コードは「メモ⑪」参照
- 記事で答える問い
  - 「v5 の `onError()` は、v4 のグローバルエラーハンドリングと比べて何ができるようになったのか？」
  - 答えのイメージ：`/api/*` は JSON、それ以外は HTML、みたいな出し分けが**1つのアプリで**書ける
  - 💭 感想：（ここに書く）

### 5. 実験③：ワイルドカードのマッチング統一

- 何が変わったか
  - v4：Router の実装によってワイルドカードの挙動が違った
  - v5：全 Router で規則が統一された
- 規則（公式より）
  - セグメント**末尾**の `*` はワイルドカード。**何にもマッチしなくてよい**
  - セグメント**途中**の `*`（`/x*y` など）はワイルドカードではない
  - セグメントが `*` だけなら、**空でない1セグメント**にマッチ
- 公式が示す v5 の期待結果
  - 📋 表は「メモ⑫」参照
- 🔥 一番おいしいのはここ
  - RegExpRouter では `/x*/y` と `/x/*` を**同時に登録できない**（`UnsupportedPathError` が throw される）
  - その結果 **SmartRouter が TrieRouter にフォールバックする**
  - つまり「ルートの書き方次第で、実行時に選ばれる Router が変わる」＝ 性能特性も変わる
  - 💭 ここ、LT のクライマックスにできる。実際に再現させて見せたい
- 検証コード
  - 📋 コードは「メモ⑬」参照
  - v4 と v5 の両方で走らせて、結果の差分を表にする
  - さらに Router を明示的に切り替えて（RegExpRouter / TrieRouter / PatternRouter）比較すると深い
  - 💭 v4 で Router ごとにどう違ったかも実測して載せる

### 6. 実験④：パフォーマンス比較

- 優先度：中
- ⚠️ これは `app.fetch()` を使った**インプロセスのマイクロベンチ**
  - 実 HTTP サーバーも Cloudflare Workers 本番の性能も示さない
  - この but は記事に必ず書く
- ベンチ用 API とスクリプト
  - 📋 コードは「メモ⑭」「メモ⑮」参照
- 測定条件を揃える
  - 同じ Node.js / TypeScript バージョン
  - 同一マシン・同一コード
  - ウォームアップ後に測定
  - 最低5回測って中央値を取る
  - v4 → v5 → v5 → v4 と順序を入れ替える（熱ダレ・JIT の影響を均す）
- 💭 正直、差は出ないと予想してる。出なかったらそれはそれで「コアは変わってない」という結論
  - 結果 → 「メモ⑰」の記録シートに埋める

### 7. 実験⑤：バンドルサイズ

- 「アダプターが別パッケージになった＝軽くなった」は本当か？
  - 📋 コマンドは「メモ⑯」参照
- ⚠️ 注意点
  - アダプターが別パッケージになることと、最終バンドルが小さくなることは**同義ではない**
  - 結局 `@hono/bun` を入れれば同じものが入る
  - 「コアだけの比較」と「実際に使うアダプター込みの比較」の両方を出すと説得力が出る
- 💭 ここ、煽りタイトルに使われがちなので慎重に書く

### 8. 移行するときに踏みそうな地雷まとめ

- 型エラーで気づけるもの（＝まだ優しい）
  - `c.req.json()` の `unknown` 化
  - `c.req.query()` の `undefined` 混入
  - `onError()` のシグネチャ変更
- **型エラーでは気づけないもの（＝怖い）**
  - `c.json(undefined)` の TypeError
  - ワイルドカードのマッチング変更
  - `onError()` が上書きではなく合成になったこと
    - v4 で「後から登録して上書き」してたコードは、v5 では両方走る
    - 💭 これ気づかないと事故る。要検証
- 消えたもの（置き換え先がある）
  - `app.mount()` → `hono/mount` の Mount Middleware
    - `app.all('/itty-router/*', mount(ittyRouter.handle))`
    - ⚠️ PRD には「削除」とだけ書いてたけど、ちゃんと代替がある
  - `app.fire()` → `@hono/service-worker` の `fire(app)`
  - `c.req.matchedRoutes` / `c.req.routePath` → `hono/route` の `matchedRoutes()` / `routePath()`
  - `getColorEnabledAsync()` → `getColorEnabled(c.env)`
  - `toSSG()` の各種 Hook オプション → `plugins` 経由
    - `defaultPlugin()`（非200をスキップ）は `plugins` 省略時のみ自動適用。明示が必要
- 消えたもの（細かいやつ、記事の付録に）
  - Bearer Auth の `noAuthenticationHeaderMessage` 等 → `noAuthenticationHeader.message` 等
  - Serve Static の `pathResolve` オプション
  - SSG Helper の `SSG_DISABLED_RESPONSE` → `X_HONO_DISABLE_SSG_HEADER_KEY`
  - `timingSafeEqual()` が文字列のみ受け付けるように
  - `getQueryStrings()` → `URL` API
  - `UnOfficalStatusCode` → `UnofficialStatusCode`（タイポ修正）
    - 💭 これ、v4 のタイポがずっと残ってたのが面白い。小ネタに使える
- `hono/cloudflare-pages` は**代替なしで削除**
  - Cloudflare 自体が「Workers + static assets」を推してるため
  - Pages で Hono 使ってる人は影響大
  - 💭 自分のプロジェクトで影響あるか確認する

### 9. まとめ ―― 今すぐ移行すべきか

- 💭 結論：（検証後に書く）
- 書くときの観点
  - 新規プロジェクトなら？
  - 既存プロジェクトなら？
  - Cloudflare Pages 使ってるなら？
  - RC である以上、本番投入は待つべきか？
- 「壊れる」ことをネガティブに書きすぎない
  - `unknown` 化も `onError` のミドルウェア化も、**設計として素直になった**方向の変更
  - 壊れるのは、v4 が緩かったところ
  - 💭 ここの着地が記事の価値になる

- Thanks for listening

---

## 検証前チェックリスト

- [ ] v4 と v5 の正確なバージョンを記録した（`npm ls hono typescript`）
- [ ] `c.req.json()` の型チェック差分を確認した
- [ ] `c.req.query()` の分割代入が赤くなるか確認した
- [ ] `c.json(undefined)` の TypeError を実際に出した
- [ ] `onError()` の新 API（パス指定・複数登録・next()）を動作確認した
- [ ] `onError()` が「上書き」ではなく「合成」になることを確認した
- [ ] `notFound()` の新 API を動作確認した
- [ ] 非 Error の throw が `c.error.cause` に入ることを確認した
- [ ] ワイルドカードの挙動を v4/v5 で比較した
- [ ] RegExpRouter の `UnsupportedPathError` → TrieRouter フォールバックを再現した
- [ ] ベンチマークを5回以上測定して中央値を取った
- [ ] バンドルサイズを比較した（コアのみ／アダプター込み）
- [ ] 実験コードを sandbox/ に置いた
- [ ] 公式ドキュメントへのリンクを張った

---

## メモ（サンプルコード・資料）

> 本文の 📋 から参照されるコード置き場。
> **ここのコードはまだ実行していない想定**なので、走らせて結果を本文に反映すること。

### メモ① v4 → v5 変更点の一覧表

| 項目 | Hono v4 | Hono v5 |
| --- | --- | --- |
| モジュール形式 | ESM / CJS | **ESM のみ**（Node.js 22.12+） |
| ランタイムアダプター | `hono/<runtime>` に同梱 | `@hono/<runtime>` として別パッケージ |
| `hono/cloudflare-pages` | あり | **削除（代替なし）** |
| `hono/adapter` | あり | あり（`hono` に残る） |
| `onError()` | `(err, c)`、1つだけ・上書き | `(c, next)`、パス指定可・複数登録で合成 |
| `notFound()` | 単一ハンドラ | パス指定可・複数ミドルウェア可 |
| 非 Error の throw | `app.fetch()` の外に漏れる | `Error` にラップして `onError` へ |
| `c.req.json()` | `Promise<any>` | `Promise<unknown>` |
| `c.req.query()` | `Record<string, string>` | `Record<string, string \| undefined>` |
| `c.req.queries()` | `Record<string, string[]>` | `Record<string, string[] \| undefined>` |
| `c.json(undefined)` | 空レスポンス | `TypeError` |
| ワイルドカード | Router 間で差異あり | 全 Router で規則統一 |
| `app.mount()` | あり | 削除 → `hono/mount` |
| `app.fire()` | あり | 削除 → `@hono/service-worker` の `fire(app)` |
| `c.req.routePath` | あり | 削除 → `hono/route` の `routePath(c)` |

出典: https://hono.dev/docs/guides/migrating-to-v5

### メモ② 検証環境のセットアップ

ディレクトリ構成：

```
sandbox/
├── v4/
│   ├── package.json
│   └── src/
│       ├── app.ts
│       ├── verify.ts
│       ├── benchmark-app.ts
│       └── benchmark.ts
└── v5/
    ├── package.json
    └── src/
        └── （同じ構成）
```

セットアップ：

```sh
mkdir -p sandbox/v4/src sandbox/v5/src

cd sandbox/v4
npm init -y
npm install hono@4
npm install -D typescript tsx @types/node
cd ../..

cd sandbox/v5
npm init -y
npm install hono@next     # 5.0.0-rc.1 が入る
npm install -D typescript tsx @types/node
cd ../..
```

バージョンを記録（この出力を記事に貼る）：

```sh
(cd sandbox/v4 && npm ls hono typescript)
(cd sandbox/v5 && npm ls hono typescript)
node --version    # 22.12 以降であること
```

v5 側は `package.json` に `"type": "module"` を入れておく。

### メモ③ 型安全性：v4 のコード（型エラーが出ない）

```ts
import { Hono } from 'hono'

const app = new Hono()

app.post('/users', async (c) => {
  const body = await c.req.json() // any

  return c.json({
    name: body.name.toUpperCase(), // ← 型チェックを通ってしまう
  })
})

export default app
```

`name` が数値で送られてくると実行時に落ちる。型は守ってくれない。

### メモ④ 型安全性：v5 のコード（型エラーになる）

```ts
import { Hono } from 'hono'

const app = new Hono()

app.post('/users', async (c) => {
  const body = await c.req.json() // unknown

  return c.json({
    name: body.name.toUpperCase(),
    //    ^^^^ TypeScript Error: 'body' is of type 'unknown'.
  })
})

export default app
```

実際のエラーメッセージは `tsc` の出力をそのまま貼ること。

### メモ⑤ 型安全性：型ガードを書いた版

```ts
import { Hono } from 'hono'

const app = new Hono()

app.post('/users', async (c) => {
  const body = await c.req.json()

  if (
    typeof body !== 'object' ||
    body === null ||
    !('name' in body) ||
    typeof body.name !== 'string'
  ) {
    return c.json({ error: 'Invalid body' }, 400)
  }

  return c.json({
    name: body.name.toUpperCase(),
  })
})

export default app
```

公式が案内しているのはこちらの短縮形：

```ts
const body = await c.req.json<{ name: string }>()
```

ただしこれは**型引数を信じるだけで、実行時検証はしない**。
外部入力を扱うなら `@hono/zod-validator` などを使って `c.req.valid()` で受けるのが正しい。

### メモ⑥ 型チェックの実行コマンド

```sh
npx tsc --noEmit \
  --strict \
  --module NodeNext \
  --moduleResolution NodeNext \
  --target ES2022 \
  src/app.ts
```

v4 と v5 の両方で走らせて、診断結果の差分を記事に載せる。

### メモ⑦ エラーハンドリング：v4

```ts
import { Hono } from 'hono'

const app = new Hono()

app.onError((err, c) => {
  console.error(err.message)

  return c.json({ error: 'Internal Server Error' }, 500)
})

app.get('/error', () => {
  throw new Error('Something went wrong')
})

export default app
```

### メモ⑧ エラーハンドリング：v5

```ts
import { Hono } from 'hono'

const app = new Hono()

// パススコープ付きのエラーミドルウェア
app.onError('/api/*', async (c, next) => {
  console.error(c.error?.message)
  c.header('X-Error-Handler', 'api')
  await next() // 後続に委譲
})

// パス省略 = basePath 内の '*' に登録
app.onError((c) => {
  return c.json({ error: 'Internal Server Error' }, 500)
})

app.get('/api/error', () => {
  throw new Error('Something went wrong')
})

export default app
```

ポイント：

- エラーは引数ではなく `c.error` から読む
- 登録は**合成**される（v4 のような上書きではない）
- レスポンスを返せばチェーンが止まり、`next()` なら次へ
- `onError()` 内で投げたエラーは組み込みハンドラが処理する

### メモ⑨ `notFound()` も同じ形に

```ts
app.notFound(
  '/api/*',
  async (c, next) => {
    c.header('x-not-found', 'api')
    await next()
  },
  (c) => c.text('API resource not found', 404)
)
```

従来の単一ハンドラ構文もそのまま使える：

```ts
app.notFound((c) => c.text('Not Found', 404))
```

`notFound()` ミドルウェアは、未マッチのリクエストと `c.notFound()` の明示呼び出しの両方で走る。

### メモ⑩ 非 Error の throw

```ts
app.get('/throw-string', () => {
  throw 'oops' // v4 では app.fetch() の外に漏れていた
})

app.onError((c) => {
  // v5 では Error にラップされている
  console.log(c.error?.message) // 'oops'
  console.log(c.error?.cause)   // 'oops'（元の値）

  return c.json({ error: 'wrapped' }, 500)
})
```

オブジェクトを投げた場合は `c.error.cause` にだけ元の値が入る（`message` は入らない）。
→ 要検証。

### メモ⑪ エラーハンドリングの検証スクリプト

`sandbox/v5/src/verify.ts`：

```ts
import assert from 'node:assert/strict'
import app from './app.js'

const response = await app.request('http://localhost/api/error')

assert.equal(response.status, 500)
assert.equal(response.headers.get('X-Error-Handler'), 'api')

const body = await response.json()
assert.deepEqual(body, { error: 'Internal Server Error' })

console.log('All tests passed!')
```

実行：

```sh
npx tsx src/verify.ts
```

### メモ⑫ ワイルドカードの期待結果（公式より）

| ルート | パス | v5 |
| --- | --- | --- |
| `/x*/y` | `/x/y` | マッチ |
| `/x*/y` | `/xz/y` | マッチ（v4 の TrieRouter / PatternRouter はマッチしなかった） |
| `/x*/y` | `/x/z/y` | マッチしない |
| `/x*y` | `/xay` | マッチしない |
| `/wild/*/card` | `/wild//card` | マッチしない |

加えて：RegExpRouter では `/x*/y` と `/x/*` を同時に登録できず `UnsupportedPathError` が投げられるため、
SmartRouter は TrieRouter にフォールバックする。

### メモ⑬ ワイルドカードの検証コード

```ts
import { Hono } from 'hono'

const app = new Hono()

app.get('/x*/y', (c) => c.text('matched'))

const paths = ['/x/y', '/xz/y', '/x/z/y', '/xay', '/wild//card']

for (const path of paths) {
  const response = await app.request(`http://localhost${path}`)

  console.log({
    path,
    status: response.status,
    body: await response.text(),
  })
}
```

Router を明示して比較する版：

```ts
import { Hono } from 'hono'
import { RegExpRouter } from 'hono/router/reg-exp-router'
import { TrieRouter } from 'hono/router/trie-router'
import { PatternRouter } from 'hono/router/pattern-router'

const routers = {
  RegExpRouter: () => new RegExpRouter(),
  TrieRouter: () => new TrieRouter(),
  PatternRouter: () => new PatternRouter(),
}

for (const [name, factory] of Object.entries(routers)) {
  const app = new Hono({ router: factory() })
  app.get('/x*/y', (c) => c.text('matched'))
  // ... 同じ paths でループ
}
```

`UnsupportedPathError` の再現（RegExpRouter で両方登録）：

```ts
const app = new Hono({ router: new RegExpRouter() })
app.get('/x*/y', (c) => c.text('a'))
app.get('/x/*', (c) => c.text('b'))
await app.request('http://localhost/x/y') // ここで throw されるはず → 要検証
```

### メモ⑭ ベンチマーク用 API

`src/benchmark-app.ts`（両ディレクトリに同じものを置く）：

```ts
import { Hono } from 'hono'

export const app = new Hono()

app.get('/', (c) => c.text('Hello Hono!'))

app.get('/users/:id', (c) => {
  return c.json({
    id: c.req.param('id'),
    name: 'tanahiro2010',
  })
})

app.post('/users', async (c) => {
  const body = await c.req.json()
  return c.json({ data: body }, 201)
})
```

アダプターを含まないので、まず Hono コアを中心とした比較になる。

### メモ⑮ ベンチマークスクリプト

`src/benchmark.ts`：

```ts
import { performance } from 'node:perf_hooks'
import { app } from './benchmark-app.js'

const ITERATIONS = 100_000
const WARMUP = 10_000

const request = new Request('http://localhost/users/123')

async function run(n: number) {
  for (let i = 0; i < n; i++) {
    const res = await app.fetch(request.clone())
    if (res.status !== 200) {
      throw new Error(`Unexpected status: ${res.status}`)
    }
    await res.text()
  }
}

await run(WARMUP)

const start = performance.now()
await run(ITERATIONS)
const duration = performance.now() - start

console.log({
  iterations: ITERATIONS,
  durationMs: duration.toFixed(2),
  requestsPerSecond: Math.round(ITERATIONS / (duration / 1000)),
  averageMs: (duration / ITERATIONS).toFixed(6),
})
```

実行：

```sh
node --import tsx src/benchmark.ts
```

### メモ⑯ バンドルサイズの比較

両ディレクトリで：

```sh
npm install -D esbuild

npx esbuild src/benchmark-app.ts \
  --bundle \
  --platform=browser \
  --format=esm \
  --minify \
  --outfile=dist/bundle.js

wc -c dist/bundle.js
```

アダプター込みの比較もやる場合は、v4 は `hono/bun`、v5 は `@hono/bun` を import したエントリを別途用意する。

### メモ⑰ 結果記録シート（埋める）

| 測定 | v4 | v5 |
| --- | --- | --- |
| hono バージョン | | |
| 実行時間（ms, 中央値） | | |
| Requests/sec | | |
| バンドルサイズ（コアのみ, bytes） | | |
| バンドルサイズ（アダプター込み, bytes） | | |

測定環境：

- Node.js: （バージョン）
- TypeScript: （バージョン）
- マシン: （機種・CPU）
- 測定日: （日付）
