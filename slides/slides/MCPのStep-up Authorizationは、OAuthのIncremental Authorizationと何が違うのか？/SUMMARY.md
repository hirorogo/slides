# 検証サマリ — MCPのStep-up Authorization は仕様どおりに動くか

| | |
| --- | --- |
| 検証日 | 2026-10-20 |
| 対象 | Cloudflare API MCP Server（`https://mcp.cloudflare.com/mcp`） |
| 記録 | HTTP往復 **128件**（`sandbox/data/*.jsonl`、秘密はSHA-256指紋） |
| 状態 | 実機検証・判定とも**完了**。開示は不要と判断。次は執筆 |
| 詳細 | [DETAILS.md](./DETAILS.md) / 判定表 [claims.md](./claims.md) / ソース [references.md](./references.md) |

---

## 最初の問いと、その答え

> **MCPのStep-up Authorization は、OAuthのIncremental Authorization と何が違うのか？**

違いは **3つだけ**で、それ以外は同じ OAuth です。

| | Google Incremental Authorization | MCP Step-up Authorization |
| --- | --- | --- |
| 追加が必要と**気づく**のは | アプリ（呼ぶ前に自分で判断） | **サーバー**（`403 insufficient_scope`） |
| 不足Scopeを**伝える**のは | 伝達不要（アプリが知っている） | `WWW-Authenticate: scope="…"` |
| 既存Scopeを**覚えている**のは | **認可サーバー**（`include_granted_scopes=true`） | **クライアント**（和集合を自分で計算） |
| 再認可の仕組み | OAuth認可コードフロー | **同じ** |

3行目は仕様を読んだだけでは決まりませんでした。**実機で測って確定させたのが今回の中心**です。

> Cloudflare の認可サーバーは、**baseline 以外の既付与Scopeを引き継がない。**
> `d1.read` を持った状態で `workers-r2.read` だけを要求して再認可したら、
> `d1.read` は scope 文字列からも消え、**D1 の操作も 403 に戻った**。
>
> Changelog の "Scopes you already granted are kept" が成立するのは
> **クライアントが和集合を作っているから**であって、認可サーバーが覚えているからではない。
> Google とは構造が逆。

---

## 大きい発見 3つ

### 1. サーバーが和集合を作っていた（仕様が捨てた方のやり方）

403 の `scope` は **「トークンの付与Scope全部 ∪ その操作に必要なScope」** でした。
トークンの中身を変えると、チャレンジの中身も追随します（3状態で観測）。

```
持っている: baseline のみ
  → scope="user:read account:read workers-r2.read"

持っている: baseline + workers-r2.read
  → scope="user:read account:read workers-r2.read d1.read"
```

これは **2025-11-25 仕様の "Recommended approach"**、つまり **2026-07-28 が削除した方**です。
Issue #2349 が「ステートレスなサーバーには実装不可能」と言った当のやり方を、
AS と リソースサーバーが状態を共有する Cloudflare はやれてしまう。

**副作用が大きい。** `@modelcontextprotocol/sdk@1.32.1` のような「403のscopeで上書きする」
古いクライアントでも、**Cloudflare相手なら無限ループに落ちません**。サーバーが肩代わりしています。

### 2. 権限不足が、静かに「0件」になる操作がある

同じMCPサーバーの中に、**3通りの失敗の仕方**が同居していました。

| 操作 | 権限が無いとどうなるか | step-up は起動するか |
| --- | --- | --- |
| R2 / KV / D1 / Queues / Images | **403 + `WWW-Authenticate`** | **する** |
| `/zones`, `/workers/scripts` | **200 + 空配列** | **しない** |
| `/user/tokens` | ツール結果の文字列で 403 | **しない**（対応Scopeがカタログに無い） |

2行目を Scope 付与の前後で比べると:

```
ゾーン一覧            0件  →  3件
Workers スクリプト一覧  0件  → 12件
```

**アカウントには実在していました。** 権限が無いあいだ、AIは「ゾーンはありません」と報告します。
ユーザーに権限を聞きにいく機会そのものが発生しない。**静かな失敗**です。

### 3. refresh は `scope` を完全に無視する

広げるのも狭めるのも無視されます。広げられないのは RFC 6749 §6 どおりですが、
**狭める方は Cloudflare 自身のライブラリdocs と食い違います**
（"Token and refresh requests can only narrow the grant"）。

ライブラリ側のソースは `downscope()` で正しく交差を取っています。
つまり食い違っているのは hosted サーバーの方。
**同じ名前でも OSS 版と hosted 版を同一視しない**、という教訓になりました。

おまけに、refresh は直列化されていて重なると `429 temporarily_unavailable`、
`refresh_token` は毎回**回転**します。

---

## 細かいが効くもの

| | 観測 |
| --- | --- |
| **2 : 384** | リソースの `scopes_supported` は2個、認可サーバーのカタログは384個 |
| **同意は2画面** | `Minimal` を含むプリセット選択 → 権限の内訳（REQUIRED / ADDITIONAL ACCESS）。サーバーごとに構成が違う |
| **要求 ≠ 付与** | `user:read account:read` を要求 → `offline_access` が足されて3個で返る（同意画面がREQUIRED扱い） |
| **revoke の粒度** | access_token を revoke しても refresh は生きる。refresh_token を revoke して初めて `invalid_grant` |
| **2026-07-28 に `initialize` は無い** | ステートレス。`_meta` 必須 + `Mcp-Method` / `Mcp-Name` ヘッダー必須 |
| **Scope対応表は引ける** | `search()` の OpenAPI spec に `x-api-token-group`（"OAuth scopes have the same names"） |

---

## 判定が覆ったもの・測り直したもの

**2件あります。どちらも記事に書く価値があります。**

| | 何が起きたか |
| --- | --- |
| **D-1「ASが保持している」→ 取り下げ** | 「要求しなかった3つが残った」は事実だが、**過去の付与がゼロのクライアントでも同じ3つが同意画面に出た**。baseline の既定で説明がつき、保持の証拠にならなかった。非baselineの `d1.read` で測り直して決着 |
| **refresh の判定 → 測り直し** | 3ケースを連続投入して2本目以降が429。**本題が一度も実行されていないのに**「広がらなかった」と出力していた。間隔を空けて再測定 |

---

## 報告について

**脆弱性ではありません。** 権限昇格・認証バイパス・データ露出のいずれもなし。

当初「失効したトークンを持つクライアントが、サインインではなく**追加権限**を求められるのでは」
と疑いましたが、**起きません**。現実的な契機を3つ潰して全部 401 でした。

| 実クライアントが持ちうる状態 | 結果 |
| --- | --- |
| revoke 済みの実トークン | 401 `invalid_token` ✅ 仕様どおり |
| 別リソース向けの正規トークン | 401 `invalid_token` ✅ 仕様どおり |
| 壊れた文字列 / 39文字以下 | 401 `invalid_token` ✅ 仕様どおり |
| 一度も発行されていない40文字以上の文字列 | **403 `insufficient_scope`** ❌ RFC 6750 とズレる |

403 になるのは最後の1行だけで、**意図的に文字列を作らないと到達しません**。

- **N2（無言の空配列）** — 報告する価値あり。エージェント製品として一番痛い
- **C1（401/403の取り違え）** — 単独では薄い。N2のついでに一段落添える程度を推奨
- **N4（docsと実装の食い違い）** — **PR の出しどころなし**。OSSライブラリ側は `downscope()` で正しく実装されており、違うのは hosted サーバー

---

## 次にやること

1. **記事の軸を1本に決める**（発見が多いので、放っておくと主張が2本になって絡まる）
2. `slide.md` → `article.md` の順で書く
3. 公開前に Connected Applications から検証用クライアント3つを剥がす
   （`mcp-stepup-sandbox (verification)` / `… CONTROL` / `… CROSS-RESOURCE`）

軸の候補は **「違いは、誰が気づいて、誰が覚えているか」**。
発見1〜3 はすべてこの1文の下に並びます。
