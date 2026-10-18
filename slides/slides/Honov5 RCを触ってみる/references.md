# references — Hono v5 RC

| | |
| --- | --- |
| 調査日 | 2026-10-18 |
| 対象 | `hono@5.0.0-rc.1` vs `hono@4.13.13` |
| 用途 | slide.md / article.md |

## 確認した主張

| # | 主張 | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | `onError()` / `notFound()` がルーティング可能なミドルウェアに | ✅ | 公式ガイド / PR #5541 / 実測 |
| 2 | `onError()` は上書きではなく合成になった | ✅ | PR #5541 / 実測 |
| 3 | `c.req.json()` が `unknown`、`c.req.query()` が `undefined` 込み | ✅ | 公式ガイド / `tsc` 実測 |
| 4 | `c.json(undefined)` が TypeError | ✅ | 公式ガイド / 実測（500） |
| 5 | ワイルドカードが全 Router で統一 | ✅ | 公式ガイド / 4 Router 総当たり実測 |
| 6 | RegExpRouter 競合 → SmartRouter が TrieRouter にフォールバック | ✅ | 公式ガイド / 実測・再現成功 |
| 7 | アダプタ 8 つが v5 のために切り出された | ✅ | npm registry（初版 2026-09-28） |
| 8 | パッケージが -46% | ✅ | registry / `du -sh` / 登壇資料の 3 者一致 |
| 9 | v5 は「AI のための Hono」 | ✅ | HonoConf 2026 登壇資料 |
| 10 | 外部 PR は 2026-10-05 に停止 | ✅ | 登壇資料 / リポジトリの PR 一覧 |
| 11 | アダプタ分離はサプライチェーン対策でもある | ⚠️ 二次のみ | 参加レポート（Qiita） |
| 12 | 「依存を減らした」 | ❌ **前提が違う** | v4 から依存ゼロ（registry） |
| 13 | v5 は速くなった | ❌ **誤差** | 10 ラウンド実測、分布が重なる |
| 14 | サブアプリ `notFound()` の優先順位 | ⬜ 未確認 | PR 本文に記述あり・未実測 |

---

## 1–6. API の変更

- [Migrating to v5](https://hono.dev/docs/guides/migrating-to-v5) — 一次。
  raw で取ると表が崩れない:
  `curl -sL https://raw.githubusercontent.com/honojs/website/main/docs/guides/migrating-to-v5.md`
- [honojs/hono#5541](https://github.com/honojs/hono/pull/5541) — 一次。**設計意図はこっち**
  > The goal is to model error and not-found handling using Hono's routing system
  - 内部では `@ERROR` / `@NOT_FOUND` の予約メソッドで Router に登録される
  - マイグレーションガイドには載っていない
- [Routers — Hono](https://hono.dev/docs/concepts/routers) — RegExpRouter は「1 本の巨大な正規表現」、
  SmartRouter のデフォルトは `[new RegExpRouter(), new TrieRouter()]`

実測はすべて `sandbox/` と `results.json` / `results.md`。

### 記事に使える切り口

- **型で捕まるもの / 捕まらないものが綺麗に分かれる。** `c.json(undefined)`、
  `onError()` の合成化、ワイルドカード変更の 3 つは型エラーにならない
- v4 スタイルの `onError` を握りつぶして実行すると
  `Context is not finalized...` という**原因を指さないエラー**が出る

---

## 7–8. パッケージサイズとアダプタ分離

> ⚠️ **このリポジトリでは `npm view` が `EBADDEVENGINES` で落ちる**
> （ルートの `devEngines.packageManager: bun`）。registry API を直接叩く。

```sh
curl -s https://registry.npmjs.org/hono/5.0.0-rc.1 | python3 -c "
import json,sys; d=json.load(sys.stdin)
print(d['dist']['unpackedSize'], d['dist']['fileCount'], d.get('dependencies'))
"
```

| | unpackedSize | fileCount | dependencies |
| --- | ---: | ---: | ---: |
| `hono@4.13.13` | 1.23 MB | 574 | **0** |
| `hono@5.0.0-rc.1` | 0.66 MB | 310 | **0** |

アダプタ 8 つ（`@hono/bun` / `deno` / `cloudflare-workers` / `vercel` / `netlify` /
`aws-lambda` / `lambda-edge` / `service-worker`）は**全て初版 2026-09-28**。

- `@hono/node-server` は初版 **2023-01-07**。v4 時代から別パッケージ。混同しない
- `@hono/cloudflare` は**存在しない**（`@hono/cloudflare-workers`）

---

## 9–10. v5 の位置づけと、PR 停止

- [Hono Conference 2026 — Yusuke Wada](https://slides.yusu.ke/honoconf-2026) — 一次。
  自前ホストの HTML なので `WebFetch` がそのまま効く
  - v5 =「AIのためのHono」。設計目標は「抽象化されていて、選択肢が少ない」
  - パッケージサイズ 1.29MB → 0.70MB（-46%）、ファイル数 574 → 310
  - 2026-10-05 に外部コントリビューターの PR を停止。
    理由は「PRが増えた」「GitHubのinboxを見るのが追いつかない」。
    品質ではなく「貢献のための貢献」が課題
- リポジトリ側の裏取り:
  ```sh
  gh api "repos/honojs/hono/pulls?state=all&per_page=10" \
    --jq '.[] | "\(.created_at[:10])  @\(.user.login)  \(.title)"'
  ```
  → マージ済みは `yusukebe` と `usualoma` のみ。外部の PR は open のまま

---

## 11. アダプタ分離とサプライチェーン

**判定: 二次ソースのみ。出どころ付きで書く。**

- [Honoでのサプライチェーン侵害対策 〜 3つのライブラリに学ぶ](https://speakerdeck.com/yusukebe/honodenosapuraitienqin-hai-dui-ce-3tunoraiburarinixue-bu)
  — 一次だが SpeakerDeck でテキストが崩れて読み取れない
- [参加レポート（Qiita / kouki_engineer）](https://qiita.com/kouki_engineer/items/fd371f4258941b3ae149)
  — 二次。**中身はここからほぼ丸ごと取れた**
  - GMO Flatt Security 勉強会「OSS開発者は今何をするべきか？」2026-06-23
  - 題材 3 つ: axios（ソーシャルエンジニアリング）/ TanStack（`pull_request_target`
    のキャッシュ汚染・**PR がマージされなくても成立**）/ Mastra（npm アカウント乗っ取り）
  - Hono の対策に **「アダプター機能をコアから外す」** が入っている
  - 他に OIDC trusted publishing、`pull_request_target` 不使用、Actions の pin、
    DevContainers / Gitpod の削除
  - メンテナ実質 1 人が単一障害点として挙げられている

> ⚠️ **「テキストが崩れて読めない」は references.md に書くもの。article.md には書かない。**

### 迂回路の記録

SpeakerDeck 直読み → ✗ / イベント名 + セッション名で検索 → ✅ 参加レポートに当たった。
**1 本目で諦めなかったのが効いた。**

---

## 12. 「依存を減らした」は成り立たない ❌

| | runtime dependencies |
| --- | ---: |
| `hono@4.13.13` | **0** |
| `hono@5.0.0-rc.1` | **0** |
| `@hono/bun@1.0.1` | **0**（peer に `hono` のみ） |
| 参考: `express` | 28 |
| 参考: `axios` | 4 |

**v4 の時点で外部ランタイム依存がゼロ。** 分離で減ったのは依存グラフではなく、
コアが配るコードの量（574 → 310 ファイル）。

→ 記事の 9 章はこの発見で 1 節増えた。**❌ が一番の収穫になった例。**

---

## 13. 性能は誤差 ❌

`app.fetch()` で `GET /users/:id` × 100,000 回、v4/v5 交互に 10 ラウンド。

| | 中央値 | 最小 |
| --- | ---: | ---: |
| v4 | 270.53 ms | 258.31 ms |
| v5 | 266.50 ms | 255.59 ms |

v4 の最小が v5 の中央値より速い → **有意差なし。**

> ⚠️ **5 ラウンドだと 2.9%、10 ラウンドだと 1.5% だった。**
> Router フォールバックの方も 3 ラウンドで 3.3%、12 ラウンドで 7.1% とぶれた。
> マイクロベンチはラウンド数を書かないと意味がない。

環境: Node.js v24.22.0 / TypeScript 7.0.2 / Apple M4 (arm64)

---

## 未確認・積み残し

- [ ] `route()` でのサブアプリ `notFound()` の優先順位（PR #5541 に記述、未実測）
- [ ] `basePath()` と `onError()` のパス解決の組み合わせ
- [ ] 実 HTTP サーバー経由のベンチ（今回は `app.fetch()` のみ）
- [ ] Cloudflare Workers 実環境での計測
- [ ] `@hono/zod-validator` と `c.req.valid()`
- [ ] Hono CLI 1.0 RC

## 探したが取れなかったもの

- **外部 PR 停止の公式な理由表明** — `honojs/hono` の `CONTRIBUTING.md` /
  `.github/CONTRIBUTING.md` / `SECURITY.md` はいずれも 404。
  登壇資料と二次記事しか見つからなかった
- **アダプタ分離の目的を明記した一次文書** — Migration Guide は「何が変わったか」
  しか書いていない。目的は登壇資料と参加レポート経由
