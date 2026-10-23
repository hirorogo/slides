# summary — Cloudflare AgentsのAI Providerが統合されたので検証してみる

| | |
| --- | --- |
| 作成日 | 2026-10-23 |
| 入力 | draft.md / references.md / claims.md / sandbox |
| 用途 | article.md |
| 一言 | 落ちたら切り替わる、と思っていました。切り替わるのは、本文が 1 文字も出ていないうちだけでした。 |

---

## 1. 何が統合されたのか

2026 年 10 月 21 日、Cloudflare が Agents SDK の AI Provider を `createAI` に一本化したと発表しました。
`workers-ai-provider` と `ai-gateway-provider` は非推奨になり、npm のレジストリにも `deprecated` フィールドが立っています。
どちらも 2026 年 10 月 20 日公開の版です。

`createAI` は 4 通りのモデル指定を受け付けます。
`@cf/` で始まる Workers AI のモデル、`<author>/<model>` の形をした AI Gateway カタログのモデル、`dynamic/` で始まる dynamic route、そしてベンダー製パッケージが作るモデルオブジェクトです。
呼び出し側のコードを変えずにモデルだけ差し替えられるのが売りになっています。

ただし「10 月 21 日に実装された」わけではありません。
実装が入ったのは 10 月 2 日で、PR #2448 が experimental として追加しています。
そこから 10 月 12 日に dynamic routes、14 日に Universal Endpoint の廃止、20 日に REST 対応と積み上げて、最後に告知が来ました。
**1 か月かけて機能差を埋めてから deprecate した**、という進め方です。

そして「統合」には、移植されなかった機能があります。
Issue #2569 が移行チェックリストになっていて、2 項目に取り消し線が引かれています。
ひとつはサーバーサイドの fallback で、理由は「Universal Endpoint の機能だったから」。
もうひとつは `safePrompt` で、「`safe_prompt` を宣言する Workers AI モデルが無いから」です。

旧 `createAiGateway([a, b])` は 1 リクエストを投げて Gateway 側がモデルを選んでいました。
`createAI` の `fallback` は Worker 内でモデルごとに 1 リクエストずつ投げます。
<!-- 要出典: 「課金されるリクエスト数が変わる」はリクエスト数からの推論で、課金額は測っていない。
     記事では「リクエスト数が変わる」までに留めるか、「課金に効くはず」と推量で書く -->

## 2. 検証のやり方

`createAI({ binding })` の `binding` に必要なものは 3 つだけです。
`run(model, input, options)` が `Response` を返すこと、`fetch(url, init)` が `Response` を返すこと、`aiGatewayLogId` プロパティを持つことです。

つまり偽物を渡せば、fallback の状態機械がローカルで動きます。
Cloudflare のアカウントも課金も要らず、毎回同じ結果が出ます。
SSE を 1 チャンクずつ組み立てられるので、**狙った位置で失敗させられる**のが大きい。

本物のモデルではこれができません。
任意の位置でストリームを切る手段が無いからです。
境界を測るなら偽 binding しかありません。

あとで気づいたのですが、Cloudflare の公式テストも同じ手法で書かれていました。
`packages/agents/src/tests/models/ai-sdk/fallback-and-errors.test.ts` が `fakeBinding()` を使っています。

今回はローカルで 86 テスト、実機は `wrangler dev --remote` で 1 回です。
実機が要ったのはエラーの分類とメタデータのキーだけでした。

## 3. fallback の境界

ドキュメントの記述はこれだけです。

> A request that the vendor rejects falls back. So does a stream that fails before its first output part.

「first output part」がどこを指すのかは書いてありません。
そこで、切断する位置だけを動かして、他の条件を固定して測りました。

| 切断した位置 | fallback |
| --- | --- |
| 何も出さずに切断 | する |
| `response-metadata` のみ | する |
| ツール名だけ（`tool-input-start`） | する |
| ツールの引数が出た | しない |
| `reasoning-delta` まで | しない |
| 本文 1 文字（`text-delta`） | しない |

**ツール名までなら間に合い、本文が 1 文字出たら手遅れ**でした。

fallback が起きたとき、落ちたモデルのパートは利用者に 1 つも届きません。
答えたモデルのプリアンブルに丸ごと差し替わります。

この結果は 2 つの失敗モードで確かめました。
接続が切れる場合（`try`/`catch` を通る経路）と、SSE の中に `error` が載る場合（別の分岐を通る経路）です。
モデル ID も本文も変えて、同じ線が出ました。

## 4. なぜそこが境界なのか

実装に `PREAMBLE_PARTS` という集合があります。
`stream-start` / `response-metadata` / `text-start` / `reasoning-start` / `tool-input-start` / `raw` の 6 種類で、「ここまでなら、まだ何も出力していない」という判定に使われます。

ところが chat-completions の wire を読むと、**6 種類のうち単独で出せるのは 3 つだけ**でした。

`text-start` は `content !== ""` のガードがあるため、必ず `text-delta` と連続して発行されます。
`reasoning-start` も `reasoning-delta` と対です。
一方 `tool-input-start` は、引数が空なら `tool-input-delta` が出ないので単独で出せます。

だから「ツール名だけ届いた状態」が、切り替われる最後の地点になります。

<!-- 未確認: 「text-start が集合に入っているのはベンダーのモデルオブジェクト向け。
     Anthropic の provider は content_block_start を単独で出すので、そちらなら到達できる」
     ── これは推論で、ベンダーモデルでは一度も測っていない。
     記事では「〜と読めます」と推量で書くか、落とす -->

なお公式テストは「出力前」と「出力後」の 2 つしか試していません。
ツール名だけの状態は扱われていません。

## 5. 出力が始まった後

fallback が手を引いた後、何も無いわけではありません。
`resume` があります。

`AAA` まで流して切断し、再接続して `BBB` を受け取ると、利用者が手にするのは `AAABBB` です。
取りこぼしも重複もありません。
そしてこのとき **fallback は 1 度も呼ばれません**。

`fallback` は「開けなかったとき」、`resume` は「開いた後に壊れたとき」と役割が分かれています。

ただし `resume` は `cf-aig-run-id` ヘッダが無いと働きません。
実機で確認したところ、**Workers AI のストリームには run id が付きませんでした**。
守備範囲はカタログモデルと dynamic route だけです。
ドキュメントの Limitations にも「Workers AI streams do not resume」とあり、一致します。

実機で取れた数値も書いておきます。
正常系のストリームで最初のパートまで 328 ミリ秒、パート数は 32 でした。
`providerMetadata.cloudflare` に載ったキーは 8 つで、`cacheStatus` / `eventId` / `gateway` / `logId` / `model` / `requestId` / `step` / `traceId` です。
`runId` と `provider` は載りませんでした。

<!-- 未確認: 328ms はストリーム 1 本ぶん。n=1 で分布を取っていない。
     記事に出すなら「1 回計測して 328ms」と回数を明記する。平均と書かない -->

## 6. resume の限界

resume 側も毎回落とすようにして数えたところ、**5 回で諦めました**。

実装の定数は `resumableBody` の `options.maxReconnects ?? 5` です。
ソースのコメントには「Reconnects allowed before giving up. Defaults to 5.」とあります。
公開オプションには無いので、呼び出し側からは変更できません。

諦めたときのメッセージはこうなります。

```
The stream dropped 6 times; giving up at event 7.
```

ドキュメントは「after five drops」と書いていますが、実際はドロップ 5 回を生き延びて 6 回目で落ちます。
1 つ手前を指している表現でした。

## 7. 諦めたときのエラーが拾えない

ドキュメントはこう約束しています。

> The provider throws `CloudflareAIError`, which extends the AI SDK's `APICallError`, for Workers AI failures, AI Gateway failures, **failed stream resumes**, and a fallback chain where every model failed.

同じ import、同じ `streamText` で、失敗のさせ方だけを変えて比べました。

| | 通常の失敗 | resume の失敗 |
| --- | --- | --- |
| `e.name` | `CloudflareAIError` | `CloudflareAIError` |
| `instanceof CloudflareAIError` | `true` | `false` |
| `APICallError.isInstance()` | `true` | `false` |
| `code` / `status` | 正しい | 正しい（`provider-error` / 404） |

名前が同じで、型だけが違います。
ログを眺めていても気づけません。

原因は、同じ名前のクラスが 2 つあることです。
`models/core/errors.ts` の方は `extends Error` で、公開されていません。
`models/ai-sdk/errors.ts` の方は `extends APICallError` で、こちらが公開されています。
`core/resume.ts` は前者を import しています。

しかもそのエラーを投げるのは、`run()` が返った**後**、利用者がストリームを読んでいる最中です。
`run()` の `catch` に置かれた変換（`toAISDKError`）は、その時点ではもう通り過ぎています。

結果として 2 つ困ります。
ドキュメントのサンプル通りに `instanceof` で分岐すると、resume の失敗だけ素通りします。
`APICallError` でもないので、AI SDK の retry ループが `isRetryable` を読めません。

セキュリティの問題でも可用性の問題でもありません。
エラーの分類が取れないだけです。

## 8. なぜ誰も気づかなかったか

公式テストが**内部クラスを import している**からです。

```ts
import { CloudflareAIError } from "../../../models/core/errors";
```

投げられているのはまさにそのクラスなので、`toBeInstanceOf` は常に通ります。
公開 API としての契約を見ているテストが 1 つもありません。

これは Cloudflare 固有の話ではありません。
**内部実装を import したテストは、公開 API の約束を守らない**という一般論として読めます。

設計 RFC（`design/rfc-workers-ai-gateway-merge.md`）と出荷版にも差がありました。
RFC は `layer` / `transport` / `index` / `startedAt` を持つ attempt tree を設計していましたが、出荷されたのは `{ model, error }` の 2 フィールドだけです。
`recoverability` も `server` モードも、型定義には出てきません。

## 9. 上のレイヤーを足すと

AI SDK v7 に `streamRetries` があります。
既定は 0 で、省略すると stream retry そのものが無効になります。
「出力が始まった**後**のプロバイダーエラーを再試行する」オプションです。

`createAI` のドキュメントと AI SDK のドキュメントは、互いにこのオプションに触れていません。

primary を「本文を出してから error」に固定して測りました。

| `streamRetries` | primary 呼び出し | 利用者が見たテキスト | `res.text` |
| --- | ---: | --- | --- |
| 省略 | 1 | `PARTIAL-` | `PARTIAL-` |
| `1` | 2 | `PARTIAL-PARTIAL-` | `PARTIAL-` |
| `2` | 3 | `PARTIAL-PARTIAL-PARTIAL-` | `PARTIAL-` |

部分出力が、別の id を持つ新しいテキストブロックとして流れます。
`res.text` を読む実装と `fullStream` を UI に流す実装で、見えるものが違います。

再試行しても fallback には届きません。
primary がストリームを開けてしまうので、毎回 primary に確定するからです。
「出力後の答えは最終」というドキュメントの記述は、上のレイヤーを足しても破れませんでした。

## 10. 実運用で効く数値

Retry は fallback チェーンの**外側**にあります。

| 構成 | 総リクエスト数 |
| --- | ---: |
| 2 本チェーン / `maxRetries: 0` | 2 |
| 2 本チェーン / `maxRetries: 2`（既定） | 6 |
| 3 段の入れ子 / `maxRetries: 2` | 9 |

チェーンの長さ ×（1 + `maxRetries`）になります。
`maxRetries` の既定は 2 なので、何も指定しないと 3 倍です。

入れ子の `fallback` は展開されます。
leg が自分で持つ `fallback` は保持され、per-call で渡したものだけが剥がされます。

404 は fallback しますが retry はしません。
判定の基準が別で、fallback は abort 以外のすべてで次に進み、retry は `isRetryable` だけを見るからです。

`attempts` は fallback を設定していないと `undefined` です。
ドキュメントは無条件に入るように読めますが、Cloudflare 自身のテストが `expect(error.attempts).toBeUndefined()` を期待しています。

実機では「存在しないモデル」の `code` が 2 つに割れました。

| 入力 | status | `code` |
| --- | ---: | --- |
| `@cf/nope/does-not-exist` | 400 | `bad-request` |
| `nope/not-a-real-model` | 404 | `not-found` |

`code === "not-found"` でモデル ID の打ち間違いを拾おうとすると、`@cf/` の打ち間違いだけがすり抜けます。

最後に、`ai@6` では動きません。
`peerDependencies` は `^6.0.0 || ^7.0.0` ですが、`ai@6` は `@ai-sdk/provider@3` を直接依存で抱えていて、v4 のモデルを受け付けません。
入れても peer の警告は出ず、最初の `generateText` で `UnsupportedModelVersionError` が飛びます。
ここはドキュメントが正しく、`package.json` の方が誤っていました。

## 11. 報告まで

見つけたものは報告しました。

| | 内容 | 状態（2026-10-23 時点） |
| --- | --- | --- |
| agents#2687 | resume のエラー型 | open。第三者が再現 |
| agents#2690 | `ai` の peer range | open。別のコントリビューターが着手を表明 |
| cloudflare-docs#34546 | 再接続回数と `attempts` の記述 | open。AI レビュー 0 findings、承認待ち |

#2687 には @suryakant-source から独立の再現報告が付きました。
原因の特定も修正方針も、こちらが出したものと一致しています。
`createTransport().run()` でレスポンスの body を包み、読み出し中のエラーを `toAISDKError` に通す、という形です。

この人も「リポジトリが PR をコラボレーターに限定しているので PR を開けない」と書いていました。
報告が届いても PR で直せない、という制約は共通のようです。

<!-- 要出典: 「gardener bot が報告を処理して PR を出す」は #2647 の 1 例しか見ていない。
     記事に書くなら「別件ではボットが確認コメントを付け、PR #2678 が出た」と事例として書く。
     一般化しない -->

## 12. まとめ

ストリームが壊れたとき、守りは層になっています。

| 壊れた場所 | 守る層 |
| --- | --- |
| 出力が始まる前 | `createAI` の `fallback` |
| ツール名だけ届いた | 同上。まだ間に合う |
| 本文が 1 文字出た後 | fallback は手を引く |
| 出力後・run id あり | AI Gateway の resume |
| 出力後・Workers AI | 誰も守らない |
| resume が尽きた | 誰も。しかもエラーが拾えない |

層はあります。ただし一番外側の手当てが抜けていました。

測れなかったものも書いておきます。
429 と 401 は無料枠では起こせず、分類は偽 binding でしか確認していません。
Gateway の `retries` が実際に何回投げたかは、設計上クライアントからは観測できません（RFC §8a）。
カタログモデルでの `metadata.model` と `response.modelId` のズレは、Unified Billing を使わなかったので未確認です。

---

## 変えたこと

| draft の記述 | どうしたか |
| --- | --- |
| 「課金されるリクエスト数が変わる」 | 「リクエスト数が変わる」に留める。課金額は測っていない |
| 「Anthropic なら `text-start` 単独に到達できる」 | 推量として書くか落とす。ベンダーモデルで一度も測っていない |
| 「328ms」 | 「1 回計測して 328ms」と回数を明記する |
| 「gardener bot が処理する」 | #2647 の 1 事例として書く。一般化しない |
| 「別のコントリビューターが名乗り出た」（#2690 のみ） | #2687 の独立再現を追加。こちらの方が強い |

## 埋まらなかった穴

- [ ] §4 のベンダーモデル側の挙動。測るなら Unified Billing か BYOK が要る
- [ ] §1 の課金への影響。リクエスト数までしか言えない
- [ ] §5 の 328ms が n=1。article に出すなら回数を書くか、落とす

## 使わなかった素材

- 設計 RFC と出荷版の差（attempt tree が 2 フィールドに）── §8 に 1 段落だけ残した。これ以上広げると別記事
- オプションの優先順位・メタデータのマージなど 15 件 ── 全部ドキュメント通りで、話が進まない
- `@hf/` の扱い ── 枝葉
