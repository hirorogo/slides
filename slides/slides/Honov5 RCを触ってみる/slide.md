---
title: Honov5 RCを触ってみる
description: 〜 v4 と並べて、何が壊れるのか確かめた 〜
author: 田中博悠 / tanahiro2010
date: 2026-10-18
slug: hono-v5-rc
published: true
---

::title::

# Honov5 RCを触ってみる

〜 v4 と並べて、何が壊れるのか確かめた 〜

田中博悠 / tanahiro2010

::note::

「Honov5 RCを触ってみる」、田中博悠です。よろしくお願いします。

全 129 枚・想定 15〜20 分。**LT 枠（5分）なら「性能」「サイズ」「設計」の 3 章と移行チェックリストを落とす** → 約 55 枚。

---

## 田中博悠 / tanahiro2010

- 三田学園高等学校 1年
- Hono Conference 2026 コアスタッフ
- 個人開発でずっと Hono を使ってる

# Hono、好きです

::right::
![tanahiro2010](./img/tanahiro_hono.jpg)

::note::

高校1年で、Hono Conference 2026 のコアスタッフをやっています。個人開発でずっと Hono を使っていて、だから v5 の破壊的変更が他人事じゃないという立場です。

**15 秒で切る。**

---

::center::

Hono v5 RC、出ましたね

::note::

Hono v5 の RC、出ましたね。触った人いますか？

---

## v5 RC

- 10月8日 → `5.0.0-rc.0`
- 10月10日 → `5.0.0-rc.1`

-# honojs/hono releases

::note::

10月8日に rc.0、その 2 日後の 10日に rc.1 が出ています。

**聞かれたら:** latest タグはまだ 4.13.13 系。RC は next タグで配られている。

---

::center size=3::

```sh
npm i hono@next
```

::note::

`npm i hono@next` で入ります。これが公式ガイドの案内する方法です。

---

::center::

もう触れます

::note::

もう誰でも触れる状態です。

---

::center size=2 bg=blue::

で

::note::

ここから本題に入ります。**一拍。**

---

::center::

あなたのアプリ、

v5 にしたら壊れますか？

::note::

みなさんに聞きたいんですけど、あなたのアプリ、v5 にしたら壊れますか？

**客席を見て、数秒待つ。**

---

::center::

⋯

::note::

……

焦らす。1〜2秒。

---

::center size=2::

**僕のは壊れました**

::note::

**僕のは壊れました。**

ここで笑いが取れる。この後に出てくる型エラーの山が全部それです。

---

::center size=1.5 bg=white::

方針

::note::

まず今日の方針から。

---

::center::

Migration Guide の翻訳はしない

::note::

最初に言っておくと、公式の Migration Guide の翻訳はしません。読めば分かることは話さないです。

**この宣言で以降の信頼が変わる。** 省略しない。

---

## やったこと

- v4 と v5 の環境を**別々に**作る
- **同じコードを両方で動かす**
- 差分だけを見る

::note::

やったことは単純で、v4 と v5 の環境を別々のディレクトリに作って、**同じ .ts を両方の tsc にかけて、同じリクエストを両方に流しました。** その差分だけを見ます。

---

::center::

「ドキュメントにこう書いてある」

↓

「実際にこうなった」

::note::

「ドキュメントにこう書いてある」ではなく「実際にこうなった」を出します。

---

## 環境

| | |
|---|---|
| v4 | `hono@4.13.13` |
| v5 | `hono@5.0.0-rc.1` |
| Node.js | v24.22.0 |
| TypeScript | 7.0.2 |

-# Apple M4 / 2026-10-18 時点

::note::

環境です。v4 が 4.13.13、v5 が 5.0.0-rc.1。Node は 24.22、TypeScript は 7.0.2。

**読み上げない。** 「手元の環境はこれです」で次へ。**RC なので正式版で変わる可能性がある、は口頭で必ず添える。**

---

::center size=1.5 bg=white::

型

::note::

1 つ目、型の話。

---

## `c.req.json()`

```ts
app.post('/users', async (c) => {
  const body = await c.req.json()

!!   return c.json({ name: body.name.toUpperCase() })
})
```

- v4 → `any`
- v5 → `unknown`

::note::

`c.req.json()` の戻り値が、v4 では `any`、v5 では `unknown` になりました。ハイライトしている行が問題のところです。

---

::center::

v4 では、このコードが通る

::note::

v4 では、このコードが型チェックを通ってしまいます。`name` に数値が来たら実行時に落ちるのに、型は何も言わない。

---

## v5

```console
error TS18046: 'body' is of type 'unknown'.
```

::note::

v5 だと TS18046。'body' is of type 'unknown'。

---

::center::

ちゃんと止まった

::note::

ちゃんと止まってくれました。

---

::center::

もうひとつ気になってたのが

::note::

もうひとつ、個人的に気になっていたのがこっちです。

---

## `c.req.query()`

```ts
const { name } = c.req.query()
const upper: string = name.toUpperCase()
```

- v4 → `Record<string, string>`
- v5 → `Record<string, string | undefined>`

::note::

`c.req.query()` をキー無しで呼んだときの戻り値が、`string` から `string | undefined` になりました。

---

::center::

これ、分割代入してるコードが

**全部赤くなるのでは？**

::note::

これ、**分割代入してるコードが全部赤くなるのでは**と思ったんですよ。

**問いかけとして言う。** 答えは次のスライド。

---

## v5

```console
error TS18048: 'name' is possibly 'undefined'.
error TS2322: Type 'string[] | undefined' is not
  assignable to type 'string[]'.
```

::note::

TS18048 と TS2322 が出ました。`name` は undefined かもしれない、`string[] | undefined` は `string[]` に代入できない、と。

---

::center size=1.5::

**全部赤くなった**

::note::

**全部赤くなりました。** 分割代入している箇所は全滅です。

---

::center::

でも、ここで面白いことに気づいた

::note::

でも、ここで面白いことに気づきました。

---

## 実行時の値を比べてみる

`GET /q?a=1&a=2`

| | v4 | v5 |
|---|---|---|
| `query()` | `{"a":"1"}` | `{"a":"1"}` |
| `queries()` | `{"a":["1","2"]}` | `{"a":["1","2"]}` |

::note::

同じクエリを両方に投げて、実際に返ってくる値を比べてみました。

---

::center size=1.5::

**完全に同じ**

::note::

**完全に同じでした。**

---

## わかったこと

- v5 は挙動を**変えていない**
- v4 でも `undefined` は返っていた
- 型が嘘をついていただけ

::note::

つまり v5 は挙動を変えていない。v4 でも存在しないキーを引けば undefined が返っていたのに、型が `string` だと言い張っていただけなんです。

---

::center::

赤くなった箇所は、

**v4 の時点でバグり得た箇所**

::note::

なので、赤くなった箇所は**v4 の時点でバグり得た箇所**です。

**この一文を言ってから次の章へ。** まとめでもう一度使います。

---

::center size=1.5 bg=white::

エラー

::note::

2 つ目、エラーハンドリング。

---

::center::

ここが v5 で一番面白い

::note::

ここが v5 で一番面白いところだと思っています。

---

## v4 の `onError()`

```ts
app.onError((err, c) => {
  console.error(err.message)
  return c.json({ error: 'Internal Server Error' }, 500)
})
```

- アプリ全体に1つだけ
- シグネチャは `(err, c)`

::note::

v4 の `onError()` は `(err, c)` で、アプリ全体に 1 つだけでした。

---

## v5 の `onError()`

```ts
app.onError('/api/*', async (c, next) => {
!!   console.error(c.error?.message)
  c.header('X-Error-Handler', 'api')
  await next()
})

app.onError((c) => c.json({ error: 'Error' }, 500))
```

- `(c, next)` → 普通のミドルウェア
- エラーは `c.error` から読む
- **パスで絞れる**

::note::

v5 は `(c, next)` になって、エラーは `c.error` から読みます。そして**パスで絞れる**ようになりました。

---

## 設計意図

> エラー処理を Hono の**ルーティングシステムの上に**
> モデル化する

- 内部では `@ERROR` / `@NOT_FOUND` という
  予約メソッドで Router に登録されている

-# honojs/hono#5541

::note::

設計意図は PR #5541 の本文に書いてあって、「エラー処理を Hono のルーティングシステムの上にモデル化する」と。

**聞かれたら:** 内部では `@ERROR` / `@NOT_FOUND` という予約メソッドで Router に登録されている。だから普通のルートと同じ仕組みで引かれる。マイグレーションガイドには載っていない情報。

---

::center::

本当にパスで絞れるのか？

::note::

ドキュメントを読んだだけでは分からないので、動かしてみました。

---

## 動かしてみた

| リクエスト | ヘッダ | status |
|---|---|---|
| `/api/error` | **`api`** | 500 |
| `/other/error` | なし | 500 |

::note::

`/api/error` のときだけヘッダが付いて、`/other/error` には付かない。最終的なレスポンスは共通のハンドラが返しています。

---

::center::

効いた

::note::

ちゃんと効きました。

---

::center::

ちなみに v4 で同じことを書くと

::note::

ちなみに v4 で同じことを書くとどうなるか。

---

## v4

```console
this.errorHandler is not a function
```

- パス文字列をハンドラとして保存してしまう
- **登録時ではなくリクエスト時に落ちる**

::note::

`this.errorHandler is not a function`。v4 はパス文字列をハンドラとして保存してしまうので、**登録時には何も言われず、リクエストが来た時点で落ちます。**

---

::center size=1.5 bg=#ca8a04::

ここからが本番

::note::

ここからが本番です。

---

::center::

`onError()` を 2回登録したら

どうなる？

::note::

`onError()` を 2 回登録したらどうなるか。

**問いかけ。少し待つ。**

---

## 実験

```ts
app.onError((c) => { order.push('first');  ... })
app.onError((c) => { order.push('second'); ... })
```

::note::

こういう実験をしました。1 つ目と 2 つ目、どちらが走るか記録します。

---

## 結果

| | 実行されたハンドラ |
|---|---|
| **v4** | `["second"]` |
| **v5** | `["first", "second"]` |

::note::

v4 は `second` だけ。v5 は `first` と `second` の両方が走りました。

---

::center size=1.5::

v4 は**上書き**

v5 は**合成**

::note::

**v4 は上書き、v5 は合成です。**

---

## 敗因になりそうなところ

- v4 → 「あとから登録して潰す」が書けた
- v5 → **両方走る**
- しかも⋯

::note::

v4 では「あとから登録して前のを潰す」が書けました。v5 だと両方走ります。しかも、

---

::center size=2::

**型エラーにならない**

::note::

**型エラーになりません。**

---

::center::

シグネチャさえ直せば `tsc` は通る

::note::

シグネチャさえ `(c, next)` に直せば tsc は通ってしまう。実際に動かすまで気づけない類の変更です。

---

::center::

じゃあ v4 の書き方のまま

動かしたらどうなる？

::note::

じゃあ、v4 の書き方のまま v5 で動かしたらどうなるか。気になったので試しました。

---

## 型チェックは止めてくれる

```console
error TS2339: Property 'message' does not exist
  on type 'Context<BlankEnv, string, any>'.
error TS2339: Property 'json' does not exist
  on type 'Next'.
```

- 第1引数が `Context`、第2引数が `Next`

::note::

型チェックは止めてくれます。TS2339 が 2 つ。第 1 引数が `Context`、第 2 引数が `Next` になったことがそのまま出ています。**ここで気づけます。**

---

::center::

問題は、これを握りつぶしたとき

::note::

問題は、これを `@ts-expect-error` で握りつぶして実行したときです。

---

## 実行すると

```console
Context is not finalized.
Did you forget to return a Response object
or `await next()`?
```

::note::

`Context is not finalized. Did you forget to return a Response object or await next()?`

---

::center size=1.5::

**原因を指していない**

::note::

**原因を全く指していません。**

---

## 何が起きてるか

- `c` のつもりで触ってるものが `next` 関数
- `c.text()` が無い → 例外
- → Context が確定しないまま終わる

-# 型エラーを消すと、デバッグが遠回りになる

::note::

何が起きてるかというと、v4 のつもりで `c` として触っているものが `next` 関数なんですね。だから `c.text()` が無くて例外になって、結果として Context が確定しないまま終わる。型エラーを消すとデバッグが遠回りになるパターンです。

---

## 非 Error を `throw` したら

| | v4 | v5 |
|---|---|---|
| `throw 'oops'` | 外に漏れる | `message` / `cause` に `'oops'` |
| `throw { code: 42 }` | 外に漏れる | `message` は **空** |

- オブジェクトは `cause` にしか入らない
- → `c.error.message` だけログに出すと何も分からない

::note::

非 Error を throw したときの扱いも変わりました。v4 は `app.fetch()` の外に漏れていたのが、v5 は Error にラップされて `onError` に流れます。

**注意点:** オブジェクトを投げると `message` が空文字になります。元の値は `cause` にしか入らないので、`c.error.message` だけログに出していると何も分かりません。

---

::center size=1.5 bg=red::

地雷

::note::

3 つ目。型でも捕まらない地雷の話。

---

::center::

型でも捕まらないやつ

::note::

ここまでは型が教えてくれました。次は教えてくれないやつです。

---

## `c.json(undefined)`

| | v4 | v5 |
|---|---|---|
| `c.json(undefined)` | 200 / 空ボディ | **500** |
| `c.json(() => 1)` | 200 / 空 | **500** |

```console
TypeError: Value is not JSON serializable
```

::note::

`c.json(undefined)` が、v4 では 200 で空ボディだったのが、v5 では 500 になります。`TypeError: Value is not JSON serializable` が投げられます。

---

::center size=2::

**型エラーにならない**

::note::

**そしてこれは型エラーになりません。**

---

## どこで踏むか

```ts
const user = await db.query.users.findFirst({ ... })
!! return c.json(user) // 見つからなければ undefined
```

- v4 → 404 のつもりが 200 で空ボディ
- v5 → **500**

::note::

どこで踏むかというと、一番ありそうなのがこれです。DB から 1 件引いて、見つからなければ undefined になるのに、そのまま `c.json()` に渡しているコード。

v4 では 404 のつもりが 200 で空ボディ、で済んでいました。

---

::center::

つまり

::note::

つまり、

---

::center size=1.5::

v5 で 500 が出る箇所は

**v4 の時点でバグっていた箇所**

::note::

**v5 で 500 が出る箇所は、v4 の時点でバグっていた箇所**なんですよね。壊れたんじゃなくて、隠れてたバグが出てきただけです。

---

::center size=1.5 bg=white::

ルーター

::note::

4 つ目、ルーターの話。ここが今日の山場です。

---

::center::

ワイルドカードが統一された

::note::

ワイルドカードのマッチングが、全 Router で統一されました。

---

::center::

v4 は Router ごとにバラバラだった

::note::

v4 は Router の実装ごとに挙動が違ったんです。Hono には Router が 4 種類あって、SmartRouter が自動で選んでいます。

---

::wide::

## v4

| ルート | パス | Smart | RegExp | Trie | Pattern |
|---|---|---|---|---|---|
| `/x*/y` | `/x/y` | ❌ | ❌ | ❌ | ❌ |
| `/x*/y` | `/xz/y` | ✅ | ✅ | ❌ | ❌ |
| `/x*y` | `/xay` | ✅ | ✅ | ❌ | ❌ |
| `/wild/*/card` | `/wild//card` | ❌ | ❌ | ✅ | ❌ |

-# 6ケース中3ケースで割れている

::note::

v4 の総当たり結果です。**表は読み上げない。割れている 3 ケースだけ指す。**

特に `/wild/*/card` は TrieRouter だけがマッチします。Router を切り替えた瞬間にルーティングが変わるということです。

---

::wide::

## v5

| ルート | パス | Smart | RegExp | Trie | Pattern |
|---|---|---|---|---|---|
| `/x*/y` | `/x/y` | ✅ | ✅ | ✅ | ✅ |
| `/x*/y` | `/xz/y` | ✅ | ✅ | ✅ | ✅ |
| `/x*y` | `/xay` | ❌ | ❌ | ❌ | ❌ |
| `/wild/*/card` | `/wild//card` | ❌ | ❌ | ❌ | ❌ |

::note::

同じ表を v5 で取り直しました。

---

::center size=1.5::

**4つとも一致**

::note::

**4 つとも一致しました。** 公式ドキュメントの表とも完全に同じです。

---

::center size=1.5 bg=#ca8a04::

ここが一番おいしい

::note::

で、ここが一番おいしいところです。

---

## 競合するルートを書いてみる

```ts
app.get('/x*/y', (c) => c.text('a'))
app.get('/x/*',  (c) => c.text('b'))
```

::note::

`/x*/y` と `/x/*` を同時に登録します。この 2 行だけです。

---

## v5 の RegExpRouter

```console
UnsupportedPathError: /x/*
```

- 両方を同時に登録できない

::note::

v5 の RegExpRouter はこれを処理できません。`UnsupportedPathError` が投げられます。

---

::center::

じゃあ SmartRouter はどうなる？

::note::

じゃあ SmartRouter はどうなるか。

---

## 選ばれた Router

| 登録したルート | Router |
|---|---|
| `/x/*` だけ | `SmartRouter + RegExpRouter` |
| `/x*/y` + `/x/*` | **`SmartRouter + TrieRouter`** |

::note::

`/x/*` だけなら RegExpRouter が選ばれるのに、`/x*/y` を足すと **TrieRouter にフォールバック**しました。

---

::center size=1.5::

ルートを**1行足しただけ**で

Router が入れ替わった

::note::

**ルートを 1 行足しただけで、実行時に選ばれる Router が入れ替わった**わけです。

**ここで一拍おく。**

---

::center::

性能も変わるのでは？

::note::

Router が変わるなら性能も変わるはずなので、測りました。

---

## 測った

`GET /users/:id` × 50,000回 × 12ラウンド

| | 中央値 | 最小 |
|---|---:|---:|
| RegExpRouter | 138.68 ms | 132.35 ms |
| Trie フォールバック | 148.57 ms | 146.25 ms |
| **差** | **+7.1%** | **+10.5%** |

::note::

5万回 × 12ラウンドで、中央値が 7.1%、最小値では 10.5% 遅くなりました。

**聞かれたら:** 最初 3 ラウンドで測ったときは 3.3% しか出なかった。ラウンド数が足りなくて結論がぶれた。

---

::center::

遅くなった

::note::

遅くなりました。

---

## でも問題はそこじゃない

- 7〜10% は正直どうでもいい
- 問題は**無言で切り替わる**こと
- ログにも型にも出ない

::note::

でも、7〜10% という数字自体は正直どうでもよくて。**問題は無言で切り替わること**です。ログにも型にも出ません。

---

::center::

しかも

::note::

しかも、これは「遅くなる」だけの話で終わらなくて。

---

## マッチするハンドラも変わる

同じ競合ルートに `/x/y` を投げると

| v4 | v5 |
|---|---|
| `/x/*` の方 | `/x*/y` の方 |

::note::

同じ競合ルートに `/x/y` を投げると、v4 と v5 で**マッチするハンドラ自体が変わります。** 型でもテストでも気づきにくいところです。

---

::center size=1.5 bg=white::

性能

::note::

5 つ目、性能。

---

::center::

v5、速くなったの？

::note::

v5、速くなったんでしょうか。

---

## 測った

`GET /users/:id` × 100,000回 × 10ラウンド

| | 中央値 | 最小 |
|---|---:|---:|
| v4 | 270.53 ms | 258.31 ms |
| v5 | 266.50 ms | 255.59 ms |

-# `app.fetch()` のインプロセス計測。実サーバーの性能ではない

::note::

10万回 × 10ラウンド、v4 と v5 を交互に走らせました。

**but を必ず言う:** これは `app.fetch()` のインプロセス計測で、実 HTTP サーバーや Workers 本番の性能ではない。

---

::center size=1.5::

**誤差**

::note::

**誤差でした。**

---

## 分布が重なっている

- v4 の最小 **258.31 ms**
- v5 の中央値 **266.50 ms**
- → v4 の方が速いラウンドがある

::note::

v4 の最小値 258.31 ms が v5 の中央値 266.50 ms より速いので、分布が大きく重なっています。有意差とは言えません。

---

::center::

ここで、恥ずかしい話を

::note::

ここで、ちょっと恥ずかしい話をします。

---

## 敗因

- 最初 **5ラウンド**で測った → 差 **2.9%**
- **10ラウンド**に増やした → 差 **1.5%**
- 同じコード、同じマシン、同じ日

::note::

最初 5 ラウンドで測ったときは差が 2.9% ありました。10 ラウンドに増やしたら 1.5% に縮みました。同じコード、同じマシン、同じ日です。

---

::center size=1.5::

ラウンド数を変えただけで

**結論が倍違った**

::note::

**ラウンド数を変えただけで、結論の見え方が倍違いました。**

---

## わかったこと

- マイクロベンチで数%を語るなら
  **ラウンド数と分布**を出す
- Router の方も 3ラウンド → 12ラウンドで
  3.3% → 7.1% に変わった

::note::

マイクロベンチで数 % を語るなら、ラウンド数と分布を出さないと意味がない。Router の方も 3 ラウンド → 12 ラウンドで 3.3% → 7.1% に変わりました。自分で踏んだので説得力はあると思います。

---

::center::

コアの性能は**据え置き**

::note::

というわけで、コアのルーティング性能は v4 から据え置きです。

---

::center::

v5 の変更は、性能のためじゃない

::note::

でもこれは悪い結論ではなくて、v5 の変更はそもそも性能のためのものではないので。

---

::center size=1.5 bg=white::

サイズ

::note::

6 つ目、サイズ。

---

::center::

「アダプタ分離で軽くなった」

本当？

::note::

「アダプタが別パッケージになって軽くなった」という話、本当か確かめました。

---

## インストールサイズ

| | 展開後 | ファイル数 |
|---|---:|---:|
| v4 | 1.23 MB | 574 |
| v5 | **0.66 MB** | **310** |

-# npm registry の unpackedSize

::note::

npm registry の `unpackedSize` を引くと、1.23 MB から 0.66 MB。ファイル数は 574 から 310 です。

---

::center size=1.5::

**-46%**

::note::

**-46% です。**

---

## 3つの測り方が一致した

- npm registry → **-46%**
- 手元の `du -sh`（2.8M → 1.5M）→ **-46%**
- yusukebeさんの資料（1.29MB → 0.70MB）→ **-46%**

-# ファイル数 574 → 310 は完全一致

::note::

しかも 3 つの測り方が一致しました。registry、手元の `du -sh`（2.8M → 1.5M）、そして yusukebe さんの登壇資料の数字。**ファイル数 574 → 310 は完全一致でした。**

---

::center::

じゃあバンドルは？

::note::

じゃあバンドルサイズはどうか。

---

## バンドルサイズ

| | v4 | v5 | 差 |
|---|---:|---:|---:|
| コアのみ | 18,528 B | 18,830 B | **+302 B** |
| アダプタ込み | 22,760 B | 22,923 B | **+163 B** |

::note::

esbuild でバンドルしたら、18,528 バイトから 18,830 バイト。アダプタ込みでも 163 バイト増。

---

::center size=1.5::

**増えた**

::note::

**増えました。**

---

## 考えてみれば当たり前

- 減ったのは CJS ビルドとアダプタの分離
- CJS はそもそもバンドルに入らない
- `@hono/bun` を入れれば同じコードが入る

::note::

考えてみれば当たり前で、減ったのは CJS ビルドの削除とアダプタの分離です。CJS はそもそもバンドルに入らないし、アダプタも `@hono/bun` を入れれば同じコードが入ります。

---

::center::

「軽くなった」は

**インストールサイズの話**

::note::

なので「軽くなった」はインストールサイズの話です。記事に書くときは区別が要ります。

**聞かれたら:** hono は v4 の時点で依存ゼロ。だから「依存を減らした」ではなく「配るコードを減らした」が正確。

---

::center size=1.5 bg=white::

設計

::note::

最後に、設計の話。

---

::center::

ここまで全部、同じ方向を向いてる

::note::

ここまで見てきた変更、全部同じ方向を向いています。

---

## v5 = AIのためのHono

> 抽象化されていて、選択肢が少ない

-# Yusuke Wada / Hono Conference 2026

::note::

Yusuke Wada さんが Hono Conference 2026 で、v5 を「AI のための Hono」と表現していて、設計目標として「抽象化されていて、選択肢が少ない」を挙げています。

---

## なぜ型を厳しくするのか

- 人間は「ここは `any` だけど大丈夫」と空気を読む
- **LLM は読まない**
- 型が嘘をつけば、嘘のまま出てくる

::note::

なぜ型を厳しくするのか。人間は「ここは any だけど実際は文字列が来るから大丈夫」と空気を読めますが、**LLM は読みません。** 型が嘘をつけば、嘘のまま出力されます。

---

::center::

それが一番出てるのが

::note::

それが一番はっきり出ているのが、

---

## `defineHandler()`

```ts
app.get('/ping', defineHandler(() => ({ pong: true })))
```

```console
ping -> 200 {"pong":true}
```

- `c.json()` を呼んでいない
- **返した値が Response になる**

::note::

`defineHandler()` です。`c.json()` を呼んでいないのに、**返した値がそのまま Response になります。** オブジェクトなら JSON、null なら 204。

---

## 検証も1か所で書ける

```ts
app.post('/users', defineHandler({ json: NameSchema })(
  (c, input) => ({ name: input.json.name.toUpperCase() })
))
```

```console
400 {"error":"Validation failed","issues":[...]}
```

- Standard Schema → Zod / Valibot ...

::note::

リクエストとレスポンスの検証も 1 か所に書けます。Standard Schema なので Zod や Valibot がそのまま使えます。

---

## ハマった

- 普通の検証関数で `throw` すると
  400 ではなく **500** になる
- 400 にしてくれるのは Standard Schema のルートだけ

::note::

ここでハマりました。**普通の検証関数の中で throw すると、400 ではなく 500 になります。** 400 にしてくれるのは Standard Schema のルートだけでした。

---

## 型定義のコメント

> A JSON Response by `c.json()` is not accepted,
> because it bypasses the response validation.

- `c.json()` を返すことを**型で禁止**している

::note::

そして型定義のコメントに思想がそのまま書いてあって、「`c.json()` が返す JSON Response は受け付けない。レスポンス検証を迂回してしまうから」と。**型で禁止しているんですね。**

---

::center::

やり方が複数あって、どれでも動く

↓

**正しいやり方が1つで、他は型で止まる**

::note::

やり方が複数あってどれでも動く、から、正しいやり方が 1 つで他は型で止まる、への移行。これが v5 全体の思想だと思います。

---

::center size=1.5 bg=white::

まとめ

::note::

まとめに入ります。

---

## 移行チェックリスト

**①まず `tsc --strict` を通す**

- `c.req.json()` の直アクセス
- `c.req.query()` の分割代入
- `onError((err, c) => ...)`

→ 機械的に潰せる

::note::

移行チェックリスト。まず `tsc --strict` を通します。`c.req.json()` の直アクセス、`query()` の分割代入、`onError` のシグネチャ。**ここは機械的に潰せます。**

---

## 移行チェックリスト

**②型では捕まらない3つ**

- `c.json(undefined)` → 500
- `onError()` の合成化 → 両方走る
- ワイルドカードのマッチ変更

→ **ここが本番**

::note::

次が本番で、型では捕まらない 3 つ。`c.json(undefined)` が 500 になる、`onError()` が合成になる、ワイルドカードのマッチが変わる。

**ここだけ覚えて帰ってほしい。**

---

## 移行チェックリスト

**③import を書き換える**

- `hono/<runtime>` → `@hono/<runtime>`
- `hono/cloudflare-pages` → **代替なし**
- `app.mount()` → `hono/mount`
- `app.fire()` → `@hono/service-worker`

::note::

最後に import の書き換え。`hono/<runtime>` が `@hono/<runtime>` に。**`hono/cloudflare-pages` だけは代替がなくて、Workers への移行が必要です。**

---

## まとめ

- 型 → 嘘をつかなくなった。実行時の値は同じ
- エラー → 上書きから**合成**へ
- 地雷 → `c.json(undefined)` が 500
- ルーター → 統一された。でも無言で入れ替わる
- 性能 → 据え置き。ラウンド数を書こう
- サイズ → install は -46%、バンドルは微増

::note::

章ごとに一行ずつまとめました。読み上げて構いません。

---

::center size=1.5::

v5 で壊れるのは

**v4 が緩かったところ**

::note::

**v5 で壊れるのは、v4 が緩かったところです。**

---

::center::

壊れたんじゃなくて、

隠れてたバグが出てきただけ

::note::

壊れたんじゃなくて、隠れてたバグが出てきただけ。

---

::center::

本番投入は RC なので待ちます

::note::

今すぐ本番に入れるかと言われれば、RC なので待ちます。

---

::center::

でも `hono@next` で1回ビルドするのは

**今やる価値がある**

::note::

でも、手元のプロジェクトを `hono@next` で一度ビルドしてみるのは今やる価値があります。

---

::center::

型エラーの量を見れば、

移行コストがその場で分かる

::note::

型エラーの量を見れば、移行コストがその場で分かるので。

---

::center size=1.5::

ありがとうございました

::note::

ありがとうございました。

**時間が無ければここで終わる。** 以降は余った場合だけ。

---

::center bg=white::

One more thing

::note::

時間があれば、もう一つだけ。

---

::center::

正式リリースまでの予想

::note::

正式リリースまでの予想を書いておきます。外れてもいい前提で。

---

## ひっくり返るとしたら

**`defineHandler()`** だと思う

- 唯一 experimental と明記されている
- 検証関数で 500 になる角が残っている
- `onError()` とワイルドカードはこのまま出る

::note::

ひっくり返るとしたら `defineHandler()` だと思っています。唯一 experimental と明記されているし、さっきの「検証関数で 500」みたいな角がまだ残っています。逆に `onError()` とワイルドカードは PR で設計が詰められているので、このまま出ると見ています。

---

## 一番詰まるのは

**`hono/cloudflare-pages` の削除**

- 他は書き換えれば済む
- これだけ**代替がない**
- 型エラーの数なら `c.req.query()` が圧倒的
- でも時間を食うのは**数じゃなくて1件**

::note::

移行で一番詰まるのは `hono/cloudflare-pages` の削除だと予想しています。型エラーの数なら `c.req.query()` が圧倒的ですが、あれは機械的に潰せる。**時間を食うのは数じゃなくて、代替のない 1 件の方**だと思います。

---

::center::

外れるかもしれません

::note::

どちらも外れるかもしれません。

---

::center::

正式版が出たら、答え合わせします

::note::

正式版が出たら、答え合わせします。

---

::center size=3::

```sh
npm i hono@next
```

-# [hono.dev/docs/guides/migrating-to-v5](https://hono.dev/docs/guides/migrating-to-v5)

::note::

`npm i hono@next` で今すぐ試せます。移行ガイドは hono.dev にあります。ありがとうございました。
