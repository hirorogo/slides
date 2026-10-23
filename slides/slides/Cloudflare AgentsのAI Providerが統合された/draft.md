# Cloudflare AgentsのAI Providerが統合されたので検証してみる

**このドラフトは検証がすべて完了した後の確定版です。** 主張 37 件すべてに判定が付いている。
数値はローカル 86 テストと実機 1 回分で確定済み。slide.md / article.md は未着手。

**経緯メモ:** 検証中に実装のバグを 1 件、`package.json` の誤りを 1 件、ドキュメントの不正確な記述を 2 件見つけた。
3 件とも Cloudflare に報告済みで、修正ブランチも添えてある。
セキュリティの発見ではないので、公開を待つ必要はない。

- agents#2687（resume のエラー型）: https://github.com/cloudflare/agents/issues/2687
- agents#2690（`ai` の peer range）: https://github.com/cloudflare/agents/issues/2690
- cloudflare-docs#34546（ドキュメント修正・draft PR）: https://github.com/cloudflare/cloudflare-docs/pull/34546

## 一次ソース

- Agents — Models（更新 2026-10-21）: https://developers.cloudflare.com/agents/models/
- Agents — AI SDK（更新 2026-10-21）: https://developers.cloudflare.com/agents/models/ai-sdk/
- Changelog「createAI replaces workers-ai-provider and ai-gateway-provider」（2026-10-21）: https://developers.cloudflare.com/changelog/post/2026-10-21-createai/
- AI Gateway — Fallbacks（更新 **2026-04-20**）: https://developers.cloudflare.com/ai-gateway/configuration/fallbacks/
- Changelog「Standardize provider credential error responses」（2026-10-05）: https://developers.cloudflare.com/changelog/post/2026-10-05-provider-credential-errors/
- cloudflare/agents#2569（移行チェックリスト・closed 2026-10-20）: https://github.com/cloudflare/agents/issues/2569
- cloudflare/agents#2576（Universal Endpoint をやめた PR・merged 2026-10-14）: https://github.com/cloudflare/agents/pull/2576
- 設計 RFC `design/rfc-workers-ai-gateway-merge.md`（リポジトリ内・1004 行）
- 公式テスト `packages/agents/src/tests/models/ai-sdk/fallback-and-errors.test.ts`
- `agents@0.30.0` の sourcemap（公開 2026-10-22）── **dist に元の TypeScript が入っている**

## 表現のルール（slide でも守る）

- ❌「2 つのプロバイダーが統合された」→ ⭕「`createAI` に一本化された。ただしサーバーサイド fallback は移植されていない」
- ❌「10 月 21 日の新機能」→ ⭕「実装は 10 月 2 日から段階的。10 月 21 日は告知とドキュメント公開」
- ❌「脆弱性を見つけた」→ ⭕「API 契約のバグ」。可用性にもセキュリティにも影響しない
- `fallback` / `retry` / `resume` を書き分ける。**3 つとも別の層**
- 「ドキュメントが間違っている」と「実装が間違っている」を区別する
  - peer range の件は**ドキュメントが正しかった**。先に docs を疑って外した
- 実測値には必ず環境を添える（Node / OS / 日付 / 試行回数）
- **偽 binding の結果と実機の結果を混ぜない。** どちらで測ったか毎回書く
- R6 を煽らない。「公式テストが通っているのに契約が壊れていた」として扱う

## タイトルまわり

- 題名：Cloudflare AgentsのAI Providerが統合されたので検証してみる
- 一言（記事冒頭のエピグラフ。slide の 2 枚目にも置く）

  > 落ちたら切り替わる、と思っていました。
  > 切り替わるのは、本文が 1 文字も出ていないうちだけでした。

  - 候補②：`fallback` は書いてありました。ただ、本文が 1 文字出たあとは効きません。
  - 候補③：守ってくれる層は 3 つありました。一番外側が諦めたときのエラーだけ、ドキュメント通りに書くと拾えませんでした。
  - 📌 ①は境界（§3）、③は R6（§7）を指す。**軸は境界なので①を第一候補にする**
- 発表者：田中博悠 / tanahiro2010
- 自己紹介：
  - どこかの上場済み企業 / GDG Greater Kwansai / Hono Conference in Tokyo 2026運営
  - Cloudflare Workers で個人開発をしている（`fallback` を書いて安心していた側）
  - 最近毎日ブログを書いてる人 / バンジーが好きな人

## つかみ

- 2026/10/21、Cloudflare が Agents SDK の AI Provider 統合を発表
- `workers-ai-provider` と `ai-gateway-provider` が `createAI` に一本化された
- `fallback` が 1 行で書けるようになった ── 便利そう
- ……で、「失敗したら」って**どこから失敗**なんだろう
  - ストリーミングだと、途中まで出てから落ちることがある
  - そのとき切り替わるのか、切り替わらないのか
  - ドキュメントは "fails before its first output part" としか書いていない
- 調べ始めたら、3 つ出てきた
  - 境界が思っていたより手前にあった
  - 出力が始まった後は、**別の仕組み**が守っていた
  - その仕組みが諦めたときのエラーが、**ドキュメント通りに書くと拾えなかった**
- 問いかけ：「あなたの `fallback`、いつ効くか知っていますか？」

## この発表のスタンス

- 公式ドキュメントの紹介記事にはしない
- ドキュメントと実装を**並べて差分を見る**
- 「ドキュメントにこう書いてある」ではなく「**実際にこうなった**」を出す
- 偽 binding で測ったものと実機で測ったものを**区別して出す**
- 測れなかったものは「測れなかった」と書く
- 🔥 このスタンスは §4（到達不能なパート）と §8（公式テストが見ていない）で正当化される
- 検証は大体無料枠で収めた

---

## 1. 何が統合されたのか ―― ただし「統合」は言いすぎ

- `createAI` 1 つで 4 通りのモデル指定ができるようになった

  | 指定 | 例 | 経路 |
  | --- | --- | --- |
  | Workers AI | `@cf/zai-org/glm-4.7-flash` | `env.AI.run` |
  | Gateway カタログ | `anthropic/claude-opus-5.5` | `env.AI.run` → `/run` |
  | Dynamic Route | `dynamic/support` | `env.AI.run` → `/run` |
  | ベンダーのモデル | `anthropic("claude-opus-5-5")` | binding の `fetch` → provider-native |

- 旧 2 パッケージは npm の `deprecated` フィールド付き（どちらも 2026-10-20 公開の版、📋 メモ①）
- ✅ ただし「10 月 21 日に実装された」わけではない
  - 実装が入ったのは **2026-10-02**（#2448、experimental として）
  - 10/12 dynamic routes、10/14 Universal Endpoint 廃止、10/20 REST 対応
  - **10 月いっぱいかけて parity を埋めてから告知している**
- 🔥 そして「統合」には移植されなかった機能がある
  - Issue #2569 が移行チェックリストになっていて、2 項目に取り消し線が引かれている
  - サーバーサイド fallback ── 理由は「Universal Endpoint の機能だったから」
  - `safePrompt` ── 理由は「`safe_prompt` を宣言する Workers AI モデルが無いから」
- 📌 影響：旧 `createAiGateway([a, b])` は 1 リクエストで Gateway が選んでいた
  - 今は Worker 内でモデルごとに 1 リクエストずつ投げる
  - **課金されるリクエスト数が変わる**
- 📌 AI Gateway の Fallbacks ドキュメントは 2026-04-20 のまま、非推奨の Universal Endpoint を説明している
  - `createAI` から飛んでくると誤解する

## 2. 検証のやり方 ―― 偽の binding

- `createAI({ binding })` の `binding` に必要なのは 3 つだけ（📋 メモ②）
  - `run(model, input, options)` が `Response` を返す
  - `fetch(url, init)` が `Response` を返す
  - `aiGatewayLogId` プロパティ
- ✅ 偽物を渡すと、**fallback の状態機械がローカルで決定的に動く**
  - Cloudflare アカウント不要、課金ゼロ、毎回同じ結果
  - SSE を 1 チャンクずつ組み立てられるので、**任意の位置で失敗させられる**
- 📌 本物のモデルでは境界を測れない。狙った位置で落とせないため
- 🔥 あとで気づいたが、**Cloudflare の公式テストも同じ手法**だった
  - `fallback-and-errors.test.ts` が `fakeBinding()` で書かれている
- 実機が要ったのは、エラーの分類とメタデータのキーだけ
  - ローカル 86 テスト / 実機 1 回（`wrangler dev --remote`、2026-10-22）

## 3. fallback の境界を測る（🔥 山場その1）

- ドキュメントの記述はこれだけ
  - > A request that the vendor rejects falls back. So does a stream that fails before its first output part.
- ✅ 実測（偽 binding、切断位置**だけ**を動かし他は固定、📋 メモ③）

  | 切断した位置 | fallback |
  | --- | --- |
  | 何も出さずに切断 | する |
  | `response-metadata` のみ | する |
  | **ツール名だけ（`tool-input-start`）** | **する** |
  | ツールの引数が出た | しない |
  | `reasoning-delta` まで | しない |
  | **本文 1 文字（`text-delta`）** | **しない** |

- 着地：**ツール名までなら間に合う。本文が 1 文字出たら手遅れ**
- ✅ fallback したとき、落ちた leg のパートは利用者に 1 つも届かない
  - 答えた leg のプリアンブルに丸ごと差し替わる
- ✅ 独立再現：接続断（try/catch 経路）と SSE 内 `error`（別分岐）の**2 つの失敗モード**で同じ線が出た
  - モデル ID も本文も変えて確認

## 4. なぜそこが境界なのか ―― 半分は到達できない

- 実装に `PREAMBLE_PARTS` という集合がある。6 種類
  - `stream-start` / `response-metadata` / `text-start` / `reasoning-start` / `tool-input-start` / `raw`
  - 「ここまでなら、まだ何も出力していない」という判定
- 🔥 ところが chat-completions wire で**単独に出せるのは 3 つだけ**だった

  | パート | 単独到達 | 理由 |
  | --- | --- | --- |
  | `stream-start` | できる | 先頭に 1 つ出る |
  | `response-metadata` | できる | 最初のチャンクの id / model から |
  | `text-start` | **できない** | `content !== ""` のガードで `text-delta` と連続 |
  | `reasoning-start` | **できない** | `reasoning-delta` と対 |
  | `tool-input-start` | できる | 引数が空なら `tool-input-delta` が出ない |
  | `raw` | できる | `includeRawChunks` 時のみ |

- 📌 `text-start` が集合に入っているのは、ベンダーのモデルオブジェクト向けと読める
  - Anthropic の provider は `content_block_start` を単独で出す
  - **つまり境界はモデルの種類で動く**
- 📌 公式テストは「出力前」と「出力後」の 2 つしか見ていない
  - ツール名だけの状態は試していない

## 5. 出力が始まった後 ―― resume が受け持つ

- fallback が手を引いた後、何も無いわけではない
- ✅ 実測（偽 binding、📋 メモ④）
  - `AAA` まで流して切断 → 再接続 → `BBB`
  - 受け取るのは `AAABBB`。**取りこぼしも重複もない**
  - このとき **fallback は 1 度も呼ばれない**
- 着地：`fallback` は「開けなかったとき」、`resume` は「開いた後に壊れたとき」
- 🔥 ただし `cf-aig-run-id` が無いと働かない
- ✅ 実機で確認（`wrangler dev --remote` / Workers AI 無料枠 / 2026-10-22、📋 メモ⑤）
  - **Workers AI のストリームには run id が付かない**
  - 正常系ストリームの最初のパートまで 328ms、32 パート
  - `providerMetadata.cloudflare` に載ったキーは 8 つ
    - `cacheStatus` / `eventId` / `gateway` / `logId` / `model` / `requestId` / `step` / `traceId`
    - `runId` と `provider` は載らない
- 📌 ドキュメントの Limitations にも「Workers AI streams do not resume」と書いてある
  - 守備範囲はカタログモデルと dynamic route だけ

## 6. resume の限界 ―― 5 回

- ✅ 実測：resume 側も毎回落とすと、**5 回で諦めた**（偽 binding、📋 メモ⑥）
- 実装の定数は `resumableBody` の `options.maxReconnects ?? 5`
  - ソースのコメントが「Reconnects allowed before giving up. Defaults to 5.」
  - 📌 **公開オプションに無いので変更できない**
- 諦めたときのメッセージ
  - `The stream dropped 6 times; giving up at event 7.`
- 📌 ドキュメントは「after five drops」と書いている
  - 実際はドロップ 5 回を生き延びて 6 回目で落ちる。1 つ手前を指している
  - → cloudflare-docs#34546 で修正提案

## 7. 諦めたときのエラーが拾えない（🔥 山場その2）

- ドキュメントの約束
  - > The provider throws `CloudflareAIError`, which extends the AI SDK's `APICallError`, for ... **failed stream resumes** ...
- ✅ 実測（偽 binding、同じ import・同じ `streamText`・失敗のさせ方だけ変更、📋 メモ⑦）

  | | 通常の失敗 | resume の失敗 |
  | --- | --- | --- |
  | `e.name` | `CloudflareAIError` | `CloudflareAIError` |
  | `instanceof CloudflareAIError` | `true` | **`false`** |
  | `APICallError.isInstance()` | `true` | **`false`** |
  | `code` / `status` | 正しい | 正しい（`provider-error` / 404） |

- 🔥 **名前が同じなので、ログを見ていても気づけない**
- 原因：同名のクラスが 2 つある
  - `models/core/errors.ts` → `extends Error`（非公開）
  - `models/ai-sdk/errors.ts` → `extends APICallError`（**公開されているのはこっち**）
  - `core/resume.ts` が前者を import している
  - しかも投げるのは `run()` が返った**後**、ストリーム本文の中から
    - `run()` の `catch` にある変換（`toAISDKError`）を通らない
- 影響
  - ドキュメントのサンプル通りに `instanceof` で分岐すると、resume の失敗だけ素通りする
  - `APICallError` でもないので、AI SDK の retry ループが `isRetryable` を読めない
- 着地：セキュリティでも可用性でもない。**エラー分類が取れないだけ**。煽らない

## 8. なぜ誰も気づかなかったか

- 🔥 公式テストが**内部クラスを import している**
  - `import { CloudflareAIError } from "../../../models/core/errors";`
  - 投げられているのはまさにそのクラスなので、`toBeInstanceOf` は**常に通る**
- 公開 API としての契約を見ているテストが 1 つも無い
- 📌 これは Cloudflare 固有の話ではない
  - **内部実装を import したテストは、公開 API の約束を守らない**
  - 「テストが通っているのに契約が壊れている」の実例として使える
- 📌 設計 RFC（`design/rfc-workers-ai-gateway-merge.md`）と出荷版にも差がある
  - RFC は `layer` / `transport` / `index` / `startedAt` を持つ **attempt tree** を設計していた
  - 出荷されたのは `{ model, error }` の 2 フィールドだけ
  - `recoverability` も `server` モードも型定義に 0 件

## 9. 上のレイヤーを足すとどうなるか ―― `streamRetries`

- AI SDK v7 に `streamRetries` がある。既定 0、省略すると stream retry が完全無効
  - 「出力が始まった**後**のプロバイダーエラーを再試行する」オプション
  - 📌 `createAI` のドキュメントと AI SDK のドキュメントが**互いに触れていない**
- ✅ 実測（偽 binding、primary を「本文を出してから error」に固定、📋 メモ⑧）

  | `streamRetries` | primary 呼び出し | 利用者が見たテキスト | `res.text` |
  | --- | ---: | --- | --- |
  | 省略 | 1 | `PARTIAL-` | `PARTIAL-` |
  | `1` | 2 | `PARTIAL-PARTIAL-` | `PARTIAL-` |
  | `2` | 3 | `PARTIAL-PARTIAL-PARTIAL-` | `PARTIAL-` |

- 🔥 部分出力が**別 id の新しいテキストブロック**として流れる
  - `res.text` を読む実装と `fullStream` を UI に流す実装で、**見えるものが違う**
- 📌 再試行しても fallback には届かない
  - primary がストリームを開けてしまうので、毎回 primary に確定する
  - 「出力後の答えは最終」は、上のレイヤーを足しても破れなかった

## 10. 実運用で効く数値

- ✅ Retry は fallback チェーンの**外側**にある（偽 binding、📋 メモ⑨）

  | 構成 | 総リクエスト数 |
  | --- | ---: |
  | 2 本チェーン / `maxRetries: 0` | 2 |
  | 2 本チェーン / `maxRetries: 2`（既定） | **6** |
  | 3 段の入れ子 / `maxRetries: 2` | **9** |

  - チェーン長 ×（1 + `maxRetries`）になる
- ✅ 入れ子の `fallback` は展開される
  - leg が自分で持つ `fallback` は保持される。per-call のものだけ剥がされる
- ✅ **404 は fallback するが retry はしない**
  - 判定基準が別。fallback は abort 以外すべて、retry は `isRetryable` だけを見る
- ✅ `attempts` は fallback 未設定だと `undefined`
  - ドキュメントは無条件に入るように読める
  - 🔥 **Cloudflare 自身のテストが `expect(error.attempts).toBeUndefined()` を期待している**
- ✅ 実機：「存在しないモデル」の `code` が 2 つに割れる

  | 入力 | status | `code` |
  | --- | ---: | --- |
  | `@cf/nope/does-not-exist` | **400** | `bad-request` |
  | `nope/not-a-real-model` | **404** | `not-found` |

  - `code === "not-found"` で打ち間違いを拾うと、**`@cf/` だけすり抜ける**
- ✅ `ai@6` では動かない
  - `peerDependencies` は `^6.0.0 || ^7.0.0` だが、v6 は `@ai-sdk/provider@3` を直接抱えている
  - 入れても peer 警告は出ず、最初の `generateText` で `UnsupportedModelVersionError`
  - 📌 ここはドキュメントが正しく、`package.json` が誤っていた

## 11. 報告まで

- 見つけたものは全部報告した。修正ブランチも添えた

  | | 内容 | 状態 |
  | --- | --- | --- |
  | agents#2687 | resume のエラー型（§7） | open・ブランチ付き |
  | agents#2690 | `ai` の peer range（§10） | open・ブランチ付き |
  | cloudflare-docs#34546 | 再接続回数と `attempts` の記述 | draft PR |

- 📌 このリポジトリには gardener bot がいて、報告を確認して PR を出すことがある
  - 別件（#2647）では報告 → 確認コメント → PR #2678 まで動いた
- 📌 #2690 には別のコントリビューターが「担当したい」と名乗り出た
- 着地：**ファイルと行が特定できている報告は処理される**

## 12. まとめ ―― 守りの層

- ストリームが壊れたとき、守りは層になっている

  | 壊れた場所 | 守る層 |
  | --- | --- |
  | 出力が始まる前 | `createAI` の `fallback` |
  | ツール名だけ届いた | 同上。まだ間に合う |
  | 本文が 1 文字出た後 | fallback は手を引く |
  | 出力後・run id あり | AI Gateway の resume |
  | 出力後・Workers AI | 誰も守らない |
  | resume が尽きた | 誰も。しかもエラーが拾えない |

- 言い切り：**ツール名までなら切り替わる。本文が 1 文字出たら切り替わらない**
- 層はある。ただし**一番外側の手当てが抜けていた**
- できなかったこと
  - 429 と 401 の実機再現（無料枠では起こせなかった。分類は偽 binding で確認）
  - Gateway の `retries` の実際の試行回数（RFC によると**設計上クライアントから見えない**）
  - カタログモデルでの `metadata.model` と `response.modelId` のズレ（Unified Billing を使わなかったため）
- 偽の binding を 1 つ書くだけで、ここまで測れる

## 検証前チェックリスト

- [ ] `.gitignore` を `.env` より先に書く（`.dev.vars` / `data/` / 生ログも）
- [ ] AI SDK の `maxRetries` を 0 に固定する（既定 2。数えると 3 倍に見える）
- [ ] Gateway キャッシュ対策。プロンプトを毎回ユニークにし、`cacheStatus` を必ず記録する
- [ ] 偽 binding で潰せる項目と実機が要る項目を分ける
- [ ] 実機は正常系を**最初と最後**に 1 回ずつ通す（枠切れしていない証明）

## メモ（サンプルコード・資料）

### メモ① 旧プロバイダーの非推奨を引く

```sh
for p in workers-ai-provider ai-gateway-provider; do
  curl -s "https://registry.npmjs.org/$p" | python3 -c "
import json,sys; d=json.load(sys.stdin); lt=d['dist-tags']['latest']
print(lt, d['time'][lt][:10], repr(d['versions'][lt].get('deprecated')))"
done
```

### メモ② 偽の binding

```ts
const binding = {
  aiGatewayLogId: "01LOGID",
  async fetch() { return new Response("gone", { status: 404 }); },
  async run(model, input, options) {
    return new Response(sseBody, {
      headers: { "content-type": "text/event-stream", "cf-aig-run-id": "run-123" },
    });
  },
};
const ai = createAI({ binding: binding as never });
```

### メモ③ 境界を測る（切断位置だけ動かす）

`sandbox/src/boundary-probe.ts`。
SSE を 1 チャンクずつ流し、指定位置で `controller.error()` する。
fallback 側は正常に答えるモデルに固定。

### メモ④ resume の再接続

`sandbox/src/scenarios/r-resume.test.ts`。
`cf-aig-run-id` 付きで流して切断し、binding の `fetch` が
`/run/{runId}/resume?from=N` に答える。

### メモ⑤ 実機シナリオ

`sandbox/worker/index.ts` を `wrangler dev --remote` で動かす。
デプロイはしない。モデルは `@cf/meta/llama-3.2-1b-instruct` に固定。

### メモ⑥ 再接続回数

resume ルートが毎回切れる本文を返すようにして、`fetch` が呼ばれた回数を数える。

### メモ⑦ エラー型の比較

```ts
import { createAI, CloudflareAIError } from "agents/models/ai-sdk";
import { APICallError } from "@ai-sdk/provider";

// 通常の失敗 → true / true
// resume の失敗 → false / false
console.log(err instanceof CloudflareAIError, APICallError.isInstance(err));
```

### メモ⑧ `streamRetries` の観測

`sandbox/src/streamretries-probe.ts`。
`fullStream` のパートを id ごと記録すると、テキストブロックが分かれているのが見える。

### メモ⑨ リクエスト数を数える

偽 binding が `calls[model]` と `order[]` を持つので、そのまま数えられる。
`maxRetries` は必ず明示する。

### メモ⑩ 配布パッケージから元の TypeScript を取り出す

```sh
curl -sL https://registry.npmjs.org/agents/-/agents-0.30.0.tgz -o agents.tgz
tar -xzf agents.tgz -C pkg
python3 -c "
import json, os
m = json.load(open('pkg/package/dist/ai-sdk-DRPh2rRa.js.map'))
for i, s in enumerate(m['sources']):
    open(s.split('/')[-1], 'w').write(m['sourcesContent'][i])
"
```

- sourcemap の `sourcesContent` に元ソースが丸ごと入っている
- **実際に npm から配られている版**が読めるので、GitHub より確実
