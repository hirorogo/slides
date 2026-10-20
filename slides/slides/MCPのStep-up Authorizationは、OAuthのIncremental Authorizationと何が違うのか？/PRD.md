# PRD：MCPのStep-up Authorizationは、OAuthのIncremental Authorizationと何が違うのか？

技術記事・実装検証

PRD v1.0 · 2026年10月20日

## 1. プロジェクト概要

### 企画の背景

2026年10月19日、Cloudflareは公式Changelogにて、Cloudflare API MCP ServerがStep-up Authorizationに対応したことを発表した。

[iO: Cloudflare partner for online security and performance](https://images.openai.com/static-rsc-4/s23GVJzUfW5cBtFaNRq9Cwf00WG9OVSKVGzeshF-SjKTD0St-VOhz1Gc64YAXO4dZGSLF4PoRSiyZCkcp_Oy2uOT8ddxsum-dlaOoMn33iADWYqHnMJa7haUIg5lZrMzkGBIwWRm0E3zEQxLWDDboBbb9bgjKSEx3Jsq66ligZI?purpose=inline)

[Cloudflare API MCP server now supports step-up authorization](https://developers.cloudflare.com/changelog/post/2026-10-19-cloudflare-mcp-step-up/?utm_source=chatgpt.com)

Cloudflare Changelog · 2026年10月19日

最小限の権限で接続し、MCPツールの実行時に必要となった追加権限だけをユーザーに要求できるようになった。

Cloudflareの発表によれば、初回接続時に認可画面で `Minimal` を選択することで、最小限のScopeから接続を開始できる。未許可のScopeを必要とする操作では、MCP Serverが `insufficient_scope` を返し、対応するMCP Clientが追加の認可を要求する。

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Changelog

+1



この発表を見て、次の疑問が生まれた。

「必要になったタイミングでScopeを追加する」という仕組みは、従来のOAuthにおけるIncremental Authorizationと何が違うのだろうか？

Google OAuthなどでは、アプリケーションが追加機能を利用する際に必要なScopeだけを後から要求する、Incremental Authorizationが以前から提供されている。

一方、MCPのStep-up Authorizationでも、最初からすべての権限を与えるのではなく、ツールの実行時に必要な権限を段階的に追加する。

両者はユーザー体験として似ている。しかし、追加認可を要求する主体・きっかけ・プロトコル上の責務には違いがある。

本記事では、OAuthとMCPの仕様を比較したうえで、Cloudflareが新たに対応したStep-up Authorizationを実際に操作し、その仕組みを検証する。

### 記事の基本方針

単なるCloudflareの新機能紹介や仕様のまとめではなく、次の順序で話を展開する。

CloudflareがStep-up Authorizationに対応した

記事を書くきっかけ

OAuthのIncremental Authorizationと似ている？

技術的な疑問を提示

仕様を比較して違いを理解する

実装・責務・HTTPフローの比較

CloudflareのMCP Serverで実験する

Scopeの追加・維持・エラー処理を検証

結局、何が違うのかを整理する

MCPにおける必要性と設計上の意味

## 2. 記事の目的と成功条件

主目的： MCPのStep-up AuthorizationとOAuthのIncremental Authorizationの関係を、仕様と実際の動作の両面から説明できる技術記事を作成する。

記事の読者はOAuth 2.0の基礎を理解し、MCPを使ったことがあるバックエンドエンジニアを想定する。

この記事を読み終えた読者が、以下を理解できることを成功条件とする。

- Incremental AuthorizationとStep-up Authorizationは、必ずしも対立する別方式ではないこと。
- MCPにおける `403 insufficient_scope` の意味と、追加認可が開始される仕組み。
- MCP Client・MCP Server・Authorization Serverの役割分担。
- 追加認可の際、既存のScopeを維持することがなぜ重要なのか。
- Cloudflareが2026年10月19日に対応した機能の具体的な挙動。
- MCPを利用するアプリケーションにおいて、Step-up Authorizationがどのような設計上の利点を持つのか。

実装検証を通じて、仕様の記述とCloudflareの実際の動作を照合する。

## 3. 技術的な論点

### 3.1 最も重要な比較

ここは記事の核となる。

| 観点        | OAuth Incremental Authorization | MCP Step-up Authorization          |
| --------- | ------------------------------- | ---------------------------------- |
| 主な目的      | 必要な権限を段階的に要求                    | MCP操作時に不足する権限を追加要求                 |
| 追加要求のきっかけ | アプリ側の機能利用など                     | MCP ServerからのScope Challenge       |
| 不足権限の伝達   | アプリが必要なScopeを把握する               | `403 insufficient_scope` と `scope` |
| 認可フロー     | OAuthによる追加認可                    | OAuthによる再認可                        |
| 既存権限の維持   | 認可サーバー・実装に依存                    | MCP Clientが既存Scopeとの和集合を要求することを推奨  |
| 特徴        | 段階的に権限を付与する方式                   | MCPの操作を契機とした段階的な認可フロー              |

Google OAuthの `include_granted_scopes=true` は、Incremental Authorizationにおける既存権限の維持を実現する具体的な機能である。一方、MCPの仕様では、クライアント自身が既存Scopeと追加要求Scopeを統合して再認可するフローが定義されている。

[image](https://www.google.com/s2/favicons?domain=https://developers.google.com\&sz=32)

Google for Developers

+1



ここから導く記事の中心的な仮説は、次のとおり。

> MCPのStep-up Authorizationは、OAuthのIncremental Authorizationを置き換える仕組みではなく、MCPのツール実行時に必要な追加権限を検出し、OAuthの再認可へつなげる仕組みである。

これは最初から結論として断定するのではなく、仕様の比較とCloudflareでの実験によって確かめる。

### 3.2 誤解を避けるための注意点

本記事では、以下を厳密に区別する。

- Step-up AuthorizationとStep-up Authentication： 前者は権限Scopeの追加、後者は認証の強度や新しさの引き上げを指す。RFC 9470は後者を扱うため、両者を同義として説明しない。

  [image](https://www.google.com/s2/favicons?domain=https://www.rfc-editor.org\&sz=32)

  RFC Editor

- 認可要求と認可成功： MCP ClientがScopeの追加を要求しても、必ずユーザーが承認するとは限らない。

- Scopeの要求と付与： 要求したScopeがすべてトークンに付与されたと決めつけず、認可後の結果を確認する。

- 403と401： 権限不足と未認証・無効な認証情報を混同しない。

## 4. Cloudflareを使った実証実験

本記事の最重要パート。

単に公式ドキュメントのフローを紹介するだけでなく、実際のCloudflare API MCP Serverを利用して、Scopeが不足する瞬間から追加認可が完了するまでを観察する。

### 4.1 検証環境

| 項目         | 採用する技術                           |
| ---------- | -------------------------------- |
| MCP Server | Cloudflare API MCP Server        |
| URL        | `https://mcp.cloudflare.com/mcp` |
| MCP Client | Step-up対応クライアント                  |
| 通信方式       | Streamable HTTP                  |
| 認可         | OAuth                            |
| 検証言語       | TypeScript（補助スクリプト）              |
| 検証用アカウント   | 個人のCloudflareアカウント               |
| 記録         | 認可画面、HTTPレスポンス、Scopeの変化          |

Cloudflare API MCP Serverは、`search()`、`execute()`、`docs()` を使ってCloudflare APIとドキュメントを操作できる。つまり、個別のMCPツールごとだけでなく、`execute()` 内から呼び出すAPIエンドポイントに応じて必要なScopeが異なる可能性がある点も興味深い。

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare Agents docs



### 4.2 実験シナリオ

実験A：Minimalで初回接続する

MCP ClientにCloudflare API MCP Serverを登録し、OAuthの認可画面で `Minimal` を選択する。

確認事項：初回の同意画面、Scope、接続成功後に利用できる機能。

実験B：未許可Scopeを要求する操作を試す

最初に権限の必要な読み取り専用APIを選び、MCP経由で実行する。

確認事項：`403` と `insufficient_scope` の発生、要求されたScope、ユーザーへの追加認可の提示。

実験C：Scopeを追加認可する

追加認可を承認して、失敗したツール呼び出しを再実行する。

確認事項：OAuthフローの再実行、認可後のScope、元の操作が成功するか。

実験D：既存Scopeが維持されるか

先ほどとは別の読み取り専用APIを試し、さらにScopeを追加する。

確認事項：先に取得した権限が使えること、追加認可時のScopeが和集合になっていること。

実験E：追加認可を拒否する

必要なScopeを追加せず、元の操作がどう扱われるか確認する。

確認事項：操作の失敗、認可ループの有無、既存の権限への影響。

いずれの実験も、まずは読み取り専用の操作で実施する。設定の変更やリソースの削除を伴う操作は必要ない。

### 4.3 具体的な操作候補

Cloudflare API MCP Serverの `search()` でエンドポイントを調べ、`execute()` を用いて呼び出す。

候補は以下。

| 操作候補                | 検証目的         |
| ------------------- | ------------ |
| Cloudflareのドキュメント検索 | 基本動作の確認      |
| アカウント情報の読み取り        | 最初の追加認可      |
| Workersに関する情報の読み取り  | 別Scopeの追加    |
| DNSレコード一覧の取得        | 複数Scopeの維持確認 |

実験前に各エンドポイントの要求Scopeを調べ、実際に異なるScopeが必要になる組み合わせを採用する。

注意： これらの操作が必ず異なるScopeを要求するとは現時点では断定しない。また、MCP ClientがStep-upに対応していない場合は、対応クライアントへの切り替えか、限定的なHTTPレベルの検証を行う。

## 5. HTTPレベルでの動作検証

記事の技術的な深さを担保するため、UI操作だけで終わらせない。

MCPの仕様では、権限が不足した場合、次のようなScope Challengeを送ることが定義されている。

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub



仕様に基づくレスポンス例（Cloudflareから取得した実測値ではない）

```
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope",
  scope="files:write",
  resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"
```

MCP Clientはこのレスポンスを受け取ると、必要なScopeを既存の要求Scopeに加えて再認可する。

追加認可フローの模式図

OAuth認可に必要なブラウザー操作などを省略した概念図。

ここで重要になるのは、次の検証ポイント。

- `WWW-Authenticate` に必要なScopeが指定されるか。
- Scope ChallengeはMCP Serverから返されるか。
- 再認可時にScopeがどのように指定されるか。
- 実際に許可されたScopeが以前のScopeを含むか。
- 再試行時に新しいトークンが利用されるか。
- 再認可に失敗した場合に適切に停止するか。

リクエスト・レスポンスの記録については、ローカルの検証用クライアントやHTTPログを使用する。アクセストークン、認可コード、Cookie、アカウントIDなどは記事掲載前に削除またはマスクする。

## 6. 記事の構成要件

実際に執筆する記事は、以下の構成を基本とする。

| セクション                             | 執筆する内容                                  |
| --------------------------------- | --------------------------------------- |
| はじめに                              | Cloudflareの2026年10月19日の発表、記事を書くことになった疑問 |
| OAuthのIncremental Authorizationとは | Google OAuthを例に既存Scopeの追加認可を説明          |
| MCPのStep-up Authorizationとは       | MCP仕様、`insufficient_scope`、再認可のフロー      |
| 何が違うのか？                           | 発火条件、要求主体、既存Scopeの扱いを比較                 |
| Cloudflareで実際に検証してみる              | 接続から追加認可までの操作手順と観測結果                    |
| HTTPレベルではどうなっている？                 | Scope Challengeやリクエストの内容を分析             |
| 結局何が違ったのか                         | 実験結果と仕様を照合し、疑問に回答                       |
| おわりに                              | 権限設計とMCPエコシステムにおける意味                    |

技術記事らしく、各セクションは仕様の根拠・実装例・観察結果を中心に記述する。未検証の動作を実測結果として書かないこと。

## 7. 成果物

成果物チェックリスト

0/5

公開用の技術記事

Markdown形式。仕様比較・コード・実験結果を含む

実験用コード

必要に応じてTypeScriptで作成。再現できる手順を用意

HTTPログの抜粋

不足Scopeと再認可前後の違いを示す

認可画面のスクリーンショット

Minimal、追加認可、拒否などの実際の画面

比較表とシーケンス図

OAuthとMCPの責務の違いを可視化

## 8. 完了基準（Definition of Done）

- 公式仕様を根拠に、両者の違いを説明できている。
- Cloudflareの公式発表と今回の仕様対応を明示している。
- 実際にCloudflare API MCP ServerへOAuth接続できている。
- Scope不足による追加認可を少なくとも1回観測している。
- 初期状態・権限不足・再認可後の3段階が比較できる。
- `insufficient_scope` とScope Challengeの内容を確認している。
- 既存Scopeが維持されたか、実際の検証結果を明記している。
- 再現可能な実験手順を掲載している。
- 実測した内容と仕様からの推測を明確に分離している。
- セキュリティ上の機密情報を公開していない。

### 対象外とする内容

独自のOAuth Authorization Serverをゼロから実装すること、Cloudflareの認可基盤を再実装すること、OAuthのすべての仕様を解説することは対象外とする。

検証に必要であれば小規模なクライアントコードを作成するが、目的はあくまでCloudflareの実装を使ってMCP Step-up Authorizationの実際の動作を確認することである。

## 9. 参考資料（一次ソース）

- [Cloudflare — Step-up Authorization対応発表](https://developers.cloudflare.com/changelog/post/2026-10-19-cloudflare-mcp-step-up/?utm_source=chatgpt.com)
- [Cloudflare — Cloudflare API MCP Server](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/?utm_source=chatgpt.com)
- [MCP Specification 2026-07-28 — Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization?utm_source=chatgpt.com)
- [Google OAuth — Incremental Authorization](https://developers.google.com/identity/protocols/oauth2/web-server?utm_source=chatgpt.com)
- [RFC 6750 — OAuth Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750?utm_source=chatgpt.com)
- [RFC 9470 — OAuth Step Up Authentication Challenge Protocol](https://www.rfc-editor.org/rfc/rfc9470?utm_source=chatgpt.com)

## 10. 記事で最も伝えたいこと

この企画で特に深掘りしたいのは、単に権限を後から追加できることではない。

従来のWebアプリケーションでは、アプリケーション開発者が実行される機能や必要なScopeを把握していることが多い。一方、MCPでは、AI Agentがユーザーの指示に応じてツールを選択し、実行する。

つまり、どのScopeが必要になるのか、MCP Client側で事前に判断しづらいという事情がある。

この環境において、MCP Serverが要求された操作を判断し、不足するScopeをクライアントに伝えられることは、OAuthのIncremental Authorizationをより動的な利用形態へ適用するうえで重要な意味を持つ。

そして、Cloudflareがそれを実際のサービスとして提供し始めた。

この記事は、その事実を入口として、OAuthがもともと持っていた段階的な認可の考え方と、MCPが定義するScope Challengeの違いを、実際のHTTP通信を含めて明らかにする。

記事としては「MCPに新しい認可方式ができた」という話にするより、「OAuthでできたことを、MCPではどう動的に実現するのか」という視点にすると、技術的に正確で読み応えのある内容になる。

なお、このPRDは公式資料を調査した段階のもの。Cloudflareへの実接続、追加認可、HTTPレスポンスの観測はまだ実施しておらず、その結果は記事執筆時に記録する。