---
title: MCPのStep-up Authorizationは、OAuthのIncremental Authorizationと何が違うのか？
description: 〜 違いは「誰が気づいて、誰が覚えているか」でした 〜
author: 田中博悠 / tanahiro2010
date: 2026-10-20
slug: cloudflare-mcp-stepup-auth
published: true
---

::title::

# MCPのStep-up Authorization は

# OAuthのIncremental Authorization と何が違うのか？

田中博悠 / tanahiro2010

::note::

よろしくお願いします。タイトルが長いので一回で読めませんでした。

全 158 枚・想定 18〜22 分。1枚1メッセージなので、流す枚数が多いぶん手は止めない。

**LT 枠（5分）なら「歴史」「refresh」「おまけ」の3章を落とす** → 約 95 枚。
さらに削るなら「403」の章をチャレンジ1枚に圧縮する。

**絶対に落とさないのは「ゾーン」の章。** 今日いちばん持ち帰ってほしいのはそこ。

---

## 田中博悠 / tanahiro2010

- 三田学園高等学校 1年
- GDG Greater Kwansai
- 個人開発で Google OAuth を使ってる
- MCPサーバーも書く

::right::

![tanahiro2010](./images/tanahiro.jpg)

::note::

個人開発で Google OAuth を使っていて、しかも MCP サーバーを書く側にも回ります。

つまり今日の話、**両方の当事者**です。

**15 秒で切る。**

---

::center size=1.5 bg=white::

発端

---

::center::

2026年10月19日

---

::center::

Cloudflare API MCP Server が

**Step-up Authorization に対応**

-# Cloudflare Changelog

---

::center::

最小の権限で繋いで

---

::center::

足りなくなったら、足せる

::note::

便利そうですよね。

最小権限でAIエージェントを繋げられる。で、ツールが権限を要求したらその時に足す。

---

::center::

で、読んでて思ったんですけど

---

::center size=1.5 bg=white::

問い

---

::center::

`include_granted_scopes=true`

-# Google OAuth

---

::center::

これ、昔からありますよね

::note::

Google OAuth の Incremental Authorization。

「必要になったタイミングで、必要なScopeだけ追加で要求する」

僕が個人開発で使っているやつです。

---

::center size=2::

**何が違うんだ？**

::note::

ここで一拍おく。

これが今日の問いです。

---

::center::

仕様を読んで

---

::center::

自分でクライアントを書いて

---

::center size=2::

**128回 叩きました**

-# HTTP往復・全部ログに残してあります

---

::center size=1.5 bg=white::

前提

---

::center::

Cloudflare の MCP サーバーは

---

::center::

`scopes_supported` を 2 箇所で公開している

---

## 名前は同じ、意味は別

| | RFC | 意味 |
|---|---|---|
| Protected Resource | 9728 | 最低限いるもの |
| Authorization Server | 8414 | 発行しうる全部 |

---

::center::

数えてみました

---

::center size=3::

**2 : 384**

::note::

リソース側が2個。`user:read` と `account:read` だけ。

認可サーバーのカタログが **384個**。

ここで一拍。

---

## 認証なしで叩くと

```console
HTTP/2 401
www-authenticate: Bearer realm="OAuth",
  resource_metadata="...",
!!   scope="user:read account:read"
```

---

::center::

2個で始められる

---

::center size=2::

**足りなくなったら足せる前提があるときだけ**

::note::

これが今日の機能の存在理由です。

384個から初回に渡す分を選ぶしかないなら、少なく選べば動かないし、多く選べば配りすぎる。

---

::center size=1.5 bg=white::

仕様

---

::center::

発火点は

---

::center size=2::

`403 insufficient_scope`

---

## チャレンジ

```console
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer
!!   error="insufficient_scope",
  scope="files:write",
  resource_metadata="..."
```

---

::center::

このエラーコード

---

::center size=2::

**MCPの発明じゃない**

---

::center size=1.5::

RFC 6750 §3.1

**2012年**

-# OAuth Bearer Token Usage

::note::

12年前から居るやつです。

MCPが新しく決めたのは、エラーコードじゃない。

---

::center::

MCPが足したのは

---

::center size=1.5::

**そこから再認可に繋ぐ手順**

---

## Step-Up Authorization Flow

1. `WWW-Authenticate` を読む
2. **前回の Scope ∪ チャレンジの Scope**
3. 再認可する
4. 元のリクエストを再試行

-# 3 は普通の OAuth 認可コードフロー

---

::center::

ここまでで、違いが3つ見えます

---

## Google と MCP

| | Google | MCP |
|---|---|---|
| 気づくのは | アプリ | **サーバー** |
| 伝える手段 | 不要 | **`WWW-Authenticate`** |
| 覚えてるのは | 認可サーバー | **クライアント** |
| 再認可 | 認可コードフロー | **同じ** |

::note::

**表は読み上げない。** 3行目だけ指す。

---

::center::

3行目

---

::center size=2::

**これ、読んだだけじゃ決まらない**

::note::

Changelog にはこう書いてあります。

"Scopes you already granted are kept."

**主語がない。**

クライアントが和集合を作った結果そう見えるのか、認可サーバーが覚えてるのか。両方読めます。

ここを実機で決めます。

---

::center size=1.5 bg=white::

歴史

---

::center::

その前に、ひとつ

---

::center size=2::

**新機能じゃなかった**

---

## Step-Up の節が入った版

| 仕様 | |
|---|---|
| 2025-06-18 以前 | 記述なし |
| **2025-11-25** | **登場** |
| 2026-07-28 | 現行 |

-# Cloudflare がリンクしてるのは 2026-07-28

---

::center::

じゃあ 2026-07-28 で何が変わった？

---

## 和集合を作るのは

| 仕様 | 誰が |
|---|---|
| 2025-11-25 | **サーバー** |
| 2026-07-28 | **クライアント** |

---

::center size=2::

**責務がひっくり返った**

-# SEP-2350 / 2026-03-28 merged

---

::center::

なぜ？

---

## Issue #2349

> This **contradicts the RFC**,
> creates an **impossible requirement
> for stateless servers**,
> and leads to **infinite
> re-authorization loops** in practice.

---

::center::

無限ループ

---

## #1582 の再現手順

- `initialize` は `init` が要る
- `tools/list` は `mcp:tools:read` が要る

---

::center::

403 が「その操作に必要なScope」だけ返す

---

::center::

クライアントが `_scope` を**上書き**する

---

## そして

```text
tools/list → 403 → init を失う
initialize → 403 → tools:read を失う
tools/list → 403 → init を失う
       ⋮
```

::note::

永久に往復します。

和集合は「お作法」じゃなくて**事故対策**だった。

---

::center size=1.5 bg=white::

検証

---

::center::

公式SDKを使いませんでした

---

## `@modelcontextprotocol/client`

```ts
function computeScopeUnion(...scopes) {
  const seen = new Set()
  for (const scope of scopes) {
!!     for (const t of scope.split(/\s+/)) seen.add(t)
  }
  return [...seen].join(' ')
}
```

-# 403 を見たら自動で和集合にする

---

::center::

正しい実装です

---

::center::

でも、これだと

---

::center size=2::

**和集合を作らない再認可**

が投げられない

::note::

「誰が覚えてるのか」を切り分ける対照が作れない。

なので手で書きました。

---

## 自前の最小クライアント

- OAuth を手で踏む（DCR / PKCE）
- 通信層は**例外を投げない**
- 全送信を 1 行 JSON で記録

-# 400 も 403 も観測結果なので

---

## 秘密は指紋にする

```json
"access_token": {
  "_redacted_len": 82,
!!   "_sha256_16": "184d68d85f68caab"
}
```

::note::

`<redacted>` で潰すと「同じトークンを投げた」も「毎回別物だった」も示せなくなる。

指紋なら両方示せます。

---

::center::

まず最小Scopeで繋いで

---

::center::

**普通に動くことを確認してから**

403 を踏みに行く

::note::

これ大事で、順番を逆にすると、403が出なかったときに

「権限が足りてた」のか「そもそも届いてない」のかが切り分けられません。

---

::center size=1.5 bg=white::

403

---

::center::

踏めました

---

## チャレンジ全文

```console
HTTP/2 403
WWW-Authenticate: Bearer realm="OAuth",
  error="insufficient_scope",
!!   scope="user:read account:read workers-r2.read",
  error_description="This operation needs
    the workers-r2.read scope"
```

---

::center::

`scope` に注目

---

::center size=2::

**baseline が入ってる**

---

## ここ、割れてました

| | 403 の scope に何を入れる |
|---|---|
| MCP 仕様 | 必要なものだけでいい |
| Cloudflare docs | **baseline込みで全部** |
| **実機** | **後者** |

---

::center size=1.5 bg=white::

本題

---

::center size=2::

**誰が覚えているのか**

---

::center::

`d1.read` だけ要求してみる

-# 持ってた3つは、あえて落とす

---

## 実験 D-1

```text
要求 : d1.read
```

---

![consent](./images/consent-d1-only.png)

---

## 付与された

```text
要求 : d1.read
!! 付与 : d1.read user:read offline_access account:read
```

---

::center size=2::

**残ってる**

---

::center::

認可サーバーが保持してる

---

::center::

…と書きかけました

::note::

ここで一拍。

---

::center size=1.5 bg=red::

敗因

---

::center size=2::

**対照が無い**

---

## 残った理由、3つ考えられる

1. 認可サーバーが保持している
2. **DCRの登録scopeに入れた**（自分のミス）
3. baseline を既定で出してるだけ

-# 2 は自分で混ぜ込んだ交絡

---

::center::

過去の付与ゼロのクライアントを作って

---

::center::

同じ画面を出してみる

---

![control](./images/consent-control.png)

---

::center size=2::

**完全に同じ**

::note::

過去に一度も認可していないクライアントでも Account Read が出る。

つまり 3 で説明がつく。

---

::center size=1.5::

判定を取り下げました

---

::center::

測り直し

---

::center::

**baseline じゃない** `d1.read` を持った状態で

`workers-r2.read` だけ要求する

-# これなら既定値では説明がつかない

---

![r2 only](./images/consent-r2-only.png)

---

::center size=2::

**`D1 Read` が無い**

-# 直前に付与したばかりなのに

---

## 付与された

```text
要求 : workers-r2.read
!! 付与 : workers-r2.read user:read offline_access account:read
```

---

::center::

`d1.read` が消えた

---

::center::

文字列だけじゃ足りないので

---

::center::

**実際に叩いてみる**

---

::center size=2::

D1一覧 → **403**

-# 能力ごと失われている

---

::center size=1.5 bg=white::

わかったこと

---

::center size=1.5::

Cloudflare の認可サーバーは

**過去の付与を引き継がない**

---

::center::

"Scopes you already granted are kept"

が成立するのは

---

::center size=2::

**クライアントが和集合を作ってるから**

::note::

Google は認可サーバー側で合成します。`include_granted_scopes=true` の一行で。

MCP はクライアント側。**構造が逆**。

これが問いへの答えです。

---

::center size=1.5 bg=white::

ところが

---

::center::

チャレンジの中身を、よく見ると

---

## トークンを変えて3回観測

| 持ってたScope | チャレンジの scope |
|---|---|
| baseline | `… workers-r2.read` |
| baseline + r2 | `… workers-r2.read` **`d1.read`** |
| baseline + r2 | `… workers-r2.read` **`kv…read`** |

::note::

**表は読み上げない。** 太字の増えてる部分だけ指す。

---

::center::

baseline 固定じゃない

---

::center size=2::

**トークンの中身に追随してる**

---

## つまり

```text
challenge.scope =
    トークンの付与Scope
  ∪ その操作に必要なScope
```

---

::center::

これ、どこかで見ました

---

::center size=2::

**2025-11-25 のやり方**

-# 2026-07-28 が削除した方

::note::

Issue #2349 が「ステートレスなサーバーには実装不可能」と言った、あのやり方です。

Cloudflare は認可サーバーとリソースサーバーが状態を共有してるので、やれてしまう。

---

::center::

効果があります

---

## `sdk@1.32.1` の403ハンドラ

```ts
if (error === 'insufficient_scope') {
  if (scope) {
!!     this._scope = scope   // 上書き
  }
```

-# さっきのループ条件そのもの

---

::center size=2::

**それでも落ちない**

---

::center::

サーバーが肩代わりしてるから

---

::center size=1.5 bg=white::

ゾーン

---

::center::

総当たりしてて、気づいたんですけど

---

::center::

403 が返らない操作がある

---

## 権限が無いのに

```text
GET /zones
!! → 200  result: []
```

---

::center::

0件？

---

::center::

本当に無いのか

権限で消えてるのか

---

::center size=2::

**区別できない**

---

::center::

`zone.read` を付けて、もう一回

---

## 同じ呼び出し

| | Scope無し | 付与後 |
|---|---:|---:|
| ゾーン一覧 | 0件 | **3件** |
| Workers一覧 | 0件 | **12件** |

---

::center size=3::

**あった**

::note::

ここで一拍。

アカウントには実在していました。権限が無いあいだ、空で返ってただけ。

---

::center::

403 が返らないので

---

::center::

クライアントは「足りない」を知らない

---

::center::

ユーザーに聞きにいく機会も、発生しない

---

::center size=2::

**AIは「ゾーンはありません」と答える**

::note::

ここが今日いちばん持ち帰ってほしいところです。

人間なら「自分の権限では見えないのかも」と察します。AIは察しません。

---

## 同じサーバーに3通り

| 操作 | 権限が無いと |
|---|---|
| R2 / KV / D1 | **403 + チャレンジ** |
| zones / workers | **200 + 空配列** |
| `/user/tokens` | 文字列で403 |

-# step-up できるのは1行目だけ

---

::center size=1.5 bg=white::

refresh

---

::center::

追加認可って、必ずブラウザに戻りますよね

---

::center::

なんで refresh じゃダメなの？

---

::center size=1.5::

RFC 6749 §6

**広げられない**

---

## 投げてみた

| 要求 | HTTP | 付与 |
|---|---|---|
| 省略（対照） | 200 | 元のまま |
| **広げる** | 200 | **元のまま** |
| **狭める** | 200 | **元のまま** |

---

::center::

広げられないのは仕様どおり

---

::center::

でも、狭めるのも無視される

---

::center size=2::

**docs には「狭められる」と書いてある**

-# workers-oauth-provider

---

## ライブラリのソース

```ts
private downscope(requested, allowed) {
  if (!requested) return allowed
!!   return requested.filter(s => allowed.includes(s))
}
```

---

::center::

ライブラリは正しい

---

::center size=2::

**違うのは hosted の方**

::note::

チャレンジのヘッダー形式は OSS 版と一致するのに、refresh の処理とトークン検証は別物でした。

同じ名前でも、OSS版とhosted版を同一視しない方がいい。

---

::center size=1.5 bg=white::

まとめ

---

## 違いは3つ

1. **気づくのが誰か** → サーバー
2. **伝える手段があるか** → `WWW-Authenticate`
3. **覚えてるのが誰か** → クライアント

-# 再認可そのものは同じOAuth

---

::center::

Step-up は OAuth の代替じゃない

---

::center size=2::

**OAuth への入口**

---

::center::

なんでMCPだけこの形？

---

::center::

従来のWebアプリ

**開発者が**どのScopeが要るか知ってる

---

::center::

MCP

**AIが**ツールを選ぶ

-# `execute()` は呼ぶまで分からない

---

::center::

クライアントには事前に判断できない

---

::center size=2::

**だから「気づく」をサーバーに移した**

---

::center::

そのための経路が、Step-up

---

::center size=1.5 bg=white::

そして

---

::center::

経路は、まだ全部つながってない

---

::center size=2::

**黙って空を返さない**

::note::

MCPサーバーを書く側として持ち帰ったのはこの一点です。

403とチャレンジを返せば、クライアントがユーザーに聞きにいける。

経路は仕様が用意してくれている。つながってない操作を作るかどうかは、書く側の判断です。

---

::center size=1.5 bg=white::

おまけ

---

::center::

対照に投げたデタラメな文字列が

---

::center size=2::

**403 insufficient_scope**

-# 一度も発行されてないのに

---

## 境界を二分探索した

```text
39文字 → 401 invalid_token
!! 40文字 → 403 insufficient_scope
```

-# `[A-Za-z0-9_-]` のとき

---

::center::

丸い数字が出たら実装定数

---

::center::

失効したトークンでも起きる？

---

## 潰しました

| | |
|---|---|
| revoke 済み | 401 ✅ |
| 別リソースのトークン | 401 ✅ |
| 壊れた文字列 | 401 ✅ |

---

::center size=2::

**全部ハズレ**

-# 実クライアントの状態からは到達しない

::note::

期待してたんですけどね。

意図的に文字列を作らないと起きません。実害なしです。

---

::title::

# ありがとうございました

田中博悠 / tanahiro2010

https://blog.tanahiro2010.com

::note::

ありがとうございました。

記事に全部の数字と生ログの話を書いています。検証コードも置いてあります。
