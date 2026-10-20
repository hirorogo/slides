# references — MCPのStep-up Authorization vs OAuthのIncremental Authorization

| | |
| --- | --- |
| 調査日 | 2026-10-20 |
| 対象 | MCP仕様 2026-07-28 / 2025-11-25、Cloudflare API MCP Server、`@modelcontextprotocol/*` SDK |
| 用途 | PRD.md の裏取り → slide.md / article.md |
| 未実施 | OAuth実接続（`Minimal` 選択、403観測、再認可）。下の「未確認」参照 |
| 再検証 | 2026-10-20 主張11（クライアント対応状況）を Claude Code 2.1.304 で取り直し、❌→✅ に訂正 |

> PRD.md のリンクは `utm_source=chatgpt.com` 付き＝ChatGPT経由の収集。
> **全URLを実際に叩いて実在を確認済み。** 捏造リンクは無かった。
>
> ⚠️ **2026-10-20 追記：実機検証（`sandbox/`）を実施した。判定が変わった行がある。**
> 最新の判定は `claims.md` を見ること。このファイルは「資料に何が書いてあるか」の記録。

---

## 確認した主張

| # | 主張 | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | Cloudflareが2026-10-19にStep-up Authorization対応を発表 | ✅ 確認 | 公式Changelog（本文取得済み） |
| 2 | MCP仕様が `403 insufficient_scope` + Scope Challengeを定義 | ✅ 確認 | 2026-07-28 仕様本文 |
| 3 | 再認可時のScope和集合は**クライアント**の責務 | ✅ 確認 | 2026-07-28 仕様 / SEP-2350 |
| 4 | **Step-upは2026-07-28の新機能** | ❌ **前提が違う** | 2025-11-25 仕様に既出。変わったのは「誰が和集合を作るか」 |
| 5 | Google Incremental Authorization = `include_granted_scopes=true` | ✅ 確認 | Google公式 |
| 6 | 既存Scope維持の主体：Google=**認可サーバー** / MCP=**クライアント** | ✅ 確認 | 両仕様の記述を直接比較 |
| 7 | RFC 9470はStep-up **Authentication**（別物） | ✅ 確認 | RFC 9470本文 + WorkOS記事 |
| 8 | Cloudflareの初期Scopeは最小（2個）、AS全体は384個 | ✅ **自分で計測** | PRM / AS metadata を実測 |
| 9 | Cloudflareの401チャレンジは `scope="user:read account:read"` | ✅ **自分で計測** | 実リクエスト |
| 10 | TypeScript SDK 1.x は403でScopeを**上書き**、2.x は**和集合** | ✅ **自分で計測** | 公開tarballのコードを確認 |
| 11 | 手元のMCP Clientが和集合を計算している（Claude Code 2.1.304） | ✅ **自分で計測** | インストール済みバイナリのコードを確認 |
| 12 | Cloudflare API MCP Serverは `search()` / `execute()` / `docs()` | ⚠️ **実機は4本** | 実測。`whoami` が増えている（公式docs未記載） |
| 13 | 「`Minimal` を選ぶと最小Scopeで接続」 | ✅ 確認 | 実機（2026-10-20）。同意は2画面で、1枚目が `Minimal` を含むプリセット選択 |

---

## 1. Cloudflareの発表（2026-10-19）

**判定: 確認。** 本文全文が取れる。`developers.cloudflare.com` は **URL末尾に `/index.md` を付けるとMarkdownが返る。**

```sh
curl -sL "https://developers.cloudflare.com/changelog/post/2026-10-19-cloudflare-mcp-step-up/index.md"
```

- [Cloudflare API MCP server now supports step-up authorization](https://developers.cloudflare.com/changelog/post/2026-10-19-cloudflare-mcp-step-up/) — 一次
  > Grant only the required scopes when you connect, then authorize more on demand as your agent performs a task. When a tool call needs a scope you have not granted, the server returns an `insufficient_scope` challenge naming it, and your MCP client asks you to approve it. **Scopes you already granted are kept.**
  > To start with the least access, choose **Minimal** on the consent page when you connect `https://mcp.cloudflare.com/mcp`.
  > **Available now in all MCP clients that support step-up authorization.**

注目すべきは最後の一文。**Server側ができても、Client側が対応していないと体験としては成立しない。**（→ 主張11）

### 前日譚が2つある（記事の「なぜ今か」はここ）

| 日付 | 出来事 | ソース |
| --- | --- | --- |
| 2026-08-22 | Wrangler / API MCP Serverが **optional scopes** 対応。同意画面に「Edit Permissions」 | [Changelog](https://developers.cloudflare.com/changelog/post/2026-08-22-wrangler-mcp-optional-oauth-scopes/) |
| 2026-10-01 | `workers-oauth-provider` が **v1**。MCP 2026-07-28対応 + `insufficientScope()` | [Changelog](https://developers.cloudflare.com/changelog/post/2026-10-01-workers-oauth-provider-1x/) |
| 2026-10-19 | API MCP Server が Step-up 対応 | [Changelog](https://developers.cloudflare.com/changelog/post/2026-10-19-cloudflare-mcp-step-up/) |

2026-08-22のChangelogの締めが効いている：

> If a command or tool call needs a scope that you declined, **reauthorize the client** and grant that scope.

つまり8月時点では「断ったら手で繋ぎ直せ」だった。10月の発表は**その手作業を消した**という話。

### 記事に使える切り口

- 「最小権限で繋げる」（8月）と「足りなくなったら自動で足せる」（10月）は別の機能。
  前者だけだと**最小で繋ぐほど不便**になる。10月の対応で初めて最小権限が実用になる。

---

## 2. MCP仕様（2026-07-28）— 何が書いてあるか

**判定: 確認。** 仕様はディレクトリに分割されている。

```sh
curl -sL "https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/docs/specification/2026-07-28/basic/authorization/index.mdx"
```

[Authorization — MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) より（引用はすべて原文）：

**403のScope Challenge**（`#scope-challenge-handling`）

> - `HTTP 403 Forbidden` status code (per RFC 6750 Section 3.1)
> - `error="insufficient_scope"` / `scope="required_scope1 required_scope2"` / `resource_metadata` / `error_description` (optional)

> The `scope` attribute describes the scopes necessary to access the requested resource — **servers are not required to include the client's previously granted scopes.**

> Challenging incrementally (returning one missing scope, then another on the subsequent retry) forces multiple authorization round-trips for a single operation and degrades user experience.

**Step-Up Authorization Flow**（`#step-up-authorization-flow`）

> 2. **Determine required scopes** by computing **the union of the client's previously requested scope set and the scopes from the current challenge.**

> 4. **Retry the original request** with the new authorization no more than a few times

> Servers **MUST** account for scope hierarchies, where a broader scope implies narrower ones.

**Scope Selection Strategy**（初回401の話。403とは別物）

> The `scopes_supported` field is intended to represent **the minimal set of scopes necessary for basic functionality**, with additional scopes requested incrementally through the step-up authorization flow.

仕様が例示するレスポンス（PRD.mdのものと一致。ただし `error_description` が付く）：

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope",
                         scope="files:write",
                         resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource",
                         error_description="File write permission required for this operation"
```

### 記事に使える切り口

- MCPが参照しているのは **RFC 6750 §3.1**。つまりStep-upの土台は2012年のOAuthの仕組みそのもの。
  **MCPが新しく発明したのは「エラーコード」ではなく「誰がどう再認可に繋ぐかの手順」。** これが記事の結論に直結する。

---

## 3. ❌ 「Step-upは2026-07-28の新機能」は違う

**判定: 前提が違う。ここが一番の収穫。**

```sh
# 2025-11-25 にも Step-Up Authorization Flow の節がある
curl -sL ".../docs/specification/2025-11-25/basic/authorization.mdx" | grep -n "Step-Up"
# → 541:#### Step-Up Authorization Flow
# 2025-06-18 / 2025-03-26 には無い（grepヒット0）
```

| 仕様 | `insufficient_scope` | 既存Scopeの和集合を作るのは |
| --- | --- | --- |
| 2025-03-26 / 2025-06-18 | 記述なし | — |
| **2025-11-25** | あり | **サーバー**（"Recommended approach: Include both existing relevant scopes and newly required scopes"） |
| **2026-07-28** | あり | **クライアント**（"computing the union of the client's previously requested scope set and the scopes from the current challenge"） |

2025-11-25の原文：

> - **Minimum approach**: Include the newly-required scopes for the specific operation. Include any existing granted scopes as well, if they are required…
> - **Recommended approach**: Include both existing relevant scopes and newly required scopes to prevent clients from losing previously granted permissions
> - **Extended approach**: Include existing scopes, newly required scopes, and related scopes that commonly work together

この3択が2026-07-28で**丸ごと消えて**、クライアント側の和集合に置き換わった。

### 変更の設計意図はIssue本文にある（一次ソース）

- [Issue #2349](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/2349) — 問題提起
  > placing scope accumulation responsibility on the server rather than the client. This **contradicts the RFC**, creates an **impossible requirement for stateless servers**, and leads to **infinite re-authorization loops** in practice.

  挙げられている理由は3つ：
  1. RFC 6750 §3.1は「そのリソースに必要なScope」を指す。既存Scopeの合併は意味が違う
  2. 既存Scopeを入れるには、サーバーがクライアントのトークン内容を知る必要がある（opaqueなら不可能）
  3. **抽象のレイヤが違う。** サーバーは「この操作に何が要るか」を知り、クライアントは「自分が何を貯めてきたか」を知る

- [SEP-2350（PR）](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2350) — **merged 2026-03-28**
- [実装トラッキング #2878](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/2878) — TS / C# / Go / Java / PHP / Python / Ruby / Rust は完了、**Kotlin / Swift は未チェック**（2026-10-20時点）

### 記事に使える切り口

- **「Cloudflareが新機能に対応した」ではなく「2025-11-25から仕様にあったものが、やっと実装側に降りてきた」。**
  記事の切り口をここに置くと、Changelog紹介記事との差がはっきり出る。
- 無限ループの実例（#1582、下の主張10）は、「なぜ和集合が要るのか」を説明する最短の材料。

---

## 4. OAuth Incremental Authorization（Google）

**判定: 確認。** [Google: Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server) より：

> It is considered a best user-experience practice to request authorization for resources at the time you need them.

> `include_granted_scopes` … If you set this parameter's value to `true` and the authorization request is granted, then **the new access token will also cover any scopes to which the user previously granted the application access.**

> The combined authorization includes all scopes the user granted to the API project **even if the grants were requested from different clients.**

> Revoking a token for a combined authorization revokes access to **all** of its scopes for that user at once.

> A warning or error page may appear if your app isn't approved to request all scopes that could be returned.

ポイントは**合成しているのが認可サーバー（Google）側**であること。
クライアントは「新しいScope + フラグ1個」を送るだけで、過去の付与状況を知らなくていい。

### MCPとの対応関係（記事の核。表にする価値あり）

| | Google Incremental Authorization | MCP Step-up Authorization |
| --- | --- | --- |
| 追加が必要と**気づく**のは | アプリ（機能を呼ぶ前に自分で判断） | **サーバー**（操作時に `403 insufficient_scope`） |
| 不足Scopeを**伝える**のは | （伝達不要。アプリが知っている） | `WWW-Authenticate: scope="…"` |
| 既存Scopeを**維持する**のは | **認可サーバー**（`include_granted_scopes=true`） | **クライアント**（和集合を自分で計算） |
| 再認可の仕組み | OAuth認可コードフロー | **同じ**（OAuth認可コードフロー） |

→ **プロトコルの再認可部分は同一。違うのは「誰がトリガを引き、誰が記憶しているか」。**
PRD.md の仮説（置き換えではなく、検出してOAuthの再認可へ繋ぐ仕組み）は、仕様上これで裏が取れている。

---

## 5. RFC 9470は別物（PRD 3.2の裏取り）

**判定: 確認。**

```sh
curl -sL https://www.rfc-editor.org/rfc/rfc6750.txt
curl -sL https://www.rfc-editor.org/rfc/rfc9470.txt
```

| | RFC 6750 §3.1 (2012) | RFC 9470 (2023-09) |
| --- | --- | --- |
| エラーコード | `insufficient_scope` | `insufficient_user_authentication` |
| ステータス | 403推奨 | 401 |
| 追加パラメータ | `scope` | `acr_values` / `max_age` |
| 聞いていること | **権限が足りない** | **認証の強度・新しさが足りない** |

RFC 6750 §3.1 原文：

> **insufficient_scope** — The request requires higher privileges than provided by the access token. The resource server SHOULD respond with the HTTP 403 (Forbidden) status code and MAY include the "scope" attribute with the scope necessary to access the protected resource.

RFC 9470 §3 原文：

> **insufficient_user_authentication** — The authentication event associated with the access token presented with the request does not meet the authentication requirements of the protected resource.

なお RFC 9470 自身が両者の併用に触れている：

> If the resource server determines that the request is **also** lacking the scopes required by the requested resource, it MAY include the scope attribute … as described in Section 3.1 of [RFC6750].

二次ソースだが整理が良い：
- [MCP: Scope step-up is not authentication step-up — WorkOS, 2026-09-01](https://workos.com/blog/mcp-scope-step-up-vs-authentication-step-up)
  - MCPの認可仕様に `acr_values` / `max_age` / `auth_time` は**一語も出てこない**
  - 例示が強い：3時間前に `admin:write` を取ったトークンで `delete_production_database` を呼ぶ。トークンは有効なので**誰も人間の存在を確認しない**
  - 「Scopeの付与は持続的、人間の存在証明は腐る」

### 記事に使える切り口

- PRDの注意書きを1段深くできる。「同義ではない」で止めず、**MCPの穴（認証の新しさを表現する手段がない）** まで書くと、比較記事が設計論になる。

---

## 計測（自分で取った一次ソース）

### A. Cloudflare API MCP Serverの401チャレンジ

```sh
curl -s -i -X POST https://mcp.cloudflare.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"refcheck","version":"0.0.1"}}}'
```

```http
HTTP/2 401
www-authenticate: Bearer realm="OAuth",
  resource_metadata="https://mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp",
  scope="user:read account:read"
cache-control: no-store
```

壊れたトークンを付けた場合（403ではなく**401 + `invalid_token`**。PRDの「403と401を混同しない」はここで実演できる）：

```sh
curl -s -i -X POST https://mcp.cloudflare.com/mcp -H 'Authorization: Bearer not-a-real-token' ...
```

```http
HTTP/2 401
www-authenticate: Bearer realm="OAuth", resource_metadata="…", error="invalid_token", scope="user:read account:read"

{"error":"invalid_token","error_description":"Access token appears malformed; reauthenticate and try again"}
```

### B. Scopeの個数 — 2 vs 384

```sh
curl -s "https://mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp" | python3 -m json.tool
curl -s "https://mcp.cloudflare.com/.well-known/oauth-authorization-server" | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print(len(d['scopes_supported']))"
```

| メタデータ | RFC | `scopes_supported` | 中身 |
| --- | --- | ---: | --- |
| Protected Resource Metadata (`/mcp`) | RFC 9728 | **2** | `user:read`, `account:read` |
| Authorization Server Metadata | RFC 8414 | **384** | `offline_access`, `dns.write`, `workers-scripts.write`, `zone.write` … |

PRM全文：

```json
{
  "resource": "https://mcp.cloudflare.com/mcp",
  "authorization_servers": ["https://mcp.cloudflare.com"],
  "scopes_supported": ["user:read", "account:read"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Cloudflare API MCP Server"
}
```

AS metadataの確認できた属性（2026-07-28対応の裏取りになる）：

| フィールド | 値 |
| --- | --- |
| `client_id_metadata_document_supported` | `true`（CIMD対応） |
| `authorization_response_iss_parameter_supported` | `true`（issuer識別） |
| `grant_types_supported` | `authorization_code`, `refresh_token` |
| `code_challenge_methods_supported` | `S256` |
| `registration_endpoint` | あり（DCRも継続サポート） |

→ Workers OAuth Provider v1のChangelogが言っていること（CIMD、issuer識別、DCR互換）と**一致する**。

**`offline_access` はAS側の384個には入っているが、PRMの2個には入っていない。**
これは仕様の次の要求を満たしている：

> MCP Servers (Protected Resources) **SHOULD NOT** include `offline_access` in `WWW-Authenticate` scope or Protected Resource Metadata `scopes_supported`, as refresh tokens are not a resource requirement.

### 記事に使える切り口（この数字が記事の山場になる）

- **2 : 384。** Step-up以前は「384個のカタログからどれを最初に渡すか」の二択しかなかった。
  `scopes_supported` を最小2個にできるのは、**足りなくなったら足せる前提がある時だけ。**
- 「最小権限で始める」が絵空事でないことを、数字1組で示せる。

### C. サーバー側が返すチャレンジの実装（Cloudflare公式ライブラリ）

観測した401ヘッダの形（`Bearer realm="OAuth", resource_metadata=…, scope=…`）は、
[`cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) の実装と一致する。

```sh
curl -sL https://raw.githubusercontent.com/cloudflare/workers-oauth-provider/main/src/oauth-resource-server.ts
```

```ts
export function insufficientScope(auth: OAuthResourceAuth, scope: string[], description?: string): Response {
  let challenge = `Bearer realm="OAuth", error="insufficient_scope", scope="${[...new Set(scope)].join(' ')}"`;
  challenge += `, resource_metadata="${getResourceMetadataUrl(auth.audience)}"`;
  // …
  return new Response(JSON.stringify({ error: 'insufficient_scope', … }), {
    status: 403,
    headers: { …NO_CACHE_HEADERS, 'Content-Type': 'application/json', 'WWW-Authenticate': challenge },
  });
}
```

ヘッダだけでなく**JSONボディにも `{"error":"insufficient_scope"}` を入れている**（仕様はボディを要求していない）。

[`docs/authorization-server.md`](https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/authorization-server.md) の整理が秀逸で、**上の「2 vs 384」をそのまま言語化している**：

> | AS metadata `scopes_supported` | RFC 8414 | everything this authorization server can grant |
> | PRM `scopes_supported` | RFC 9728 | the scopes any access needs, so clients request them first |
> | `WWW-Authenticate: Bearer … scope="…"` | RFC 6750 | what's needed right now |

> Copying the catalogue into the resource would make every client request everything on first sign-in.

> `requiredScopes` is **advertised, not enforced**: the handler decides whether a token is sufficient, because only it knows which scopes imply others.

ただし**仕様とライブラリで推奨が微妙にズレている**（記事に書ける対立点）：

| | 403の `scope` に何を入れるか |
| --- | --- |
| MCP 2026-07-28仕様 | 「その操作に必要なものだけでよい。既存Scopeを含める義務はない」 |
| workers-oauth-provider docs | 「**baseline込みで**全部入れる」 — `insufficientScope(ctx.auth, ['mcp:read', 'mcp:write'])` |

どちらも仕様違反ではない（仕様はSHOULDで、集合関係を仮定するなと書いている）。
**Cloudflareの実機が実際にどちらを返すかは未観測** → 実験Bの観測ポイント。

### D. TypeScript SDK：1.x は上書き、2.x は和集合

```sh
curl -s https://registry.npmjs.org/@modelcontextprotocol%2Fsdk    | python3 -c "import json,sys;print(json.load(sys.stdin)['dist-tags'])"
curl -s https://registry.npmjs.org/@modelcontextprotocol%2Fclient | python3 -c "import json,sys;print(json.load(sys.stdin)['dist-tags'])"
# tarballを展開して403ハンドラを読む
```

| パッケージ | 最新 | 公開日 | 403で `_scope` を | `LATEST_PROTOCOL_VERSION` |
| --- | --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | 1.32.1 | 2026-10-05 | **上書き** | `2025-11-25` |
| `@modelcontextprotocol/client` | 2.3.1 | 2026-10-05 | **和集合** | `2025-11-25` |

`@modelcontextprotocol/sdk@1.32.1`（`dist/cjs/client/streamableHttp.js`）:

```js
if (response.status === 403 && this._authProvider) {
    const { resourceMetadataUrl, scope, error } = extractWWWAuthenticateParams(response);
    if (error === 'insufficient_scope') {
        const wwwAuthHeader = response.headers.get('WWW-Authenticate');
        if (this._lastUpscopingHeader === wwwAuthHeader) {
            throw new StreamableHTTPError(403, 'Server returned 403 after trying upscoping');
        }
        if (scope) {
            this._scope = scope;   // ← 上書き。前のScopeは消える
        }
```

`@modelcontextprotocol/client@2.3.1`（`dist/index.mjs`）:

```js
function computeScopeUnion(...scopes) {
	const seen = new Set();
	for (const scope of scopes) {
		if (!scope) continue;
		for (const token of scope.split(/\s+/)) if (token) seen.add(token);
	}
	return seen.size > 0 ? [...seen].join(" ") : void 0;
}
```

```ts
// packages/client/src/client/streamableHttp.ts（main）
const unionScope = computeScopeUnion(this._scope, tokens?.scope, challenge.scope);
this._scope = unionScope;
// refresh では scope を広げられない（RFC 6749 §6）ので、超集合なら再認可を強制する
const forceReauthorization = isStrictScopeSuperset(unionScope, tokens?.scope);
```

**`refresh` ではScopeを広げられない（RFC 6749 §6）** という指摘は、記事に効く技術的な詰め。
「追加認可＝必ずブラウザに戻る」理由がこれ。

1.x の挙動は**壊れているというより古い仕様（2025-11-25＝サーバーが和集合を作る前提）に忠実**。
サーバーが操作単位のScopeだけを返すと破綻する、というのがこのIssue：

- [typescript-sdk#1582](https://github.com/modelcontextprotocol/typescript-sdk/issues/1582) — **open**（2026-10-20時点）
  > 5. The 403 handler sets `_scope = "mcp:tools:read"`, re-authorizes … but `init` was not requested
  > 6. The next operation requiring `init` fails with 403, overwriting `_scope = "init"`, losing `mcp:tools:read`
  > 7. **Infinite loop between steps 5 and 6**
- [typescript-sdk#1618](https://github.com/modelcontextprotocol/typescript-sdk/pull/1618) — **未マージ**（`merged=false`）。別経路（SEP-2350実装 #2200）で2.xに入った

### 記事に使える切り口

- **和集合は「お作法」ではなくループ対策。** 貼るならこの7ステップ。1つのバグ報告で必要性が全部説明できる。
- 1.x と 2.x でパッケージ名が変わっている（`sdk` → `client` + `core`）。
  **「SDKを上げたのに直らない」が起こりうる。**

### E. 手元のMCP Client（Claude Code 2.1.304）がやっていること

> 初回調査時は 2.1.205 で「Step-up未対応」と判定したが、**これは誤りだった。**
> `claude update` 後の 2.1.304 でバイナリを読み直した結果、以下に訂正する。
> Step-up対応自体は **2.1.49** から入っており、2.1.205 にも（弱いUXながら）存在していた。

```sh
claude --version   # → 2.1.304 (Claude Code)
```

#### Step-up周りのCHANGELOG（全部拾い直した）

| バージョン | 内容 |
| --- | --- |
| **2.1.49** | Improved MCP OAuth authentication **with step-up auth support** and discovery caching |
| **2.1.85** | Fixed MCP step-up authorization **failing when a refresh token exists** — servers requesting elevated scopes via `403 insufficient_scope` now correctly trigger the re-authorization flow |
| **2.1.118** | Fixed MCP step-up authorization **silently refreshing instead of prompting** for re-consent when the server's `insufficient_scope` 403 names a scope the current token already has |
| 2.1.274 | Fixed 403 `insufficient_scope` **being reported as an expired sign-in**: the error now names the missing permissions |
| **2.1.288** | **Added a re-authenticate prompt** when an MCP server asks for more OAuth scope during a tool call |
| 2.1.281 | Added MCP **URL-mode elicitation** on 2026-07-28 connections |
| 2.1.292 / 295 / 299 | stdio / claude.ai connector / cloud connector が **2026-07-28をデフォルトでネゴシエート**（`MCP_PROTOCOL_NEGOTIATION=legacy` で退避） |
| 2.1.302 | Fixed MCP servers showing no tools when the server **negotiates 2026-07-28** but omits `resultType` / `ttlMs` / `cacheScope` |

2.1.85 の修正内容（リフレッシュトークンがあるとStep-upが動かない）は、
**RFC 6749 §6「refreshでスコープは広げられない」** を踏み外した典型例。記事に使える。

#### バイナリを読んで確認したこと（＝一番強い裏取り）

```sh
strings -a /opt/homebrew/Caskroom/claude-code/2.1.304/claude > cc-strings.txt
grep -o "async _stepUpAuthorize(e,t){.\{0,900\}" cc-strings.txt
```

minify済みだが、クラスのフィールド名とログ文字列は残っている。

```js
async _stepUpAuthorize(e, t) {
  if (this._onInsufficientScope === "throw") throw new Yi({ requiredScope: e.scope, … });
  if (t >= this._maxStepUpRetries)
    throw new Fk(…, `Server returned 403 insufficient_scope after step-up re-authorization (retry limit ${this._maxStepUpRetries} reached)`, { status: 403 });
  if (e.resourceMetadataUrl) this._resourceMetadataUrl = e.resourceMetadataUrl;
  let r = await this._oauthProvider.tokens();
  let s = _n(this._scope, r?.scope, e.scope);   // ← computeScopeUnion(前回要求, 現トークン, チャレンジ)
  this._scope = s;
  let a = Pd(s, r?.scope);                      // ← isStrictScopeSuperset(union, 現トークン)
  return axt(this._oauthProvider, { …, scope: s, forceReauthorization: a, … });
}
```

**`_n(this._scope, r?.scope, e.scope)` / `Pd(s, r?.scope)` は、
`@modelcontextprotocol/client@2.3.1` の `computeScopeUnion` / `isStrictScopeSuperset` と引数まで一致する**（主張10のソースと比較）。
→ **Claude Code 2.1.304 は SEP-2350 の和集合実装を積んでいる。** 主張3が手元の実機で確認できたことになる。

403ハンドラ本体（`WWW-Authenticate` のパース → pending登録）：

```js
if (h.status === 403) {
  let { error: l, scope: s } = $Fe(h);
  if (l === "insufficient_scope" && s) t.markStepUpPending(s);
} else if (h.status === 401) {
  t.clearStepUpPending();
}
```

さらに、**Step-up保留中はrefresh_tokenを意図的に伏せる**：

```js
let h = this._pendingStepUpScope, l = h !== void 0;
if (l) se(this.serverName, `Step-up pending (${FC("scope", h)}), omitting refresh_token`);
```

→ refreshで済まされるとScopeが広がらないので、**ブラウザでの再認可を強制している。**
2.1.118 の「silently refreshing instead of prompting」修正はこれ。

その他の確認できた挙動：

| 事実 | 意味 |
| --- | --- |
| `_onInsufficientScope` の既定値は `"reauthorize"`（`"throw"` も選べる） | SDKレベルで自動再認可がデフォルト |
| `_maxStepUpRetries` でリトライ上限、超えたら403を投げる | 無限ループ対策が**クライアント側にも**ある |
| `redirectToAuthorization` は、Step-up保留中は設定由来のscope上書きを**しない** | 和集合をトランスポート層が決め、上書きで壊さない設計 |
| ログ文字列 `Marked step-up pending: scope=…` / `Step-up pending (…), omitting refresh_token` | **実験時はこのログを拾えばよい**（`--debug` 等） |

### 記事に使える切り口

- 「仕様にこう書いてある」で終わらせず、**自分が今使っているクライアントのバイナリに `computeScopeUnion` 相当が入っていることを示せる。**
  仕様 → SDK → 実際に手元で動くバイナリ、まで線が繋がる。
- `omitting refresh_token` の一行は、**「なぜ追加認可は必ずブラウザに戻るのか」の答えそのもの。**

---

## 未確認・積み残し（＝実験フェーズでやること）

- [ ] **`Minimal` の同意画面。** Changelogに記述あり、画面未確認。PRD実験A
- [ ] **403 `insufficient_scope` の実レスポンス。** Cloudflareが `scope` に
      「不足分だけ」を入れるか「baseline込み」を入れるか（上の C の対立点）。PRD実験B
- [ ] **既存Scopeの維持は誰がやっているか。** Changelogは "Scopes you already granted are kept" と書く＝
      **Cloudflare側（AS）も保持している**可能性。仕様はクライアントの和集合を要求。**両方効いているのか、片方だけかは実測が要る。**
      → これが取れると、記事の中心的な問い（Google=AS側 / MCP=Client側）に対する**実装のねじれ**として最高の材料になる。PRD実験D
- [ ] **どのCloudflare APIがどのScopeを要求するか。** `search()` で調べて `execute()` を叩くまで不明。
      読み取り専用に限定して実施。PRD実験4.3
- [ ] **Cloudflareが `2026-07-28` をネゴシエートするか。** トークン無しでは `initialize` まで到達できず未確認
      （クライアント側は 2.1.292以降 2026-07-28 を既定でネゴシエートするので、条件は揃っている）

## 探したが取れなかったもの

- ~~**Cloudflare API MCP ServerのScope一覧（ツール別・エンドポイント別）** — 公開ドキュメント上に無い。~~
  **❌ 訂正（2026-10-20 実機検証で判明）。** `search()` が返す OpenAPI spec の各 operation に
  **`x-api-token-group`** が入っている。説明文いわく
  > "API token permissions the endpoint accepts (any one); **OAuth scopes have the same names**"

  例: `GET /zones` → `["Zone Zone Read"]`。つまり対応表はMCPサーバー自身から引ける。
- **`Minimal` オプションの公式ドキュメント上の説明** — Changelog本文以外に見当たらない。
  [Edit optional permissions](https://developers.cloudflare.com/fundamentals/oauth/authorizing-an-application/#edit-optional-permissions) は8月のoptional scopes側の説明。
- [`agents/model-context-protocol/protocol/authorization/`](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/) は
  **Last updated Jul 27, 2026** で、参照先が MCP **2025-06-18** のまま。Step-upの記述なし。
  Changelogがこのページにリンクしているが、中身は追随していない。**公式docsの中でも新旧が混在している。**

---

## ソース一覧

### 一次（仕様・RFC）
- [MCP 2026-07-28 — Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) / [raw](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/index.mdx)
- [MCP 2025-11-25 — Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)（比較用）
- [SEP-2350 PR #2350](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2350) / [Issue #2349](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/2349) / [実装追跡 #2878](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/2878)
- [RFC 6750 §3.1](https://www.rfc-editor.org/rfc/rfc6750#section-3.1) / [RFC 9470](https://www.rfc-editor.org/rfc/rfc9470) / [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) / [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)

### 一次（Cloudflare）
- [Changelog 2026-10-19 — step-up authorization](https://developers.cloudflare.com/changelog/post/2026-10-19-cloudflare-mcp-step-up/)
- [Changelog 2026-10-01 — Workers OAuth Provider v1](https://developers.cloudflare.com/changelog/post/2026-10-01-workers-oauth-provider-1x/)
- [Changelog 2026-08-22 — optional OAuth scopes](https://developers.cloudflare.com/changelog/post/2026-08-22-wrangler-mcp-optional-oauth-scopes/)
- [Cloudflare MCP servers 一覧](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/)
- [cloudflare/workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider)（README / `docs/authorization-server.md` / `src/oauth-resource-server.ts`）

### 一次（Google / 実装）
- [Google — Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [typescript-sdk#1582](https://github.com/modelcontextprotocol/typescript-sdk/issues/1582) / [#1618](https://github.com/modelcontextprotocol/typescript-sdk/pull/1618)
- [claude-code#44652](https://github.com/anthropics/claude-code/issues/44652) / [CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)

### 二次（出どころ明記で使う）
- [WorkOS — MCP: Scope step-up is not authentication step-up](https://workos.com/blog/mcp-scope-step-up-vs-authentication-step-up)（2026-09-01）
- [InfoQ — Cloudflare Adds Optional OAuth Scopes](https://www.infoq.com/news/2026/09/cloudflare-optional-oauth-scopes/)

### 調査環境
- 2026-10-20 / macOS (Darwin 25.5.0, arm64) / Claude Code **2.1.304**（初回調査時は 2.1.205。主張11は更新後に再検証し、判定を訂正した）
