# claims — MCPのStep-up Authorization は仕様どおりに動くか

| | |
| --- | --- |
| フェーズ | **6（判定）完了**。5（実機）は全項目を測り終えた |
| 次 | 7 は不要（下記）→ **8. 書く**（slide → article） |
| 人間待ち | なし |
| 開示 | **不要と判断。** C1 は失効トークンには及ばず（C1' で 401 invalid_token を確認）、影響は「一度も発行されていない文字列」に限定。仕様準拠の瑕疵であってセキュリティ問題ではない |
| 作成日 | 2026-10-20 |
| 対象 | Cloudflare API MCP Server（`https://mcp.cloudflare.com/mcp`）の `403 insufficient_scope` と再認可 |
| 実機 | **要**（個人の本番Cloudflareアカウント。読み取り専用操作のみ・2026-10-20 合意） |
| C1'(revoke) | **やる。ただし全検証の最後**（不可逆・2026-10-20 合意） |

## 一次資料

**更新日を必ず書く。** どちらを先に疑うかの材料になる。

| 資料 | 種別 | 最終更新 |
| --- | --- | --- |
| MCP Specification 2026-07-28 — Authorization | 標準 | 2026-07-28 |
| MCP Specification 2025-11-25 — Authorization | 標準（旧） | 2025-11-25 |
| SEP-2350（責務をサーバー→クライアントへ） | 標準の変更提案 | merged 2026-03-28 |
| Cloudflare Changelog（step-up 対応） | ベンダー告知 | 2026-10-19 |
| Cloudflare Changelog（Workers OAuth Provider v1） | ベンダー告知 | 2026-10-01 |
| Cloudflare Changelog（optional scopes） | ベンダー告知 | 2026-08-22 |
| `cloudflare/workers-oauth-provider` docs / src | ベンダー実装 | main（2026-10） |
| Cloudflare「Authorization」docs | ベンダー doc | **2026-07-27**（MCP 2025-06-18 を参照したまま） |
| RFC 6750 §3.1 | 標準 | 2012-10 |
| RFC 9470 | 標準 | 2023-09 |
| `@modelcontextprotocol/client` 2.3.1 / `sdk` 1.32.1 | 実装 | 2026-10-05 |
| Claude Code 2.1.304 | 実装（手元のクライアント） | 2026-10-20 |

---

## 主張一覧

判定記号：✅ 確認 / ❌ 違った / 📭 書かれていない / ⬜ 未測定 / 🔒 人間待ち

### 実機が要らないもの（フェーズ3・済）

| # | 主張 | 出典 | 確かめ方 | 対照 | 判定 |
| --- | --- | --- | --- | --- | --- |
| A1 | PRM の `scopes_supported` は「基本機能に必要な最小集合」 | MCP 2026-07-28 | PRM を引く | AS 側の `scopes_supported` と比べる | ✅ **2 個 : 384 個** |
| A2 | 401 の `scope` は PRM の最小集合と一致する | RFC 6750 / Cloudflare 実装 | 認可なしで `initialize` | — | ✅ 一致 |
| A3 | `offline_access` は PRM に出さない | MCP 2026-07-28（SHOULD NOT） | 両メタデータを grep | AS 側には在ること | ✅ AS のみ |
| A4 | Cloudflare は CIMD と issuer識別に対応（v1 の告知） | Changelog 2026-10-01 | AS metadata を引く | — | ✅ 両方 `true` |
| A5 | 2026-07-28 を名乗っても 401 の中身は変わらない | 📭 記載なし | 3 バージョンで `initialize` | 同一リクエストで版だけ変える | ✅ 全部同じ |
| A6 | DCR は公開されていて、事前登録なしで検証できる | AS metadata | `/register` に POST | — | ✅ public client として登録可 |
| A7 | 和集合（`computeScopeUnion`）はクライアントの責務 | SEP-2350 | SDK とバイナリを読む | `sdk@1.32.1` は上書きのまま | ✅ 2.x と Claude Code は和集合 |
| **C1** | **未知のトークンは `invalid_token`(401)** | RFC 6750 | 発行されていない文字列を投げる | **`not-a-real-token` が 401 になること** | ❌ **40文字以上なら 403 `insufficient_scope`**（C1' で範囲が狭まった） |

### 実機が要るもの（フェーズ5）

| # | 主張 | 出典 | 確かめ方 | 対照 | 判定 |
| --- | --- | --- | --- | --- | --- |
| B1 | 同意画面に `Minimal` がある | Changelog 2026-10-19 | 認可画面を人間が見る | 他に何が並んでいるか | ✅ **ある。** 1枚目がプリセット選択（`Minimal` ＋他数個）、2枚目が権限の内訳（REQUIRED / ADDITIONAL ACCESS + Edit Permissions） |
| B2 | Minimal で接続すると付与Scopeは2個 | Changelog | トークンの `scope` を見る | 要求Scopeと別々に記録 | ❌ **3個**。要求 `user:read account:read` → 付与に `offline_access` が足される |
| B3 | 未許可Scopeが要る操作は `403 insufficient_scope` を返す | MCP 2026-07-28 | 読み取り専用APIを `execute()` | 既に持つScopeの操作が 200 | ⚠️ **操作による。** R2/KV/D1/Queues/Images は403、`/zones` `/workers/scripts` は **200+空配列** |
| B4 | 403 の `scope` は「その操作に必要なもの」だけ | MCP 2026-07-28 | `WWW-Authenticate` を読む | baseline が含まれるか | ❌ **baseline込み** |
| B4' | （対立）Cloudflare 実装は baseline 込みを推奨 | workers-oauth-provider docs | 同上 | B4 と同じ観測 | ✅ **こちらが実機。** しかも baseline でなく**トークンの付与Scope全部**∪必要Scope |
| B5 | 403 はヘッダーで返る（ツール結果の中ではなく） | RFC 6750 | ステータスと本文の両方 | 200+isError が無いか | ⚠️ **両方ある。** カタログに対応Scopeがある操作はヘッダー、無い操作（`/user/tokens`）はツール結果の文字列 |
| C2 | 「既に付与したScopeは保たれる」 | Changelog 2026-10-19 | 2回追加認可して `scope` を追う | 和集合を作らない再認可（D-1） | ⚠️ **baseline だけ保たれる。** それ以外は保たれない |
| C3 | 保っているのはクライアント（AS ではない） | SEP-2350 | D-1b で非baselineの既付与Scopeを要求しない | 対照: 過去の付与ゼロのクライアント | ✅ **確定。** `d1.read` は文字列からも能力からも消えた |
| D1 | 再認可しないとScopeは広がらない（refresh では不可） | RFC 6749 §6 | refresh で広いScopeを要求 | 同じトークンで通常の refresh が成功 | ✅ 200 だが `scope` は**無視**。KVは403のまま（行動確認） |
| D1' | （追加）refresh で**狭める**ことはできる | workers-oauth-provider docs | refresh で baseline だけ要求 | 同上 | ❌ **狭まらない。** `scope` は完全に無視される |
| E1 | 拒否しても既存の権限は壊れない | 📭 記載なし | 拒否後に既存Scopeの操作 | 拒否前の同じ操作が 200 | ✅ 前後とも 200・件数も同じ |
| E2 | 拒否時に認可ループにならない | MCP（retry 制限） | 再試行回数を数える | — | 📭 **自前クライアントでは測れない**（再試行はクライアントの仕事）。Claude Code の `_maxStepUpRetries` はバイナリで確認済み |
| **C1'** | **失効済みトークンも 403 `insufficient_scope` か** | ― | 実トークンを revoke して投げる | revoke 前の同じトークンが 200 | ✅ **401 `invalid_token`。仕様どおり。** C1 の影響は及ばない |
| **C1''** | **別リソース向けの正規トークンではどうか** | ― | `browser.mcp.cloudflare.com` のトークンを `mcp.cloudflare.com` に投げる | **本来の相手では 200**（指紋一致で同一トークンと証明） | ✅ **401 `invalid_token`。仕様どおり** |
| B1' | 同意画面の構成はサーバー共通か | 📭 記載なし | 別サーバーの同意画面を見る | `mcp.cloudflare.com` の画面 | ❌ **違う。** browser 側はカテゴリ別で REQUIRED/ADDITIONAL の2段構成ではない |

> **C1 を狭める作業が、この検証で一番効いた。**
> C1 は「一度も発行されていない40文字以上の文字列」で 403 `insufficient_scope`。
> 現実的な契機を3つ潰した結果、**どれも 401 `invalid_token`（仕様どおり）**だった。
>
> | 実クライアントが持ちうる状態 | 結果 |
> | --- | --- |
> | revoke 済みの実トークン | 401 invalid_token |
> | 別リソース向けの正規トークン | 401 invalid_token |
> | 壊れた文字列 / 39文字以下 | 401 invalid_token |
>
> → **実クライアントの状態からは到達しない。** 意図的に文字列を作らないと起きない。
> 当初想定した「失効したクライアントが追加権限を求められる」は**起きない**。
> 開示は不要。記事には「仕様準拠の細かいズレ」として短く書く。

### 対照が効いているか

| 主張 | 対照が無いと | 置いた対照 | 状態 |
| --- | --- | --- | --- |
| C1 未知トークンで 403 | 「そもそも全部403」と区別できない | `not-a-real-token` → 401 / 39文字 → 401 | ✅ 効いた |
| B3 403 を踏んだ | 「サーバーが落ちてる」と区別できない | `whoami` / `docs` が 200 | ✅ 効いた |
| C3 誰が覚えているか | 「和集合が効いた」と「ASが保持した」が区別できない | **① 過去の付与ゼロのクライアント ② 非baselineの既付与Scope** | ✅ **①で D-1 の判定が覆り、②で決着** |
| D1 refresh では広がらない | 「refreshが壊れている」と区別できない | scope 省略の refresh が 200 | ✅ 効いた（初回は 429 で未測定→測り直し） |
| B3' 空配列は権限フィルタか | 「本当に0件」と区別できない | **同じ操作を Scope 付与の前後で叩く** | ✅ 0件 → 3件 / 12件 |

---

## ドキュメント同士の矛盾

### 矛盾① 403 の `scope` に baseline を入れるか

| 資料 | 言っていること |
| --- | --- |
| MCP 2026-07-28 | servers are **not required to** include the client's previously granted scopes |
| workers-oauth-provider docs（Cloudflare 自身） | every scope it needs, **baseline included** — `insufficientScope(ctx.auth, ['mcp:read','mcp:write'])` |

- どちらも仕様違反ではない（SHOULD の範囲）。だが**クライアントの実装難易度が変わる**
- 確かめ方: B4 / B4'。実機の `WWW-Authenticate` 一発で決まる

### 矛盾② 既存Scopeを保つのは誰か

| 資料 | 言っていること |
| --- | --- |
| MCP 2026-07-28 / SEP-2350 | **クライアント**が和集合を計算する |
| Cloudflare Changelog 2026-10-19 | Scopes you already granted **are kept**（主語がない） |

- Changelog の一文は、クライアント和集合の結果とも、AS 側の保持とも読める
- 確かめ方: C3（D-1 vs D-2）。**和集合を作らない再認可を自前クライアントで投げる**のが唯一の切り分け

### 矛盾③ Cloudflare 自身のドキュメントが古い

- `agents/model-context-protocol/protocol/authorization/` は **2026-07-27 更新で MCP 2025-06-18 を参照**
- 2025-06-18 には step-up の記述が無い。Changelog からリンクされているのにページは追随していない
- 実機の挙動には影響しないが、**読者が最初に当たるページ**なので記事で触れる価値がある

---

## 書かれていなかったこと（沈黙）

| # | 項目 | なぜ要るか | 測り方 | 状態 |
| --- | --- | --- | --- | --- |
| S1 | **トークンが「形として妥当」と見なされる条件** | 401 と 403 の分かれ目。403 は step-up の発火点 | 二分探索 | ✅ **40文字**（`[A-Za-z0-9_-]`） |
| S2 | どのCloudflare APIがどのScopeを要求するか | 403 を踏むために必須 | `search()` → `execute()` | ⬜ |
| S3 | 403 を踏んだ後、同じセッションが生きているか | 再試行の作法が変わる | `Mcp-Session-Id` を追う | ⬜ |
| S4 | 2回目以降の同意画面は何を見せるか | 「追加だけ」か「全部」かでUXが変わる | 人間が見る | 🔒 |
| S5 | 403 のレート制限・再試行上限 | 事故時の挙動 | 連続で踏む（控えめに） | ⬜ |
| S6 | トークンの有効期限 | C1' の設計に要る | `expires_in` を見る | ⬜ |

---

## 公式サンプルの検証

- [x] `insufficientScope()` の実装を読んだ（ヘッダー形式が実機の401と一致）
- [x] Changelog の引用元を `/index.md` で取り、要約でなく原文を確認した
- [ ] Cloudflare の MCP docs のサンプルコードは未検証（2026-07-27 版・古い参照を含む）

---

## 実機に必要なもの

- **個人のCloudflareアカウント**（本番リソースを持つアカウントで可。ただし**読み取り専用操作のみ**）
- OAuthクライアントは**事前登録不要**（A6: DCR で自動登録。`data/client.json`）
- ブラウザでの認可操作：**最低3回**（初回Minimal / 追加認可 / 対照のD-1）＋拒否1回

### ⚠️ 1回しか試せない検証（先に洗い出す）

| # | 内容 | なぜ1回きりか |
| --- | --- | --- |
| B1 / B2 | **初回の同意画面**（Minimal の既定状態） | 一度承認すると、以後は「追加分だけ」の画面になる可能性が高い |
| S4 | 2回目の同意画面 | 同上。1回目と2回目は別物として記録する |
| C2 / C3 | Scope の積み上がり | 一度広いScopeを承認すると、狭い状態に戻すには revoke が要る |
| C1' | 失効トークンの挙動 | **revoke は不可逆**。他の実機検証を全部終えてから最後に回す |

> **実行順（verify-pipeline フェーズ5）**
> ① B1/B2 初回同意（1回きり）→ ② B3/B4/B5 403を踏む → ③ C2/C3 積み上げ（D-1 を先に、D-2 を後に）
> → ④ D1 refresh の限界 → ⑤ E1/E2 拒否 → ⑥ S1境界の再確認 → ⑦ **C1' revoke（不可逆・最後）**
> → ⑧ **最後にもう一度正常系**（ここまでの観測が有効だったと示す）

### 安全上のルール

- 書き込み・削除系APIは叩かない。`*.read` のみ
- 公開エンドポイントへの連打をしない（境界探索は間隔を空け、最小回数）
- アクセストークン / リフレッシュトークン / 認可コード / `code_verifier` は**指紋化**して記録
- `WWW-Authenticate` は秘密を含まないのでそのまま残す（この検証の主役）


---

## 実測で出た、計画になかったもの

| # | 見つけたもの | なぜ効くか |
| --- | --- | --- |
| N1 | **403 の `scope` = トークンの付与Scope全部 ∪ 必要Scope** | 2025-11-25 の "Recommended approach"（サーバーが既存Scopeを含める）そのもの。2026-07-28 が**削除した方**。Issue #2349 が「ステートレスなサーバーには不可能」と言ったやり方を、ASとRSが状態を共有する Cloudflare はやれてしまう。結果 `sdk@1.32.1` のような上書き型クライアントでも #1582 のループに落ちない |
| N2 | **権限不足が 200 + 空配列になる操作がある** | `/zones` 0件→3件、`/workers/scripts` 0件→12件（Scope付与の前後）。step-up が起動せず、AIは「ありません」と報告する。**静かな失敗** |
| N3 | **`x-api-token-group` で Scope↔エンドポイントが引ける** | `search()` の OpenAPI spec に入っている。"OAuth scopes have the same names"。references.md の「公開情報に無い」は誤り |
| N4 | **refresh は `scope` を完全に無視する**（広げるのも狭めるのも） | ライブラリdocs は "can only narrow the grant" と書いている。ドキュメントと実装の食い違い |
| N5 | **access_token の revoke では refresh_token は死なない** | revoke 後も refresh が 200。refresh_token を revoke して初めて `invalid_grant "Grant not found"` |
| N6 | **refresh は直列化されていて重なると 429 `temporarily_unavailable`**、refresh_token は毎回**回転** | Claude Code CHANGELOG の「並行 refresh でトークンを失う」系の修正と符合 |
| N7 | **2026-07-28 は `initialize` が無い**（ステートレス）。`_meta` 必須 + `Mcp-Method` / `Mcp-Name` ヘッダー必須 | 本文を開かずに中間装置がルーティングできる設計。Claude Code の `_applyBodyDerivedHeaders` と一致 |
| N8 | **同意は2画面構成**（プリセット選択 → 権限の内訳）。しかもサーバーごとに違う | `mcp.cloudflare.com` は REQUIRED / ADDITIONAL ACCESS の2段、`browser.mcp.cloudflare.com` はカテゴリ別で Edit Permissions なし |

## 測り直した／取り下げた判定

| 何を | なぜ |
| --- | --- |
| **B1「同意画面に `Minimal` は無い」→ 取り下げ** | **ある。** 受け取ったスクリーンショットが2枚目（権限の内訳）だけで、1枚目のプリセット選択画面を見ていなかった。**資料に写っていないことを「存在しない」と書いた。** Changelog の記述は正確 |
| **D-1「ASが過去の付与を保持している」→ 取り下げ** | 「要求しなかった3つが残った」は観測事実だが、**過去の付与ゼロのクライアントでも同じ3つが同意画面に出た**。baseline の既定で説明がつく。非baseline の `d1.read` で測り直して決着 |
| **refresh の判定 → 測り直し** | 3ケースを連続投入して 2本目以降が 429。**本題は一度も実行されていないのに**「広がらなかった」と出力していた。間隔を空けて再測定 |

## 記録の出どころについて（正直に）

- 実験E の拒否コールバックは、**ローカルのリスナーではなく人間がアドレスバーからコピーした値**。
  検証スクリプトをツール呼び出しの子プロセスで起動したため、Cancel の瞬間にリスナーが落ちていた。
  `state` は生成値と一致を照合済み。対照クライアント側では**リスナーが実際に受けた**同形の拒否がある。
- 同意画面の内容は**人間の観測**（スクリーンショット）。images/1〜4。記事には貼らない（画像を使わない方針のため）。
  Edit Permissions の中身はスクショを取り損ねたが、「optional な権限のチェックを外せた」ことは確認済み。
