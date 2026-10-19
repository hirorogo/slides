# references — Google OAuth の Refresh Token を DPoP でバインドする

| | |
| --- | --- |
| 調査日 | 2026-10-19 |
| 対象 | Google OAuth Platform の DPoP 対応（RFC 9449） |
| 用途 | slide.md / article.md（PRD.md 準拠） |
| 計測環境 | Node.js v24.22.0 / jose 6.2.12 / Apple M4 (arm64) / macOS 25.5.0 |

> ⚠️ **Google OAuth クライアントを持っていないので、実トークン交換は未実施。**
> PRD §8 の受け入れ条件はすべて ⬜ のまま。下の「未確認・積み残し」に移した。
> ここで ✅ になっているのは「ドキュメントの記述」と「手元で再現できた計算・計測」だけ。

## 確認した主張

| # | 主張 | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | Refresh Token だけがバインドされ、Access Token は Bearer のまま | ✅ 確認 | 公式 3 ドキュメント + blog が一致 |
| 2 | DPoP は新機能ではない（RFC 9449、2023 年） | ✅ 確認 | RFC 9449 |
| 3 | 「2026-10-15 に対応」ではなく、**5 月には出ていた** | ✅ 実測 | Wayback で Best Practices の改版を特定 |
| 4 | 認可コード交換の `jti` = `base64url(sha256(code))` | ✅ 実測 | 公式サンプルから再現できた |
| 5 | その `jti` 規則は **RFC 9449 に無い Google 独自仕様** | ✅ 確認 | RFC は `dpop_jkt` / `jti` はランダム要求 |
| 6 | RFC 9449 は「Confidential Client の RT はバインドしない」と書いている | ✅ 確認 | RFC 9449 §5。Google のサンプルは `client_secret` 付き |
| 7 | Google は discovery doc で DPoP 対応を広告していない | ❌ **前提が違う** | `dpop_signing_alg_values_supported` が無い（実測） |
| 8 | 公式 Adoption Guide の Refresh サンプル proof は**署名が壊れている** | ❌ **ドキュメントのバグ** | 70 byte の ASN.1 DER。検証も通らない（実測） |
| 9 | web-server doc の proof サンプルは **RFC 9449 の例文の丸写し** | ❌ **ドキュメントのバグ** | `htu` が `server.example.com`、`jti` がランダム（実測） |
| 10 | 初回 Refresh の nonce 持ち越しは**効かない**（Adoption Guide が正しい） | ✅ **実測で決着** | 400 `use_dpop_nonce`（実測） |
| 11 | `extractable: false` だと Node では**鍵を永続化できない** | ✅ 実測 | `InvalidAccessError`（実測） |
| 12 | ES256 検証コストは ~50µs/op | ✅ 実測 | 20,000 回計測 |
| 13 | 既存 Refresh Token は DPoP バインドに移行できない | ✅ 確認 | revoke か `prompt=consent` が必要と明記 |
| 14 | secretless SPA は DPoP を直接使えない | ✅ 確認 | 公式 2 箇所に明記 |
| 15 | `jose` は依存ゼロ | ✅ 実測 | npm registry |
| 16 | 日本語の実装記事は見つからなかった | ⚠️ 探索の限界 | 2 回検索して 0 件 |
| 17 | Google は **DPoP proof より先に grant を検証する** | ✅ 実測 | 壊した proof 8 通り全部が `invalid_grant`（実測） |
| 18 | `iat` の許容は**過去ちょうど 3600s / 未来ちょうど 10s** | ✅ **1 秒精度で確定** | -3599s 可 / -3600s 不可、+10s 可 / +11s 不可（2 回独立に再現） |
| 19 | `htm` / `htu` 不一致は `invalid_dpop_proof` ではない | ❌ **ドキュメントと違う** | 実際は `invalid_request`（実測） |

---

## 1. Refresh Token だけがバインドされ、Access Token は Bearer

**判定: 確認。一次ソース 4 本が一致。**

- [Announcing DPoP Support for Google OAuth](https://developers.googleblog.com/announcing-dpop-support-for-google-oauth-securing-refresh-tokens/)（2026-10-15、Sergei Akulich / Brian Daugherty）— 一次。**理由が書いてあるのはここだけ**
  > Google's OAuth Platform supports DPoP binding specifically for refresh tokens. This design choice reflects a pragmatic engineering tradeoff: by sender-constraining the long-lived refresh token, we neutralize the primary vector for persistent offline impersonation. Meanwhile, short-lived access tokens remain standard Bearer tokens, ensuring that high-QPS resource APIs do not incur the per-request asymmetric cryptographic verification overhead of DPoP.
- [DPoP Adoption Guide](https://developers.google.com/identity/protocols/oauth2/resources/dpop-adoption)（Last updated 2026-07-31）— 一次。レスポンス例が `"token_type": "Bearer"`
- [Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)（Last updated 2026-10-16）— 一次。**ここが一番はっきり書いている**
  > `token_type` | The type of token returned. This value is always `Bearer`, even when DPoP is used.
- [Best Practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)（Last updated 2026-05-20）— 一次
  > Note: Google's OAuth 2.0 implementation supports DPoP binding for refresh tokens. Issued access tokens remain standard Bearer tokens when accessing Google APIs.

### 記事に使える切り口

- blog の性能論（「高 QPS API で非対称署名検証を毎回やると重い」）は、**#12 の実測値と並べると数字で語れる。**
  1 回 50µs は自分のアプリでは無視できる。Google の規模だと無視できない。**どちらも正しい**という書き方ができる。

---

## 2. DPoP は新機能ではない

**判定: 確認。** RFC 9449（Proposed Standard, 2023-09）。PRD §10 の「DPoP が新登場した、と書かない」はこれ。

- [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html) — 一次
- 新しいのは **Google が対応したこと**だけ。Okta / FusionAuth などは以前から対応している
  - [Okta: Configure DPoP](https://developer.okta.com/docs/guides/dpop/nonoktaresourceserver/main/)
  - [FusionAuth: OAuth DPoP](https://fusionauth.io/docs/lifecycle/authenticate-users/oauth/dpop)

---

## 3. 「2026-10-15 に対応した」は不正確。5 月には出ていた

**判定: 実測で確定。タイトルの「対応したらしい」をそのまま信じると間違える。**

Wayback Machine で Best Practices ページの改版を追った（コマンドは下の「計測」）。

| 日付 | 出来事 | 根拠 |
| --- | --- | --- |
| 2026-04-15 | Best Practices に DPoP の記述**なし** | 20260510 スナップショット（dpop 0 hits） |
| **2026-05-20** | Best Practices に "Sender-constrain tokens with DPoP" **が登場** | 20260619 スナップショット（dpop 14 hits） |
| 2026-07-31 | DPoP Adoption Guide の Last updated | ページ末尾 |
| **2026-09-04** | `google/skills` に公式 DPoP SKILL.md が commit | `a83a895` |
| **2026-10-15** | Developers Blog で発表 | blog |
| 2026-10-16 | web-server doc が DPoP 対応で更新 | ページ末尾 |

### 記事に使える切り口

- **「静かに出して、5 か月後に発表した」** という時系列そのものがネタになる。
  LT の掴みに使える。「DPoP に対応したらしい」→「調べたら半年前から動いてた」。

---

## 4. 認可コード交換の `jti` は乱数ではない（Google 独自）

**判定: 公式サンプルから再現できた。一次ソース級。**

[DPoP Adoption Guide](https://developers.google.com/identity/protocols/oauth2/resources/dpop-adoption) より:

> When an authorization code is exchanged for access and refresh tokens the value of `jti` is the Base-64 and Url-encoded SHA256 hash of the authorization code, such as `jti = BASE64URL(SHA-256(authorization_code))`.

ドキュメント内のサンプル（code と jti）で実際に計算したら **一致した。**

```
doc jti : o29CN8LIY0l_N8iy5-ilon1guad9NFQHFOdXTzrBNck
calc jti: o29CN8LIY0l_N8iy5-ilon1guad9NFQHFOdXTzrBNck
match   : True
```

→ **サンプルの数値は作り物ではなく、実際に生成されたもの。** 規則の記述は信用してよい。

Refresh 側は別ルール（web-server doc）:
> For refresh token exchanges, the `jti` must be a unique per-request identifier.

Adoption Guide はさらに具体的に `crypto.getRandomValues(new Uint8Array(24))` を Base64URL 化、と書いている（= 192 bit）。

---

## 5. その `jti` 規則は RFC 9449 に存在しない

**判定: 確認。ここが記事の技術的な山場。**

RFC 9449 §4.2（414-421 行）:
> `jti`: Unique identifier for the DPoP proof JWT. The value MUST be assigned such that there is a negligible probability that the same value will be assigned to any other DPoP proof used in the same context during the time window of validity. Such uniqueness can be accomplished by encoding (base64url or any other suitable encoding) at least 96 bits of pseudorandom data or by using a version 4 UUID string

RFC が定める「認可コードを DPoP 鍵に縛る」方法は §10、**`dpop_jkt` 認可リクエストパラメータ**（JWK Thumbprint を認可リクエストに付ける）。

**Google の認可リクエストのサンプルに `dpop_jkt` は無い。** 代わりに `jti = sha256(code)` で同じ目的を果たしている。

| | RFC 9449 | Google |
| --- | --- | --- |
| 認可コードと鍵の紐付け | `dpop_jkt` 認可リクエストパラメータ（OPTIONAL） | `jti = base64url(sha256(code))` |
| `jti` の性質 | 96bit 以上の擬似乱数 / UUIDv4 | 認可コード交換時は**決定的な値** |
| Access Token | `token_type: DPoP` が MUST | `token_type: Bearer` |
| 認可コード交換での nonce | — | optional（web-server doc） |

### 記事に使える切り口

- 「RFC を読んで実装したら動かない」が起きる場所。**RFC 準拠のライブラリをそのまま使えない理由**になる。
- 決定的な `jti` は RFC 的には奇妙に見えるが、**認可コードが 1 回しか使えない**ので実質一意。
  リプレイ対策としては `dpop_jkt` と同等の効果。Google が RFC の OPTIONAL 機能を実装する代わりに
  既存クレームを流用した、という読み方ができる。

---

## 6. RFC は「Confidential Client の RT はバインドしない」と書いている

**判定: 確認。Google のサンプルと噛み合っていない。**

RFC 9449 §5（636-648 行）:
> Refresh tokens issued to confidential clients (those having established authentication credentials with the authorization server) are not bound to the DPoP proof public key because they are already sender-constrained with a different existing mechanism. ... This existing sender-constraining mechanism is more flexible (e.g., it allows credential rotation for the client without invalidating refresh tokens) than binding directly to a particular public key.

一方で、Google の Adoption Guide のサンプルは `--data-urlencode "client_secret=YOUR_CLIENT_SECRET"` を送っている = **Confidential Client**。

Best Practices の推奨対象は逆に public client 寄り:
> Adopting DPoP is strongly recommended if your application: Operates as a public client (such as a single-page application or installed app) where refresh tokens may be more susceptible to exfiltration.

そして Adoption Guide / SKILL.md は SPA には **BFF（= Confidential Client）を立てろ**と言う。

→ **「public client を守りたい、でも実装は confidential client で」** というねじれがある。
RFC が言う「鍵に縛るより client 認証の方が柔軟」というデメリット（鍵ローテーションの難しさ）を
Google 構成では**両方背負う**ことになる。

### 記事に使える切り口

- PRD §9 の「鍵ローテーションは単純な鍵差し替えではない」の根拠が、まさに RFC のこの段落。
  **RFC が事前に警告していたデメリットを踏みにいっている。**

---

## 7. ❌ Google は discovery doc で DPoP 対応を広告していない

**判定: 実測。前提が違った。**

RFC 9449 §5.1 は、対応の表明方法として authorization server metadata を定義している:
> `dpop_signing_alg_values_supported`: A JSON array containing a list of the JWS alg values ... supported by the authorization server for DPoP proof JWTs.

実際に引いた（2026-10-19）:

```sh
curl -s https://accounts.google.com/.well-known/openid-configuration | python3 -m json.tool | grep -i dpop
# → 何も出ない
```

`accounts.google.com` の discovery doc 全文を確認したが、**`dpop` を含むキーは 1 つも無い。**
`grant_types_supported` / `code_challenge_methods_supported` などは普通にある。

→ **discovery ベースで feature detection する標準準拠クライアントは、Google の DPoP 対応を検出できない。**
→ 対応アルゴリズム（ES256 以外に何が通るか）も機械可読な形では公開されていない。
→ 実装では **ハードコードするしかない。**

### 記事に使える切り口

- 「公式 blog が出たのに、プロトコル上は何も宣言していない」。**#3 の時系列と繋がる。**
- `openid-client` / `oauth4webapi` のような discovery 前提のライブラリで詰まるポイント。

---

## 8. ❌ 公式 Adoption Guide の Refresh サンプル proof は署名が壊れている

**判定: 実測。ドキュメントのバグ。今回の一番の収穫。**

[DPoP Adoption Guide](https://developers.google.com/identity/protocols/oauth2/resources/dpop-adoption) には proof のサンプルが 2 つある。手元で署名検証した:

| サンプル | 署名長 | 検証結果 |
| --- | ---: | --- |
| 認可コード交換 | 64 B | **SIGNATURE VALID** |
| Token Refresh | **70 B** | **SIGNATURE FAILED** |

70 byte の中身を ASN.1 としてパースしたら、きれいに通った:

```
hex head: 3044022039b4f405
ASN.1 DER SEQUENCE? True | declared len: 68 | actual rest: 68
  r: tag=0x02 (INTEGER) len=32
  s: tag=0x02 (INTEGER) len=32
```

→ **JWS が要求する raw `R||S`（P-256 で 64 byte, IEEE P1363）ではなく、ASN.1 DER のまま貼られている。**

これは Google 自身が別の場所で「やるな」と書いていることそのもの。

- web-server doc:
  > Note that JWS requires the signature to be in a raw `R | S` concatenated format (64 bytes for P-256). If using OpenSSL directly, you must convert the default ASN.1 DER-encoded signature to this raw format.
- 公式 SKILL.md §1-D は丸々このトピックに割かれている（"IEEE P1363 vs. ASN.1 DER Signature Disambiguation"）

なお、DER → P1363 に変換してもう一度検証したが、**それでも通らなかった。**
→ 署名そのものがその payload / 鍵に対応していない。つまりこのサンプルは
**生成し直されていないプレースホルダ**の可能性が高い。「DER で貼ってしまった」のか
「単に別物を貼った」のかは、ここからは判別できない。

> ⚠️ この「変換しても通らなかった」という過程は references.md 限りの話。
> article.md には「Refresh サンプルの署名は 64 byte の P1363 ではなく 70 byte の DER だった」という
> **検証できた事実だけ**を書く。

### 記事に使える切り口

- **最大の実装トラップがそのまま公式サンプルで踏まれている。** Node の `crypto.subtle.sign` は P1363 を返すが、
  `node:crypto` の `createSign` と OpenSSL は DER を返す（#12 で両方計測済み）。
- `length === 70` でチェックするのもダメ。DER 長は leading zero 次第で 69〜72 に揺れる（手元では 71 B が出た）。

---

## 9. ❌ web-server doc の proof サンプルは RFC 9449 の例文の丸写し

**判定: 実測。こちらもドキュメントのバグ。**

web-server doc の「sample request」に載っている DPoP JWT をデコードした:

```json
{"typ":"dpop+jwt","alg":"ES256","jwk":{"kty":"EC","x":"l8tFrhx-34tV3hRICRDY9zCkDlpBhF42UQUfWVAWBFs","y":"9VE4jf_Ok_o64zbTTlcuNJajHmt6v9TDVrU0CdvGRDA","crv":"P-256"}}
{"jti":"-BwC3ESc6acc2lTc","htm":"POST","htu":"https://server.example.com/token","iat":1562262616}
```

RFC 9449 の 459-467 行と**完全に同一**（同じ鍵、同じ `jti`、同じ `htu`）。`iat` は 2019-07-04。

問題が 2 つある:

1. `htu` が **`https://server.example.com/token`**。Google のエンドポイントではない。
   そのままコピーすると `invalid_dpop_proof`（htu 不一致）。
2. `jti` が `-BwC3ESc6acc2lTc` という**短いランダム文字列**。
   同じページの 3 段落上に「認可コード交換では `jti` は `BASE64URL(SHA256(code))`」と書いてあるのに、
   **その直後のサンプルが自分のルールを破っている。**

### 記事に使える切り口

- #8 と合わせて「**公式サンプルを 2 つとも信じてはいけない**」が言える。
  これは煽りではなく、**自分で検証する価値がある**という記事全体の主張の実証になる。
- PRD §8 の「成功したものだけを実測結果として記載する」の裏返し。
  ドキュメントの記述とサンプルは、別々に検証しないといけない。

---

## 10. ✅ Nonce の「workflow isolation」— 決着した

**判定: 実測。Adoption Guide が正しく、web-server doc が間違っている。**

同じことを 2 つの公式ページが**逆に**書いていた。

**A. Adoption Guide（2026-07-31）— 持ち越しは効かない**
> When an expired, incorrect, or reused nonce is used **or when transitioning between different OAuth workflows (such as moving from the initial Authorization Code Exchange to a Token Refresh request)** Google's server enforces workflow isolation. This means the server **unconditionally rejects** the nonce with an HTTP 400 `use_dpop_nonce` challenge to establish a fresh nonce namespace for the new workflow.

**B. web-server doc（2026-10-16）— 持ち越しは効く**
> Your client must cache this nonce and include it in the `nonce` claim of the DPoP proof in subsequent requests (such as when exchanging a refresh token for a new access token...). **By using this early-issued nonce, you can avoid an extra round-trip failure (`use_dpop_nonce`) on your next request.**

### 実測結果（2026-10-19T12:36:24Z）

認可コード交換のレスポンスで受け取った `DPoP-Nonce` を、そのまま初回 Refresh の
`nonce` クレームに入れて 1 回だけ投げた。

```
HTTP 400  use_dpop_nonce
```

**→ A が正しい。** 認可コード交換 → Refresh の遷移では、持ち越した nonce は拒否される。

### 分かったこと

- **初回 Refresh は必ず 400 → リトライで 2 往復になる。** 避けられない
- したがって `use_dpop_nonce` のリトライループは**最適化ではなく必須**。
  実装から省くと、認可直後の 1 回目が必ず失敗する
- **web-server doc の「余分な往復を避けられる」は、この遷移に関しては誤り。**
  より新しいページ（2026-10-16 更新）の方が間違っている

### 記事に使える切り口

- 公式ドキュメントが割れていて、**新しい方が間違っていた**。
  #8 / #9（公式サンプルの不備）と並べると「公式を疑う」話が3つ揃う
- 実装者にとっての結論は単純: **リトライループを必ず書く**

---

## 11. `extractable: false` は Node では「永続化できない」と同義

**判定: 実測。記事の実装パートの核。**

Google の公式 SKILL.md（[google/skills](https://github.com/google/skills/blob/main/skills/identity/dpop-adoption/SKILL.md)、2026-09-04 commit `a83a895`）:

> **CRITICAL SECURITY GUARDRAIL:** The private key MUST be configured as **non-extractable** (`extractable: false`). This guarantees the private key can never leave the hardware cryptographic boundary (Secure Enclave, Android KeyStore, or JS sandbox memory), thwarting XSS and dependency token theft attacks.

web-server doc も同じ方向:
> The security of DPoP relies on the private key being restricted to a single device; we recommend storing it in a way that it cannot be copied off-device, for example by using TPMs, Secure Enclaves, or other hardware-backed keystores.

Node.js v24.22.0 で実測した結果:

```
[1] generateKey(extractable=false)
  privateKey.extractable = false
  publicKey.extractable  = true          ← public は常に export できる（WebCrypto 仕様）
  exportJWK(public) -> {"kty":"EC","x":"...","y":"...","crv":"P-256"}

[2] 秘密鍵をプロセス再起動をまたいで永続化できるか
  exportKey('jwk')   -> InvalidAccessError: key is not extractable
  exportKey('pkcs8') -> InvalidAccessError: key is not extractable
```

→ **Node サーバーで SKILL.md を字義通りに守ると、秘密鍵をプロセス外に出せない。**
→ プロセスが再起動した瞬間、その鍵にバインドされた **全ユーザーの Refresh Token が使用不能**になる。
→ 復旧には `prompt=consent` での**再同意しかない**（#13）。

さらに、Node の WebCrypto には **TPM も Secure Enclave も無い。**
非 extractable 鍵はただのプロセスメモリ上の鍵で、「hardware cryptographic boundary」は存在しない。
SKILL.md のこの表現は**ブラウザ / モバイル向けの文言**で、Adoption Guide 自身が前提にしている
Node の Confidential Client（`client_secret` を送る）には当てはまらない。

永続化する場合（`extractable: true`）も実測した:

```
[persist] private JWK keys: kty,x,y,crv,d | has d: true
[persist] sign with reloaded key -> verify OK (round-trip works, but "d" now sits in your DB)
```

→ 動く。ただし秘密鍵成分 `d` が DB に乗る。
→ **PRD §9 の「Refresh Token と同じ DB に平文で置かない」はここに効く。**

### 記事に使える切り口

- **「Google のガードレールをそのまま Node に持ってくると壊れる」。** 公式 SKILL.md を読んだだけだと気づけない。
- 選択肢は実質 3 つ。記事で整理する価値がある:
  1. `extractable: false` + 鍵をプロセスに閉じる → 再起動で全滅。却下
  2. `extractable: true` + JWK を KMS/暗号化して保存 → 現実解。ただし RFC の脅威モデルからは一段落ちる
  3. KMS 側に鍵を置いて署名だけ委譲 → 「鍵が出ない」を本当に満たせる唯一の方法
- 2 を選んだ時点で「鍵が盗まれない保証」は消え、**DPoP は "RT 単体の窃取" にだけ効く**という
  PRD §3 の整理がそのまま正しくなる。

---

## 12. ES256 の実コスト（blog の性能論の裏取り）

**判定: 実測。**

```
[3] crypto.subtle.sign ECDSA output = 64 bytes | first byte 0xed  (DER would be 0x30)
    node:crypto createSign output   = 71 bytes | first byte 0x30  (ASN.1 DER)

[perf] N=20000  ES256 sign   26.2 us/op  (38,227 ops/s)
[perf] N=20000  ES256 verify 50.5 us/op  (19,787 ops/s)
```

- WebCrypto は **64 byte の raw P1363**、`node:crypto` は **DER**。#8 のトラップが Node 内で再現できる
- 検証は署名の約 2 倍のコスト。1 コアあたり毎秒 2 万回程度

### 記事に使える切り口

- blog の "the compute overhead at the API Gateway layer would be massive" は、
  **1 リクエスト 50µs という数字を出した上でなら公平に評価できる。**
  自分のアプリでは誤差。Gmail / Drive の規模では効く。**煽らずに両立させられる。**
- DER の長さが 70 でも 71 でもあり得る（leading zero 次第）ことも、この計測で出た

---

## 13. 既存の Refresh Token は DPoP バインドに移行できない

**判定: 確認。**

web-server doc:
> Note: If your application already has a refresh token for the user and you want to obtain a new DPoP-bound refresh token, **the user must revoke the existing grant or you must use the `prompt=consent` parameter** in the initial authorization request to ensure a new refresh token is issued.

→ **既存ユーザー全員に再同意を踏ませないと移行できない。** 導入判断の最大のコスト。
→ PRD §9 の「本番ユーザーの grant を不用意に失効させない」はここ。
→ #11 の「鍵を失ったら再同意しかない」と**同じ代償**。鍵ローテーションの現実性がこれで決まる。

---

## 14. secretless SPA は DPoP を使えない（BFF が要る）

**判定: 確認。一次ソース 2 本。**

- Adoption Guide:
  > Pure, secretless client-side SPAs cannot use DPoP directly due to the `client_secret` requirement and CORS limitations on the `DPoP-Nonce` header. To secure SPAs, route traffic through a Backend-for-Frontend (BFF) that acts as a Confidential Client, enables `access_type=offline`, and utilizes DPoP to bind the refresh token server-side.
- SKILL.md §1-E も同じ内容

関連して blog が挙げている設計論:
- [RFC 9700](https://datatracker.ietf.org/doc/html/rfc9700)（OAuth 2.0 Security BCP）が sender-constrained refresh token を論じている
- OAuth 2.0 for Browser-Based Applications draft が BFF / Token-Mediating Backend / Browser-based OAuth Client の 3 モデルを定義
- mTLS（RFC 8705）との比較:
  > Unlike transport-layer token binding (e.g., mTLS/RFC 8705) which often breaks or terminates at modern cloud proxies and load balancers, DPoP operates at the HTTP header level.

---

## 15. ライブラリ（`jose`）

**判定: 実測。PRD §5 の「執筆時点の対応状況を確認して固定する」。**

```sh
curl -s https://registry.npmjs.org/jose | python3 -c "
import json,sys
d=json.load(sys.stdin); lt=d['dist-tags']['latest']; v=d['versions'][lt]
print('latest:', lt, 'published:', d['time'][lt][:10])
print('deps:', v.get('dependencies') or 'なし')
print('unpackedSize:', v['dist'].get('unpackedSize'), 'files:', v['dist'].get('fileCount'))"
```

| | version | published | dependencies | unpackedSize | files |
| --- | --- | --- | --- | ---: | ---: |
| `jose` | **6.2.12** | 2026-09-05 | **なし** | 210,660 | 80 |
| `openid-client` | 6.8.8 | 2026-09-05 | `jose` `oauth4webapi` | 221,768 | 9 |

- `jose@6.2.12` で **非 extractable な `CryptoKey` のまま `SignJWT().sign()` が通る**（実測、下記）
- Node v24.22.0 で `exportJWK` / `importJWK` / `calculateJwkThumbprint` 全て動作
- → **PRD §5 の候補 `jose` を採用して問題ない。依存ゼロなのも記事で書ける**
- `openid-client` は discovery 前提なので、#7（Google が DPoP を広告していない）と噛み合わない可能性がある。未検証

---

## 16. ⚠️ 日本語の実装記事は見つからなかった

**判定: 探索の限界。「無い」とは言い切らない。**

2 回検索したが、Zenn / Qiita / はてな に Google OAuth の DPoP 実装記事は見つからなかった。
英語圏も [daily.dev](https://daily.dev/posts/announcing-dpop-support-for-google-oauth-securing-refresh-tokens-az3pwwa6i) /
[welcome.ai](https://www.welcome.ai/content/google-integrates-dpop-support-to-secure-refresh-tokens-against-cyber-threats) /
[it-boltwise.de](https://www.it-boltwise.de/google-oauth-dpop-bindet-refresh-tokens-gegen-infostealer-angriffe.html) など、
**blog をそのまま要約したアグリゲータ記事ばかり**で、実装も検証もしていない。

- 参考になる日本語資料: [RFC 9449 日本語訳](https://tex2e.github.io/rfc-translater/html/rfc9449.html)（tex2e）— 二次だが RFC の対訳として使える

→ **検証した記事を出す価値は高い。** 特に #8 / #9（公式サンプルの不備）と #10（ドキュメント矛盾）は
今のところどこも書いていない。

---

## 17. Google は DPoP proof より先に grant を検証する

**判定: 実測。認可なしで取れた唯一の実挙動。**

存在しない Refresh Token（= grant は確実に不正）を送りつつ、**proof の方だけを 8 通りに壊して**
投げ分けた。proof が先に検証されるなら `invalid_dpop_proof` か `use_dpop_nonce` が返るはず。

実行日時 2026-10-19T12:17:41Z / `sandbox/src/probe.ts`

| 検証項目 | HTTP | error | `DPoP-Nonce` |
| --- | ---: | --- | --- |
| proof なし | 400 | `invalid_grant` | 返らない |
| 正しい proof（nonce なし） | 400 | `invalid_grant` | 返らない |
| **DER 署名の proof**（公式サンプルと同じ壊れ方） | 400 | `invalid_grant` | 返らない |
| `htu` が別 URL | 400 | `invalid_grant` | 返らない |
| `iat` が 1 時間前 | 400 | `invalid_grant` | 返らない |
| `typ` が `dpop+jwt` でない | 400 | `invalid_grant` | 返らない |
| `jwk` を付けない | 400 | `invalid_grant` | 返らない |
| proof が JWT ですらない（`not-a-jwt`） | 400 | `invalid_grant` | 返らない |

認可コード交換（`grant_type=authorization_code`）でも同じだった。

| 検証項目 | HTTP | error | `DPoP-Nonce` |
| --- | ---: | --- | --- |
| proof なし | 400 | `invalid_grant` | 返らない |
| 正しい proof | 400 | `invalid_grant` | 返らない |
| `jti` が乱数（Google 規則違反） | 400 | `invalid_grant` | 返らない |

**→ grant が不正な時点で打ち切られ、proof は一切見られていない。**
`error_description` も全部 `"Bad Request"` だけで、詳細は出ない。

### ここから分かること

1. **有効な Refresh Token を持っていないと、DPoP の挙動は何も調べられない。**
   PRD §8 の受け入れ条件が実機必須なのはこのため。回避路は無い
2. 🔥 **デバッグ時に proof のバグが `invalid_grant` に隠れる。**
   Refresh Token が期限切れ・revoke 済みだと、proof がどれだけ壊れていても `invalid_grant` しか返らない。
   「proof を直したのに直らない」の原因がここにある可能性がある
3. **不正なリクエストで Nonce だけ先に貰うことはできない。**
   `DPoP-Nonce` ヘッダーは grant が通った後にしか出てこない
4. PRD §6.4 の「`invalid_grant` など通常の OAuth エラーを DPoP エラーと混同しない」は、
   実際には**逆向きに**効く。混同するのではなく、**DPoP エラーが `invalid_grant` に覆い隠される**

### 記事に使える切り口

- 実装の順序として「まず DPoP なしで Refresh が通ることを確認してから DPoP を足す」が正解になる。
  **根拠つきで言える。** いきなり DPoP 付きで書き始めると、どちらが壊れているのか切り分けられない
- RFC 9449 はこの検証順序を規定していない（§5 は proof が invalid なら `invalid_dpop_proof` と書くだけ）。
  **どちらを先に見るかは実装依存**で、Google は grant 優先


---

## 18. `iat` の許容は過去に甘く、未来に厳しい

**判定: 実測。Google が公開していない値。**

`iat` をずらした proof を投げて、どこから弾かれるかを測った。

| ずれ | HTTP | error |
| --- | ---: | --- |
| -30s | 200 | — |
| -60s | 200 | — |
| -120s | 200 | — |
| -300s | 200 | — |
| **-600s** | **200** | — |
| **-3600s** | **400** | `invalid_dpop_proof` |
| **+60s（未来）** | **400** | `invalid_dpop_proof` |
| +300s（未来） | 400 | `invalid_dpop_proof` |

二分探索で 1 秒まで詰めた。独立した 2 回の実行で同じ値になった。

| 方向 | 通る最遠 | 弾かれる最近 | 値 |
| --- | ---: | ---: | --- |
| 過去 | **-3599s** | **-3600s** | **ちょうど 3600 秒（1 時間）** |
| 未来 | **+10s** | **+11s** | **ちょうど 10 秒** |

どちらもきれいな丸い数字で、境界が 1 秒単位で一致している。実装上の定数とみてよい。

**→ 過去は 3600 秒、未来は 10 秒。360 倍の非対称。**

この非対称性は理屈が通っている。proof が作られてから届くまでの遅延は当然あるので
過去側は緩める必要があるが、未来の `iat` は**事前生成した proof の作り置き**を意味する。
RFC 9449 §11.2 が "DPoP Proof Pre-generation" として警戒しているのがまさにこれ。

### 記事に使える切り口

- 🔥 **サーバーの時刻がずれていると、詰む方向が決まっている。**
  未来に 15 秒ずれているだけで**全 proof が弾かれる**。過去にずれている分は 1 時間耐える。
  NTP が効いていない環境で「なぜか `invalid_dpop_proof` が出る」の典型的な原因
- この非対称の設計意図は読める。proof が届くまでの遅延は過去側にしか出ないが、
  未来の `iat` は**事前生成した proof の作り置き**を意味する。
  RFC 9449 §11.2 "DPoP Proof Pre-generation" が警戒しているのがまさにそれ

---

## 19. ❌ `htm` / `htu` 不一致は `invalid_dpop_proof` を返さない

**判定: 実測。ドキュメントの記述と違う。**

web-server doc の一文を分解して、`htm` / `htu` / `iat` / 署名の 4 つを試した。

> If the DPoP proof has mismatching `htm` or `htu` claims, an expired `iat`, a re-used `jti`, or an invalid signature, Google returns an `invalid_dpop_proof` error code.

| doc の主張 | 実測の error | 合っているか |
| --- | --- | --- |
| mismatching `htu` → `invalid_dpop_proof` | `invalid_request` | ❌ |
| mismatching `htm` → `invalid_dpop_proof` | `invalid_request` | ❌ |
| expired `iat` → `invalid_dpop_proof` | `invalid_dpop_proof` | ✅ |
| invalid signature → `invalid_dpop_proof` | `invalid_dpop_proof` | ✅ |

**→ 4 つのうち 2 つが実際と違う。**

proof を付けなかった場合も `invalid_request` だった（doc は 400 とだけ書いている）。

エラーの出方を整理するとこうなる。

| 状況 | error |
| --- | --- |
| proof が無い | `invalid_request` |
| `htm` / `htu` が合わない | `invalid_request` |
| 署名が不正（別の鍵） | `invalid_dpop_proof` |
| `iat` が範囲外 | `invalid_dpop_proof` |
| `nonce` が無い / 期限切れ / workflow 跨ぎ | `use_dpop_nonce` |
| grant 自体が不正 | `invalid_grant`（#17。proof より先に判定される） |

**読み方**: `invalid_request` は「proof が proof として成立していない / リクエストと噛み合っていない」、
`invalid_dpop_proof` は「proof として成立しているが、暗号的・時間的に無効」。
この切り分けの方が、doc の記述より一貫している。

### 記事に使える切り口

- **エラーコードで分岐するコードを doc 通りに書くと動かない。**
  `invalid_dpop_proof` だけを見ていると、`htu` のタイポに気づけない
- 実装者向けの表として、上の「状況 → error」を記事に載せる価値がある。
  **公式ドキュメントのどこにも無い表**になる


---

## 計測（自分で取った一次ソース）

スクリプトは `sandbox/measurements/` にある（Google の認証情報なしで走る）。
実トークン交換の example は `sandbox/src/`（`npm start` / `npm run experiments`）。

### 環境

- Node.js v24.22.0 / npm 11.19.1 / `jose` 6.2.12
- Apple M4 (arm64) / macOS 25.5.0
- 計測日 2026-10-19

### A. 公式サンプルの `jti` 再現

```python
import hashlib, base64
code = "4/0AXEQxIDNpLD-qpSIvjHb2Hl10uS_2sk2GBRpO8UJQ78YZF3hZ9LB9kTA1xYLD4xisi4C5w"
print(base64.urlsafe_b64encode(hashlib.sha256(code.encode()).digest()).rstrip(b'=').decode())
# -> o29CN8LIY0l_N8iy5-ilon1guad9NFQHFOdXTzrBNck  （doc の jti と一致）
```

### B. 公式サンプル proof の署名検証

```js
import { jwtVerify, importJWK, decodeProtectedHeader } from 'jose'
const hdr = decodeProtectedHeader(jwt)
const key = await importJWK(hdr.jwk, 'ES256')
await jwtVerify(jwt, key, { clockTolerance: Number.MAX_SAFE_INTEGER })
```

```
[auth-code exchange] sig=64B  SIGNATURE VALID
[token refresh]      sig=70B  SIGNATURE FAILED: ERR_JWS_SIGNATURE_VERIFICATION_FAILED
```

DER 構造の確認:
```
hex head: 3044022039b4f405  →  SEQUENCE(0x30) len=68, INTEGER r[32], INTEGER s[32]
```

### C. Node の非 extractable 鍵

```js
const kp = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'}, false, ['sign','verify'])
await crypto.subtle.exportKey('jwk', kp.privateKey)
// InvalidAccessError: key is not extractable
```

### D. 署名フォーマットと性能

```js
await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'}, priv, data)  // 64 B (P1363)
createSign('SHA256').update(data).sign(keyObject)                    // 71 B (DER)
```

| | µs/op | ops/s | N |
| --- | ---: | ---: | ---: |
| ES256 sign | 26.2 | 38,227 | 20,000 |
| ES256 verify | 50.5 | 19,787 | 20,000 |

### E. discovery doc に DPoP が無いこと

```sh
curl -s https://accounts.google.com/.well-known/openid-configuration | grep -i dpop
# （何も出ない）
```

### E-2. grant と proof の検証順（Google に実際に投げた）

```sh
cd sandbox && npm run probe
```

存在しない Refresh Token + 壊した proof 8 通り → **全部 `invalid_grant`**。
`DPoP-Nonce` は一度も返らなかった。詳細は #17。

### G. 実機でのトークン交換（2026-10-19T12:36:24Z）

```sh
cd sandbox && npm start          # ブラウザで認可
cd sandbox && npm run experiments
```

生の出力: `sandbox/data/results-2026-10-19T12-36-26-691Z.md`

| 検証項目 | HTTP | error |
| --- | ---: | --- |
| 正常系 | 200 | — |
| proof を付けない | 400 | `invalid_request` |
| 別の鍵で署名 | 400 | `invalid_dpop_proof` |
| `htu` を別の URL にする | 400 | `invalid_request` |
| `htm` を GET にする | 400 | `invalid_request` |
| **`jti` を使い回す** | **200** | — |
| `nonce` クレームを入れない | 400 | `use_dpop_nonce` |
| **使用済みの `nonce` を再送** | **200** | — |
| 正常系（最後にもう一度） | 200 | — |

`iat` スキュー: -30 / -60 / -120 / -300 / **-600 は 200**、
**-3600 / +60 / +300 は 400 `invalid_dpop_proof`**。

環境: Node.js v24.22.0 / jose 6.2.12 / hono 4.13.13

### F. ドキュメント改版の追跡（Wayback）

```sh
curl -s "http://web.archive.org/cdx/search/cdx?url=developers.google.com/identity/protocols/oauth2/resources/best-practices&fl=timestamp,statuscode&collapse=timestamp:6&limit=30"

# 各スナップショットを取って DPoP の出現数を数える（gzip されているので注意）
curl -s --compressed "https://web.archive.org/web/${ts}id_/https://developers.google.com/identity/protocols/oauth2/resources/best-practices"
```

| snapshot | Last updated | `dpop` 出現数 |
| --- | --- | ---: |
| 20260510064412 | 2026-04-15 | **0** |
| 20260619045816 | 2026-05-20 | 14 |
| 20260710111344 | 2026-05-20 | 14 |
| 20260803231334 | 2026-05-20 | 16 |
| 20260915101121 | 2026-05-20 | 16 |

### G. 公式 SKILL.md の commit 履歴

```sh
curl -s "https://api.github.com/repos/google/skills/commits?path=skills/identity/dpop-adoption/SKILL.md&per_page=20"
```

```
2026-09-21 becc4b8 Enforce semantic versioning (MAJOR.MINOR.PATCH) for skills.
2026-09-04 a83a895 Add official DPoP Adoption Skill (RFC 9449) under skills/identity/dpop-adoption/
```

`google/skills` リポジトリ: created 2026-03-31 / 21,411 stars / last push 2026-10-16。
DPoP ディレクトリの中身は `SKILL.md` 1 ファイルのみ（11,264 bytes）。

---

## 未確認・積み残し

### 実機検証（PRD §8 の受け入れ条件）

2026-10-19 に実施済み。生の出力は `sandbox/data/results-2026-10-19T12-36-26-691Z.md`。

- [x] DPoP 付き認可コード交換の成功と `DPoP-Nonce` の受領
- [x] 正しい鍵・Nonce での Refresh 成功（200）
- [x] **#10 の決着**: 持ち越した nonce は 400 `use_dpop_nonce` で拒否された
- [x] DPoP proof を省略した Refresh が拒否されること（`invalid_request`）
- [x] 別の鍵で署名した proof が拒否されること（`invalid_dpop_proof`）
- [x] `htm` / `htu` / `iat` を壊したときのエラー（#19）
- [x] `iat` の許容スキューの概算（#18）
- [x] 一連の失敗で Refresh Token が無効化されないこと（最後の正常系が 200）

まだ埋まっていないもの:

- [ ] **DPoP なしの通常フローとの差**（DPoP なしで認可した場合の比較。未実施）

### 仕様として確認できなかったこと

- [x] ~~**`iat` の許容スキュー**~~ → #18 で確定（過去ちょうど 3600s / 未来ちょうど 10s）
- [ ] **RSA が本当に通るか。** Adoption Guide は "A RSA keypair is also possible but not recommended due to
      higher computational costs" と書くが、**具体的な alg 名（RS256 / PS256）が無い。**
      #7 の通り discovery にも出ていないので、投げて試すしかない
- [ ] **`ath` クレームの扱い。** SKILL.md は `calculateATH` を必須 export にしているが、
      Google の Access Token は Bearer なので使い道が無いはず。送ったら無視されるのか拒否されるのか不明
- [ ] **Confidential Client にも本当に RT がバインドされるのか。** #6 の通り RFC は否定的だが、
      Google のサンプルは `client_secret` 付き。public / confidential で挙動が違う可能性
- [ ] 成功レスポンスに出てくる謎の `"challenge"` フィールド（Adoption Guide のサンプルにあるが、
      本文では一切説明されていない。値は `DPoP-Nonce` と同じ）
- [ ] `openid-client` / `oauth4webapi` が Google + DPoP で使えるか（discovery が #7 で効かない懸念）

## 探したが取れなかったもの

- **DPoP Adoption Guide ページの初出日** — Wayback に**スナップショットが 1 つも無い**
  （`http://archive.org/wayback/available` も CDX も空）。
  Best Practices 経由で「2026-05-20 までには対応が入っていた」と言うのが限界
- **日本語の実装・検証記事** — 2 回検索して 0 件（#16）
- **開発者コミュニティの反応** — HN / Reddit / X の議論は見つからず。
  アグリゲータの要約記事のみ。「反応が無い」こと自体は断定しない（探し方が足りない可能性）
- **`DPoP-Nonce` の仕様詳細**（有効期限、発行ポリシー）— RFC 9449 §8 は実装依存とし、Google も非公開

## 記事に持ち込まない注意

- 「DER → P1363 に変換しても検証が通らなかった」（#8 後半）は **references.md 限り。**
  article.md には「70 byte の DER だった」という**確認できた事実だけ**を書く
- 「Wayback のスナップショットが gzip で tr が落ちた」などの取得過程も書かない
- PRD §10 の表現ルールを守る: 「DPoP ならトークン漏えいを防げる」と断定せず、
  **「盗まれた Refresh Token 単体の再利用を困難にする」**。#11 で鍵を DB に置く選択をした以上、
  この区別は記事の誠実さに直結する

## 一次ソース一覧

| 資料 | 種別 | 最終更新 |
| --- | --- | --- |
| [Announcing DPoP Support for Google OAuth](https://developers.googleblog.com/announcing-dpop-support-for-google-oauth-securing-refresh-tokens/) | 公式 blog | 2026-10-15 |
| [DPoP Adoption Guide](https://developers.google.com/identity/protocols/oauth2/resources/dpop-adoption) | 公式 doc | 2026-07-31 |
| [Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server) | 公式 doc | 2026-10-16 |
| [OAuth 2.0 Best Practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices) | 公式 doc | 2026-05-20 |
| [google/skills — dpop-adoption/SKILL.md](https://github.com/google/skills/blob/main/skills/identity/dpop-adoption/SKILL.md) | 公式 skill | commit 2026-09-04 |
| [RFC 9449 — DPoP](https://www.rfc-editor.org/rfc/rfc9449.html) | 標準 | 2023-09 |
| [RFC 9700 — OAuth 2.0 Security BCP](https://datatracker.ietf.org/doc/html/rfc9700) | 標準 | — |
| [accounts.google.com discovery doc](https://accounts.google.com/.well-known/openid-configuration) | 機械可読 | 2026-10-19 取得 |
| [registry.npmjs.org/jose](https://registry.npmjs.org/jose) | レジストリ | 2026-10-19 取得 |
