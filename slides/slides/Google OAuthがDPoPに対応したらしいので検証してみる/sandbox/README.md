# sandbox — Google OAuth × DPoP の検証

`../draft.md` と `../references.md` の検証用コード。

- `src/` … Hono で実際に Google とトークン交換をする example
- `measurements/` … Google を叩かずに手元で取れる計測（references.md の「計測」に対応）

## セットアップ

```sh
npm install
cp .env.example .env   # client_id / client_secret を書く
```

`.env` と `data/` は `.gitignore` 済み。**client secret と秘密鍵が入るので絶対にコミットしない。**

Google Cloud Console 側の設定：

| 項目 | 値 |
| --- | --- |
| 承認済みの JavaScript 生成元 | `http://localhost:3000` |
| 承認済みのリダイレクト URI | `http://localhost:3000/api/auth/callback/google` |

## ブラウザから通す

```sh
npm start
```

http://localhost:3000 を開いて、上から順に押していく。

1. **認可する** — DPoP 鍵ペアを生成して Google の同意画面へ
2. 戻ってくると、**認可コードを DPoP proof 付きで交換**する
   - `jti` は `base64url(sha256(認可コード))`（Google 独自仕様）
   - レスポンスの `DPoP-Nonce` を保存する
   - `token_type` が `Bearer` であることがここで確認できる
3. **Refresh する** — 保存した Nonce で Refresh Token を使う
   - `use_dpop_nonce` が返ったら、新しい Nonce でちょうど 1 回だけ再送する
   - 何往復かかったかが画面に出る

> 📌 認可した直後の 1 回目の Refresh が、`references.md` の **#10
> （公式ドキュメント同士が矛盾している箇所）** の検証になる。
> 実測では 400 `use_dpop_nonce` が返り、DPoP Adoption Guide の記述が正しかった。

## ファイル構成

```
src/
├── config.ts      設定値と Google 側で固定の URL
├── dpop.ts        鍵ペアと DPoP proof の生成          ← ここが中心
├── google.ts      トークンエンドポイントとの通信
├── store.ts       鍵・Refresh Token・Nonce の保存
├── session.ts     保存した状態から鍵を復元する薄い層
├── server.tsx     Hono アプリ（hono/jsx）
└── views/         画面の部品
```

読む順番は `dpop.ts` → `google.ts` → `server.tsx` がおすすめ。

## 手元だけで取れる計測

Google の認証情報なしで走る。`references.md` の「計測」セクションに対応。

| ファイル | 内容 |
| --- | --- |
| `measurements/check_jti.py` | 公式サンプルの `jti = base64url(sha256(code))` を再現 |
| `measurements/verify-doc-sample.mjs` | 公式サンプル proof の署名検証（Refresh 側が 70B の DER で落ちる） |
| `measurements/measure-node.mjs` | 非 extractable 鍵が export できないこと、署名フォーマット |
| `measurements/measure-perf.mjs` | 鍵の永続化ラウンドトリップ、ES256 の sign/verify ベンチ |

```sh
python3 measurements/check_jti.py
node measurements/verify-doc-sample.mjs
node measurements/measure-node.mjs
node measurements/measure-perf.mjs
```

## 環境

Node.js v24.22.0 / hono 4.13.13 / jose 6.2.12 で確認。
TypeScript + JSX を `tsx` 経由で直接実行している（ビルド不要）。

```sh
npm run typecheck
```
