# PRD：Google OAuthのRefresh TokenをDPoPで保護するTypeScript実装記事

## 1. 記事の目的

Google OAuthで利用できるRefresh TokenのDPoPバインディングを、TypeScriptで実装・検証する技術記事を執筆する。DPoPの概念紹介だけに留めず、Google固有の仕様とRFC 9449との差分、鍵・Nonceの扱い、実際のトークン交換を追える内容にする。

読者が記事を読み終えたとき、次のことをできる状態を目指す。

- DPoPがRefresh Tokenの漏えい時に何を防ぎ、何を防がないか説明できる
- GoogleのAuthorization Code交換とRefresh Token更新で必要なDPoP proofを作れる
- TypeScriptでES256署名、JWK、`jti`、`nonce`を扱える
- 失敗時のエラーや鍵紛失時の影響を理解し、検証環境で再現できる

## 2. 想定読者

- TypeScript / Node.jsでOAuth 2.0を実装した経験があるWebエンジニア
- Google API連携でRefresh Tokenを保存している開発者
- OAuthやJWTの基礎知識はあるが、DPoPを実装したことがない読者

## 3. 記事の中心メッセージ

DPoP自体はRFC 9449で標準化済みの仕組みであり、本記事の焦点は「Google OAuthがRefresh TokenをDPoP鍵にバインドする仕様」と「それをTypeScriptで実装するときに必要になる具体的な処理」である。

Googleの実装ではRefresh Tokenが鍵に結び付く一方、Access Tokenは引き続きBearer Tokenである。したがって、DPoPは漏えいしたRefresh Token単体の再利用を防ぐ sender-constraining であり、Access Token漏えい、秘密鍵漏えい、ブラウザーセッションCookie窃取を解決するものではない。

## 4. 記事に含めるスコープ

### 対象

- Google OAuth Authorization Codeフロー
- `access_type=offline` によるRefresh Token取得
- ES256 / EC P-256の鍵ペア生成と保存
- Authorization Code交換時のDPoP proof生成
- Refresh Token更新時のDPoP proof生成
- Googleが返す `DPoP-Nonce` の保存、利用、更新
- `jti` のGoogle固有ルール
- TypeScriptのコード例とローカル検証手順
- エラーケースと運用上の注意
- DPoP、PKCE、秘密情報の暗号化保存の役割の違い

### 対象外

- Google APIリソースリクエストをDPoPで保護する実装（GoogleのAccess TokenはBearerのため）
- 汎用OAuthクライアントライブラリの完全実装
- SPA単独で完結する本番構成
- 鍵管理サービスやハードウェアセキュリティキーのベンダー比較
- RFC 9449全体の逐条解説

## 5. 実装前提と記事内で明示する選択

- 実行環境：Node.js上のTypeScriptサーバーアプリ（Google OAuthのConfidential Client）
- JWT実装：JWSのES256署名とJWKエクスポートを扱えるライブラリを使う。例として `jose` を候補にし、執筆時点のNode.js対応状況とAPIを確認して固定する
- HTTP通信：標準の `fetch` を使い、`application/x-www-form-urlencoded` でGoogle token endpointへPOSTする
- 鍵形式：EC P-256。秘密鍵はサンプルではプロセス内に保持し、本番ではDB/KMS/OSキーストア等の保護された永続ストレージに保存する方針を説明する
- OAuth callbackの `state` 検証とPKCEは既存フローとして含める。DPoPがこれらを置き換えないことを明記する
- 動作確認は専用のGoogle OAuthクライアントとテストアカウントで行い、トークンや秘密鍵はログ・記事・リポジトリへ出さない

## 6. 必須仕様と実装要件

### 6.1 鍵とJWTヘッダー

- EC P-256の鍵ペアを生成する
- JOSEヘッダーは `typ: dpop+jwt`、`alg: ES256`、公開鍵のみを含む `jwk` を持つ
- JWKに秘密鍵素材を含めない
- Authorization Code交換で使った秘密鍵を、Refresh Tokenの更新にも継続して使う
- 鍵を失うと、その鍵にバインドされたRefresh Tokenを更新できないことを説明する

### 6.2 Authorization Code交換

- 認可リクエストで `access_type=offline` を設定する
- 必要に応じて初回のRefresh Token発行を得るため `prompt=consent` を使う。乱用を推奨せず、既存grantからの再発行など要件に応じて説明する
- token endpointは `https://oauth2.googleapis.com/token`
- DPoP proof payloadは少なくとも `htm=POST`、`htu`、Unix秒の `iat`、Google指定の `jti` を持つ
- Authorization Code交換の `jti` はauthorization codeのSHA-256をBase64URLエンコードした値
- proofを `DPoP` HTTPヘッダーに置く。フォーム項目として送らない
- `code_verifier`、`client_id`、`client_secret`（Confidential Clientの場合）、`redirect_uri`、`grant_type=authorization_code`、`code`を通常どおり送信する
- 成功レスポンスの `DPoP-Nonce` を取得して保存する

### 6.3 Refresh Token更新

- `grant_type=refresh_token`、`refresh_token`、`client_id`等を送信する
- 毎回新しいproofを署名し、同じ秘密鍵を利用する
- `jti` はリクエストごとの一意なランダム値とする（Googleガイドの例はWeb Cryptoの乱数をBase64URL化）
- `iat`を都度更新する
- 保存済みの有効なNonceを `nonce` claimに含める
- レスポンスに新しい `DPoP-Nonce` があれば、次回用に更新する
- 同一ユーザーの並行RefreshによるNonce競合・再利用を避ける設計上の考慮を記す。実装例では直列化、またはNonce更新とRefresh処理の排他制御を検討する

### 6.4 エラー処理

- `invalid_dpop_proof`：`htm` / `htu`不一致、期限切れ `iat`、`jti`再利用、署名不正などを点検する
- `use_dpop_nonce`：応答の新しい `DPoP-Nonce` を取得し、新規 `jti`・`iat`でproofを作り直して再試行する
- 再試行は無制限に行わず、対象エラーに限って回数を制限する
- `invalid_grant`など通常のOAuthエラーをDPoPエラーと混同しない
- 各リクエストでproofを使い回さない

## 7. 期待する記事構成（執筆上の要件）

これは見出しを固定するアウトラインではなく、記事内で読者に順に理解してもらう内容要件である。

1. Google OAuthのRefresh TokenにDPoPを適用する動機と、DPoPの現在地（RFC標準化済み）
2. 通常のBearer Refresh Tokenとの違い、脅威モデルと保護範囲
3. Google固有の仕様：Refresh Tokenのみバインド、Access TokenはBearer、token endpointとNonce要件
4. TypeScript実装の前提、鍵生成・JWK・proof生成
5. Authorization Code交換をDPoP付きで実行し、Refresh TokenとNonceを保存
6. Refresh処理を実装し、Nonce更新とエラー再試行を扱う
7. 成功・失敗ケースの検証結果
8. 鍵保管、ローテーション、既存grant、SPA/BFFなどの運用判断
9. 結論として、どんなアプリに導入価値があり、何を別途守る必要があるか

## 8. 検証計画と受け入れ条件

記事を公開する前に、専用テスト環境で以下を確認し、成功したものだけを実測結果として記載する。

- DPoPなしの通常フローと、DPoP付きフローの差を確認できる
- DPoP付きAuthorization Code交換が成功し、Refresh Tokenと `DPoP-Nonce` が返る
- 正しい鍵・NonceによるRefreshが成功する
- Refresh Tokenだけを使い、DPoP proofを省略すると拒否される
- 別の鍵で署名したproofが拒否される
- 使用済みNonceや再利用proofでエラーになり、新Nonceを使う再試行が成功する
- `jti`、`iat`、`htu`等を意図的に壊したときのエラーを記録できる
- ログにRefresh Token、client secret、秘密鍵、完全なproofを出さない
- 記事中のサンプルコードがTypeScriptの型チェックを通り、記載したNode.js環境で動作する

Google側のテスト挙動やエラー詳細が仕様文書と異なる場合は、その差を明記し、未検証の期待結果を断定しない。

## 9. セキュリティ・運用上の注意

- DPoPはRefresh Token単体の窃取・再利用への対策であり、鍵とトークンの両方が盗まれれば攻撃者が使える可能性がある
- Access TokenはBearerのままなので、漏えいしたAccess Tokenは有効期限内に悪用され得る
- Node.jsサーバーに保存する鍵は、Refresh Tokenと同じDBに平文で置かない。少なくとも保存時暗号化・アクセス制御・バックアップ保護を考慮し、可能ならKMS等を使う
- DPoP秘密鍵はRefresh Tokenと同等以上に重要な秘密情報として扱う
- DPoP導入後の鍵ローテーションは単純な鍵差し替えではない。新しい鍵に結び付くRefresh Tokenを得る再認可の設計が必要
- ブラウザーだけのSPAではclient secret要件とNonceヘッダーのCORS制約があるため、記事サンプルの対象にしない。SPAではBFFを検討する
- PKCEは認可コード保護、DPoPは発行後のRefresh Token保護であり、両方を組み合わせる
- `prompt=consent`やgrant revokeで再発行を試す場合、テストアカウントを使い、本番ユーザーのgrantを不用意に失効させない

## 10. 用語・表現のルール

- 「DPoPが新登場した」と書かない。DPoPはRFC 9449で標準化済み
- 「Google OAuthのDPoP対応」「Refresh TokenのDPoPバインディング」と表現する
- 「Refresh Tokenを暗号化する」と「Refresh Tokenを鍵にバインドする」を区別する
- 「DPoPならトークン漏えいを防げる」と断定せず、「盗まれたRefresh Token単体の再利用を困難にする」と説明する
- Google仕様とRFC一般仕様を区別し、Google固有の `jti` やNonceルールを明示する
- コードは概念コードと実際に動作確認したコードを混同しない

## 11. 執筆時に再確認する一次資料

- Google DPoP Adoption Guide: https://developers.google.com/identity/protocols/oauth2/resources/dpop-adoption
- Google OAuth 2.0 for Web Server Applications: https://developers.google.com/identity/protocols/oauth2/web-server
- Google Developers Blog announcement (2026-10-15): https://developers.googleblog.com/announcing-dpop-support-for-google-oauth-securing-refresh-tokens/
- RFC 9449: https://www.rfc-editor.org/rfc/rfc9449.html

仕様・ライブラリAPIは変わり得るため、記事執筆時点で再確認する。
