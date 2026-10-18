
## 1. 記事タイトルとコンセプト

「Hono v5 RCを触ってみた。v4から何が変わり、何が壊れるのか？」

副題：型安全性・エラーハンドリング・ルーティング・パフォーマンスを比較する

想定読者は、Honoを使っているバックエンドエンジニア、Cloudflare WorkersでAPIを開発している人、v5への移行を検討している人です。

記事で検証したい仮説は3つあります。

1. Hono v5では型に関する破壊的変更によって、v4で見逃されていたミスが検出しやすくなる。
2. エラーハンドリングとルーティングの変更は、既存のアプリケーションの挙動に影響する。
3. ランタイムアダプターの分離によって、パッケージ構成や配布サイズに変化がある。

なお、現時点ではこれらは検証する仮説であり、実測結果ではありません。

## 2. 公式情報からわかった主な変更点

| 項目                  | Hono v4      | Hono v5                |
| ------------------- | ------------ | ---------------------- |
| モジュール形式             | ESM / CJS    | ESMのみ                  |
| ランタイムアダプター          | Hono本体に同梱    | 別パッケージ                 |
| `onError()`         | `(err, c)`   | `(c, next)`            |
| `c.req.json()`の型    | `any`        | `unknown`              |
| `c.req.query()`の値   | `string`     | `string \\| undefined` |
| `c.json(undefined)` | 空レスポンス       | TypeError              |
| ワイルドカード             | Router間で差異あり | マッチング規則を統一             |
| `app.mount()`       | 利用可能         | 削除                     |

出典：[Hono公式Migration Guide](https://hono.dev/docs/guides/migrating-to-v5?utm_source=chatgpt.com)&#x20;

[image](https://www.google.com/s2/favicons?domain=https://hono.dev\&sz=32)

Hono



特に記事として掘り下げたいのは、`onError()`の変更です。

v4では、エラーハンドラーを専用のコールバックとして扱っていましたが、v5ではミドルウェア形式になり、パス単位のエラーハンドリングや複数ハンドラーの合成もできるようになっています。

単なる引数の変更ではなく、エラー処理の拡張性そのものが変わったと捉えると記事の価値が上がります。

## 3. 推奨する記事構成

記事の目次案

&#x20;コピー

1. はじめに：Hono v5 RCが登場 — なぜ今回のメジャーアップデートに注目するのか
2. 検証環境 — v4とv5を同じ条件で比較する
3. Breaking Changesの整理 — 移行時に注意すべき変更
4. 型安全性の検証 — `any`から`unknown`への変更を試す
5. エラーハンドリングの検証 — 新しい`onError()`を触る
6. ルーティングの検証 — ワイルドカードの挙動を比較する
7. パフォーマンス比較 — スループット・レイテンシ・配布サイズ
8. 移行時の注意点 — 既存アプリへの適用方法
9. まとめ — v5へ今すぐ移行するべきか

この構成なら、コードと測定結果を中心に展開でき、単なる公式ドキュメントの翻訳記事にもなりません。

## 4. 検証環境の構築

v4とv5の比較は、依存関係が混ざらないように別ディレクトリで行います。

ディレクトリ構成

hono-v5-benchmark/ ├── v4/ │   ├── package.json │   └── src/ │       ├── app.ts │       └── verify.ts └── v5/     ├── package.json     └── src/         ├── app.ts         └── verify.ts

まずはセットアップします。

```

mkdir hono-v5-benchmark
cd hono-v5-benchmark

mkdir -p v4/src v5/src

cd v4
npm init -y
npm install hono@4
npm install -D typescript tsx @types/node
cd ..

cd v5
npm init -y
npm install hono@5.0.0-rc.1
npm install -D typescript tsx @types/node
cd ..

```

比較中に最新バージョンへ変わらないよう、両環境とも実際にインストールされたバージョンを記録しておきましょう。

```
cd v4 && npm ls hono typescript && cd ..
cd v5 && npm ls hono typescript && cd ..
```

Node.jsは22.12以降で統一します。Hono v5の公式移行ガイドでも、ESM化に伴うNode.jsのバージョン要件が示されています。

[image](https://www.google.com/s2/favicons?domain=https://hono.dev\&sz=32)

Hono



## 5. 実験①：型安全性の変更を検証する

優先度：高

Hono v5で面白い変更の一つが、`c.req.json()`の戻り値が`any`から`unknown`になったこと。

### v4でのコード

```
import { Hono } from 'hono'

const app = new Hono()

app.post('/users', async (c) => {
  const body = await c.req.json()

  return c.json({
    name: body.name.toUpperCase(),
  })
})

export default app
```

v4では`body`が`any`なので、型チェックは通ってしまいます。仮に`name`が数値だった場合、実行時にエラーになります。

### v5でのコード

```
import { Hono } from 'hono'

const app = new Hono()

app.post('/users', async (c) => {
  const body = await c.req.json()

  return c.json({
    name: body.name.toUpperCase(),
    //    ^^^^ TypeScript Error
  })
})

export default app
```

v5では`body`が`unknown`なので、型を絞り込むまでプロパティアクセスできません。

つまり、危険な処理が型チェック段階で明らかになります。

### 改善後の実装

```
import { Hono } from 'hono'

const app = new Hono()

app.post('/users', async (c) => {
  const body: unknown = await c.req.json()

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

なお、v5でも`c.req.json<{ name: string }>()`と型を指定できますが、これは入力データの実行時検証ではありません。

外部からのリクエストを扱う場合は、Zodなどのバリデーターで検証するのが適切です。

検証する項目

- v4では型エラーなしで通ること
- v5では型エラーになること
- v5で型ガードを追加すれば正常に動くこと
- 不正なリクエストが400レスポンスになること

実行コマンド：

```
npx tsc --noEmit \
  --strict \
  --module NodeNext \
  --moduleResolution NodeNext \
  --target ES2022 \
  src/app.ts
```

記事にはv4とv5それぞれのTypeScript診断結果を掲載すると、変更点が伝わりやすくなります。

## 6. 実験②：エラーハンドリングの変更

優先度：高

ここが今回の個人的な推しポイントです。

### v4のエラーハンドリング

```
import { Hono } from 'hono'

const app = new Hono()

app.onError((err, c) => {
  console.error(err.message)

  return c.json({
    error: 'Internal Server Error',
  }, 500)
})

app.get('/error', () => {
  throw new Error('Something went wrong')
})

export default app
```

### v5のエラーハンドリング

```
import { Hono } from 'hono'

const app = new Hono()

app.onError('/api/*', async (c, next) => {
  console.error(c.error?.message)
  c.header('X-Error-Handler', 'api')

  await next()
})

app.onError((c) => {
  return c.json({
    error: 'Internal Server Error',
  }, 500)
})

app.get('/api/error', () => {
  throw new Error('Something went wrong')
})

export default app
```

この例では、`/api/*`専用のエラー処理を通してから、共通ハンドラーでJSONを返す構成にしています。

v5の`onError()`には以下の特徴があります。

- 特定のパスに適用できる。
- 複数のエラーミドルウェアを組み合わせられる。
- `next()`で後続のハンドラーへ処理を委譲できる。
- `Error`以外の値がthrowされても、`Error`にラップされて処理される。

これらは公式Migration Guideにも記載されています。

[image](https://www.google.com/s2/favicons?domain=https://hono.dev\&sz=32)

Hono



### 検証スクリプト

v5側の`src/verify.ts`を作成します。

```

import assert from 'node:assert/strict'
import app from './app.js'

const response = await app.request(
  'http://localhost/api/error'
)

assert.equal(response.status, 500)
assert.equal(
  response.headers.get('X-Error-Handler'),
  'api'
)

const body = await response.json()

assert.deepEqual(body, {
  error: 'Internal Server Error',
})

console.log('All tests passed!')

```

実行：

```
npx tsx src/verify.ts
```

記事で答える問い：

「Hono v5の`onError()`は、従来のグローバルエラーハンドリングと比べて何が便利になったのか？」

これを具体例とコードで説明します。

## 7. 実験③：Routerのマッチングを比較する

Hono v5では、ワイルドカードの挙動がRouter間で統一されています。

特に注目したいのが`/x*/y`というルートです。

### 検証コード

```

import { Hono } from 'hono'

const app = new Hono()

app.get('/x*/y', (c) => {
  return c.text('matched')
})

const paths = [
  '/x/y',
  '/xz/y',
  '/x/z/y',
]

for (const path of paths) {
  const response = await app.request(
    `http://localhost${path}`
  )

  console.log({
    path,
    status: response.status,
    body: await response.text(),
  })
}

```

このファイルを両環境で実行して比較します。

公式ドキュメントにあるv5の期待結果は以下のとおりです。

[image](https://www.google.com/s2/favicons?domain=https://hono.dev\&sz=32)

Hono



| リクエスト    | v5での期待結果 |
| -------- | -------- |
| `/x/y`   | 200      |
| `/xz/y`  | 200      |
| `/x/z/y` | 404      |

v4ではRouterによって差異があったため、単に「v4とv5の結果が違った」で終わらせず、Routerの種類や実行時に選択されたRouterにも注目すると深い記事になります。

ここは予想外の挙動が出る可能性もあり、実験として面白い部分です。

## 8. 実験④：v4とv5のパフォーマンス比較

優先度：中

こちらは少し本格的に検証したいところ。

Honoが軽量なフレームワークだからこそ、メジャーバージョンアップによる変化がどの程度あるか確かめます。

### ベンチマーク用API

`src/benchmark-app.ts`を両ディレクトリに配置します。

```

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
  const body: unknown = await c.req.json()
  return c.json({ data: body }, 201)
})

```

### ベンチマークスクリプト

`src/benchmark.ts`を作成します。

```

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
  requestsPerSecond: Math.round(
    ITERATIONS / (duration / 1000)
  ),
  averageMs: (duration / ITERATIONS).toFixed(6),
})

```

これをv4、v5でそれぞれ実行します。

```
node --import tsx src/benchmark.ts
```

なお、これは実際のHTTPサーバーを通さない、`app.fetch()`を利用したインプロセスのマイクロベンチマークです。ネットワーク経由の性能やCloudflare Workers本番環境の性能を直接示すものではありません。

信頼性を上げるため、次の条件を揃えます。

- 同じNode.js・TypeScriptのバージョンを使用する。
- 同一マシン、同一コードで比較する。
- ウォームアップ後に測定する。
- それぞれ最低5回計測し、中央値を使う。
- v4→v5→v5→v4のように順序を入れ替えて測定する。

### 結果記録シート

測定結果を入力

v4 実行時間（ms）

v4 Requests/sec

v5 実行時間（ms）

v5 Requests/sec

計測した4つの数値を入力すると、v4とv5の差分を自動計算します。

## 9. 実験⑤：バンドルサイズの比較

最後に、Honoの軽量化を検証します。

比較するのはnpmパッケージ全体のサイズだけでなく、実際にアプリケーションをビルドした際のバンドルサイズです。

両ディレクトリで：

```
npm install -D esbuild

npx esbuild src/benchmark-app.ts \
  --bundle \
  --platform=browser \
  --format=esm \
  --minify \
  --outfile=dist/bundle.js

wc -c dist/bundle.js
```

`benchmark-app.ts`にはランタイムアダプターを含まないため、まずHonoコアを中心とした比較ができます。

ただし、アダプターが別パッケージになったことと、最終的なバンドルサイズが減ることは同義ではありません。 実際のWorkersアプリで使用するアダプターやミドルウェアを含めた計測もできると、さらに説得力が増します。

## 10. 記事を書くときのチェックリスト

記事公開までの進捗

0/8

v4とv5の正確なバージョンを記録した

c.req.json()の型チェック差分を確認した

onError()の新しいAPIを動作確認した

ワイルドカードの挙動を比較した

ベンチマークを複数回測定した

バンドルサイズを比較した

Breaking Changesの影響をまとめた

実験コードと公式ドキュメントをリンクした

## 11. 記事の導入文ドラフト

# Hono v5 RCを触ってみた。v4から何が変わり、何が壊れるのか？

2026年10月10日、Hono v5.0.0-rc.1が公開されました。

HonoはCloudflare WorkersをはじめとするさまざまなJavaScriptランタイムで利用できる、軽量なWebフレームワークです。

今回のv5では、ランタイムアダプターの分離やESMへの一本化、エラーハンドリングAPIの再設計、型安全性の改善など、いくつかの破壊的変更が加えられています。

個人的に気になったのは、`c.req.json()`の戻り値が`any`から`unknown`になったこと、そして`onError()`がミドルウェア形式に変更されたことです。

これらの変更は、既存のHonoアプリケーションにどのような影響を与えるのでしょうか。

そこで今回は、Hono v4とv5 RCの環境をそれぞれ用意して、型チェック、エラーハンドリング、ルーティング、パフォーマンス、バンドルサイズの5項目を比較してみます。

なお、v5は現時点でリリース候補版のため、正式リリース時には仕様が変更される可能性があります。