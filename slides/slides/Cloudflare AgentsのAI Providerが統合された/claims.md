# claims — Cloudflare Agents `createAI` の Fallback 境界

| | |
| --- | --- |
| フェーズ | 6（判定）完了。全主張が決着。**実装バグを 1 件発見（R6）**|
| 次の 1 手 | 8（スライド→記事）へ。骨格は下の「記事の骨格」。R6 は Issue 下書き済み（`issue-draft.md`）|
| 人間待ち | なし（フェーズ5で Workers AI + AI Gateway の無料枠を使う） |
| 開示 | セキュリティの発見は無い。R6 は API 契約のバグで、issue 相当 |
| 作成日 | 2026-10-22 |
| 記事の軸 | **Streaming の Fallback 境界**（ツール名までなら切り替わる。本文が 1 文字出たら確定する） |
| 実機 | 済。`wrangler dev --remote` / Workers AI 無料枠 / 2026-10-22 |

`references.md` でソースを集めた。
ここはその記述を真偽判定できる文に割る。

---

## 一次資料

| 資料 | 種別 | 最終更新 |
| --- | --- | --- |
| [Agents — Models](https://developers.cloudflare.com/agents/models/) | ベンダー doc | 2026-10-21 |
| [Agents — AI SDK](https://developers.cloudflare.com/agents/models/ai-sdk/) | ベンダー doc | 2026-10-21 |
| [Changelog — createAI replaces ...](https://developers.cloudflare.com/changelog/post/2026-10-21-createai/) | ベンダー告知 | 2026-10-21 |
| [AI Gateway — Fallbacks](https://developers.cloudflare.com/ai-gateway/configuration/fallbacks/) | ベンダー doc | **2026-04-20** |
| [Changelog — provider credential errors](https://developers.cloudflare.com/changelog/post/2026-10-05-provider-credential-errors/) | ベンダー告知 | 2026-10-05 |
| [cloudflare/agents#2569](https://github.com/cloudflare/agents/issues/2569) | 移行チェックリスト | closed 2026-10-20 |
| [cloudflare/agents#2576](https://github.com/cloudflare/agents/pull/2576) | PR 本文（設計意図） | merged 2026-10-14 |
| `agents@0.30.0` の sourcemap | **実装そのもの** | published 2026-10-22 |

最後の 1 行が今回の主力になる。
ドキュメントと実装が食い違ったとき、**実装が実際の挙動**なので、
ドキュメント側を ❌ と判定してよい。ただし実機で裏を取るまでは仮説として扱う。

---

## 主張一覧

判定記号は ✅ 確認 / ❌ 違った / 📭 書かれていない / ⬜ 未確認。
「出典」が **source** のものは、ドキュメントに記述が無く実装から読んだ仮説を指す。

### A. Fallback の発火条件（記事の軸）

ドキュメントのこの 1 文を割った。

> A request that the vendor rejects falls back. So does a stream that fails before its first output part. Once a model has produced output, its answer is final, errors included.

| # | 主張 | 出典 | 確かめ方 | 対照 | 実機 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | ベンダーが拒否したリクエストは fallback する | doc | primary を 4xx で落とし、fallback を成功させる | **primary 単体では例外になること**、**fallback 単体では成功すること** | 不要 | ✅ |
| A2 | 最初の出力前に失敗したストリームは fallback する | doc | `stream-start` の直後に `error` パートを流す | 同じモックを fallback 無しで流すと例外になること | 不要 | ✅ |
| A3 | 出力を出した後の失敗は fallback しない | doc | `text-delta` を 1 つ流してから `error` | A2 が fallback していること（**同じモックで位置だけ変える**） | 不要 | ✅ |
| A4 | `text-start` はまだ「出力」に数えられない（状態機械として） | **source** | 生の `LanguageModelV4` leg で `text-start` だけ流して `error` | A3（`text-delta` 後）が fallback しないこと | 不要 | ⚠️ 到達不能 |
| A4b | **chat-completions wire では `text-start` 単独は発行されない**ので、A4 はこの経路で到達不能 | **source** | SSE で `delta.content` を持つ最初のチャンク直後に `error` | `response-metadata` だけのチャンク後の `error` は fallback すること | 不要 | ✅ |
| A5 | `response-metadata` / `tool-input-start` / `raw` は**単独で到達でき**、preamble として扱われる | **source** | 各パートだけを出してから `error` を流す 3 ケース | A3 | 不要 | ✅ |
| A5b | `reasoning-start` は `reasoning-delta` と必ず対で出るので、`text-start` と同じく到達不能 | **source** | `delta.reasoning_content` を持つチャンク直後に `error` | A5 の `tool-input-start` は fallback すること | 不要 | ✅ |
| A5c | 名前だけで引数が空のツール呼び出しは `tool-input-start` 単独を出す | **source** | `tool_calls` に `function.name` だけ入れて `error` | 引数付きなら `tool-input-delta` が出て確定すること | 不要 | ✅ |
| A6 | `finish` の `finishReason.unified === "error"` でも fallback する | **source** | エラー理由の `finish` を流す | 正常な `finish` では fallback しないこと | 不要 | ✅ |
| A7 | abort は fallback せずそのまま投げる | **source** | `AbortSignal` で中断する | **同じ位置の `error` パートなら fallback すること**（A2） | 不要 | ✅ |
| A8 | 失敗した leg のプリアンブルは破棄され、答えた leg のものに差し替わる | doc + source | 両 leg で違う `response-metadata` を出す | 受け取った id が fallback leg のものであること | 不要 | ✅ |
| A9 | ストリームの本体が途中で壊れた場合も、出力前なら fallback する | source | 出力前に body を reject させる | A3 | 不要 | ✅ |

**A4b と A5c がこの記事の核になった。**
ドキュメントは「first output part」としか書かず、実装は 6 種類の preamble パートを並べている。
ところが chat-completions wire を読むと、**そのうち単独で出せるのは 3 種類だけ**だった。

| preamble パート | この wire で単独到達 | 理由 |
| --- | --- | --- |
| `stream-start` | できる | 先頭に必ず 1 つ出る |
| `response-metadata` | できる | 最初のチャンクの id / model から出る |
| `text-start` | **できない** | `text-delta` と同じチャンクから連続で出る |
| `reasoning-start` | **できない** | `reasoning-delta` と対で出る |
| `tool-input-start` | **できる** | 引数が空なら `tool-input-delta` が出ない |
| `raw` | できる | `includeRawChunks` 時のみ |

実務的に言い直すと、こうなる。

> **ツール呼び出しの名前だけが届いた段階なら、まだ別のモデルに切り替わる。
> 本文が 1 文字でも出たら、もう切り替わらない。**

`text-start` が preamble に入っているのは、ベンダーのモデルオブジェクト
（Anthropic の `content_block_start` のように単独で出る wire）のためと読める。
**モデルの種類によって境界が動く**ので、そこまで込みで記事にする。

### B. チェーンの順序と構成

| # | 主張 | 出典 | 確かめ方 | 対照 | 実機 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | fallback は宣言した順に試される | doc | 3 本全部失敗させて `attempts` の並びを見る | **順番を入れ替えた同一チェーン**で並びも入れ替わること | 不要 | ✅ |
| B2 | per-call の fallback は per-model を**置換**する（連結しない） | **source** | 両方に別のモデルを置いて `attempts` を見る | 片方だけ指定したときの `attempts` | 不要 | ✅ |
| B3 | fallback leg は自分の fallback を再展開しない | **source** | leg 自身に fallback を持たせ、総リクエスト数を数える | leg の fallback を外したときの数 | 不要 | ❌ **主張が誤り** |
| B4 | 空配列の `fallback: []` は未指定と同じ | 📭 | 空配列で失敗させ、エラー型を見る | 未指定で失敗させたときのエラー型（C2） | 不要 | ✅ |

### C. エラーの型と分類

| # | 主張 | 出典 | 確かめ方 | 対照 | 実機 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | 全 leg 失敗時は `CloudflareAIError` になり `attempts` が入る | doc | 2 本チェーンを両方失敗させる | 成功時は例外が出ないこと | 不要 | ✅ |
| C2 | `error.attempts` は失敗した fallback モデルを列挙する（**無条件**） | doc | fallback **未設定**で 1 本だけ失敗させる | C1（2 本失敗時は入ること） | 不要 | ❌ **doc が違う** |
| C3 | `code` は 7 分類に収まる | doc | 404 / 401 / 429 / 400 / 5xx を実際に起こす | 正常系が 200 であること | **要** | ❌ **分類が割れる** |
| C4 | 形式が不正なモデル ID は `TypeError` になり fallback しない | **source** | `"gpt-5.5"`（スラッシュ無し）を primary にする | **`"nope/not-a-model"`（形式は正しく実在しない）は fallback すること** | 不要 | ✅ |
| C5 | `isRetryable` は 408 / 409 / 429 / 5xx / ステータス無しで true | **source** | 各ステータスを作って読む | 404 で false になること | 不要 | ✅ |
| C6 | 全 leg 失敗時のエラーは最後の leg の `code` と `isRetryable` を引き継ぐ | **source** | 最後を 429 と 404 で出し分ける | **先頭の leg を別の `code`（401）にしておき、出てくるのが最後の値であること** | 不要 | ✅ |

### D. Retry との入れ子

| # | 主張 | 出典 | 確かめ方 | 対照 | 実機 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | AI SDK の Retry は fallback チェーン**全体**を包む | **source** | `maxRetries: 2` × 2 本チェーンで総リクエスト数を数える | **`maxRetries: 0` の同一チェーン**（2 回になること） | 不要 | ✅ |
| D2 | チェーンが retry されるかは**最後の leg** のエラーで決まる | **source** | 最後を 429 / 404 で出し分け、総数を比較 | D1 | 不要 | ✅ |
| D3 | 404 は fallback するが retry はしない | **source** | 404 単体 + `maxRetries: 2` で総数を数える | **429 単体なら retry されること** | 不要 | ✅ |
| D4 | Gateway の `retries` は 1 カタログモデル内のプロバイダー間で効く | doc | `retries` を付けて log を見る | `retries` 無しのときの試行数 | 要（Gateway） | ✅ **観測不能が仕様** |

### E. Metadata から実行モデルを特定する

| # | 主張 | 出典 | 確かめ方 | 対照 | 実機 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | `providerMetadata.cloudflare.model` は fallback 後に答えたモデルを指す | doc | fallback させてから読む | **primary 成功時は primary の名前であること** | 不要 | ✅ |
| E2 | その `model` は「書いた ID」であってベンダーの申告名ではない | **source** | `response.modelId` と突き合わせる | 両者が一致するケースも示すこと | **要** | ✅ |
| E3 | `model` 以外のフィールドは無いことがある | doc | Workers AI 直呼びで各キーの有無を見る | Gateway 経由では付くこと | **要** | ✅ |
| E4 | ストリームでは `finish` パートに metadata が載る | doc | ストリームの finish を読む | 非ストリームの戻り値と同じ形か | 不要 | ✅ |

### F. 性能（ドキュメントが黙っている）

| # | 主張 | 出典 | 確かめ方 | 対照 | 実機 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | `fallback` を設定すると、**成功時**のストリームでも TTFB が延びる | 📭 **source** | fallback 有無で同一モック primary の TTFB を比較 | **同一モック・同一プロンプト・同一遅延** | 不要 | ❌ **差が出ない** |
| F2 | fallback 発火時の追加レイテンシは、落ちた leg の応答時間の和になる | 📭 | 各 leg に既知の遅延を仕込んで測る | F1 の fallback 無し | 不要 | ✅ |

### G. AI SDK の `streamRetries` との境目

フェーズ3で見つけた。
`ai@7.0.148` の `streamText` には `maxRetries` とは別に `streamRetries` がある。

> Maximum number of retries for provider errors received **after streaming starts**. Default: 0.

`createAI` の fallback が手を引く領域（出力開始後）を、AI SDK 側が拾いにいく。
**両方のドキュメントが互いに触れていないので、重なり方は実測するしかない。**

| # | 主張 | 出典 | 確かめ方 | 対照 | 実機 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | `streamRetries` は出力開始後のエラーを再試行する | AI SDK doc | `text-delta` の後に `error` を流し、`streamRetries: 1` を付ける | **`streamRetries` 省略時は再試行されないこと**（既定 0） | 不要 | ✅ |
| G2 | `streamRetries` の再試行は `doStream` を呼び直すので、**fallback チェーンが先頭から再実行される** | 📭 | A3 の構成に `streamRetries: 1` を足し、`doStream` の呼ばれた回数を数える | `streamRetries` 無しのときの呼び出し回数 | 不要 | ✅ |
| G3 | G2 が起きると「出力後の答えは最終」というドキュメントの記述が破れる | 📭 | 再試行後に答えたモデルが primary かどうかを見る | G1 で再試行が実際に起きていること | 不要 | ❌ **破れない** |
| G4 | `onError` が `{ retry: true }` を返したときも同じ経路を通る | AI SDK doc | `onError` で再試行を要求する | 自動再試行（G1）との差 | 不要 | ✅ 条件付き |
| G5 | **再試行のたびに、部分出力が別ブロックとして `fullStream` に再送される** | 📭 **実測で発見** | `streamRetries: 2` で部分出力後に失敗させ、パート id を見る | `streamRetries` 省略時は 1 ブロックだけであること | 不要 | ✅ |

#### 測った結果

primary を「本文を出してから `error`」、fallback を「正常に答える」に固定し、
`streamRetries` だけを動かした（`src/streamretries-probe.ts`）。

| `streamRetries` | primary の呼び出し | 利用者が見たテキスト | `res.text` | 答えたモデル |
| --- | ---: | --- | --- | --- |
| 省略（既定 0） | 1 | `PARTIAL-` | `PARTIAL-` | primary |
| `1` | 2 | `PARTIAL-PARTIAL-` | `PARTIAL-` | primary |
| `2` | 3 | `PARTIAL-PARTIAL-PARTIAL-` | `PARTIAL-` | primary |

ここから 3 つ出た。

**G2 は当たった。** `streamRetries` は `doStream` を呼び直す。
`createAI` から見ると、チェーンが丸ごともう一度先頭から走る。

**G3 は外れた。** 再試行しても fallback には届かない。
primary のストリームは 2xx で開いて本文まで出せてしまうので、
`withStreamFallbackLegs` は毎回 primary に確定する。
**fallback は「開けなかったとき」の保険であって、「開いた後に壊れたとき」には永久に使われない。**
ドキュメントの「出力後の答えは最終」は、上のレイヤーを足しても破れなかった。

**代わりに G5 が出た。これは計画になかった。**
再試行のたびに、部分出力が**別の id を持つ新しいテキストブロック**として `fullStream` に流れる。

```
text-start id=03b4d183… → text-delta "PARTIAL-" → text-end
text-start id=a8c81696… → text-delta "PARTIAL-" → text-end
text-start id=101d4351… → text-delta "PARTIAL-" → text-end
error → finish-step → finish
```

`res.text` は 1 つ分しか返さないので、**`res.text` を読む実装と `fullStream` を UI に流す実装で見えるものが違う。**
`streamRetries` を有効にしたまま途中失敗が起きると、利用者の画面には同じ文章が繰り返し出る。

---

## ドキュメント同士の矛盾

実機を叩く前に、読むだけで取れたもの。

### 矛盾① `attempts` がいつ入るか

| 資料 | 言っていること |
| --- | --- |
| AI SDK doc（10-21）のサンプル内コメント | `error.attempts lists every fallback model that failed.` 条件なし |
| `fallback.ts`（実装、0.30.0） | `if (attempts.length <= 1) throw lastError;` |

実装どおりなら、**fallback を設定していないときは `attempts` を持たない生のエラーが飛ぶ**。
ドキュメントだけ読んで `error.attempts` を前提にしたコードを書くと、
fallback 未設定の経路で `undefined` を踏む。

- 実装への影響: `error.attempts?.` と書くべきか、`error.attempts.` でよいか
- 確かめ方: C1 と C2 を並べて投げる
- 注意: 新しい方が正しいとは限らないが、**ここは実装が配布物そのものなので実装を優先する**

### 矛盾② Fallback は Gateway で走るのか Worker で走るのか

| 資料 | 言っていること |
| --- | --- |
| AI Gateway — Fallbacks（**2026-04-20**） | Universal Endpoint に fallback を並べると Gateway が切り替える |
| Agents — Models（2026-10-21） | `createAI` は Universal Endpoint を使わない |
| AI SDK doc（2026-10-21） | `Fallback runs in your Worker` |

Fallbacks ページは**半年前の更新のまま、非推奨になった仕組みを説明している**。
`createAI` から来た読者がこのページに飛ぶと、確実に誤解する。

- 実装への影響: `cf-aig-step` を見て fallback を追えると思うと外れる
- 確かめ方: fallback 発火時に `step` が増えるかどうか（E3 と同時に測れる）

### 矛盾③ 必要な AI SDK のバージョン（調べたら doc が正しかった）

| 資料 | 言っていること |
| --- | --- |
| ai-sdk doc | `The provider needs ai@^7 and @ai-sdk/provider@^4` |
| `agents@0.30.0` の `peerDependencies` | `ai: ^6.0.0 \|\| ^7.0.0` |

当初は「doc が v6 に触れていない」と読んだが、**実際に v6 を入れて測ったら逆だった。**

```
ai: 6.0.312 | @ai-sdk/provider: 4.0.31 | agents: 0.30.0
RESULT: 失敗 -> UnsupportedModelVersionError
  Unsupported model version v4 for provider "cloudflare" and model "@cf/zai-org/glm-4.7-flash".
```

`@ai-sdk/provider@3.0.19`（v6 に合う版）でも同じエラーになった。
プロバイダーは `LanguageModelV4` を作るが、`ai@6` は v4 仕様を受け付けない。

**doc は正しく、`package.json` の peer range のほうが誤っている。**
`ai: ^6.0.0 || ^7.0.0` は、宣言どおりに入れると動かない組み合わせを許してしまう。
`ai@6` で `agents` を入れても peer 警告は出ず、最初の `generateText` で初めて落ちる。

これは docs ではなく **agents 側の 2 件目の報告事項**になる。

---

## 書かれていなかったこと（沈黙）

実測するしかないもの。**一次情報になるので優先度が高い。**

| # | 項目 | なぜ要るか | 測り方 |
| --- | --- | --- | --- |
| S1 | 「first output part」の正確な境界 | **記事の軸そのもの。** リトライ設計が変わる | A4 / A5 |
| S2 | fallback 設定による成功時 TTFB のオーバーヘッド | 保険のつもりが常時コストになる | F1 |
| S3 | `maxRetries` × チェーン長でリクエストが積になるか | 課金とレート制限に直結する | D1 |
| S4 | abort 時に fallback が走らないこと | ユーザーのキャンセルで別モデルに課金されたら事故 | A7 |
| S5 | 形式不正なモデル ID が fallback に拾われないこと | 保険が効かない入力がある | C4 |
| S6 | 空の `fallback: []` の扱い | 設定を動的に組むとよく起きる | B4 |
| S7 | 全 leg 失敗時のエラーメッセージの形 | ログ検索の設計に効く | C1 |

---

## 公式サンプルの検証

コピーして動かす前に、サンプル自体を疑う。

- [x] doc のモデル ID が実在するか → **実在した。** フェーズ3で確認済み
- [ ] doc の `fallback` サンプルがそのまま型を通るか（`ai(anthropic(...), { fallback: [...] })`）
- [ ] PRD.md の最小実装例が doc と一致しているか
- [ ] doc が `providerMetadata` と書いている箇所と、実際の戻り値のキーが一致するか

---

## フェーズ3で片付いたもの（実機なし）

認証情報もブラウザも使わずに取れた分。

| 項目 | 結果 | 取り方 |
| --- | --- | --- |
| `@cf/zai-org/glm-4.7-flash` の実在 | ✅ 実在する | `workers-ai/llms.txt` を grep |
| `anthropic/claude-opus-5.5` の実在 | ✅ カタログにある | `ai/models/index.md` を grep |
| AI SDK の `maxRetries` 既定値 | ✅ **2**（0 で無効化） | `ai@7.0.148` の型定義 |
| `streamRetries` の存在と既定値 | ✅ **既定 0、省略で完全無効** | 同上。G 群の根拠 |
| 旧 2 プロバイダーの非推奨 | ✅ npm の `deprecated` にある | registry API |
| `ai` の peer 範囲 | ✅ `^6.0.0 \|\| ^7.0.0`（矛盾③） | registry API |
| Fallbacks ページの陳腐化 | ✅ 2026-04-20 のまま（矛盾②） | doc の更新日 |
| `attempts` のガード条件 | ✅ 実装に `attempts.length <= 1`（矛盾①） | sourcemap |

**`maxRetries` が既定 2 である点は、測定の前提として効く。**
何も指定せずにリクエスト数を数えると、最初から 3 倍に見える。

## フェーズ5（ローカル分）で測った結果

`sandbox/` の偽 binding で 28 件。Cloudflare は一度も叩いていない。

### 境界の観測（`src/boundary-probe.ts`）

primary を「指定位置まで流して接続断」、fallback を「正常」に固定し、**切断位置だけ**を動かした。

| 切断した位置 | fallback | 答えた | 観測されたパート列 |
| --- | --- | --- | --- |
| 何も出さずに切断 | ✅ する | fallback | （fallback の列に差し替わる） |
| `response-metadata` のみ | ✅ する | fallback | 同上 |
| **`tool-input-start` のみ（ツール名だけ）** | **✅ する** | fallback | 同上 |
| `tool-input-delta` まで（引数あり） | ❌ しない | なし | `tool-input-start → tool-input-delta` |
| `reasoning-delta` まで | ❌ しない | なし | `reasoning-start → reasoning-delta` |
| `text-delta` まで（本文 1 文字） | ❌ しない | なし | `text-start → text-delta` |

fallback したケースでは、**落ちた leg のパートが利用者に一切届いていない**。
答えた leg のプリアンブルに差し替わっている（A8）。

結論を 1 文にするとこうなる。

> ツール名だけが届いた段階なら、まだ別のモデルに切り替わる。
> 本文が 1 文字でも出たら、もう切り替わらない。

### Retry との積（`src/scenarios/cd-errors-retry.test.ts`）

2 本チェーンの両方を 500 で落とし、`maxRetries` だけを動かした。

| `maxRetries` | 総リクエスト数 | 内訳 |
| --- | ---: | --- |
| 0 | 2 | primary 1、fallback 1 |
| 2 | **6** | primary 3、fallback 3 |

Retry がチェーンの外側にあるので、**チェーン長 ×（1 + maxRetries）**になる。
エラーコード別では、404 は fallback するが retry されず（2 回で終わる）、
429 は retry される。チェーン全体が retry されるかは**最後の leg** のエラーで決まった。

## フェーズ5（実機）で測った結果

`wrangler dev --remote` で本物の AI binding に当てた。デプロイはしていない。

| | |
| --- | --- |
| 日時 | 2026-10-22 14:42 UTC |
| アカウント | tanahiro2010（個人） |
| モデル | `@cf/meta/llama-3.2-1b-instruct`（Workers AI 無料枠） |
| Gateway | `default` |
| 証跡 | `sandbox/data/evidence-live-*.json`（gitignore） |

対照は両端とも通っている。
先頭の正常系が 1 回目で成功し、最後の正常系も成功した。
全リクエストの `cacheStatus` が `MISS` なので、キャッシュが混ざった観測は無い。

> 1 回目の実行では先頭 2 件が 500（`provider-error`、`isRetryable: true`）で落ちた。
> **対照が通らない回の観測は使っていない。** 上の表は対照が両端とも通った 2 回目以降の結果。

### C3: 「存在しないモデル」の分類が割れる

| 入力 | status | `code` | `isRetryable` |
| --- | ---: | --- | --- |
| `@cf/nope/does-not-exist`（Workers AI） | **400** | **`bad-request`** | false |
| `nope/not-a-real-model`（カタログ） | **404** | **`not-found`** | false |
| `@cf/baai/bge-base-en-v1.5` を chat として呼ぶ | 400 | `bad-request` | false |

**同じ「そんなモデルは無い」が、ID の種類で別の `code` になる。**
Workers AI 側のメッセージは `AiError: No such model`、カタログ側は `Model not found`。

doc は `code` の一覧を挙げるだけで、どの状況がどれに割り当てられるかを書いていない。
`if (err.code === "not-found")` でモデル ID の打ち間違いを拾おうとすると、
**`@cf/` の打ち間違いだけすり抜ける。**

### E3: Workers AI 直呼びで実際に載っていたキー

```
cacheStatus, eventId, gateway, logId, model, requestId, step, traceId
```

`runId` と `provider` は**載らなかった**。doc の記述（`runId` はカタログモデルと
dynamic route、`provider` はモデルオブジェクト）と整合する。
`step` は Workers AI 直呼びでも `0` として載っていた。

### E2: 書いた ID と申告名

Workers AI では `providerMetadata.cloudflare.model` と `response.modelId` が
どちらも `@cf/meta/llama-3.2-1b-instruct` で**一致**した。
両者がズレるのはカタログモデルやモデルオブジェクトの場合なので、
今回の構成（Workers AI のみ）では**ズレる側を確認できていない。**

### 実機のストリーミング

| シナリオ | 結果 |
| --- | --- |
| 正常系 | 最初のパートまで 328 ms、32 パート、`runId` なし |
| primary が存在しない ID → fallback | fallback が答えた。`error` パートは一切届かなかった |

**落ちた leg のパートが利用者に混ざらないこと（A8）が実機でも確認できた。**
`runId` が無いのは doc の Limitations（Workers AI のストリームは resume しない）と合う。

### 実機で決着しなかったもの

- **D4**（Gateway の `retries`）。オプションは受け付けられ、`step` は `0` のままだった。
  retries が実際に何回投げたかは、Worker 側からは観測できない。
  Gateway のログを見るか、意図的に落ちるカタログモデルが要る。
- **429 の再現**。無料枠の範囲では発生させられなかった。
- **401 の再現**。binding 経由では認証が通ってしまうので、
  `createAI({ accountId, apiToken })` に壊したトークンを渡す経路でないと起こせない。

### まだ実機なしで潰せる分

A 群・B 群・C1/C2/C4〜C6・D1〜D3・E1/E4・F 群・G 群は、
偽の binding を渡せば**ローカルで決定的に動かせる**。フェーズ4で書く。

---

## 実機に必要なもの

ユーザーの選択は **Workers AI + AI Gateway（無料枠中心）**。
カタログモデルと Unified Billing は使わない。

| 要るもの | 用途 |
| --- | --- |
| Cloudflare アカウント（Workers） | C3 / E2 / E3 / D4 |
| `[ai] binding = "AI"` の Worker | 同上 |
| `default` gateway（初回使用時に自動作成される） | E3 / D4 |

**A / B / C1・C2・C4〜C6 / D1〜D3 / E1 / E4 / F は実機が要らない。**
`createAI({ binding })` の `binding` は `run()` と `fetch()` を持つオブジェクトでしかないので、
**偽の binding を渡せば Fallback の状態機械をローカルで決定的に動かせる。**
記事の軸である A 群が、まるごとここに入る。

### 順番の罠

このプロジェクトに「認可のやり直し」は無いが、**やり直すと結果が変わるもの**が 3 つある。

```
① AI SDK の maxRetries を先に 0 に固定する
     ← 既定値のまま数えると、リクエスト数が最初から水増しされる
② Gateway キャッシュを無効化するか、プロンプトを毎回ユニークにする
     ← 2 回目以降が cacheStatus: HIT になり、モデルに届かない
③ 無料枠を使う測定（C3 / E3）を先に、繰り返し測定（F）は最後に
     ← Workers AI の無料枠を使い切ると、残りが測れなくなる
④ 最後にもう一度 正常系を通す
     ← 枠切れやトークン失効が起きていないことを示す
```

> ⚠️ ② が一番危ない。
> `cacheStatus` を毎回記録し、**HIT が混ざった観測は捨てる**。
> レコーダに `cacheStatus` を必ず残す。

---

## H 群・R 群: 残りの領域を一通り当たった

「他に仕様違反は無いか」を潰すため、ドキュメントの断定文から機械的に起こした。

### H 群: オプションと Limitations（違反なし）

| # | 主張 | 判定 |
| --- | --- | --- |
| H1 | 優先順位は call > model > provider | ✅ 3 段すべて確認 |
| H2 | `metadata` はキーごとにマージ、他のオプションは上書き | ✅ 3 層が合流した |
| H3 | `{ cacheTtl }` と `{ gateway: { cacheTtl } }` は同じ | ✅ |
| H4 | fallback leg はチェーンの `id` と `cacheTtl` を引き継ぐ | ✅ |
| H5 | `@hf/` と形式不正な ID は `TypeError`、エラー文が 3 形式を名指し | ✅ 送信ゼロ |
| H6 | モダリティの fallback は `@cf/` のみ、dynamic route は理由付きで拒否 | ✅ |
| H7 | `chatTemplateKwargs` はカタログ ID で落とされ warning が出る | ✅ |

H7 の warning の実物。

```
anthropic/claude-opus-5.5 does not take chat_template_kwargs; they were dropped.
```

**この 15 件はドキュメントどおりだった。** オプション周りは正確に書かれている。

### R 群: ストリームの resume

| # | 主張 | 判定 |
| --- | --- | --- |
| R1 | 最後の完全イベントから再開し、取りこぼしも重複もない | ✅ `AAA` + `BBB` = `AAABBB` |
| R2 | 「five drops」で諦める | ⚠️ **数え方がずれる** |
| R3 | バッファが消えていたら（404）諦める | ✅ 1 回試して終わり |
| R4 | run id が無ければ resume しない | ✅ Workers AI は 0 回 |
| R5 | 出力後に切れたら fallback ではなく resume が使われる | ✅ fallback 呼び出し 0 |
| R6 | resume 失敗も `CloudflareAIError` が投げられる | ❌ **仕様違反** |

R5 は軸の補足になる。
**出力が始まった後にストリームが切れたとき、fallback は使われないが resume は効く。**
「切り替わらない」のは別モデルへの話で、同じ run への再接続は別経路で守られている。
ただしこれはカタログモデルと dynamic route だけで、Workers AI には run id が無い。

---

## ❌ R6: resume 失敗のエラーが、公開されている型と違う

**今回見つけた中で、唯一の実装バグ。**

ドキュメントはこう書いている。

> The provider throws `CloudflareAIError`, which extends the AI SDK's `APICallError`, for Workers AI failures, AI Gateway failures, **failed stream resumes**, and a fallback chain where every model failed.

実測。対照は同じ import、同じ `streamText`、失敗のさせ方だけを変えた。

| | 通常の失敗（対照） | resume の失敗 |
| --- | --- | --- |
| `constructor.name` | `CloudflareAIError` | `CloudflareAIError` |
| `e.name` | `CloudflareAIError` | `CloudflareAIError` |
| `instanceof CloudflareAIError` | **true** | **false** |
| `instanceof APICallError` | **true** | **false** |
| `APICallError.isInstance()` | **true** | **false** |

名前だけ同じで、型が違う。

### 原因

クラスが 2 つある。

| ファイル | 定義 | 公開 |
| --- | --- | --- |
| `models/core/errors.ts` | `class CloudflareAIError extends Error` | されない |
| `models/ai-sdk/errors.ts` | `class CloudflareAIError extends APICallError` | **こちらが export** |

通常の失敗は `toAISDKError()` を通って後者に持ち上げられる。
ところが `core/resume.ts` は前者を直接 import していて、

```ts
import { CloudflareAIError } from "./errors";
```

しかもそのエラーが投げられるのは **`run()` が返った後、ストリーム本文の中**なので、
`run()` の `catch` にある変換を通らない。

### 影響

ドキュメントのエラーハンドリング例をそのまま書くと、resume の失敗だけ素通りする。

```ts
import { CloudflareAIError } from "agents/models/ai-sdk";

try {
  // ...
} catch (error) {
  if (error instanceof CloudflareAIError) {
    // ← resume が失敗したときは、ここに入らない
  }
}
```

`APICallError` でもないので、**AI SDK の retry ループが `isRetryable` を読めない。**

### なぜ気づかれていないか

公式テストがこの不一致を検出できない作りになっている。
`packages/agents/src/tests/models/core/resume.test.ts` の import がこれ。

```ts
import { CloudflareAIError } from "../../../models/core/errors";
```

**内部クラスを import して `toBeInstanceOf` しているので、常に通る。**
公開 API としての契約は、どのテストも見ていない。

### 深刻度

**セキュリティの問題ではない。** 可用性にも影響しない。
エラーの分類が取れないので、リトライやログの分岐が外れるだけ。
CVSS を付けるような話ではなく、GitHub の issue 相当。

> 報告するかは人間の判断。`verify-judge` の開示パートは
> セキュリティの発見向けなので、ここでは適用しない。

---

## ⚠️ R2: 「five drops」の数え方

doc は `after five drops in one stream` と書く。
実装が出すメッセージはこう。

```
The stream dropped 6 times; giving up at event 7.
```

resume の試行回数を数えると **5 回**だった。
最初のドロップ + resume 5 回 = 6 回ドロップ、で諦める。
つまり**ストリームは 5 回のドロップを生き延び、6 回目で落ちる。**
doc の「five drops で諦める」は、1 つ手前を指している。

定数は `resumableBody` の `options.maxReconnects ?? 5` で、
**公開オプションに無いので変更できない。**

---

## 記事の骨格（測定からそのまま出てきた）

軸は「Streaming の Fallback 境界」だったが、測り終えてみると
**「ストリームが壊れたとき、誰がどこまで守ってくれるのか」**という 1 本の問いに
全部ぶら下がった。層になっている。

| 壊れた場所 | 守る層 | 利用者から見えること |
| --- | --- | --- |
| 出力が始まる前 | `createAI` の `fallback` | 別のモデルが答える。落ちた leg の痕跡は残らない |
| ツール名だけ届いた時点 | 同上（**まだ間に合う**） | 同上 |
| 本文が 1 文字出た後 | fallback は手を引く | — |
| 出力後・run id あり（カタログ / dynamic） | AI Gateway の resume | 同じ run に再接続。取りこぼしも重複もない |
| 出力後・run id なし（Workers AI） | **誰も守らない** | そのまま失敗する |
| 出力後・`streamRetries` 有効 | AI SDK が**同じモデル**を再試行 | **部分出力が重複して流れる**（G5） |
| resume が尽きた / バッファが消えた | 誰も | **エラーの型が壊れていて `catch` で拾えない**（R6） |

この表がそのまま記事の背骨になる。

### 各節に落とすと

1. **統合された。`fallback` が 1 行で書けるようになった。** 何が変わったか（#1〜#4）
2. **で、どこまで守ってくれるのか。** 境界を測る（A 群）。
   ツール名までなら切り替わる、本文 1 文字で確定する
3. **出力が始まった後は誰が守るのか。** resume（R 群）。
   fallback は手を引くが、別経路の保険がある。ただし Workers AI には無い
4. **保険にも限界がある。** 5 回で諦める（R2）、そして
   諦めたときのエラーが公開型ではない（R6）
5. **上のレイヤーを足すと何が起きるか。** `streamRetries`（G 群）。
   fallback には届かず、部分出力が重複する
6. **実運用で何を設定するか。** Retry の積（D1/B3d）、エラー分類の落とし穴（C2/C3）

### R6 を記事に入れる意味

単なるバグ報告として置くと浮く。
**「守りの層を 1 つずつ剥がしていったら、最後の層の手当てが抜けていた」**
という流れの終点に置くと、軸から外れない。

記事に書ける事実はこれだけある。

- ドキュメントが「failed stream resumes でも `CloudflareAIError`」と明記している
- 実際は `models/core/errors.ts` の別クラスが飛ぶ
- 名前が同じなのでログでは気づけない。`instanceof` で初めて分かる
- 公式テストが内部クラスを import しているので、テストでも気づけない
- 偽の binding だけで再現できる（Cloudflare アカウント不要）
- 報告済み（Issue 下書きは `issue-draft.md`、修正ブランチは
  `sandbox/repos/agents` の `fix/lift-stream-body-errors-to-ai-sdk-type`）

**「公式テストが通っているのに契約が壊れている」**という形は、
テストの書き方の話としても独立して読める。
内部実装を import したテストは、公開 API の約束を守らない。

### 使わない発見

軸から外れるので、記事には入れないか脇に 1 行で済ませる。

- RFC と出荷版の差（attempt tree が flat になった）。面白いが別の記事
- H 群 15 件（オプションの優先順位など）。全部ドキュメントどおりで、話が進まない
- `@hf/` の扱い。枝葉

---

## 決着のための追加検証

残っていた 12 件を潰した。ここで主張が 2 つ覆った。

### リポジトリを clone して突き合わせた

`cloudflare/agents` を clone したところ、Issue #2569 が参照していた設計 RFC
（`design/rfc-workers-ai-gateway-merge.md`、1004 行）と、**公式のテスト**が入っていた。

#### RFC の提案と、実際に出たものの差

RFC は提案であって仕様ではない。出荷版と比べると、落ちた機能がある。

| RFC が提案したもの | 出荷版 |
| --- | --- |
| `fallback` に `"client"` と `"server"` の 2 モード | **client のみ。** `mode` オプション自体が無い |
| `WorkersAIFallbackError` | `CloudflareAIError` に統合 |
| **attempt tree**（`layer` / `transport` / `index` / `startedAt` / `runId`） | **フラットな `{ model, error }` だけ** |
| `recoverability`（5 値の列挙） | `isRetryable: boolean` と `code` |

型定義を grep したところ、`recoverability` / `AttemptLayer` / `attemptTree` /
`WorkersAIFallbackError` はいずれも **0 件**だった。

RFC が「デバッグで一番聞かれるのは**どの層が再試行したか**だ」と書いて設計した
attempt tree は、2 フィールドの配列になって出荷された。

#### D4 が決着した

Gateway の `retries` が何回投げたかを Worker から観測できなかった件は、
RFC §8a が答えを書いていた。

> only the _winning_ step index is on the response header, per-step failures live in the gateway log (`cf-aig-log-id`)

**観測できないのが設計どおり。** Gateway 層の各試行は `cf-aig-log-id` を辿って
Gateway のログを見るしかない。Worker 側の戻り値には勝った step しか載らない。
「測れなかった」ではなく「クライアントからは測れない」が結論になる。

#### 公式テストと突き合わせた

`packages/agents/src/tests/models/ai-sdk/fallback-and-errors.test.ts` が
**偽の binding を使う同じ手法**で書かれていた。こちらの測定と一致した項目。

| 公式テスト | 対応する主張 |
| --- | --- |
| hands over to the next leg when a stream fails before any output | A2 |
| keeps a stream that has already produced output, failure and all | A3 |
| The answering leg's own preamble is what the caller sees, once | A8 |
| reports every leg when each stream fails before output | C1 |
| makes 429 retryable and 401 not | C5 |

そして **C2 の決め手**がここにあった。404 のテストにこの 1 行がある。

```ts
expect(error.attempts).toBeUndefined();
```

ドキュメントは `error.attempts lists every fallback model that failed` と
条件なしで書いているが、**Cloudflare 自身のテストが「fallback 無しなら undefined」を
明示的に期待している。** ドキュメントの側が間違っている。

#### 公式テストが触れていないこと

公式の stream-aware fallback テストは「出力前」と「出力後」の 2 つしか見ていない。
`tool-input-start` だけが出た状態は試していない。
**A5c はベンダー自身のテスト範囲の外にある。**

### 覆った主張

#### B3: 入れ子の fallback は展開される（主張が誤りだった）

「fallback leg は自分の fallback を再展開しない」と書いていたが、**逆だった。**

| 測定 | 結果 |
| --- | --- |
| `ai(P, { fallback: [ai(F, { fallback: [F2] })] })` | `P → F → F2`、F2 が答えた |
| 3 段の入れ子 | `P → F → F2 → F3`、F3 が答えた |
| 同じ入れ子 × `maxRetries: 2` | **9 リクエスト**（3 モデル × 3 回） |

実装が剥がしているのは **per-call** の `fallback`（`withoutCallFallback`）であって、
leg が自分で持つ **per-model** の `fallback` は保持される。
per-call 側は実際に再展開されず、`P → F` のちょうど 2 回で止まった。

つまり**チェーンは木にできる。** そして D1 の積がそのまま効くので、
3 段の入れ子に既定の `maxRetries: 2` を掛けると、1 回の `generateText` が
最悪 9 リクエストになる。

#### F1: fallback 設定による立ち上がりの遅れは観測できなかった

「`fallback` を足すとストリームの覗き見が入るので TTFB が延びる」と予想していた。
プリアンブルを即時、本文を 300ms 遅らせて 7 回ずつ測った。

| | SDK の `start` まで | プロバイダー由来の最初のパート |
| --- | --- | --- |
| fallback なし | median 1ms | median **303ms**（`text-start`） |
| fallback あり | median 1ms | median **303ms**（`text-start`） |

差が出ない理由は A4b と同じだった。
**利用者に見えるプリアンブルが存在しない。**
`response-metadata` は AI SDK が内部で消費して `fullStream` に流さない
（`response.id` としては届いている）。
利用者から見た最初のプロバイダー由来パートは `text-start` で、
それは本文チャンクと一緒にしか来ない。
覗き見の対象になるパートが利用者に届かないので、待ち時間の差も観測できない。

F2 のほうは素直に出た。primary を 200ms 待たせてから落とすと、
fallback の答えが届くのは 203ms 後だった。**落ちた leg の時間はそのまま積み上がる。**

### 追加で埋めた細かいもの

| 主張 | 結果 |
| --- | --- |
| A6 | `finish_reason: "error"` でも出力前なら fallback する |
| A7 | abort は fallback に進まず素通しする。abort 以外の throw は fallback する |
| B2 | per-call の `fallback` は per-model を**置換**する。`P → F2` で F は試されない |
| B4 | `fallback: []` は未指定と同じ。どちらも `attempts` が入らない |
| C5 | 400/401/403/404/422 は `isRetryable: false`、408/409/429/500/503 は `true` |
| E2 | プロバイダーが別名を名乗っても `metadata.model` は書いた ID のまま。`response.modelId` だけが申告名になる |
| G4 | `onError` の `{ retry: true }` は `streamRetries: 0` を渡したときだけ効く。省略すると stream retry が全無効になるため無視される |

---

## 判定の記号

| | 意味 |
| --- | --- |
| ✅ | ドキュメントどおりだった |
| ❌ | ドキュメントと違った |
| 📭 | ドキュメントに記述が無い（実測が一次情報になる） |
| ⬜ | 未確認 |
