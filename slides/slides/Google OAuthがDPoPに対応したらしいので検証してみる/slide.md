---
title: Google OAuthがDPoPに対応したらしいので検証してみる
description: 〜 壊れていたのは、ドキュメントの方でした 〜
author: 田中博悠 / tanahiro2010
date: 2026-10-19
slug: google-oauth-dpop
published: true
---

::title::

# Google OAuthがDPoPに対応したらしいので検証してみる

〜 壊れていたのは、ドキュメントの方でした 〜

田中博悠 / tanahiro2010

::note::

「Google OAuthがDPoPに対応したらしいので検証してみる」、田中博悠です。よろしくお願いします。

全 90 枚・想定 15〜20 分。**LT 枠（5分）なら「差分①」「差分③」の章を落とす** → 約 50 枚。

---

## 田中博悠 / tanahiro2010

- 三田学園高等学校 1年
- GDG Greater Kwansai
- 個人開発で Google OAuth を使ってる

# Refresh Token、DBに入れてます

::note::

高校1年です。個人開発で Google OAuth を使っていて、**Refresh Token を自分のDBに保存している側**の人間です。

だから今日の話は他人事じゃない、という立場で聞いてください。

**15 秒で切る。**

---

::center::

2026年10月15日

---

::center::

Google が「DPoPに対応した」と発表した

-# Google Developers Blog

---

::center size=2::

**Refresh Token を鍵に縛れる**

::note::

盗まれても、鍵がなければ使えない。便利そうですよね。

やってみるか、と思ったわけです。

---

::center::

やってみるか

---

::center size=1.5 bg=white::

問い

---

::center::

あなたのDBにある Refresh Token

---

::center size=2::

**今漏れたら、どうなりますか**

::note::

ここで一拍おく。客席を見る。

Refresh Token は長期間有効で、しかもDBに平文で入っていることが多い。漏れたら終わりです。

DPoP はそこに効く、はずでした。

---

::center size=1.5 bg=white::

前提

---

## DPoP とは

- **D**emonstrating **P**roof-of-**P**ossession
- 鍵ペアを作って、秘密鍵を自分だけが持つ
- リクエストごとに署名した JWT を添える
- サーバーはトークンを**公開鍵に紐づけて**発行する

---

::center::

トークンだけ盗まれても、鍵がなければ使えない

---

::center size=2 bg=blue::

**RFC 9449**

---

::center::

2023年9月に標準化済み

-# Okta も FusionAuth もとっくに対応している

::note::

ここ大事です。**DPoP は新しい技術ではありません。**

新しいのは「Google が対応したこと」だけ。記事やスライドで「新技術DPoP」と書くと間違いです。

---

::center::

新しいのは **Google が対応したこと** だけ

---

## 今日やったこと

- 公式ドキュメント
- RFC 9449
- 自分の計測
- 実際のトークン交換

::right::

```text
Node.js  v24.22.0
jose     6.2.12
hono     4.13.13
Apple M4 (arm64)
```

::note::

この4方向から突き合わせました。専用のテストクライアントとテストアカウントで、本番ユーザーには触っていません。

---

::center size=1.5 bg=white::

結論

---

::center size=2::

**実装は、ちゃんと動く**

---

::center size=2::

**壊れていたのは ドキュメントの方**

::note::

ここが今日の主張です。先に言っておきます。

Google の DPoP 実装そのものはおかしくない。設計判断にも理由がある。

それでも詰まる。詰まる原因が**全部ドキュメントとの差分**だった、という話をします。

---

::center::

詰まったところは、1つ残らず

---

::center size=2::

**ドキュメントとの差分**

---

## 差分は3種類

1. **RFC と違う**（仕様。書いてある）
2. **書いてあることと、実際が違う**
3. **そもそも書いていない**

::note::

この3分類で今日は進みます。**2 が本題**です。

巻くなら 1 と 3 を落として 2 だけやる。

---

::center size=1.5 bg=white::

発端

---

::center::

まず「いつ対応したのか」から違った

---

## Wayback Machine で追った

| 日付 | |
|---|---|
| 2026-04-15 | DPoP の記述 **ゼロ** |
| **2026-05-20** | ドキュメントに**登場** |
| 2026-09-04 | 公式 SKILL.md が commit |
| **2026-10-15** | ブログで**発表** |

::note::

Best Practices のページを Wayback Machine で遡りました。

4月15日版には DPoP の「D」も無い。5月20日版で突然セクションが生えている。

発表はその **5ヶ月後**。

---

::center size=2::

**5ヶ月**

---

::center::

公式ブログの日付 ≠ リリース日

-# 隠していた、という話ではない

---

::center::

そしてこれは、序の口でした

---

::center size=1.5 bg=white::

差分①

---

::center::

RFC と違う

-# ただし、ちゃんと書いてある

---

## Access Token は Bearer のまま

- RFC 9449 §5: `token_type` は `DPoP` が **MUST**
- Google: **常に `Bearer`**

---

::center::

バインドされるのは Refresh Token だけ

::note::

これ RFC 違反じゃないです。RFC 側に逃げ道があって、「Refresh Token だけ縛る」構成が明示的に許されている。

理由はブログによると**性能**。高QPSのAPIで毎回署名検証したくない、と。

本当か？測りました。

---

## ES256、本当に重いのか

| | µs/op | ops/s |
|---|---:|---:|
| sign | 26.2 | 38,227 |
| verify | **50.5** | 19,787 |

-# Node v24.22.0 / Apple M4 / N=20,000

::note::

検証は署名の約2倍。1コアあたり毎秒2万回。

**自分のアプリなら誤差。Gmail や Drive の規模なら効く。**

Google の言い分は妥当だと思います。ここは納得した。

---

::center::

自分のアプリなら誤差

---

::center::

Gmail の規模なら、効く

---

## `jti` が乱数じゃない

- RFC: 96bit以上の**擬似乱数** or UUIDv4
- Google（認可コード交換）:

```text
jti = BASE64URL(SHA-256(authorization_code))
```

::note::

決定的な値です。RFC は「乱数にしろ」と書いているのに。

公式サンプルの code と jti で、実際に計算して確かめました。

---

::center size=2::

**一致した**

-# サンプルの数値は本物だった

---

::center::

Refresh のときは、普通に乱数

---

::center size=2::

**同じ `jti` が フローで別ルール**

::note::

ここ、片方だけ実装すると必ず詰まります。

なぜこうなってるか。RFC が用意した `dpop_jkt` というパラメータを Google は使っていない。代わりに手持ちの `jti` で代替している。

認可コードは1回しか使えないので、決定的でも実質一意。目的は達成できてます。

---

::center size=1.5 bg=white::

差分②

---

::center::

書いてあることと、実際が違う

---

::center size=2 bg=red::

**ここからが本題**

---

::center::

公式サンプルを、そのまま使うつもりでした

---

::center::

念のため、署名だけ検証した

---

## 結果

| サンプル | 署名長 | |
|---|---:|---|
| 認可コード交換 | 64 B | VALID |
| **Token Refresh** | **70 B** | **FAILED** |

::note::

ここで止まりました。

公式が配っているサンプルの proof が、署名検証を通らない。

---

::center size=2::

**公式サンプルが 壊れている**

---

## 70バイトの中身

```text
30 44 02 20 ...
ASN.1 DER SEQUENCE
  r: INTEGER len=32
  s: INTEGER len=32
```

---

::center::

JWS が要求するのは raw `R‖S` の **64バイト**

---

::center::

DER のまま貼られていた

---

::center size=2 bg=orange::

**Google 自身が「やるな」と書いている**

::note::

web-server doc にこう書いてあります。

「JWS は raw R|S 形式（P-256 なら64バイト）を要求する。OpenSSL を直接使うなら DER から変換しろ」

その注意書きの通りの間違いを、サンプルがやっている。

---

## Node の中でも再現する

```text
crypto.subtle.sign      → 64 bytes (raw)
node:crypto createSign  → 71 bytes (DER)
```

-# サンプルは 70 バイトだった

::note::

**71バイト**です。サンプルは70バイト。

DER の長さは leading zero 次第で 69〜72 に揺れます。だから `length === 70` で判定してはいけない。

---

::center::

もう1つ、サンプルを開いたら

---

## RFC の例文の丸写しだった

```json
"htu": "https://server.example.com/token"
"iat": 1562262616
```

-# 2019-07-04。Google のエンドポイントですらない

::note::

web-server doc の方のサンプルです。

`htu` が `server.example.com`。そのままコピーすると `htu` 不一致で弾かれます。

しかも `jti` が、同じページの3段落上に書いてある自分のルールを破ってる。

---

::center size=1.5 bg=white::

矛盾

---

::center::

公式ドキュメント同士が、逆のことを書いていた

---

## Nonce は持ち越せるのか

- **Adoption Guide**（07-31）
  → workflow をまたぐと「**無条件に400**」
- **web-server doc**（10-16）
  → 「**余分な往復を避けられる**」

::note::

認可コード交換で受け取った Nonce を、初回の Refresh にそのまま使えるか。

古い方は「ダメ」、新しい方は「使える」。完全に逆です。

投げました。

---

::center size=2::

**HTTP 400 `use_dpop_nonce`**

---

::center::

古い方が正しかった

-# 新しい web-server doc が間違っている

---

::center::

初回 Refresh は **必ず2往復**

---

::center size=2::

リトライループは **必須**

-# 最適化じゃない

---

::center size=1.5 bg=white::

嘘

---

## Adoption Guide にこう書いてある

> a nonce value is **used only once**

-# 再利用された nonce は400で弾く、とも

---

::center::

まず「そもそも検証してるのか」を確かめた

---

## 対照

| 送った nonce | |
|---|---|
| でたらめな乱数 | **400** |
| 1文字変えた | **400** |

::note::

ちゃんと検証されています。でたらめは弾かれる。

その上で、**正しい nonce を使い回してみた。**

---

## 同じ nonce を使い回す

```text
1回目   200
2回目   200
3回目   200
4回目   200
5回目   200
30秒後  200
```

---

::center size=2 bg=red::

**6回とも通った**

::note::

"used only once" は、実際の挙動と違います。

検証はされるが、消費はされない。

---

::center::

`jti` も同じだった

---

::center::

同じ `jti` の proof を2回 → **両方200**

-# doc は「invalid_dpop_proof で弾く」と書いている

---

::center size=1.5 bg=white::

つまり

---

::center size=2::

**proof を そのまま使い回せる**

---

## バイト単位で同一の proof

- `jti` も `nonce` も `iat` も署名も同じ
- 投げ直すと **毎回200**
- そのたびに**新しい Access Token**

-# 送った proof の SHA-256 とトークンのハッシュを記録して確認

::note::

同じ proof から毎回違うトークンが出る。キャッシュじゃなく、本当に再発行されています。

じゃあ、いつまで使えるのか。

---

::center::

いつまで使えるのか

---

::center::

1時間、ターミナルを開いたまま待った

-# ここだけは早送りができない

---

## 経過と結果

| 経過 | |
|---|---|
| 0 〜 3300秒 | 200 |
| **3540秒**（59分） | **200** |
| **3660秒**（61分） | **400** |

::note::

59分では通って、61分で落ちた。

しかも落ち方が `invalid_dpop_proof`。`use_dpop_nonce` じゃない。

つまり先に来たのは **iat の窓**です。

---

::center size=2::

**発行から約1時間、再利用できる**

---

## RFC 9449 §11.1

> nonce を複数回使ってよい。
> **ただし `jti` を追跡して重複を弾いている限り**

::note::

RFC はちゃんと条件を書いています。

nonce の使い回しを許していいのは、jti を追跡している場合に限る、と。

---

::center size=2::

Google は **条件の方を 満たしていない**

---

::center size=1.5 bg=white::

差分③

---

::center::

そもそも書いていない

---

## grant が proof より先に検証される

- 存在しない Refresh Token + 壊した proof を8通り
- **全部 `invalid_grant`**
- `DPoP-Nonce` は一度も返らない

::note::

DER署名でも、typ を壊しても、`not-a-jwt` を送っても、全部 `invalid_grant`。

これ、デバッグで刺さります。

---

::center size=2::

**proof のバグが `invalid_grant` に隠れる**

::note::

Refresh Token が期限切れだと、proof がどれだけ壊れていても `invalid_grant` しか返らない。

「proof を直したのに直らない」の原因がこれです。

---

::center::

まず DPoP なしで通してから、DPoP を足す

-# でないと切り分けられない

---

## `iat` の許容範囲

| 方向 | 通る | 弾かれる |
|---|---:|---:|
| 過去 | -3599s | **-3600s** |
| 未来 | +10s | **+11s** |

-# 二分探索で1秒まで。独立2回の実行で一致

::note::

秒数はどこにも公開されていません。実測するしかなかった。

過去3600秒、未来10秒。

---

::center size=2::

**360倍の非対称**

---

::center::

時計が未来に11秒ずれるだけで、全 proof が弾かれる

-# NTP が効いてない環境の「なぜか invalid_dpop_proof」

---

::center size=1.5 bg=white::

報告

---

::center::

これ、報告した方がいいのでは

---

## Google Bug Hunters に出した

- ドキュメントとの食い違い
- RFC の hardening 条件も未達
- 生ログを添付（秘密はハッシュ化）

---

::center size=2 bg=black::

**Won't Fix**

-# Infeasible

::note::

返ってきました。

---

## 言われたこと

- アカウント乗っ取り・権限昇格・認証バイパスが無い
- 報告者自身が「影響は限定的」と認めている
- VRP の基準を越えていない

---

::center::

納得しています

::note::

proof を観測できる立場なら、同じリクエストに入っている refresh_token も client_secret も取れる。

しかも proof 単体では `invalid_grant` で弾かれる（さっきの話）。

**再利用できる窓があっても、攻撃者の能力を増やしていない。**

---

::center::

proof を取れる立場なら、Refresh Token も取れる

---

::center size=2::

**攻撃能力を 増やしていない**

---

::center::

でも、この回答で性質が確定した

---

::center size=2::

**セキュリティバグではなく ドキュメントの問題**

-# Google 自身がそう位置づけた

::note::

これ、今日の主張そのものなんですよね。

一番派手に見えた発見が、報告した結果「これは記述の問題だ」と確定した。

---

::center size=1.5 bg=white::

まとめ

---

## 差分は3種類だった

1. **RFC と違う** — Bearer のまま、`jti` が乱数じゃない
2. **書いてあることと違う** — サンプル壊れ、矛盾、"used only once"
3. **書いていない** — `iat` の窓、検証順

---

::center size=2::

**実装は動く**

---

::center size=2::

**詰まるのは ドキュメントとの差分**

---

## これから実装する人へ

- `jti` は**フローで別ルール**
- 初回 Refresh は**必ず1回落ちる**
- `htm`/`htu` 不一致は `invalid_request`
- `iat` は過去3600秒・**未来10秒**
- Node では `extractable: false` にできない
- **まず DPoP なしで通す**

::note::

ドキュメントを読むだけでは出てこない6点です。

ここだけスクショしてもらえれば今日は十分です。

---

::center::

公式ブログの日付を疑い

---

::center::

公式サンプルを疑い

---

::center::

公式ドキュメント同士を疑った

---

::center size=2::

**だから、自分で検証する**

---

::center size=1.5 bg=white::

おまけ

---

::center::

Google の DPoP、入れるべき？

---

## 守備範囲は見かけより狭い

- Access Token は **Bearer のまま**
- Cookie は**対象外**（DBSC の領域）
- Node では秘密鍵を結局**保存する**ことになる

---

::center::

一番重いのは移行コスト

---

::center size=2::

**全ユーザーに 再同意**

-# 鍵のローテーションも同じ

::note::

既存の Refresh Token を DPoP バインドに切り替えるには、revoke するか `prompt=consent` を付けるしかない。

稼働中のサービスだとこれが一番効きます。

---

::center::

鍵のバックアップ戦略 = Refresh Token のバックアップ戦略

---

::title::

# ありがとうございました

田中博悠 / tanahiro2010

https://blog.tanahiro2010.com

::note::

ありがとうございました。

記事に全部の数字と生ログを載せています。
