# references — Cloudflare Agents の AI Provider 統合と Fallback

| | |
| --- | --- |
| 調査日 | 2026-10-22 |
| 対象 | `agents@0.30.0`（`agents/models/ai-sdk`、Beta） |
| 用途 | slide.md / article.md |
| 元ネタ | PRD.md（T01〜T12）、draft.md |

この references は公開しない。
PRD が立てた仮説 H1〜H6 のうち、実機を叩く前に資料と配布物だけで決着がつくものをここで潰した。
PRD が置いた前提のうち、1 つは成り立たず、4 つは条件を付け直す必要があった。
正しかった前提のうち 3 つにも、ドキュメントには書かれていない続きがあった。

> ⚠️ 今回は Worker を一度もデプロイしていない。
> 下の「計測」はすべて npm registry と配布パッケージの中身を読んだ結果で、ライブ API の応答ではない。
> T01〜T12 の実測は `verify-harness` 側の仕事として積み残してある。

---

## 確認した主張

| # | 主張（PRD 由来） | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | 2026-10-21 に AI Provider の統合が発表された | ⚠️ **半分** | 発表は 10/21。実装は 10/02 から段階的 |
| 2 | 旧 2 プロバイダーは非推奨になった | ✅ 確認 | npm の `deprecated` フィールド（実測） |
| 3 | 旧 2 プロバイダーの機能が `createAI` に統合された | ❌ **前提が違う** | 一部は意図的に移植されていない（Issue #2569） |
| 4 | モデル指定は 4 通り | ✅ 確認 | 公式ドキュメント / PR #2576 |
| 5 | Fallback は最初の出力前の失敗だけ | ✅ 確認 + **境界はもっと細かい** | 配布物のソース（`PREAMBLE_PARTS`） |
| 6 | Fallback は Gateway ではなく Worker 内で走る | ✅ 確認 | ソース / Issue #2569 に設計意図 |
| 7 | `CloudflareAIError` から試行履歴が取れる | ⚠️ **条件付き** | `attempts` は 2 本以上落ちたときだけ |
| 8 | すべてが `CloudflareAIError` になるわけではない | ✅ 確認 + **3 つ目のケースを発見** | ソース（`TypeError`） |
| 9 | Metadata から実行モデルを特定できる | ⚠️ **注意あり** | `model` は「書いた ID」であって応答者名ではない |
| 10 | Retry と Fallback は別レイヤー | ✅ 確認 + **入れ子の向きが重要** | ソース（Retry が Fallback を包む） |
| 11 | AI SDK v7 が前提 | ⚠️ 不正確 | peer は `^6.0.0 \|\| ^7.0.0` |
| 12 | Beta である | ✅ 確認 | 公式ドキュメントに Beta 表記 |

冒頭の問いに戻ると、ずれていたのは次の 5 つになる。
成り立たなかったのが #3 で、「統合された」と書くと落とされた機能を見落とす。
条件を付け直すのが #1（発表日と実装時期が違う）、#7（`attempts` は常に取れるわけではない）、#9（`model` は応答者名ではない）、#11（AI SDK は v6 でも動く）になる。

逆に、#5 と #8 と #10 は PRD の読みどおりだったうえに、
ドキュメントが書いていない一段細かい線がソースから引けた。
記事の技術的な見どころはこの 3 つに寄せられる。

---

## 1. 発表日は 10/21、実装は 10/02 から

**判定: 半分。記事の「新機能が出た」という書き出しは、そのままだと事実に負ける。**

- [AI Gateway Changelog — createAI replaces workers-ai-provider and ai-gateway-provider](https://developers.cloudflare.com/changelog/post/2026-10-21-createai/) — 一次。日付は 2026-10-21
- [Models](https://developers.cloudflare.com/agents/models/) — 一次。ページの `dateModified` も `2026-10-21`
- [cloudflare/agents#2448 feat(agents): add experimental agents/models/ai-sdk](https://github.com/cloudflare/agents/pull/2448) — 一次。マージは 2026-10-02

実際のタイムラインはこうなっていた。

| 日付 | 出来事 | PR |
| --- | --- | --- |
| 2026-10-02 | `agents/models/ai-sdk` が experimental として入る | #2448 |
| 2026-10-12 | dynamic routes 対応 | #2572 |
| 2026-10-12 | `zdr` / `vendorKey` 対応 | #2571 |
| 2026-10-14 | Universal Endpoint をやめ、`env.AI.run` と provider-native に移行 | #2576 |
| 2026-10-14 | `/run` ストリームの resume | #2589 |
| 2026-10-20 | `accountId` + `apiToken` 対応 | #2604 |
| 2026-10-20 | 旧 2 パッケージを npm 上で deprecated に | — |
| 2026-10-21 | ドキュメントと Changelog が公開される | — |

つまり 10/21 に起きたのは実装ではなく、移行の告知だった。

### 記事に使える切り口

10 月のひと月をかけて parity を埋め切ってから deprecate した、という進め方そのものが題材になる。
Issue #2569 がそのチェックリストとして公開されているので、外から追跡できてしまう。

---

## 2. 旧プロバイダーの非推奨は npm から確認できる

**判定: 確認。しかも二次ソースを経由せずに取れる。**

ドキュメントの文章ではなく、レジストリの `deprecated` フィールドを引いた。
機械可読なので、ここが一番強い。

| パッケージ | latest | 公開日 | `deprecated` |
| --- | --- | --- | --- |
| `workers-ai-provider` | 4.0.1 | 2026-10-20 | あり |
| `ai-gateway-provider` | 4.0.2 | 2026-10-20 | あり |
| `ai-search-provider` | 0.1.2 | 2026-09-11 | **なし** |

`workers-ai-provider` の文面はこうなっている。

> Deprecated. Use createAI from agents/models/ai-sdk, or ai-search-provider for AI Search: https://developers.cloudflare.com/agents/models/ai-sdk/

Changelog の表現は「feature frozen and marked as deprecated」で、削除ではない。
`ai-search-provider` は非推奨になっていないので、AI Search だけは移行先が別だという点を混ぜないようにする。

---

## 3. 「統合された」は言いすぎで、落とされた機能がある

**判定: 前提が違う。今回いちばんの収穫。**

PRD は「従来の 2 つの Provider の機能が `createAI` に統合され」と書いているが、
**意図的に移植しなかった機能が 2 つある。**

根拠は [cloudflare/agents#2569](https://github.com/cloudflare/agents/issues/2569) で、
タイトルからして「createAI: features missing before workers-ai-provider / ai-gateway-provider can be fully deprecated」という移行チェックリストになっている。
2026-10-20 にクローズされている。

移植された項目を挙げる。

| 旧機能 | 移植先 |
| --- | --- |
| `dynamic/<route>` モデル ID | #2572 |
| run-path のストリーム resume | #2589（自動、オプションなし） |
| BYOK key forwarding | #2571（`vendorKey: "request"`） |
| `byokAlias` / `zdr` | #2571、#2576 |
| REST / credentials モード | #2604 |

移植されなかった項目。Issue 本文では取り消し線が引かれている。

- **サーバーサイド Fallback。** 本文の理由が、この記事の中心そのものだった。

  > Not added: it came from the deprecated Universal Endpoint; a dynamic route's own fallback does it on the gateway. `createAiGateway([a, b])` sends one universal request, and the gateway picks the model that answers (`cf-aig-step`). `createAI`'s `fallback` runs on the client, one request per model.

- **`safePrompt`。** 理由は「no Workers AI model declares `safe_prompt`」で、需要がないという判断だった。

### なぜ Worker 内実行になったのか

[Fallbacks](https://developers.cloudflare.com/ai-gateway/configuration/fallbacks/) は Universal Endpoint の機能として書かれている。
そして [Models](https://developers.cloudflare.com/agents/models/) は「The providers do not use the deprecated Universal Endpoint」と明記している。
PR #2576 は Universal Endpoint のトランスポートをコアから削除したと書いている。

> **The universal transport is deleted from the core.**

Gateway 側 Fallback の土台だった Universal Endpoint を捨てたので、
Gateway 側 Fallback も一緒に捨てるしかなかった、という順序になる。
`createAI` の `fallback` が Worker 内でモデルごとに 1 リクエストずつ投げるのは、その帰結だった。

### 記事に使える切り口

PRD は「現在の Fallback は Worker 内で実行される」を制約として挙げているが、
実際には設計上の後退を伴う移行で、旧 `createAiGateway([a, b])` からの乗り換えでは課金リクエスト数が変わる。
1 リクエストで Gateway が選ぶ方式から、落ちた分だけ Worker から投げ直す方式になるため。

> ⚠️ Fallbacks のドキュメントページは `Last updated Apr 20, 2026` のまま、非推奨の Universal Endpoint を前提に書かれている。
> ドキュメント間で整合が取れていないので、ここを根拠にするときは日付に触れる。

---

## 4. モデル指定は 4 通り

**判定: 確認。**

[Models](https://developers.cloudflare.com/agents/models/) と PR #2576 が一致している。

| 指定 | 例 | 経路 |
| --- | --- | --- |
| Workers AI | `@cf/zai-org/glm-4.7-flash` | `env.AI.run` → Workers AI |
| Gateway Catalog | `anthropic/claude-opus-5.5` | `env.AI.run` → `/run` |
| Dynamic Route | `dynamic/support` | `env.AI.run` → `/run` |
| Vendor Model | `anthropic("claude-opus-5-5")` | binding の `fetch` → provider-native |

綴りの違いが罠になる。
カタログ ID は Gateway の綴り（`anthropic/claude-opus-5.5`）を使い、
ベンダーのモデルオブジェクトはベンダーの綴り（`claude-opus-5-5`）を使う。
ドキュメントも「Use the catalog's spelling, not the vendor's」と明示している。

PR #2576 には、旧 pi-ai がここを間違えて Anthropic に拒否されていたという実例があった。

> The old pi path put the catalog spelling (`claude-opus-4.8`) in the body sent to Anthropic, which Anthropic rejects.

PRD の Phase 1 の表はこの 4 つを正しく書けている。

---

## 5. Fallback の境界は「最初の出力」より手前にある

**判定: 確認。そのうえで、ドキュメントより細かい線が引けた。本記事の山場はここ。**

ドキュメントの記述はこう。

- [AI SDK provider — Fall back to another model](https://developers.cloudflare.com/agents/models/ai-sdk/) — 一次

  > A request that the vendor rejects falls back. So does a stream that fails before its first output part. Once a model has produced output, its answer is final, errors included.

「first output part」がどこを指すのかは、ドキュメントには書いていない。
配布パッケージの sourcemap に元の TypeScript が入っていたので、そこから引いた（取得手順は下の「計測」）。

`src/models/ai-sdk/models/fallback.ts` に、まさにその定義があった。

```ts
/**
 * The parts a stream emits before it has said anything: protocol preamble
 * that every leg would repeat. Anything else is output the caller has seen,
 * after which the leg is committed and a later failure is its own.
 */
const PREAMBLE_PARTS = new Set([
  "stream-start",
  "response-metadata",
  "text-start",
  "reasoning-start",
  "tool-input-start",
  "raw"
]);
```

**`text-start` はまだ「出力」に数えられていない。**
状態機械としては、テキストパートが開いた後でも Fallback は生きている。

ただし**この 6 種類が全部そのまま使えるわけではなかった。**
`wires/chat-completions.ts` を読むと、パートの出し方に対になる制約がある。

```ts
const content = text(delta.content);
if (content !== undefined && content !== "") {
  closeReasoning(controller);
  if (textId === undefined) {
    textId = newId();
    controller.enqueue({ id: textId, type: "text-start" });   // ← 続けて
  }
  controller.enqueue({ delta: content, id: textId, type: "text-delta" });  // ← これが出る
}
```

空文字は弾かれるので、`text-start` の直後には必ず `text-delta` が続く。
`reasoning-start` も `reasoning-delta` と対になっている。
一方、ツール呼び出しは引数のガードが別なので、単独で出せる。

```ts
if (input !== undefined && input !== "") {
  controller.enqueue({ delta: input, id: state.id, type: "tool-input-delta" });
}
```

結果として、この wire で単独に出せる preamble パートは 3 種類だけになる。

| preamble パート | 単独到達 | 理由 |
| --- | --- | --- |
| `stream-start` | できる | 先頭に 1 つ出る |
| `response-metadata` | できる | 最初のチャンクの id / model から出る |
| `text-start` | **できない** | `text-delta` と同じチャンクから続けて出る |
| `reasoning-start` | **できない** | `reasoning-delta` と対で出る |
| `tool-input-start` | **できる** | 引数が空なら `tool-input-delta` が出ない |
| `raw` | できる | `includeRawChunks` 時のみ |

実務的な言い方に直すとこうなる。

> ツール呼び出しの名前だけが届いた段階なら、まだ別のモデルに切り替わる。
> 本文が 1 文字でも出たら、もう切り替わらない。

`text-start` が preamble に入っているのは、ベンダーのモデルオブジェクト側のためと読める。
Anthropic の provider は `content_block_start` と `content_block_delta` を別イベントで出すので、
そちらなら `text-start` 単独が到達できる。
**つまり境界はモデルの種類によって動く。**

ストリーム側のループを読むと、確定条件は次の 3 つに整理できる。

| ストリームの状態 | Fallback |
| --- | --- |
| `PREAMBLE_PARTS` のパートだけが流れた | **する** |
| `error` パートが来た | **する** |
| `finish` の `finishReason.unified === "error"` | **する** |
| `PREAMBLE_PARTS` 以外のパートが 1 つでも流れた | **しない**（確定） |
| 正常に `done` まで到達 | しない |

落ちた leg が送ったプリアンブルは破棄され、答えた leg のプリアンブルに差し替えられる。
呼び出し側からは、最初から答えた leg につないでいたように見える。

もう 1 つ、レイテンシに効く挙動があった。

```ts
async function withStreamFallbackLegs(legs, url) {
  if (legs.length <= 1) return withFallbackLegs(legs, url);
```

`fallback` を設定していないときは、このプリアンブル覗き見そのものが走らない。
`fallback` を 1 つでも足すと、ストリームは最初の非プリアンブルパートが出るまで待たされる。
PRD の T12（Fallback 時のレイテンシ比較）は、失敗時だけでなく成功時の TTFB も測る価値がある。

### 記事に使える切り口

「出力が始まったら切り替わらない」は正しいが、粒度が粗い。
`text-start` と `text-delta` の間に線がある、というのがこの記事でしか書けない部分になる。

---

## 6. Fallback は Worker 内のループで、Retry がその外側を包む

**判定: 確認。入れ子の向きが PRD の H6 の答えになる。**

`src/models/ai-sdk/models/language.ts` を読むと、`#withFallback` は `doGenerate` と `doStream` の内側にある。

```ts
async doGenerate(options) {
  const call = parseCallOptions(options.providerOptions);
  ...
  return this.#withFallback(call, ...);
}
```

AI SDK の Retry ループは `doGenerate` の外側で回る。
したがって、**1 回の Retry がチェーン全体を丸ごと引き直す。**
`maxRetries: 2` とモデル 3 本のチェーンなら、最悪 9 リクエストになる。

さらに、全 leg が落ちたときに投げられるエラーは最後の leg のエラーを包み直したもので、
`isRetryable` も最後の leg のものを引き継ぐ。
チェーンが Retry されるかどうかは、最後に試したモデルのステータスで決まる。

レイヤーは 3 つある。

| レイヤー | 実行場所 | 単位 |
| --- | --- | --- |
| AI SDK の Retry | Worker | `doGenerate` 呼び出し全体 |
| `createAI` の Fallback | Worker | モデル 1 本ずつ |
| Gateway の `retries` | AI Gateway | 1 カタログモデル内のプロバイダー間 |

ドキュメントも同じことを別の言い方で書いている。

> Fallback runs in your Worker and moves across models. Within one catalog model, AI Gateway already retries across that model's providers, and a dynamic route runs its own fallback on the gateway.

### 判定基準が揃っていない

Fallback は abort 以外のあらゆるエラーで次の leg に進む。
`isRetryable` を見ていない。

```ts
for (const leg of legs) try {
  return await leg.run();
} catch (error) {
  if (isAbortError(error)) throw error;
  attempts.push({ error, model: leg.model });
  lastError = error;
}
```

一方 Retry は `isRetryable` しか見ない。
`isRetryableStatus` は 408 / 409 / 429 / 5xx と「ステータスなし」だけを true にする。

結果として、**404 は Fallback するが Retry はしない**という非対称が生まれる。
PRD の T04 と T11 はここを突くと面白くなる。

---

## 7. `attempts` は 2 本以上落ちたときしか入らない

**判定: 条件付き。PRD の H4 はこのままだと外れる。**

`withFallbackLegs` の終わり方がこうなっている。

```ts
if (attempts.length <= 1) throw lastError;
throw fallbackError(lastError, attempts, url);
```

`fallback` を設定していない（leg が primary 1 本だけ）場合、
**生のエラーがそのまま投げ直され、`attempts` を持つ `CloudflareAIError` には包まれない。**
`error.attempts` を読んで試行履歴を出すコードは、Fallback を設定したときだけ動く。

包まれた場合のメッセージは `All models failed (...). Last error: ...` の形になる。

`CloudflareAIError` のフィールドは `src/models/core/errors.ts` にそろっている。

| フィールド | 中身 |
| --- | --- |
| `status` | HTTP ステータス（無いこともある） |
| `code` | 下の 7 分類 |
| `logId` | `cf-aig-log-id` |
| `model` | エラーを出したモデル ID |
| `attempts` | チェーンを終わらせたときだけ |
| `isRetryable` | AI SDK の Retry が読む |

`code` の分類は `classifyStatus` が決めている。

| ステータス | `code` | `isRetryable` |
| --- | --- | --- |
| 401 / 403 | `auth` | false |
| 429 | `rate-limit` | **true** |
| 404 | `not-found` | false |
| 400 / 422 | `bad-request` | false |
| 5xx | `provider-error` | true |
| envelope が `AiGatewayError` | `gateway-error` | ステータス次第 |
| それ以外 | `unknown` | ステータス次第 |
| ステータスなし | — | **true**（transport 障害とみなす） |

AI SDK 側の `CloudflareAIError` は `APICallError` を継承しているので、
追加の配線なしで Retry ループが `isRetryable` を読む。

---

## 8. エラーの型は 3 種類ある

**判定: 確認。PRD は 2 種類だと思っているが、3 つ目があった。**

PRD は「`CloudflareAIError` とベンダー独自のエラー」の 2 分類で書いている。
ソースを読むと、もう 1 つ `TypeError` があった。

```ts
export function requireLanguageModelId(modelId) {
  if (!isLanguageModelId(modelId)) throw notAModelId(modelId, "language");
  return modelId;
}
```

しかも `language.ts` のコメントが、これは Fallback に拾わせない設計だと明言している。

> Checked as the chain is built, so the throw is not swallowed as one more failed leg.

つまり T04「存在しないモデルで Fallback するか」は、**1 つの検証ケースでは足りない。**
「存在しない」が 2 つの違う意味に割れている。

| 入力 | 何が起きるか | Fallback |
| --- | --- | --- |
| `"gpt-5.5"`（スラッシュなし） | 構築時に `TypeError` | **しない** |
| `"nope/not-a-model"`（形は正しい） | Gateway が 404 → `CloudflareAIError` (`not-found`) | **する** |
| `"@cf/does/not-exist"` | 同上 | **する** |
| ベンダーの未知のモデル ID | ベンダーの provider 独自のエラー型 | ドキュメント上は **する**（未実測） |

ID の形を見ているのは `catalog.ts` の次の関数で、構文だけで判定している。

```ts
export function isCatalogModelId(modelId) {
  if (modelId.startsWith("@") || modelId.startsWith("dynamic/")) return false;
  const slash = modelId.indexOf("/");
  return slash > 0 && slash < modelId.length - 1;
}
```

`a/b` の形なら実在しなくても通る。
だから「実在しないカタログ ID」は Gateway まで到達して 404 で返ってくる。

### 記事に使える切り口

PRD は「モデル未発見とプロバイダー障害は別ケースとして記録する」と書いている。
実際にはモデル未発見がさらに 2 つに割れるので、ここを表で見せると T04 が一段深くなる。

---

## 9. Metadata の `model` は「書いた ID」

**判定: 注意あり。H5 はほぼ成立するが、言い方を間違えると嘘になる。**

`cloudflareMetadata()` が組み立てている中身を読むと、`model` には leg に渡した `modelId` がそのまま入る。
ベンダーが名乗ったモデル名ではない。

ベンダーの申告は別の場所にある。

```ts
response: {
  modelId: generation.responseModelId ?? modelId,
  ...
}
```

| 読む場所 | 意味 |
| --- | --- |
| `providerMetadata.cloudflare.model` | **どの leg が答えたか**（Fallback の結果） |
| `response.modelId` | プロバイダーが名乗ったモデル名 |

Fallback の追跡に使うなら前者で正しい。
「実際に推論したモデル」と言い切るなら後者も併せて見る必要がある。

ヘッダー由来のフィールドは、来ていなければキーごと生えない。

| フィールド | ヘッダー |
| --- | --- |
| `cacheStatus` | `cf-aig-cache-status` |
| `eventId` | `cf-aig-event-id` |
| `requestId` | `cf-aig-request-id` |
| `runId` | `cf-aig-run-id` |
| `traceId` | `cf-aig-trace-id` |
| `step` | `cf-aig-step`（数値化できたときだけ） |
| `logId` | `cf-aig-log-id`、無ければ transport のフォールバック |

ドキュメントも「Only `model` is always present」と書いている。
PRD の「未定義を考慮する」という方針は正しい。

---

## 10. バージョン前提は AI SDK v7 だけではない

**判定: PRD の記述が不正確。**

`agents@0.30.0` の peerDependencies を引いた。

| peer | 範囲 |
| --- | --- |
| `ai` | `^6.0.0 \|\| ^7.0.0`（optional） |
| `@ai-sdk/provider` | `^4.0.0`（optional） |
| `zod` | `^4.0.0` |

PRD は「Vercel AI SDK v7」と固定で書いているが、v6 でも動く。
検証環境としては v7 を選ぶのでかまわないが、「v7 が必要」とは書けない。

もう 1 つ紛らわしい点がある。
PR #2448 の本文に「any AI SDK v4 model」と出てくるが、これは AI SDK v4 のことではない。
`@ai-sdk/provider` のインターフェース仕様が v4（`ProviderV4` / `LanguageModelV4`）という意味で、
`ai` パッケージの v7 に対応する。
記事でここを素通りすると読者が確実に混乱するので、1 行割く価値がある。

| 名前 | バージョン | 何のバージョンか |
| --- | --- | --- |
| `ai` | 7.0.148 | AI SDK 本体 |
| `@ai-sdk/provider` | 4.0.31 | プロバイダー仕様（`LanguageModelV4`） |

---

## 11. Beta であること

**判定: 確認。**

[Models](https://developers.cloudflare.com/agents/models/) に Beta のコールアウトがある。

> The model providers are in beta. Their APIs may change in a minor release.

配布物のソースでも、公開型のほぼすべてに `@experimental This surface is experimental and may change.` が付いていた。
PRD の「Beta API であるため検証環境のバージョンを明示する」という方針どおりに進める。

---

## 計測（自分で取った一次ソース）

### npm registry

> ⚠️ このリポジトリは `devEngines.packageManager: bun` のため `npm view` が `EBADDEVENGINES` で落ちる。
> registry API を直接叩いた。

非推奨フラグを引く。

```sh
for p in workers-ai-provider ai-gateway-provider ai-search-provider; do
  echo "== $p"
  curl -s "https://registry.npmjs.org/$p" | python3 -c "
import json,sys
d=json.load(sys.stdin); lt=d['dist-tags']['latest']
print(lt, d['time'][lt][:10], repr(d['versions'][lt].get('deprecated')))"
done
```

`agents` のバージョンと peer を引く。

```sh
curl -s https://registry.npmjs.org/agents/0.30.0 | python3 -c "
import json,sys; d=json.load(sys.stdin)
print(d['version'], d['dist']['unpackedSize'], d['dist']['fileCount'])
print([k for k in d['exports'] if 'model' in k])
print({k:v for k,v in d['peerDependencies'].items() if k in ('ai','@ai-sdk/provider','zod')})"
```

結果はこうなった。

| | 値 |
| --- | --- |
| `agents` latest | 0.30.0（2026-10-22 公開） |
| unpackedSize | 10,560,721 bytes |
| fileCount | 464 |
| `models` 系 exports | `./models/ai-sdk`, `./models/pi-ai`, `./models/opencode` |
| `ai` peer | `^6.0.0 \|\| ^7.0.0` |
| `@ai-sdk/provider` peer | `^4.0.0` |

### 配布パッケージから元の TypeScript を取り出す

今回の調査で一番成果が大きかったのがこれになる。
`agents` は dist に sourcemap を同梱していて、`sourcesContent` に元ソースがまるごと入っている。
GitHub を読まなくても、実際に npm から配られている版のソースが読める。

```sh
curl -sL https://registry.npmjs.org/agents/-/agents-0.30.0.tgz -o agents-0.30.0.tgz
mkdir -p pkg && tar -xzf agents-0.30.0.tgz -C pkg

python3 -c "
import json, os
m = json.load(open('pkg/package/dist/ai-sdk-DRPh2rRa.js.map'))
os.makedirs('src', exist_ok=True)
for i, s in enumerate(m['sources']):
    name = s.split('/src/models/ai-sdk/')[-1].replace('/', '_')
    open(os.path.join('src', name), 'w').write(m['sourcesContent'][i])
    print(name)
"
```

次のファイルが取り出せた。

```
errors.ts  settings.ts  transport.ts  models_fallback.ts  wires_shared.ts
models_embedding.ts  wires_chat-completions.ts  models_language.ts
models_gateway.ts  models_modality.ts  models_image.ts  models_reranking.ts
models_speech.ts  models_transcription.ts  index.ts
```

コアのほうは別の sourcemap に入っている。

```sh
python3 -c "
import json
m = json.load(open('pkg/package/dist/images-xaDv2Fqe.js.map'))
for i, s in enumerate(m['sources']):
    if s.endswith(('errors.ts', 'catalog.ts')):
        print('=' * 20, s); print(m['sourcesContent'][i])
"
```

`src/models/core/errors.ts`（`classifyStatus`、`isRetryableStatus`、binding のエラーコード表）と
`src/models/core/catalog.ts`（ID 判定）はここから取った。

ストリームのパート種別は、wire が実際に発行しているものを数えて確かめた。

```sh
grep -o 'type: "[a-z-]*"' src/wires_chat-completions.ts | sort | uniq -c | sort -rn
```

`text-start` と `text-delta` が別のパートとして発行されていることを、ここで確認した。

### GitHub

**途中から clone に切り替えた。** `gh api` で PR 本文を読むだけでは届かないものがあった。

```sh
git clone --depth 1 --filter=blob:none https://github.com/cloudflare/agents.git
```

これで出てきたのが 2 つ。

- `design/rfc-workers-ai-gateway-merge.md`（1004 行）。Issue #2569 が参照していた設計 RFC。
  **提案と出荷版の差**が読める。attempt tree も server-side fallback も提案には入っていた
- `packages/agents/src/tests/models/ai-sdk/fallback-and-errors.test.ts`。
  **公式テスト。** こちらの測定と突き合わせる相手として一番強い

```sh
gh api repos/cloudflare/agents/pulls/2576 --jq '.body'
gh api repos/cloudflare/agents/issues/2569 --jq '.body'
gh api "search/commits?q=repo:cloudflare/agents+fallback&per_page=15" \
  --jq '.items[] | "\(.commit.author.date[:10]) \(.sha[:8]) \(.commit.message|split("\n")[0])"'
```

PR 本文が想定よりはるかに厚かった。
#2576 と #2604 は、作者が実際にライブのモデルを叩いた検証結果まで書いている。
設計意図だけでなく、何をどう検証したかの前例としても使える。

### 公式ドキュメント

HTML ではなく Markdown を取った。
Cloudflare のドキュメントは URL に `index.md` を付けると raw が返る。

```sh
curl -sL "https://developers.cloudflare.com/agents/models/ai-sdk/index.md"
curl -sL "https://developers.cloudflare.com/agents/models/index.md"
curl -sL "https://developers.cloudflare.com/changelog/product/ai-gateway/index.md"
curl -sL "https://developers.cloudflare.com/ai-gateway/configuration/fallbacks/index.md"
```

`WebFetch` は要約されて返るので、オプション表やコードを正確に欲しいときはこちらが確実だった。
`https://developers.cloudflare.com/agents/llms.txt` にページ索引もある。

### 環境

- macOS 25.5.0 / arm64
- Node.js v24.22.1 / Python 3.10.4
- 調査日 2026-10-22
- Worker のデプロイと実行はなし

---

## 横断して見つけたこと

### 認証エラーの分類は課金方式で変わる

[2026-10-05 の AI Gateway Changelog](https://developers.cloudflare.com/changelog/post/2026-10-05-provider-credential-errors/) に、
プロバイダーの認証エラー応答を統一したという記載がある。

| 状況 | 変更後のステータス |
| --- | --- |
| プロバイダーが認証情報を拒否 | 401（エラーコード 2009） |
| **Unified Billing 利用時**にプロバイダーが拒否 | **503** |

これを `classifyStatus` に通すと、同じ「ベンダーの鍵が通らなかった」が 2 通りに分かれる。

| 課金方式 | ステータス | `code` | `isRetryable` | Retry |
| --- | --- | --- | --- | --- |
| BYOK | 401 | `auth` | false | しない |
| Unified Billing | 503 | `provider-error` | **true** | **する** |

Fallback はどちらでも走るが、**Retry が走るかどうかが課金方式で変わる。**
PRD の T05 はここを分けて測ると価値が出る。未実測なので ⬜ のままにしてある。

### `@hf/` の扱いが噛み合っていない

`catalog.ts` の `isWorkersAIId` は `@cf/` と `@hf/` の両方を true にする。
一方、言語モデルのゲートになる `isRunPathLanguageModelId` は `@cf/` と `dynamic/` しか通さない。
`isCatalogModelId` は `@` 始まりを弾く。

結果として `@hf/` の ID はどのゲートも通らず `TypeError` になるはずだが、実測はしていない。
枝葉なので記事には入れないが、記録として残す。

---

## 未確認・積み残し

**すべて決着した。** 詳細は `claims.md`。37 主張のうち、
ドキュメントや自分の読みと違ったのが 6 件。

| | 内容 |
| --- | --- |
| ❌ C2 | `attempts` は fallback 未設定だと入らない。**Cloudflare 自身のテストが裏付けている** |
| ❌ C3 | 「存在しないモデル」が `@cf/` は 400 `bad-request`、カタログは 404 `not-found` |
| ❌ B3 | 入れ子の fallback は**展開される**（ここの記述が誤りだった） |
| ❌ F1 | fallback 設定による TTFB の遅れは観測できない |
| ❌ peer | `ai: ^6.0.0 \|\| ^7.0.0` は動かない組み合わせを許す。**doc のほうが正しかった** |
| ❌ G3 | `streamRetries` を足しても fallback には届かない |
| ⚠️ A4 | `text-start` 単独は chat-completions wire では到達不能 |

実機は `wrangler dev --remote` で Workers AI 無料枠を使って確認した（2026-10-22）。
ローカルは偽 binding で 62 テスト。

### 実機で観測できないと判明したもの

Gateway の `retries` が何回投げたかは、**設計上クライアントから見えない。**
RFC `design/rfc-workers-ai-gateway-merge.md` §8a にこうある。

> only the _winning_ step index is on the response header, per-step failures live in the gateway log (`cf-aig-log-id`)

## 探したが取れなかったもの

- **日本語の二次ソース。** 発表から 1 日なので、Qiita / Zenn / はてなに記事がまだ無い。
  Web 検索も索引が追いついておらず、`createAI` の `fallback` を「見つからない」と返してきた。
  実際には公式ドキュメントに節がある。
  **現時点で信用できるのは公式ドキュメント、リポジトリ、配布パッケージの 3 つだけ。**
- **Fallback の設計判断を書いた公式のブログ記事。** Changelog と Issue #2569 以外に見つからなかった。
  Universal Endpoint を捨てた理由そのものは、PR #2576 の本文が一番詳しい。
- **登壇資料。** PR #2604 に「The talk demo needs this」という記述があり、
  この機能に関連する発表が存在するらしい。どのイベントかは特定できなかった。
  見つかれば設計意図の裏付けとして強い。
- **429 と 401 の実機再現。** 無料枠の範囲では起こせなかった。
  偽 binding では両方とも分類を確認している。

---

## 判定の記号

| | 意味 |
| --- | --- |
| ✅ | 一次ソース、または自分の計測で確認 |
| ⚠️ | 条件付き、または二次ソースのみ |
| ❌ | 調べたら前提が違った |
| ⬜ | 未確認 |
