---
published: false
summary: Hono v5 RC と v4を比較してみる
---

# Hono v5 RC を触ってみた。v4 から何が変わり、何が壊れるのか

> あなたのアプリ、v5 にしたら壊れますか。僕のは壊れました。

## この記事の結論

Hono v5 の RC が出たので、v4 と v5 の環境を別々に作って、**同じコードを両方で動かして差分を取りました**。型チェック・ランタイム挙動・ルーティング・性能・サイズの 5 系統を実測しています。

- **型で捕まる変更は、全部ちゃんと型で捕まった。** 移行の第一歩は `tsc --strict` を通すことです
- **本当に怖いのは、型でも捕まらない 3 つ。** `c.json(undefined)`、`onError()` の合成化、ワイルドカードのマッチ変更です
- **「軽くなった」はインストールサイズの話。** 最終バンドルはむしろ 302 バイト増えました

実測した環境です。

| 項目 | 値 |
| --- | --- |
| 検証日 | 2026-10-18 |
| v4 | `hono@4.13.13` |
| v5 | `hono@5.0.0-rc.1` |
| Node.js | v24.22.0 |
| TypeScript | 7.0.2 |
| マシン | Apple M4 (arm64) |

実験コードと生データはこちらです: https://github.com/tanahiro2010/slides/tree/main/slides/slides/Honov5%20RC%E3%82%92%E8%A7%A6%E3%81%A3%E3%81%A6%E3%81%BF%E3%82%8B

そして、この記事で一番伝えたいことを先に書いておきます。

**v5 で壊れるのは、v4 が緩かったところです。** `c.req.json()` が `any` を返していたのも、`c.req.query()` が `undefined` を隠していたのも、`onError()` が黙って上書きされていたのも、全部 v4 の側が嘘をついていた箇所でした。v5 はそれを正直にしただけです。だから移行は面倒ですが、面倒の量と設計の筋の良さは別の話です。

> この記事は Hono v5 の RC を触ってみた記録です。対象は、Hono を実際に使っていて「v5 にしたら何が壊れるのか」を知りたい人。
> **v5 は RC 版です。正式リリース時に仕様が変わる可能性があります。** この記事の内容は 2026-10-18 時点のものです。
> 事実確認は公式 Migration Guide、Hono リポジトリの PR 本文、npm registry、そして自分の計測に当たっています。確認できなかったことは「確認できていません」と書いています。

---

## 1. v5 は「AI のための Hono」だった

破壊的変更の一覧から入る前に、v5 が何を目指しているのかを先に書きます。ここを押さえると、個々の変更が全部同じ方向を向いていることが分かります。

作者の Yusuke Wada さんは、Hono Conference 2026 の発表で v5 を **「AI のための Hono」** と表現しています。

そして AI に優しい API の設計目標として、こう挙げています。

> 抽象化されていて、選択肢が少ない

これが v5 を読み解く鍵でした。

`c.req.json()` が `any` を返さなくなったのも、`onError()` が「1 つだけ登録できる特別な関数」から「普通のミドルウェア」になったのも、やることは同じです。**特殊な抜け道を潰して、選択肢を減らしている。**

人間なら「ここは `any` だけど実際は文字列が来るから大丈夫」と空気を読めます。LLM にコードを書かせると、その空気は読まれません。型が嘘をついていれば、嘘のまま出力されます。

そう考えると、この記事で後から出てくる変更が全部つながります。

## 2. 検証環境を作る

v4 と v5 の依存が混ざらないよう、ディレクトリを完全に分けました。

```sh
cd sandbox/v4
npm init -y && npm pkg set type=module
npm install hono@4
npm install -D typescript tsx @types/node

cd ../v5
npm init -y && npm pkg set type=module
npm install hono@next      # 5.0.0-rc.1 が入る
npm install -D typescript tsx @types/node
```

RC は `next` タグで配布されています。`npm install hono@next` が公式ガイドの案内する方法です。

実際に入ったバージョンがこれです。

```console
$ (cd sandbox/v4 && npm ls hono typescript)
v4@1.0.0
├── hono@4.13.13
└── typescript@7.0.2

$ (cd sandbox/v5 && npm ls hono typescript)
v5@1.0.0
├── hono@5.0.0-rc.1
└── typescript@7.0.2

$ node --version
v24.22.0
```

検証はすべて `app.request()` と `app.fetch()` で行っています。HTTP サーバーを立てていないので、ランタイムアダプターは不要です。

## 3. 型が厳しくなった

### `c.req.json()` が `any` から `unknown` へ

v4 ではこのコードが**型チェックを通ります**。

```ts
import { Hono } from 'hono'

const app = new Hono()

app.post('/users', async (c) => {
  const body = await c.req.json() // any

  return c.json({
    name: body.name.toUpperCase(), // ← 通ってしまう
  })
})
```

`name` に数値が送られてくれば実行時に落ちます。型は何も守ってくれていません。

v5 で同じコードを `tsc --strict` に通すと、こうなります。

```console
src/typecheck-json.ts(9,11): error TS18046: 'body' is of type 'unknown'.
```

絞り込むまでプロパティに触れなくなりました。

直し方は 3 つあります。公式ガイドが最初に挙げているのは型引数を渡す形です。

```ts
const body = await c.req.json<{ name: string }>()
```

ただし**これは実行時検証ではありません。** 型引数は「こう来るはずだ」という宣言でしかなく、嘘をついても通ります。`unknown` 化の意図は「中身を確かめてから触れ」ということなので、これで黙らせるのは本末転倒だと個人的には思っています。

素直なのは型ガードを書く形です。これは v5 でも型エラーになりませんでした。

```ts
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

  return c.json({ name: body.name.toUpperCase() })
})
```

実務的には 3 つ目、バリデーターを使って `c.req.valid()` で受けるのが正解です。公式ガイドもそう案内しています。

### `c.req.query()` の分割代入が一斉に赤くなる

こちらの方が影響範囲は広いと思います。

```ts
const { name } = c.req.query()
const upper: string = name.toUpperCase()

const all = c.req.queries()
const tags: string[] = all.tag
```

v4 は通ります。v5 はこうなりました。

```console
src/typecheck-query.ts(7,25): error TS18048: 'name' is possibly 'undefined'.
src/typecheck-query.ts(10,9): error TS2322: Type 'string[] | undefined' is not assignable to type 'string[]'.
  Type 'undefined' is not assignable to type 'string[]'.
```

キー無しで呼んだときの戻り値が `Record<string, string | undefined>` になったので、分割代入している箇所は全部赤くなります。

### 考察：実行時の値は何も変わっていない

ここが面白いところでした。`GET /q?a=1&a=2` を投げて、実際に返ってくる値を比べてみます。

| | v4 | v5 |
| --- | --- | --- |
| `c.req.query()` | `{"a":"1"}` | `{"a":"1"}` |
| `c.req.queries()` | `{"a":["1","2"]}` | `{"a":["1","2"]}` |

**完全に同じです。**

つまり v5 は挙動を変えていません。v4 でも存在しないキーを引けば `undefined` が返っていたのに、型が `string` だと言い張っていただけです。

変わったのは型が正直になったことだけ。赤くなった箇所は、もともと v4 の時点でバグり得た箇所です。

## 4. エラーハンドリングが再設計された

ここが v5 で一番面白い変更です。

### 何が変わったのか

v4 の `onError()` はこうでした。

```ts
app.onError((err, c) => {
  console.error(err.message)
  return c.json({ error: 'Internal Server Error' }, 500)
})
```

アプリ全体に 1 つだけ。シグネチャは `(err, c)`。

v5 はこうなります。

```ts
// パススコープ付きのエラーミドルウェア
app.onError('/api/*', async (c, next) => {
  console.error(c.error?.message)
  c.header('X-Error-Handler', 'api')
  await next()
})

// パス省略 = 現在の basePath 内の '*' に登録
app.onError((c) => {
  return c.json({ error: 'Internal Server Error' }, 500)
})
```

シグネチャが `(c, next)` になり、エラーは `c.error` から読みます。そしてパスを指定でき、複数登録できるようになりました。

この変更を入れた PR (#5541) には、設計意図がはっきり書かれています。

> The goal is to model error and not-found handling using Hono's routing system, including middleware composition, path scoping, sub-application handling, and Router-level decoration.

エラー処理を**ルーティングシステムの上に乗せ直した**わけです。実装としては `@ERROR` と `@NOT_FOUND` という予約メソッドで Router に登録されています。つまり内部的には、エラーハンドラも普通のルートと同じ仕組みで引かれています。

`notFound()` も同じ形になりました。

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

### 計測：パススコープは本当に効くのか

実際に動かして確かめました。

| リクエスト | `X-Error-Handler` | status | body |
| --- | --- | --- | --- |
| `/api/error` | `api` | 500 | `{"error":"Internal Server Error"}` |
| `/other/error` | （なし） | 500 | `{"error":"Internal Server Error"}` |

効いています。`/api/*` のときだけヘッダが付き、最終的なレスポンスは共通のハンドラが返しています。

同じことを v4 でやろうとすると、こうなります。

```console
this.errorHandler is not a function
```

v4 の `onError()` は引数を 1 つしか取らないので、パス文字列をハンドラとして保存してしまい、**リクエストが来た時点で落ちます**。登録時には何も言われません。`notFound()` も同様に `TypeError: onNotFound is not a function` になりました。

### ハマりポイント①：上書きではなく、合成になった

ここが移行で一番事故ると思います。

`onError()` を 2 回登録して、どちらが走るか記録しました。

| | 実行されたハンドラ | レスポンス |
| --- | --- | --- |
| **v4** | `["second"]` | `second` |
| **v5** | `["first", "second"]` | `second` |

**v4 は後勝ちの上書き、v5 は合成です。**

v4 では「あとから登録したものが前のを潰す」という前提のコードが書けました。それを v5 に持っていくと、両方走ります。

1 つ目がレスポンスを返した場合はチェーンが止まります。

| | 実行されたハンドラ | レスポンス |
| --- | --- | --- |
| v5 | `["first"]` | `first` |

`next()` を呼べば次に渡り、レスポンスを返せばそこで終わる。普通のミドルウェアと同じ規則です。

**そしてこれは型エラーになりません。** シグネチャさえ `(c, next)` に直せば `tsc` は通ります。実際に動かすまで気づけない類の変更です。

### ハマりポイント②：v4 の書き方のまま動かすと、意味不明なエラーが出る

v4 スタイルのハンドラを v5 で動かすとどうなるか、気になったので試しました。

まず型チェックはちゃんと止めてくれます。

```console
src/typecheck-onerror-v4style.ts(7,21): error TS2339: Property 'message' does not exist on type 'Context<BlankEnv, string, any>'.
src/typecheck-onerror-v4style.ts(8,12): error TS2339: Property 'json' does not exist on type 'Next'.
```

第 1 引数が `Context`、第 2 引数が `Next` になったことがそのまま出ています。ここで気づけます。

問題は、これを `@ts-expect-error` で黙らせて実行したときです。

```console
Context is not finalized. Did you forget to return a Response object or `await next()`?
```

**原因を全く指していません。**

実際に観測された引数はこうでした。

```json
{ "firstArgCtor": "Context", "firstArgIsContext": true, "secondArgType": "function" }
```

v4 のつもりで `c` として触っているものが `next` 関数なので、`c.text()` が存在せず例外になり、結果として Context が確定しないまま終わる。だからこのメッセージが出ます。

型エラーを握りつぶすと、デバッグがかなり遠回りになるパターンです。

### 非 Error を throw したときの扱い

v4 では、ハンドラから文字列やオブジェクトを throw すると `app.fetch()` の外まで漏れていました。

v5 では `Error` にラップされて `onError` に流れます。

| | v4 | v5 |
| --- | --- | --- |
| `throw 'oops'` | 外に漏れる | `message: 'oops'` / `cause: 'oops'` |
| `throw { code: 42 }` | 外に漏れる | `message: ''` / `cause: { code: 42 }` |

注意したいのはオブジェクトを投げた場合です。**`message` は空文字になります。** 元の値は `cause` にしか入りません。

```ts
app.onError((c) => {
  console.log(c.error?.message) // オブジェクトを投げると '' になる
  console.log(c.error?.cause)   // { code: 42 }
  return c.json({ error: 'wrapped' }, 500)
})
```

ログに `c.error.message` だけ出していると、何も分からないログが残ります。`cause` を見る必要があります。

サードパーティのライブラリが変なものを投げてきても拾えるようになったのは、素直にありがたい変更です。

## 5. 型では捕まらない、一番危ない変更

`c.json(undefined)` の挙動が変わりました。

| | v4 | v5 |
| --- | --- | --- |
| `c.json(undefined)` | 200 / ボディ長 0 | **500** |
| `c.json(() => 1)` | 200 / ボディ空 | **500** |

v5 で実際に投げられている例外がこれです。

```console
TypeError: Value is not JSON serializable
```

`Response.json()` と同じ挙動に揃えた、というのが公式の説明です。筋は通っています。

問題は、**これが型エラーにならないこと**です。

`c.json()` に渡す値が条件分岐の結果 `undefined` になり得るコードは、`tsc` を何回通しても何も言われません。`onError` を登録していなければ組み込みハンドラが 500 を返すので、本番で初めて気づくことになります。

この記事で挙げる移行チェックの中で、優先度は一番高いと思っています。テストがないと検出できません。

具体的にどこで踏むかを予想しておきます。一番ありそうなのは、DB から引いた 1 件を `c.json()` にそのまま渡しているコードです。

```ts
const user = await db.query.users.findFirst({ where: eq(users.id, id) })
return c.json(user) // 見つからなければ undefined
```

v4 では 404 を返すつもりが 200 で空ボディ、という見落としがそのまま通っていました。v5 はこれが 500 になります。**つまり v5 で 500 が出る箇所は、v4 の時点ですでにバグっていた箇所**だと思います。壊れたのではなく、隠れていたバグが表に出るだけ、という見方をしています。

もうひとつありそうなのが、`void` を返す関数の戻り値をそのまま渡しているケースです。こちらは型が `void` なので `tsc` が止めてくれる可能性もありますが、`any` を経由していると抜けます。

どちらも推測で、自分のプロジェクトで数えたわけではありません。

## 6. ワイルドカードのマッチングが統一された

### v4 は Router ごとにバラバラだった

v4 で同じルートを 4 つの Router に登録して、マッチするかどうかを総当たりしました。

| ルート | パス | SmartRouter | RegExpRouter | TrieRouter | PatternRouter |
| --- | --- | --- | --- | --- | --- |
| `/x*/y` | `/x/y` | ❌ | ❌ | ❌ | ❌ |
| `/x*/y` | `/xz/y` | ✅ | ✅ | ❌ | ❌ |
| `/x*/y` | `/x/z/y` | ❌ | ❌ | ❌ | ❌ |
| `/x*y` | `/xay` | ✅ | ✅ | ❌ | ❌ |
| `/wild/*/card` | `/wild//card` | ❌ | ❌ | ✅ | ❌ |
| `/wild/*/card` | `/wild/a/card` | ✅ | ✅ | ✅ | ✅ |

**6 ケース中 3 ケースで結果が割れています。**

`/wild/*/card` に至っては、TrieRouter だけが `/wild//card` にマッチします。Router を切り替えた瞬間にルーティングが変わるということです。

### v5 は完全に一致した

同じ表を v5 で取り直しました。

| ルート | パス | SmartRouter | RegExpRouter | TrieRouter | PatternRouter |
| --- | --- | --- | --- | --- | --- |
| `/x*/y` | `/x/y` | ✅ | ✅ | ✅ | ✅ |
| `/x*/y` | `/xz/y` | ✅ | ✅ | ✅ | ✅ |
| `/x*/y` | `/x/z/y` | ❌ | ❌ | ❌ | ❌ |
| `/x*y` | `/xay` | ❌ | ❌ | ❌ | ❌ |
| `/wild/*/card` | `/wild//card` | ❌ | ❌ | ❌ | ❌ |
| `/wild/*/card` | `/wild/a/card` | ✅ | ✅ | ✅ | ✅ |

**4 つとも一致しました。** 公式ドキュメントが示している表とも完全に同じです。

規則はこうなりました。

- セグメント**末尾**の `*` はワイルドカード。何にもマッチしなくてよい
- セグメント**途中**の `*`（`/x*y` など）はワイルドカードではない
- セグメントが `*` だけなら、空でない 1 セグメントにマッチ

v4 から挙動が変わったのは `/x*/y` と `/x/y`（全 Router で ❌ → ✅）、それと `/x*y` と `/xay`（RegExp 系で ✅ → ❌）です。ここも型では捕まりません。

### ハマりポイント③：ルートを 1 行足すと、Router が入れ替わる

ここが今回の検証で一番面白かったところです。

`/x*/y` と `/x/*` を同時に登録すると、v5 の RegExpRouter はこれを処理できません。

```console
UnsupportedPathError: /x/*
```

そして SmartRouter は、RegExpRouter が投げたこの例外を受けて **TrieRouter にフォールバックします**。

実際に、アプリが最終的にどの Router を選んだかを見てみました。

| 登録したルート | v5 で選ばれた Router |
| --- | --- |
| `/x/*` のみ | `SmartRouter + RegExpRouter` |
| `/x*/y` + `/x/*` | `SmartRouter + TrieRouter` |

**ルートを 1 行足しただけで、実行時に選ばれる Router が変わりました。**

しかも同じ競合ルートを v4 と v5 で引き比べると、マッチするハンドラ自体が違います。

| | v4 | v5 |
| --- | --- | --- |
| `/x/y` へのリクエスト | `/x/*` の方 | `/x*/y` の方 |

ルーティングの結果が静かに変わるので、型でもテストでも気づきにくい変更です。

### 計測：フォールバックのコスト

Router が変わるなら性能も変わるはずなので、測りました。`GET /users/:id` を 50,000 回、12 ラウンドです。

| | Router | 中央値 | 平均 | 最小 |
| --- | --- | ---: | ---: | ---: |
| 競合なし | `SmartRouter + RegExpRouter` | 138.68 ms | 152.28 ms | 132.35 ms |
| 競合あり | `SmartRouter + TrieRouter` | 148.57 ms | 163.99 ms | 146.25 ms |
| **差** | | **+7.1%** | **+7.7%** | **+10.5%** |

中央値・平均・最小のすべてで、フォールバック側が遅くなりました。

ひとつ正直に書いておくと、**これは測り直した値です。** 最初に 3 ラウンドで測ったときは差が 3.3% しか出ず、再実行したら 8.1% になりました。ラウンド数が足りず、結論が安定していませんでした。

12 ラウンドに増やしたあとの生データには 287 ms や 271 ms といった外れ値（GC か OS のスケジューリングだと思います）も混ざっています。なので外れ値の影響を受けにくい最小値での比較、つまり **+10.5%** が実態に近いと見ています。

### 考察：なぜ遅くなるのか

公式ドキュメントによると、RegExpRouter は登録されたルートを「1 本の巨大な正規表現」にまとめ、1 回のマッチングで結果を得ます。TrieRouter は Trie 木を使う実装で、全パターンをサポートする代わりに RegExpRouter ほど速くはない、とされています。

そして SmartRouter のデフォルト構成は `[new RegExpRouter(), new TrieRouter()]` です。アプリ起動時に速い方から順に試し、扱えるものを選んで以降それを使い続けます。つまり **「速い方を試して、ダメなら全パターン対応の方」** という設計です。

今回はその「ダメなら」の分岐を踏んだので、差が出たこと自体は設計通りです。

ここからは推測です。正規表現 1 本に畳んである RegExpRouter は、ルートが増えてもマッチングのコストがほとんど変わらないはずです。対して TrieRouter は木を辿るので、パスのセグメント数とルート数に応じてコストが乗ると思います。だとすると、今回測った 7〜10% という差はこのアプリの規模での話で、**ルートが数百本あるアプリではもっと開く**のではないかと見ています。実装を読んで確かめたわけではないので、裏は取れていません。

逆に言えば、小さいアプリならフォールバックしても体感には出ないはずです。

ただ、7〜10% という数字自体は正直どうでもいいと思っています。問題は**ルートを 1 本足しただけで無言で切り替わる**ことの方です。ログにも型にも出ません。

そしてこれは「遅くなる」だけの話で終わらない気がしています。SmartRouter が選ぶ Router が変わるということは、6 章で見た通り**マッチするハンドラが変わり得る**ということでもあります。今回は v4 と v5 の比較でそれが出ましたが、同じ v5 の中でもルートの追加順や組み合わせ次第で踏む可能性があるのでは、と疑っています。ここは試しきれていないので、完全に推測です。

## 7. 速くなったのか

コアのルーティング性能そのものも測りました。

> **注意：これは `app.fetch()` を使ったインプロセスのマイクロベンチです。**
> HTTP サーバーを立てていないので、実サーバーや Cloudflare Workers 本番の性能は示しません。
> ネットワーク・TLS・プロセス境界のコストは一切含まれていません。

`GET /users/:id` を 100,000 回（ウォームアップ 20,000 回）、v4 と v5 を交互に 10 ラウンドです。

| 統計量 | v4 | v5 | 差 |
| --- | ---: | ---: | ---: |
| 中央値 | 270.53 ms | 266.50 ms | v5 が 1.5% 速い |
| 平均 | 278.24 ms | 271.85 ms | v5 が 2.3% 速い |
| 最小 | 258.31 ms | 255.59 ms | v5 が 1.1% 速い |

**結論は「差は誤差の範囲」です。**

どの統計量でも v5 がわずかに速い方向ではあります。でも v4 の最小値（258.31 ms）が v5 の中央値（266.50 ms）より速く、分布が大きく重なっています。この測り方で「v5 は速くなった」と言うのは無理があります。

### 考察：ラウンド数を書かないベンチマークは読めない

これも正直に書いておきます。5 ラウンドで測ったときは差が 2.9% ありました。10 ラウンドに増やしたら 1.5% に縮みました。

同じコード、同じマシン、同じ日です。**ラウンド数を変えただけで結論の見え方が倍違いました。**

Router フォールバックの方でも同じことが起きています（3 ラウンドで 3.3%、12 ラウンドで 7.1%）。

マイクロベンチで数 % を語るときは、ラウンド数と分布を出さないと意味がない。今回はそれを身をもって踏みました。この記事で数字を出している箇所には、全部ラウンド数を書いています。

そして「コアのルーティング性能は v4 から据え置き」というのは、悪い結論ではないと思っています。v5 の変更は性能のためのものではないからです。

## 8. 「軽くなった」は、何が軽くなったのか

v5 ではランタイムアダプターが `hono` 本体から切り離され、`@hono/*` として別パッケージになりました。これを「軽量化」と書く記事が出てくると思うので、何が軽くなったのかを分けて測りました。

### インストールサイズは確かに減った

npm registry の `unpackedSize` を引きました。

| | 展開後サイズ | ファイル数 |
| --- | ---: | ---: |
| `hono@4.13.13` | 1.23 MB | 574 |
| `hono@5.0.0-rc.1` | 0.66 MB | 310 |
| **差** | **-46%** | **-46%** |

手元の `node_modules` を `du -sh` で測ると 2.8 MB → 1.5 MB で、こちらも **-46%** でした。

そして Yusuke Wada さんが Hono Conference 2026 の発表で出している数字も、1.29 MB → 0.70 MB の **-46%**、ファイル数 574 → 310 です。ファイル数は完全に一致しました。サイズの絶対値が少しずれているのは、おそらく参照しているバージョンの違いです。

3 つの独立した測り方で同じ比率が出たので、この数字は信用していいと思います。

### でもバンドルサイズは増えた

ここが本題です。esbuild で実際にバンドルして比べました。

| エントリ | v4 | v5 | 差分 |
| --- | ---: | ---: | ---: |
| コアのみ | 18,528 B | 18,830 B | **+302 B (+1.6%)** |
| アダプター込み | 22,760 B | 22,923 B | **+163 B (+0.7%)** |

**減るどころか増えています。**

考えてみれば当たり前で、インストールサイズが減ったのは CJS ビルドを削除したこと、そしてアダプターを別パッケージに出したことの効果です。CJS ビルドはそもそもバンドルには入りません。アダプターも、結局 `@hono/bun` を入れれば同じコードが入ります。

バンドラが tree-shaking で落としていた分が、パッケージ分割で物理的に分かれただけ。最終的に実行されるコード量は変わりません。

**「Hono v5 で軽量化」と書くときは、インストールサイズの話なのかバンドルサイズの話なのかを分けて書く必要があります。** 前者は正しく、後者は（少なくとも今回の測定では）間違いです。

## 9. ESM only と、アダプター分離のまわり

### ESM only なのに `require()` できる

v5 は CJS ビルドを削除して ESM only になりました。公式ガイドは Node.js 22.12 以降を要求しています。

面白いのは、その条件下では `require('hono')` が**動く**ことです。

| 確認内容 | 結果 |
| --- | --- |
| v4 で `require('hono')` | OK |
| v5 で `require('hono')` | **OK** |
| v4 で `import('hono/bun')` | 解決できる |
| v5 で `import('hono/bun')` | `ERR_PACKAGE_PATH_NOT_EXPORTED` |

Node.js 22.12 以降は ESM を `require()` できるようになったので、パッケージが ESM only でも `require` が通ります。公式ガイドにもその旨が書かれていて、実際にその通りでした。

ただし `hono/bun` のようなサブパスは `exports` から消えているので、こちらは確実に壊れます。壊れるのは「CJS で読んでいること」ではなく「サブパス import」の方です。

### アダプターは 8 つ、すべて 2026-09-28 に公開されている

npm registry で初版の公開日を引きました。

| パッケージ | 初版公開日 |
| --- | --- |
| `@hono/bun` / `@hono/deno` / `@hono/cloudflare-workers` | 2026-09-28 |
| `@hono/vercel` / `@hono/netlify` | 2026-09-28 |
| `@hono/aws-lambda` / `@hono/lambda-edge` | 2026-09-28 |
| `@hono/service-worker` | 2026-09-28 |

8 つとも同じ日に 1.0.0 が出ています。v5 のために切り出されたパッケージ群です。

2 つ補足があります。

**`@hono/node-server` はこの 8 つに含まれません。** 初版が 2023-01-07 で、v4 の時代からずっと別パッケージでした。v5 で切り出されたものと混同しないよう注意してください。

**`@hono/cloudflare` というパッケージは存在しません。** Cloudflare 向けは `@hono/cloudflare-workers` です。そして `hono/cloudflare-pages` は**代替なしで削除**されました。Cloudflare 自身が Workers + static assets を推しているため、というのが公式の説明です。Pages で Hono を使っている人は影響が大きいところです。

### 外部からの PR は、10 月 5 日に閉じられた

アダプター分離について「依存を減らしてサプライチェーン攻撃の対象を狭める狙いもある」という見方を聞いていたので、裏を取ろうとしました。

結論から言うと、**Hono Conference 2026 の発表スライドでは、アダプター分離とサプライチェーン対策を結びつける記述は見つけられませんでした。** そこで挙げられているのはパッケージサイズとファイル数の削減です。分離の目的そのものは明記されていません。

一方で、外部 PR の受付停止は事実でした。2026 年 10 月 5 日に、`honojs/hono` は外部コントリビューターからの PR を受け付けなくなっています。理由として挙げられているのは、

> PR が増えた / GitHub の inbox を見るのが追いつかない

というレビュー容量の問題です。PR の品質そのものは問題なかったとされています。

実際にリポジトリの直近の PR を見ると、マージされているものは `yusukebe` と `usualoma` の 2 人のものばかりで、外部コントリビューターの PR は open のまま残っていました。

なお、Yusuke Wada さんには「Honoでのサプライチェーン侵害対策 〜 3つのライブラリに学ぶ」という別の発表もあります。そちらにはアダプター分離を含む対策が挙げられているようですが、**スライドのテキスト抽出が崩れていて正確に読み取れませんでした。** この記事では断定を避けます。

## 10. `defineHandler()` ―― 「選択肢が少ない」の実物

1 章で書いた「抽象化されていて、選択肢が少ない」が一番はっきり出ているのが、v5 で入った `defineHandler()` です。experimental 扱いですが、方向性がよく分かるので触ってみました。

一番単純な形がこれです。

```ts
import { defineHandler } from 'hono/factory'

app.get('/ping', defineHandler(() => ({ pong: true })))
```

```console
ping -> 200 {"pong":true}
```

`c.json()` を呼んでいません。**返した値が Response に変換されます。** オブジェクトなら JSON、文字列や JSX なら HTML、`null` や `undefined` なら 204 です。

リクエストとレスポンスの検証を同じ場所に書けます。

```ts
app.post(
  '/users',
  defineHandler({ json: NameSchema })((c, input) => ({
    name: input.json.name.toUpperCase(),
  }))
)
```

`NameSchema` は [Standard Schema](https://standardschema.dev/) に準拠していれば何でも渡せます。Zod などがそのまま使えるということです。

検証に失敗するとこう返りました。

```console
schema ng -> 400 {"error":"Validation failed","issues":[{"slot":"json","issues":[{"message":"name must be a string","path":"name"}]}]}
```

ここで一点ハマりました。**Standard Schema ではなく普通の検証関数を渡して、その中で `throw` すると 400 ではなく 500 になります。**

```console
invalid -> 500 Internal Server Error
```

検証関数も渡せる API なので同じ扱いになると思い込んでいましたが、`HTTPException` にラップして 400 にしてくれるのは Standard Schema のルートだけでした。400 を返したいなら Standard Schema 形式で返す必要があります。

そして型定義のコメントに、この API の思想がそのまま書かれていました。

> A JSON Response by `c.json()` is not accepted, because it bypasses the response validation. Return the value instead.

`c.json()` を返すことを**型で禁止しています。** レスポンス検証を迂回できてしまうからです。

「やり方が複数あって、どれを選んでもだいたい動く」から「正しいやり方が 1 つで、他は型で止まる」への移行。1 章で引いた設計目標が、そのまま形になっていると思いました。

なお `defineHandler()` は experimental です。正式リリースまでに変わる可能性があります。

## 11. 移行チェックリスト

実測を踏まえて、優先度順に並べました。

### まず `tsc --strict` を通す（型で捕まる）

- `c.req.json()` の結果に直接プロパティアクセスしている箇所
- `const { x } = c.req.query()` の分割代入
- `c.req.queries()` の戻り値を `string[]` として扱っている箇所
- `app.onError((err, c) => ...)` を `(c) => ...` + `c.error` に書き換え

ここは全部コンパイラが教えてくれます。機械的に潰せます。

### 次に、型では捕まらない 3 つを潰す

- **`c.json()` に `undefined` が渡り得る箇所** —— 500 になります。テストがないと気づけません
- **`onError()` / `notFound()` を複数回登録している箇所** —— 上書きではなく合成されます
- **ワイルドカードを含むルート** —— `/x*/y` と `/x/y` のマッチ結果が変わります

ここが本番です。型チェックを通したから安心、とはなりません。

あわせて `/x*/y` と `/x/*` のような競合ルートがないかも見ておくと、Router のフォールバックを避けられます。

### import を書き換える

- `hono/<runtime>` → `@hono/<runtime>`（8 パッケージ）
- `hono/cloudflare-pages` は代替なし。Workers への移行が必要
- `app.mount()` → `hono/mount` の `mount()`
- `app.fire()` → `@hono/service-worker` の `fire(app)`
- `c.req.routePath` / `c.req.matchedRoutes` → `hono/route`
- `getColorEnabledAsync()` → `getColorEnabled(c.env)`
- `toSSG()` の各種 Hook オプション → `plugins` 経由（`defaultPlugin()` は明示が必要）

細かいところでは `UnOfficalStatusCode` が `UnofficialStatusCode` に直っています。v4 からずっと残っていたタイポがここで修正されました。

## 12. 今回確認できなかったこと

全部は追いきれていません。残したものを書いておきます。

- `route()` でサブアプリの `notFound()` を取り込んだときの優先順位。PR 本文には「深くネストしたサブアプリが先に走る」「同じ深さなら登録順」と書かれていますが、実際には動かしていません
- `basePath()` と `onError()` のパス解決を組み合わせたときの挙動
- 実 HTTP サーバー経由のベンチマーク。今回は全部 `app.fetch()` です
- Cloudflare Workers 実環境での計測
- `@hono/zod-validator` と `c.req.valid()` の組み合わせ
- Hono CLI 1.0 RC

それから冒頭にも書いた通り、**v5 は RC です。** ここに書いた挙動が正式リリースで変わる可能性があります。

## 13. まとめ

実測して一番強く思ったのは、**v5 で壊れるのは v4 が緩かったところだけ**ということでした。

`c.req.json()` の `any` も、`c.req.query()` の `string` も、型が嘘をついていました。v5 はそれをやめただけで、挙動は 1 ミリも変わっていません（実際、クエリの実行時の値は v4 と v5 で完全に同じでした）。`onError()` の合成化も、「特別な 1 個の関数」をやめて普通のミドルウェアに揃えた結果です。

方向性としては、1 章で引いた **「抽象化されていて、選択肢が少ない」** で一貫しています。`defineHandler()` が `c.json()` を型で拒否するところまで含めて、全部同じ思想でした。

移行コストは正直に言って安くありません。でもその大半は `tsc --strict` が指してくれます。本当に気をつけるべきは、型でも捕まらない 3 つ —— `c.json(undefined)`、`onError()` の合成化、ワイルドカードのマッチ変更です。この 3 つだけは、テストを書くか目で追うしかありません。

性能は据え置きでした。インストールサイズは半分近くになりましたが、バンドルサイズは変わりません。**v5 に上げる理由は、速さでも軽さでもなく、API の筋の良さだと思います。**

今すぐ本番に入れるかと言われれば、RC なので待ちます。でも手元のプロジェクトを `hono@next` で一度ビルドしてみるのは、今やる価値があります。型エラーの量を見れば、移行コストがその場で分かるからです。

最後に、正式リリースまでの予想を書いておきます。

ここまで見てきた変更のうち、**ひっくり返るとしたら `defineHandler()` だと思っています。** experimental と明記されている唯一の API で、しかも「検証関数で throw すると 400 ではなく 500」のような、まだ角が取れていない挙動が残っています。逆に `onError()` の再設計とワイルドカードの統一は、PR で設計が詰められていて実装も入り切っているので、このまま出ると見ています。

それと、**移行で一番詰まるのは `hono/cloudflare-pages` の削除**ではないかと予想しています。他の変更は書き換えれば済みますが、これだけは代替がなく、Workers への移行という別作業が発生するからです。型エラーの数で言えば `c.req.query()` が圧倒的に多いはずですが、あれは機械的に潰せます。時間を食うのは数ではなく、代替のない 1 件の方だと思います。

どちらも外れるかもしれません。正式版が出たら答え合わせをします。

僕のプロジェクトは、ちゃんと壊れました。

### 参考

- [Migrating to v5 — Hono](https://hono.dev/docs/guides/migrating-to-v5) — v5 の破壊的変更の一覧。この記事の検証項目はここから取った
- [feat!: add routable error and not-found middleware (honojs/hono#5541)](https://github.com/honojs/hono/pull/5541) — `onError()` / `notFound()` 再設計の PR。`@ERROR` / `@NOT_FOUND` の実装方針や、サブアプリでの優先順位が書かれている
- [Hono Conference 2026 — Yusuke Wada](https://slides.yusu.ke/honoconf-2026) — 「AI のための Hono」という v5 の位置づけ、パッケージサイズの数字、外部 PR 受付停止の経緯
- [honojs/hono releases](https://github.com/honojs/hono/releases) — `5.0.0-rc.0`（2026-10-08）と `5.0.0-rc.1`（2026-10-10）の公開日
- [Standard Schema](https://standardschema.dev/) — `defineHandler()` が受け付けるスキーマの共通インターフェース
- [Routers — Hono](https://hono.dev/docs/concepts/routers) — RegExpRouter / TrieRouter / SmartRouter それぞれの仕組みと、デフォルトの組み合わせ
- [Mount Middleware — Hono](https://hono.dev/docs/middleware/builtin/mount) — 削除された `app.mount()` の移行先
