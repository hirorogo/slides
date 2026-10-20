# 検証詳細 — MCPのStep-up Authorization

読みやすい要約は [SUMMARY.md](./SUMMARY.md)。こちらは**全部**書く。
判定表は [claims.md](./claims.md)、資料集めは [references.md](./references.md)、コードは [sandbox/](./sandbox/)。

| | |
| --- | --- |
| 検証日 | 2026-10-20 |
| 対象 | Cloudflare API MCP Server `https://mcp.cloudflare.com/mcp` |
| クライアント | 自作の最小MCPクライアント（TypeScript / tsx、SDK不使用） |
| 記録 | HTTP往復 **128件** を JSONL で保存（指紋化あり/なしの2本立て） |
| アカウント | 個人の本番Cloudflareアカウント（読み取り専用操作のみ） |
| 環境 | macOS Darwin 25.5.0 (arm64) / Node.js / Claude Code 2.1.304 |

---

## 1. なぜ SDK を使わなかったか

`@modelcontextprotocol/client@2.3.1` は 403 を見た時点で `computeScopeUnion()` を呼び、
**自動的に和集合を作って再認可する**。これだと今回の中心的な問い

> 既存Scopeを保っているのは、クライアントの和集合か、認可サーバーか？

の **対照（＝和集合を作らない再認可）が作れない**。
そのため OAuth と MCP を手で踏む最小クライアントを書いた。
「何を要求するか」を毎回こちらが決められることが、この検証の前提になっている。

### 構成

```
sandbox/
├── src/
│   ├── config.ts        設定（PORT / MCP_SERVER_URL / プロトコル版）
│   ├── http.ts          通信層。**例外を投げない**。400も403も結果として返す
│   ├── evidence.ts      記録フック。全送信がここを通る
│   ├── oauth.ts         DCR / PKCE / 認可URL / コールバック受け / トークン交換
│   ├── mcp.ts           Streamable HTTP の JSON-RPC。2026-07-28 と旧版の両方
│   ├── store.ts         data/ の状態（client・tokens・tokens-history・findings）
│   └── <実験ごと>.ts     probe / tokenshape / connect / stepup / hunt / reauth /
│                        freshclient / scopecheck / refreshtest(2) / denytest /
│                        denyafter / revoketest / crossresource / check / schema
└── data/                生ログ・トークン・状態（.gitignore 済み）
```

### 記録の作法

1往復 = 1行の JSON。**整形出力は結論に使わない。**

```json
{"seq":3,"timestamp":"…","label":"mcp: initialize",
 "request":{"method":"POST","url":"…","headers":{…},"body":"…","bodySha256":{…}},
 "response":{"status":403,"headers":{…},"body":{…}},
 "durationMs":144,
 "challenge":{"_scheme":"Bearer","error":"insufficient_scope","scope":"…"}}
```

- 秘密は消さずに**指紋**にする：`{"_redacted_len":82,"_sha256_16":"184d68d85f68caab"}`
  `<redacted>` だと「同じトークンを使い回した」も「毎回別物が出た」も示せない。
  実際にクロスリソース検証で、**同じ指紋を2つのサーバーに投げた**ことの証明に使った。
- `WWW-Authenticate` は秘密を含まないので**そのまま残す**。この検証の主役。
- 指紋化あり（`evidence-*.jsonl`）と指紋化なし（`*.raw.jsonl`）の2本を書く。

---

## 2. 実行順（なぜこの順番か）

`verify-pipeline` フェーズ5の原則に従い、**1回しか試せないもの**を先に、
**不可逆なもの**を最後に置いた。

```
実験0   認可なしで取れるもの＋対照＋DCR          ユーザー操作なし
実験0-6 トークンの「形」の境界（二分探索）         ユーザー操作なし
実験A   最小Scopeで接続（★1回きりの同意画面）     ブラウザ
―― ここで「まずMCPが普通に動く」ことを確認してから 403 を踏みに行く ――
実験B   403 を踏む／どのAPIがチャレンジを返すか    ユーザー操作なし
実験D-1 和集合を作らない再認可（対照）             ブラウザ
対照    過去の付与ゼロのクライアント               ブラウザ（Cancelのみ）
実験D-1b 非baselineの既付与Scopeで測り直し          ブラウザ
実験D-2 和集合で再認可                            ブラウザ
実験D1  refresh でScopeを広げられるか              ユーザー操作なし
実験E   拒否                                     ブラウザ（Cancelのみ）
最後の正常系                                     ユーザー操作なし
実験C1' revoke（★不可逆）                        ユーザー操作なし
追試C1'' クロスリソーストークン                    ブラウザ
```

「まずMCPが普通に動くことを確認してから403を踏む」は、
**403が出なかったときに「権限が足りていた」のか「そもそも届いていない」のかを
切り分けるため**。実際これをやっていなかったら、最初の3本が全部200だったときに
原因を取り違えていた。

---

## 3. 実験0 — 認可なしで取れるもの

### 3.1 認証なしの 401

```sh
curl -s -i -X POST https://mcp.cloudflare.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{…}}'
```

```http
HTTP/2 401
www-authenticate: Bearer realm="OAuth",
  resource_metadata="https://mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp",
  scope="user:read account:read"
```

### 3.2 2つの `scopes_supported` — 2 : 384

| メタデータ | RFC | 個数 | 中身 |
| --- | --- | ---: | --- |
| Protected Resource Metadata | RFC 9728 | **2** | `user:read`, `account:read` |
| Authorization Server Metadata | RFC 8414 | **384** | `offline_access`, `dns.write`, `zone.write` … |

- 401 の `scope` と PRM の2個は**完全一致**
- `offline_access` は AS 側384個にはあるが **PRM には無い**
  → 仕様の「PRM に `offline_access` を入れるな（SHOULD NOT）」に適合
- AS metadata で確認できた属性
  - `client_id_metadata_document_supported: true`（CIMD）
  - `authorization_response_iss_parameter_supported: true`（RFC 9207）
  - `code_challenge_methods_supported: ["S256"]`
  - `registration_endpoint` あり（DCR 可）
  - `revocation_endpoint` は token_endpoint と同一（`/token`）

Workers OAuth Provider v1 のChangelogが言っていること（CIMD・issuer識別・DCR互換）と一致する。

### 3.3 プロトコル版を変えても 401 は同じ

`2026-07-28` / `2025-11-25` / `2025-06-18` の3版で同一リクエストを投げ、
いずれも `401` + `scope="user:read account:read"`。

### 3.4 DCR

事前登録なしで検証できる。`token_endpoint_auth_method: "none"` の public client として登録され、
`client_secret` は発行されない。

---

## 4. 実験0-6 — トークンの「形」の境界

対照に置いた使い捨てトークンが、**予想外の返事**をした。

| 送った文字列 | HTTP | error | error_description |
| --- | --- | --- | --- |
| `not-a-real-token` | 401 | `invalid_token` | Access token appears malformed; reauthenticate and try again |
| **ランダム43文字（base64url）** | **403** | **`insufficient_scope`** | Token lacks required user:read or account:read scope |
| （ヘッダーなし） | 401 | — | — |

403 `insufficient_scope` は MCP 仕様では **step-up 再認可の発火点**なので、
掘る価値があると判断した。

### 決定的か

別の乱数3本で全部同じ → 決定的。

### 文字種（長さ43で固定）

| 入力 | 結果 |
| --- | --- |
| base64url / 16進 / 英小文字のみ / ハイフン入り | **403** |
| ドット入り（JWT風） | 401 |
| コロン入り | 401 |
| 空白入り | 401 |

### 長さの二分探索

`a` だけを並べて1文字まで詰めた。

```
1文字  401 / 64文字 403 / 32文字 401 / 48文字 403 /
40文字 403 / 36文字 401 / 38文字 401 / 39文字 401
→ 境界: 39文字までは 401、40文字から 403
```

**ちょうど40。** 丸い数字が出た時点で実装定数と判断できる。

> ⚠️ この時点では「失効トークンでも同じでは」と疑っていた。
> 後の C1' / C1'' で**その疑いは外れる**（§10）。
> 境界が綺麗に出たからといって、影響が大きいとは限らない。

---

## 5. 実験A — 最小Scopeで接続（1回きり）

要求 `user:read account:read` に対し、**付与は3個**。

```
要求した scope  : user:read account:read
付与された scope: user:read offline_access account:read
```

### 同意画面（人間の観測・スクリーンショット）

```
Permissions this app will be granted              4 total permissions

REQUIRED
  User Read        Background Access

ADDITIONAL ACCESS                                 Edit Permissions
  Developer Platform   1 permission   ・D1 Read
  Account & Billing    1 permission   ・Account Read
```

- **同意は2画面。** 1枚目が `Minimal` を含むプリセット選択、2枚目が上の権限の内訳。
  Changelog の `choose Minimal on the consent page` は**正確**
  （当初「`Minimal` は無い」と書いたのは誤り。§13 参照）
- `offline_access`（Background Access）が **REQUIRED 扱い**
  → 要求していないのに付与された理由はこれ
- ADDITIONAL ACCESS の権限は **Edit Permissions から外せる**（本人がクリックして確認）
  = 2026-08-22 の optional scopes が効いている

### プロトコル 2026-07-28 でつまずいた点

最初 `initialize` を投げたら 400 が返った。

```
-32020 the request headers and body disagree: an initialize request
       (legacy handshake) was sent with a modern MCP-Protocol-Version header
-32602 the MCP-Protocol-Version header names protocol revision 2026-07-28,
       but the request is missing the required per-request envelope key(s): _meta
-32020 the body names method tools/list but the required Mcp-Method header is absent
```

2026-07-28 は**ステートレス**で `initialize` ハンドシェイクが無い。代わりに:

- 毎リクエストの `params._meta` に
  `io.modelcontextprotocol/protocolVersion`（必須）、
  `io.modelcontextprotocol/clientCapabilities`（必須）、
  `io.modelcontextprotocol/clientInfo`（SHOULD）
- **本文の内容をヘッダーにも書く**：`Mcp-Method`、`Mcp-Name`

後者は中間装置（WAF・プロキシ・レート制限）が**JSON本文を開かずに**
ルーティングできるようにするためと読める。Claude Code のバイナリにも
同じ処理（`_applyBodyDerivedHeaders`）がある。

旧版（2025-11-25）の `initialize` 経路は、**ヘッダーを付けなければ**そのまま通る。
両方で `tools/list` が 200 になることを確認した。

### ツールは4本（公式docsは3本）

`docs` / `search` / `execute` / **`whoami`**。`whoami` は公式ドキュメント未記載。

---

## 6. 実験B — 403 を踏む

### 6.1 Scope対応表は引ける（references.md の訂正）

`search` の説明文：

> `"x-api-token-group"?: string[]; // API token permissions the endpoint accepts
>  (any one); **OAuth scopes have the same names**`

実際に引くと `GET /zones → ["Zone Zone Read"]`。
references.md に「公開情報に無い」と書いたのは**誤り**だった。

### 6.2 3通りの失敗の仕方

8つの読み取り専用エンドポイントを総当たりした（全部 GET）。

| 操作 | 必要Scope | 結果 |
| --- | --- | --- |
| R2 バケット一覧 | `workers-r2.read` | **403 + チャレンジ** |
| KV 名前空間一覧 | `workers-kv-storage.read` | **403 + チャレンジ** |
| D1 データベース一覧 | `d1.read` | **403 + チャレンジ** |
| Queues 一覧 | `queues.read` | **403 + チャレンジ** |
| Images 統計 | `images.read` | **403 + チャレンジ** |
| アカウントメンバー一覧 | `memberships.read` | 200（2件返る。ゲートされていない） |
| ゾーン一覧 | `zone.read` | 200 + **空配列** |
| Workers スクリプト一覧 | `workers-scripts.read` | 200 + **空配列** |
| `/user/tokens` | （カタログに無い） | ツール結果の文字列で403 |

`/user/tokens` の文面：

> Cloudflare API error: GET /user/tokens returned HTTP 403: 9109: Unauthorized to
> access requested resource. **No OAuth scope covers this endpoint, so OAuth
> connections cannot use it.** Connect with an API token that has one of these
> permissions instead: API Tokens Write, API Tokens Read.

対応Scopeがカタログに無いので step-up のしようがない。チャレンジが返らないのは当然。

### 6.3 チャレンジの中身 — baseline込み

```http
HTTP/2 403
WWW-Authenticate: Bearer realm="OAuth", error="insufficient_scope",
  scope="user:read account:read workers-r2.read",
  resource_metadata="https://mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp",
  error_description="This operation needs the workers-r2.read scope"
```

5本すべて同じ形。claims.md の **矛盾① が決着**した。

| | 403の `scope` に何を入れるか |
| --- | --- |
| MCP 2026-07-28 仕様 | 「その操作に必要なものだけでよい。既存Scopeを含める義務はない」 |
| workers-oauth-provider docs | 「**baseline込みで**全部入れろ」 |
| **実機** | **後者** |

---

## 7. 和集合を作っているのはサーバーだった（計画外の発見）

チャレンジの `scope` を、**トークンの中身を変えて複数回**観測した。

| 持っていたScope | 叩いた操作 | チャレンジの `scope` |
| --- | --- | --- |
| baseline のみ | R2一覧 | `user:read account:read workers-r2.read` |
| baseline + `workers-r2.read` | D1一覧 | `user:read account:read workers-r2.read **d1.read**` |
| baseline + `workers-r2.read` | KV一覧 | `user:read account:read workers-r2.read **workers-kv-storage.read**` |
| baseline + r2 + d1 + zone + workers-scripts | KV一覧 | 上記6個 + `workers-kv-storage.read` |

**baseline固定ではない。トークンの付与Scopeに追随している。** つまり

```
challenge.scope = トークンに付与済みのScope ∪ その操作に必要なScope
```

これは **2025-11-25 仕様の "Recommended approach"**（サーバーが既存Scopeを含める）であり、
**2026-07-28 が削除した方**。Issue #2349 の指摘：

> placing scope accumulation responsibility on the server rather than the client.
> This contradicts the RFC, creates an **impossible requirement for stateless servers**,
> and leads to infinite re-authorization loops in practice.

Cloudflare は AS とリソースサーバーが状態を共有しているので「不可能」が成立しない。

**効果**：`@modelcontextprotocol/sdk@1.32.1` のような「403のscopeで `_scope` を上書きする」
クライアントでも、Cloudflare相手なら typescript-sdk#1582 の無限ループに落ちない。
サーバーが肩代わりしている。

なお `offline_access` はチャレンジに含まれない（仕様の SHOULD NOT に適合）。

---

## 8. 誰が既存Scopeを覚えているか（本題）

### 8.1 D-1：和集合を作らずに再認可する

`d1.read` **だけ**を要求し、持っていた3つをあえて落とした。

```
要求 : d1.read
付与 : d1.read user:read offline_access account:read
```

要求していない3つが残った。**この時点では「認可サーバーが保持している」と読めた。**

### 8.2 ⚠️ 判定を取り下げた

候補が3つあって、D-1 だけでは切り分けられなかった。

1. 前回付与したものをASが保持している
2. **DCR の登録時に `scope: "user:read account:read"` を渡した**（こちらの作り込み＝交絡）
3. リソースの baseline を既定で出しているだけ

対照を作った：**過去の付与ゼロ**のクライアントを新規にDCR登録し、
登録 `scope` も `d1.read` だけにして、同じ `scope=d1.read` で同意画面を出した。

結果、**同意画面は完全に同一**（4 permissions、REQUIRED に User Read / Background Access、
ADDITIONAL ACCESS に D1 Read / Account Read）。

→ **③ で説明がつく。D-1 は保持の証拠にならない。判定を取り下げた。**

### 8.3 D-1b：baseline でない既付与Scopeで測り直す

`d1.read` を持った状態（baselineではない）で、`workers-r2.read` **だけ**を要求した。

同意画面に **`D1 Read` は出なかった**（スクリーンショットで確認）。承認後：

```
要求 : workers-r2.read
付与 : workers-r2.read user:read offline_access account:read     ← d1.read が無い
```

**行動でも確認**した。D1 一覧は再び 403 チャレンジに戻った。
文字列だけでなく能力も失われている。

> **結論（C3）**：Cloudflare の認可サーバーは、baseline 以外の既付与Scopeを引き継がない。
> 和集合を作るのはクライアントの仕事。Google の `include_granted_scopes`（ASが合成）とは構造が逆。

### 8.4 D-2：和集合で再認可（普通のクライアントの動き）

6個まとめて要求 → 7個（`offline_access` 追加）付与。同意画面は製品カテゴリ別に整理されて表示。

---

## 9. 権限不足が静かに「0件」になる

§6.2 で `/zones` と `/workers/scripts` が 200 + 空配列だった。
**権限フィルタなのか、本当に0件なのか、その時点では区別できない。**
Scope を付与して同じ操作を叩き直した。

| 操作 | Scope無し | Scope付与後 |
| --- | ---: | ---: |
| ゾーン一覧 | **0件** | **3件** |
| Workers スクリプト一覧 | **0件** | **12件** |
| D1 データベース一覧 | 403 challenge | 5件 |

同一アカウント・同一クライアントで Scope だけを変えた前後比較。**対照は固い。**

**意味**：権限が無いあいだ、AIエージェントは「ゾーンはありません」と報告する。
403 が返らないので step-up は起動せず、ユーザーに権限を聞きにいく機会が発生しない。

**機構は未確認**（§12 の積み残し）。Cloudflare API 側が list をトークン権限で
フィルタしている可能性が高いが、MCPサーバーのゲート一覧を見たわけではない。

---

## 10. refresh で Scope は広げられるか

### 10.1 ⚠️ 最初の測定は無効だった

3ケースを連続で投げたら、2本目以降が

```
429 temporarily_unavailable  "Token refresh is already in progress; retry shortly"
```

**本題（広げる）は一度も実行されていない。** なのにスクリプトは
「広がっていない（= 差分が空）」から「refresh では広げられない」と出力していた。
429 で落ちたから空なのであって、挙動を見ていない。**判定を取り下げて測り直した。**

### 10.2 測り直した結果（間隔を空け、429 は指数バックオフで再試行）

| ケース | HTTP | 付与された scope | 判定 |
| --- | --- | --- | --- |
| ① scope 省略（対照） | 200 | 元の7個のまま | 対照成立 |
| ② 広げる（`workers-kv-storage.read` 追加） | 200 | **元の7個のまま** | 要求が**無視**された |
| ③ 狭める（baseline だけ要求） | 200 | **元の7個のまま** | 要求が**無視**された |

**行動でも確認**：② の後に KV 一覧は 403 のまま、③ の後に `d1.read` はまだ通る。

- ② は RFC 6749 §6 どおり（広げられない）。ただしエラーではなく**黙って無視**
- ③ は **Cloudflare 自身のライブラリdocs と食い違う**

### 10.3 ライブラリ側を読んだ → PR の出しどころなし

```ts
// handleRefreshTokenGrant 内
let tokenScopes = this.downscope(body.scope, grantData.scope);

private downscope(requestedScope, allowedScopes) {
  if (!requestedScope) return allowedScopes;
  return requestedScopes.filter((scope) => allowedScopes.includes(scope));  // 交差
}
```

docs の "Token and refresh requests can only narrow the grant" は
**ライブラリについては正確**。食い違っているのは hosted サーバーの方。

> これは「Cloudflareの実機は workers-oauth-provider v1 で動いている」という
> references.md の推論を**弱める**。チャレンジのヘッダー形式は一致するが、
> トークン検証（`"appears malformed"` の文言がOSSに無い）と refresh の scope 処理は別物。

### 10.4 おまけ

- refresh は**直列化**されている（重なると 429）
- `refresh_token` は毎回**回転**する

Claude Code CHANGELOG の「並行 refresh でトークンを失う」系の修正と符合する。

---

## 11. 拒否・失効・クロスリソース

### 11.1 実験E — 拒否

```
?error=access_denied&state=…&iss=https%3A%2F%2Fmcp.cloudflare.com
```

- `iss` が返る（RFC 9207）。AS metadata の宣言と一致
- `error_description` は無し
- **拒否の前後で既存の権限は無傷**（`account:read`=200、D1一覧=200・5件で前後一致）
- 拒否した `workers-kv-storage.read` は相変わらず 403 チャレンジ（＝拒否が効いている）
- **E2（ループ）は自前クライアントでは測れない。** 再試行はクライアント実装の仕事。
  Claude Code の `_maxStepUpRetries` はバイナリで確認済みだが、実機で回してはいない

### 11.2 実験C1' — revoke（不可逆）

| 手順 | 結果 |
| --- | --- |
| ① 失効前（対照） | HTTP 200 |
| ② access_token を revoke（RFC 7009） | HTTP 200 |
| ③ 失効した access_token で同じ操作 | **401 `invalid_token`** "Invalid access token" |
| ④ refresh はまだ効くか | **200（効く）** |
| ⑤ refresh_token も revoke | HTTP 200 |
| ⑥ もう一度 refresh | 400 `invalid_grant` "Grant not found" |

**③ が本題。401 `invalid_token` で仕様どおり。** 当初の疑いは外れた。
④ も収穫：**access_token の revoke では refresh_token は死なない。**

### 11.3 追試C1'' — 別リソース向けの正規トークン

`browser.mcp.cloudflare.com`（別リソース・別AS）でトークンを取り、
`mcp.cloudflare.com` に投げた。**同じ指紋**を両方に出して同一性を示した。

| 投げ先 | HTTP | error |
| --- | --- | --- |
| 本来の相手（対照） | **200** | — |
| `mcp.cloudflare.com` | **401** | `invalid_token` |

**仕様どおり。** これで C1 の現実的な契機は全部潰れた。

### 11.4 C1 の最終的な範囲

403 `insufficient_scope` が返るのは
**「一度も発行されていない40文字以上の `[A-Za-z0-9_-]` 文字列」だけ**。
実クライアントが持ちうる状態からは到達しない。

### 11.5 別サーバーの同意画面は構成が違う

```
This will allow Cloudflare Browser Isolation MCP Server to    4 total permissions

Account & Billing   2    ・User Read  ・Account Read
OAuth scopes        1    ・Background Access
Developer Platform  1    ・Browser Run write
```

REQUIRED / ADDITIONAL ACCESS の2段ではなく、**カテゴリ別**。Edit Permissions も見当たらない。
`scope=` を空で送ったのに `browser:write` が既定で付与された（本検証では未使用）。

---

## 12. 積み残し・測っていないこと

**ここに書いてあることは記事で「確認できていません」と書くか、落とす。**

| # | 項目 | なぜ測れなかったか |
| --- | --- | --- |
| 1 | **期限切れ（revoke ではない）トークンの挙動** | 有効期限3600秒。revoke で代用したが別物の可能性は残る |
| 2 | **なぜ一部のエンドポイントだけゲートされるのか** | MCPサーバー側のゲート一覧は非公開。API側のフィルタと推測しているが未確認 |
| 3 | **E2（認可ループ）の実機挙動** | 再試行はクライアントの仕事。自前クライアントでは測れない |
| 4 | **Claude Code を実際に Cloudflare に繋いだ場合の挙動** | バイナリの静的解析のみ。エンドツーエンドで走らせていない |
| 5 | **R2 バケットが本当に0件か** | 付与後も0件。アカウントに無いと思われるが、`/zones` のような前後比較ができていない |
| 6 | **Edit Permissions パネルの中身** | スクリーンショットを撮り損ねた。「外せた」ことだけ本人確認済み |
| 7 | **同意1枚目のプリセット名**（`Minimal` 以外に何が並ぶか） | スクリーンショットなし。`Minimal` と「他数個」があることだけ本人確認済み |

---

## 13. 記録の出どころについて（正直に）

- **実験E の拒否コールバックは、ローカルのリスナーが受けたものではない。**
  検証スクリプトをツール呼び出しの子プロセスとして起動したため、Cancel の瞬間に
  リスナーが落ちていた。人間がブラウザのアドレスバーからコピーした値を使っている。
  `state` が生成値と一致することは照合済み。また対照クライアント側では
  **リスナーが実際に受けた**同形の拒否がある。
- **同意画面の内容はすべて人間の観測**（スクリーンショット4枚）。
  記事に画像は使わない方針なので、文章と疑似コードで再現する。
- **当初「同意画面に `Minimal` は無い」と書いたが、誤りだった。**
  受け取ったスクリーンショットが2枚目（権限の内訳）だけで、1枚目のプリセット選択画面を
  見ていなかった。**資料に写っていないことを「存在しない」の根拠にした。**
  1枚目に並ぶ `Minimal` 以外のプリセット名は未確認（§12 の積み残しに追加）。
- **`browser:write` が付与された。** 「読み取り専用で完結する」と説明していたが、
  別サーバーの既定スコープに write が含まれていた。要求はしておらず、使ってもいない
  （投げたのは `tools/list` のみ。生ログで確認できる）。

---

## 14. 再現手順

```sh
cd sandbox
npm install

./run probe          # 実験0：認可なしで取れるもの＋対照＋DCR
./run tokenshape     # 実験0-6：トークンの形の境界（二分探索）
./run connect        # 実験A：最小Scopeで接続（★ブラウザ）
./run check before   # 正常系の確認
./run schema         # tools/list の inputSchema を出す
./run stepup         # 実験B：403 を踏む
./run hunt           # 実験B：チャレンジを返すエンドポイントを探す
./run reauth --scope "d1.read" --label D1-no-union      # ★ブラウザ
./run freshclient    # 対照：過去の付与ゼロのクライアント（★ブラウザ・Cancel）
./run reauth --scope "workers-r2.read" --label D1b      # ★ブラウザ
./run scopecheck     # 行動で能力を確かめる
./run refreshtest2   # refresh で Scope を広げられるか
./run denytest       # 実験E（★ブラウザ・Cancel）
./run revoketest     # 実験C1'（★不可逆）
./run crossresource  # 追試C1''（★ブラウザ）
```

生ログは `sandbox/data/evidence-*.jsonl`（指紋化あり）と `*.raw.jsonl`（手元限定）。
`data/` は `.gitignore` 済み。

### 後片付け

My Profile → Access Management → Connected Applications から3つ剥がす。

- `mcp-stepup-sandbox (verification)`
- `mcp-stepup-sandbox CONTROL (no prior grant)`（トークン未取得）
- `mcp-stepup-sandbox CROSS-RESOURCE`（`browser:write` を含む）
