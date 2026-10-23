---
title: Cloudflare AgentsのAI Providerが統合されたので検証してみる
description: 〜 fallbackは、本文が1文字出たら切り替わらない 〜
author: 田中博悠 / tanahiro2010
date: 2026-10-23
slug: merge-cloudflare-agents-ai-provider
published: false
---

::title::

# Cloudflare AgentsのAI Providerが統合されたので検証してみる

〜 fallbackは、本文が1文字出たら切り替わらない 〜

田中博悠 / tanahiro2010

::note::

「Cloudflare AgentsのAI Providerが統合されたので検証してみる」、田中博悠です。よろしくお願いします。

全 35 枚・想定 15〜20 分。**LT 枠（5分）なら「おまけ: streamRetries」と「実運用で効く数字」を落とす** → 約 25 枚。

---

## 田中博悠 / tanahiro2010

- 三田学園高等学校 1年
- GDG Greater Kwansai
- Hono Conference in Tokyo 2026 Core Staff
- Workers で LLM を呼んでる

# fallback、書いて安心してました

::right::
![tanahiro2010](./img/tanahiro_hono.jpg)

::note::

高校1年です。GDG Greater Kwansai で活動していて、個人開発では Cloudflare Workers から LLM を呼んでいます。

`fallback` を 1 行書いて、これで落ちても大丈夫だと思っていました。その思い込みが今日の話の出発点です。

**15 秒で切る。**

---

## 今日話すこと

- 10月21日、Agents の AI Provider が `createAI` に統合された
- `fallback` が1行で書けるようになった
- => で、いつ効くのか測ってみた

::note::

今日話すことは3つです。統合の話、`fallback` が簡単に書けるようになった話、そして実際にいつ効くのか測った話。

本題は3つ目です。前の2つは前置きなので早めに進みます。

---

## 何が統合されたのか

- `workers-ai-provider` と `ai-gateway-provider` が一本化
- どちらも npm で deprecated（10月20日公開の版）
- Workers AI / カタログモデル / dynamic route / ベンダーのモデル を同じ書き方で

::note::

今まで Workers AI を使うか AI Gateway を使うかでパッケージが分かれていました。それが `createAI` ひとつになりました。

旧2つは npm 上でちゃんと deprecated フラグが立っています。レジストリを引けば確認できます。

**聞かれたら:** 削除ではなく feature frozen。当面は動く。

---

## fallbackが1行で書けるようになった

```ts
const result = await generateText({
  model: ai('@cf/zai-org/glm-4.7-flash', {
    fallback: ['anthropic/claude-opus-5.5']
  }),
  prompt: 'Hello'
})
```

::note::

これが今日の主役です。`fallback` に配列を渡すだけで、落ちたら次のモデルに行ってくれます。

Workers AI のモデルから Anthropic のモデルへ、みたいな混在もできます。便利です。

---

## で、「落ちたら」ってどこから？

::note::

ここで引っかかりました。

非ストリーミングなら分かります。エラーが返ってきたら落ちた、でいい。でもストリーミングだとどうなるんでしょうか。

**ここで一拍置く。**

---

## ドキュメントにはこう書いてある

> A stream that fails before its first output part.
>
> https://developers.cloudflare.com/agents/models/ai-sdk/

::note::

ドキュメントの記述はこれだけです。「最初の出力パートより前に失敗したストリーム」。

逆に言うと、それ以上のことは書いてありません。

---

## first output part って、どこ？

- ストリーミングは途中まで出てから切れる
- そのとき切り替わるのか
- 切り替わらないのか

::note::

ストリーミングは途中まで文章が出てから切れることがあります。ネットワークが切れたり、上流がレート制限に当たったり。

そのとき `fallback` が効くのかどうか。これが分からないと、保険として信用していいのか判断できません。

---

## どうやって測る？

- 本物のモデルは好きな位置で落とせない
- => 偽の binding を渡せばいい

::note::

測ろうとして、すぐ壁にぶつかりました。本物のモデルは、こちらの好きな位置でストリームを切ってくれません。

なので偽物を渡すことにしました。

---

## bindingに必要なのは3つだけ

```ts
const binding = {
  aiGatewayLogId: '01LOGID',
  async fetch() { return new Response('gone', { status: 404 }) },
  async run(model, input, options) {
    return new Response(sseBody, {
      headers: { 'content-type': 'text/event-stream' }
    })
  }
}
```

::note::

実装を読んだら、`createAI` が binding に求めているのは3つだけでした。`run` と `fetch` が `Response` を返すこと、`aiGatewayLogId` を持つこと。

これだけなら自分で書けます。

**聞かれたら:** 実装は `models/core/transport.ts` の `bindingTransport`。

---

## 好きな位置で切れる

```ts
function dropAfter(chunks) {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(chunks[i++])}\n\n`))
        return
      }
      controller.error(new Error('connection dropped'))
    }
  })
}
```

::note::

肝は本文の作り方です。チャンクを1つずつ出して、尽きたところでエラーにする。

`chunks` に何を渡すかで、切れる位置が決まります。本文を入れれば本文が出てから切れ、ツール呼び出しを入れればツール名が出てから切れます。

---

## アカウントも課金もいらない

- ローカルで決定的に動く
- 86ケース回して毎回同じ結果
- あとで気づいたけど Cloudflare の公式テストも同じ手口だった

::note::

この方法のいいところは、Cloudflare のアカウントが要らないことです。課金もゼロ、毎回同じ結果が出ます。

最終的に 86 ケース書きました。実機を叩いたのは、エラーの分類とメタデータのキーを確かめる 1 回だけです。

公式テストを後から読んだら、同じやり方で書かれていました。

---

## 測った結果

- 何も出さずに切断 → 切り替わる
- `response-metadata` だけ → 切り替わる
- ツール名だけ → 切り替わる
- ツールの引数が出た → 切り替わらない
- 本文1文字 → 切り替わらない

::note::

切る位置だけを変えて、他の条件は全部固定しました。

上の3つは切り替わります。下の2つは切り替わりません。

**ここは1行ずつ指しながら読む。**

---

## 境界はここ

- ツール名までなら、まだ間に合う
- 本文が1文字出たら、もう手遅れ

::note::

まとめるとこうです。ツール呼び出しの名前だけが届いた段階なら、まだ別のモデルに切り替わる。本文が1文字でも出たら、もう切り替わらない。

ちなみに切り替わったとき、落ちたモデルのパートは利用者に1つも届きません。答えたモデルのプリアンブルに丸ごと差し替わります。

---

## なぜそこなのか

- 実装に `PREAMBLE_PARTS` という集合がある
- 「ここまでならまだ出力していない」という判定
- 6種類ある

::note::

なぜそこに線が引かれるのか、実装を読みました。

`PREAMBLE_PARTS` という集合があって、ここに入っているパートまでなら「まだ出力していない」と判定されます。

---

## 6種類ある

```ts
const PREAMBLE_PARTS = new Set([
  'stream-start',
  'response-metadata',
  'text-start',
  'reasoning-start',
  'tool-input-start',
  'raw'
])
```

::note::

6種類あります。これを見ると「`text-start` の後もまだ間に合うのか」と読めます。僕も最初そう読みました。

でも実際には違いました。

---

## でも単独で出せるのは3つだけ

- `text-start` → `text-delta` と必ず連続で出る
- `reasoning-start` → `reasoning-delta` と対
- `tool-input-start` → 引数が空なら単独で出る

::note::

ストリームを組み立てる側のコードを読むと、空文字が弾かれるガードがありました。そのせいで `text-start` の直後には必ず `text-delta` が続きます。単独では出せません。

`reasoning-start` も同じく対で出ます。

ツール呼び出しだけはガードが別で、引数が空なら `tool-input-start` が単独で出ます。だからここが最後の地点になります。

---

## 出力が始まった後は？

::note::

では、本文が出てしまった後は何も守ってくれないのか。

そうでもありませんでした。

---

## resumeが引き継ぐ

- `AAA` で切れて再接続して `BBB` → 受け取るのは `AAABBB`
- 取りこぼしも重複もない
- このとき `fallback` は1度も呼ばれない

::note::

`resume` という仕組みがあります。同じ run に再接続して、続きから流し直してくれます。

`AAA` まで出て切れて、再接続して `BBB` を受け取ると、利用者が手にするのは `AAABBB` です。重複しません。

そしてこのとき `fallback` は1度も呼ばれません。役割が分かれています。

---

## 再接続の単位はSSEイベント

- 完全なイベントだけ下流に渡す
- 半端なイベントは握っておく
- 切れたら半端な分を捨てて、渡した個数から再開

::note::

なぜ重複しないかというと、再接続の単位が SSE のイベントだからです。

完全なイベントだけを下流に渡して、途中まで届いた半端なものは握っておく。切れたらその半端な分を捨てて、すでに渡した個数から再開します。

実際に偽 binding で URL を記録すると、渡した個数がそのまま `from=` に乗っていました。

---

## ただしWorkers AIは守られない

- `resume` は `cf-aig-run-id` がないと働かない
- 実機で確認 → Workers AI のストリームには run id が付かない
- 守備範囲はカタログモデルと dynamic route だけ

::note::

ここが落とし穴です。`resume` は run id が無いと働きません。

実機で確かめたら、Workers AI のストリームには run id が付きませんでした。つまり `@cf/` のモデルを使っている限り、出力が始まった後は誰も守ってくれません。

**聞かれたら:** ドキュメントの Limitations にも書いてある。見落としやすいだけ。

---

## resumeは5回で諦める

- 定数は `maxReconnects ?? 5`
- 公開オプションにないので変えられない
- `The stream dropped 6 times; giving up at event 7.`

::note::

その `resume` にも上限があります。5回まで再接続して、6回目のドロップで諦めます。

定数は実装の中にあって、公開オプションには出ていません。呼び出し側からは変えられません。

**聞かれたら:** ドキュメントは「after five drops」と書いているが、実際は5回生き延びて6回目で落ちる。1つ手前を指している。

---

## 諦めたときのエラーが拾えない

- `e.name` → どちらも `CloudflareAIError`
- `instanceof` → 通常は true、resume は false
- `APICallError.isInstance()` → 通常は true、resume は false

::note::

ここが今日いちばん言いたいところです。

諦めたときに投げられるエラーを調べたら、名前は `CloudflareAIError` なのに `instanceof` が通りませんでした。

名前が同じなので、ログを眺めていても気づけません。

**ここでちょっと溜める。**

---

## 同じ名前のクラスが2つある

- `models/core/errors.ts` → `extends Error`、非公開
- `models/ai-sdk/errors.ts` → `extends APICallError`、こっちが公開
- `core/resume.ts` は前者を import している

::note::

原因は単純でした。同じ名前のクラスが2つあって、公開されているのは後者です。

ところが `resume` の実装は前者を import していました。

---

## 投げる場所が悪い

```ts
async run(request) {
  try {
    return await inner.run(request)   // レスポンスが来た時点で解決
  } catch (error) {
    throw toAISDKError(error)         // body 読み出し中の失敗は見えない
  }
}
```

::note::

変換する仕組み自体はあります。`toAISDKError` を通せば公開クラスに持ち上がります。

でも `resume` のエラーが投げられるのは、`run()` が返った後、利用者がストリームを読んでいる最中です。この `catch` はもう通り過ぎています。

この関数のコメントには「every failure lifted into the AI SDK error type」と書いてあります。その約束から、ここだけが漏れていました。

---

## なぜ誰も気づかなかったか

```ts
// packages/agents/src/tests/models/core/resume.test.ts
import { CloudflareAIError } from '../../../models/core/errors'
```

- 公式テストが内部クラスを import している
- 投げられてるのはまさにそのクラス → 常に通る

::note::

テストはあります。でも内部クラスを import していました。

投げられているのはまさにそのクラスなので、`toBeInstanceOf` は常に通ります。テストは緑のままです。

公開 API としての契約を見ているテストが、1つもありませんでした。

---

## 内部実装をimportしたテストは、公開APIの約束を守らない

::note::

これは Cloudflare に限った話ではないと思っています。

自分のコードでも起こります。テストを書くとき、内部から import すると通りやすい。でもそれだと、公開している側の約束を検証したことにはなりません。

**ここが今日の持ち帰りポイント。ゆっくり言う。**

---

## おまけ: streamRetriesを足すと

- AI SDK v7 のオプション、既定は0
- 出力が始まった後のエラーを再試行する
- `createAI` 側のドキュメントは、これに触れていない

::note::

ここからはおまけです。時間が無ければ飛ばします。

AI SDK v7 に `streamRetries` というオプションがあります。出力が始まった後のエラーを再試行する、つまり `fallback` が手を引いた領域を拾いに行くものです。

お互いのドキュメントが相手に触れていないので、重なり方は測るしかありませんでした。

---

## 部分出力が重複する

- 省略 → `PARTIAL-`
- `streamRetries: 1` → `PARTIAL-PARTIAL-`
- `streamRetries: 2` → `PARTIAL-PARTIAL-PARTIAL-`

::note::

測ったらこうなりました。再試行するたびに、部分出力が別のテキストブロックとして流れます。

`res.text` を読んでいる分には1つ分しか返りませんが、`fullStream` を UI に流していると同じ文章が繰り返し画面に出ます。

**聞かれたら:** 再試行しても fallback には届かない。primary がストリームを開けてしまうので毎回 primary に確定する。

---

## 実運用で効く数字

- `maxRetries: 0` → 2リクエスト
- `maxRetries: 2`（既定）→ 6リクエスト
- 3段の入れ子 → 9リクエスト

::note::

Retry は `fallback` チェーンの外側にあります。なのでチェーンの長さ ×（1 + maxRetries）になります。

`maxRetries` の既定は 2 です。何も指定しないと3倍になります。

入れ子にすると、さらに掛け算されます。

---

## 他にもハマりどころ

- 404 は fallback するが retry はしない
- `attempts` は fallback 未設定だと undefined
- 存在しないモデル → `@cf/` は400、カタログIDは404

::note::

細かいところを3つ。

404 は `fallback` しますが retry はしません。判定の基準が別だからです。

`attempts` はドキュメントだと無条件に入るように読めますが、`fallback` を設定していないと undefined です。

存在しないモデルのエラーコードが2つに割れるのも罠で、`not-found` だけ見ていると `@cf/` の打ち間違いがすり抜けます。

---

## 報告した

- agents#2687 → resume のエラー型
- agents#2690 → `ai` の peer range
- cloudflare-docs#34546 → ドキュメントの記述

::note::

見つけたものは報告しました。3件です。

`agents` は pull request をコラボレーターに限定しているので、Issue に修正ブランチのリンクを添える形にしました。

---

## 翌日、知らない人が再現してくれた

- 原因の特定も修正方針も一致してた
- `createTransport().run()` で body を包む
- 別経路で同じ場所に辿り着いてるので、読み違いではなさそう

::note::

翌日、知らない方から再現報告が付きました。

原因の特定も、直し方も、こちらが出したものと一致していました。別の経路で同じ場所に辿り着いているので、自分の読み違いではなさそうです。

報告して良かったと思った瞬間でした。

---

## まとめ

- 10月21日、AI Provider が `createAI` に統合された
- `fallback` が守るのは、モデルが口を開くまで
  - ツール名までなら切り替わる
  - 本文が1文字出たら切り替わらない
- その先は `resume`。ただし Workers AI では働かない
- 偽の binding を1つ書くだけで、ここまで測れる

::note::

まとめます。

`fallback` を1行書いて安心していましたが、守備範囲はモデルが口を開くまででした。その先は `resume` が引き継ぎますが、Workers AI では働きません。

そして偽の binding を1つ書くだけで、ここまで測れます。50行ほどのオブジェクトです。

自分が使っている SDK で同じことをすると、ドキュメントに書いていない境界が出てくると思います。

---

## リンク

- https://github.com/cloudflare/agents/issues/2687
- https://github.com/cloudflare/agents/issues/2690
- https://github.com/cloudflare/cloudflare-docs/pull/34546

::note::

リンクです。Issue には再現コードを載せてあるので、興味があれば見てください。

ありがとうございました。
