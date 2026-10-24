# 客観データ: CI はいつ赤くなったか（gh run list 集計）

取材の自己申告とは別に、GitHub Actions の実行履歴から「詰まった痕跡」を数えた。

## 全体像（run 約 200 件）
```
success   Security  main            38
success   CI        main            32
success   Deploy    main            24
cancelled CI        main             6   ← concurrency による打ち切り（正常）
cancelled Security  main             3
failure   CI        main             2
failure   CI        chore/5-provision-d1  2
failure   Deploy    main             1
failure   CI        fix/deploy-client-bundle  1
failure   CI        ci/stale-build-comment    1
```

## ★最大の発見: **失敗は 1 日の最後の 25 分にすべて集中している**

| 時刻 (UTC) | ブランチ / run | 結果 |
|---|---|---|
| 12:05:15 | `chore/5-provision-d1` CI | **failure** — Typecheck: `Check generated Worker types are up to date` |
| 12:14:31 | `chore/5-provision-d1` CI | **failure** — 同上（2 回目） |
| 12:16:53 | main CI（#129 マージ後） | **failure** |
| 12:16:53 | main **Deploy**（#129 マージ後） | **failure** — Preflight ✓ / Apply D1 migrations ✓ / **Deploy auth-worker の `wrangler deploy` で失敗** / Smoke test **skipped** |
| 12:21:00 | `fix/deploy-client-bundle` CI | **failure** — Typecheck drift |
| 12:23:19 | main CI（#132 マージ後） | **failure** |
| 12:26:25 | `ci/stale-build-comment` CI | **failure** — Typecheck drift |

**それ以前（07:00〜12:00 UTC の 5 時間、PR 約 60 本）に `failure` は 1 件も無い。**
`cancelled` はすべて `concurrency: cancel-in-progress` による正常な打ち切り（PR では後続 push が前の実行を打ち切る設計、#1）。

### これが意味すること（記事に書く価値が高い）
**CI は 1 日ずっと緑だった。赤くなったのは「本番に出す」という、その日まで一度も通っていなかった経路に触れた瞬間だけ。**
しかもその赤の中身が 2 種類で、どちらも「この経路だけ通らない」系統だった:

1. **typegen drift ガード（#68、d5 が作ったもの）が 4 回発火**
   `database_id` の placeholder を実値に置換した瞬間、`wrangler types` の出力が変わって
   `worker-configuration.d.ts` と食い違った。**d5 がまさにこのために作った検査が、本番払い出しの瞬間に仕事をした。**
   （「再生成を忘れると、実際の binding と食い違った型のまま typecheck が緑で通る」ための検査）
2. **`wrangler deploy` が `Could not resolve "./generated/login-island.bundle"` で落ちた（→ PR #132）**
   Preflight と D1 マイグレーションは通過している。**落ちたのはデプロイそのもの。**
   しかも **Smoke test は skipped**（`PRODUCTION_URL` 未設定）。

### デプロイの段取りが実際に止めた順序
```
Preflight            ✓  （placeholder が残っていた間はここでずっと止めていた）
Apply D1 migrations  ✓
Deploy auth-worker   ✗  ← ここで初めて露見
Smoke test             skipped
Deploy dashboard       skipped
Deploy nfc             skipped
```
**fail-closed が正しく働き、auth-worker が落ちた時点で後続 2 Worker のデプロイは実行されなかった。**

## 補足: 取材時点でまだ動いている
取材の最後の数分で残りの OPEN PR（#127 / #128 / #130 / #131 / #133）が次々マージされ、
main の CI / Deploy は `pending` / `in_progress`。**記事を書く時点で最終状態を取り直すこと。**

## 記事での使いどころ
- 第 4 章「検査が嘘をつく」: typegen drift ガードは**嘘をつかなかった側**の実例として対置できる
  （d5 が「壊して赤くなるログを貼る」規律で作った検査が、半日後の本番払い出しで実際に発火した）
- 第 11 章「まとめ」: **「5 時間ずっと緑だった CI が、最後の 25 分で初めて赤くなった」**は締めの一文になる

---

# 【追記】★最後に出た最良の 1 件 — drift ガードが自分自身の穴で嘘をついた（`787a3cc`, 21:38:23）

取材の最中に main の CI が赤くなり、d5 が原因を特定して直した。
**これは第 4 章の決定打であり、同時に第 11 章の締めになる。**

```
fix(ci): cf-typegen を .dev.vars に依存させない（main の CI 赤を解消）
```

## 何が起きていたか（コミットメッセージ全文がそのまま使える）
> `wrangler types` は Secret の名前を `.dev.vars` から拾う。このファイルは gitignore 済みなので、
> **生成結果が「生成した人の手元に何があったか」で変わる**。
> コミットされている `worker-configuration.d.ts` は `.dev.vars` がある環境で生成されたものだったため、
> `.dev.vars` が存在しない CI で再生成すると **Secret 3 行が消え、#68 の drift 検査が落ちる**。
>
> いま main がこの理由で赤い（run 40094273426）。
> **原因はコミットされた型でも `wrangler.jsonc` でもなく、検査の入力が環境ごとに違うこと。**
> **#68 を入れた自分の設計の穴で、生成物を突き合わせる検査なのに生成の入力を固定していなかった。**

**修正**: `--env-file .dev.vars.example` を渡して入力を固定する。
このファイルは追跡済みで、必要な Secret 名が定義順に並んでいる。
**`.dev.vars` の有無で出力が一致することを実測で確認**している（d5 の「壊して測る」規律が最後まで効いている）。

**副次的効果**: 生成される型が #23 の実態に追いつく。
`SIGNING_KEY_KID` は JWK Set 形式では使われないので `.dev.vars.example` から既に消えており、型からも落ちる。
（→ #127「SIGNING_KEY_KID を必須の Worker Secret から外す」と整合）

**適用範囲の判断**: dashboard-worker と nfc-worker は Secret を持たず `.dev.vars.example` も無いので `cf-typegen` は変更しない。

変更はわずか 2 ファイル / 3 行追加 5 行削除（`package.json` と `worker-configuration.d.ts`）。

## ★なぜこれが記事の決定打なのか
**同じ 1 つの検査（#68 の typegen drift ガード）が、1 時間半のあいだに両方向の仕事をした。**

| 時刻 | 出来事 | 検査の振る舞い |
|---|---|---|
| 12:05 / 12:14 UTC | 本番 D1 の `database_id` を placeholder から実値に置換 | **正しく赤くした。** 再生成を忘れた型の食い違いを捕まえた＝**作られた目的どおりの仕事** |
| 12:21 / 12:26 UTC | 後続 PR でも同じ検査が落ち続ける | この時点では「また再生成漏れか」に見える |
| 12:31 UTC（main） | main が赤のまま | **原因は型でも設定でもなく、検査自身の入力が環境依存だった** |
| 21:38 JST | `787a3cc` で `--env-file .dev.vars.example` を渡して入力を固定 | 解消 |

→ **「検査が嘘をつく」の最終形**: 嘘をついたのは、このリポジトリで**唯一「嘘をつかない検査」の代表例として挙げられていた検査**だった。
　しかも作者本人（d5）が、取材の最中に自分でそれを見つけて「**自分の設計の穴**」と書いた。

## 記事での配置
- **第 4 章**: (c) 検査の範囲が静かにゼロになる → に加えて **(d)「検査自身の入力が固定されていない」**という新カテゴリを立てる
- **第 11 章の締め**: 09 の「5 時間ずっと緑だった CI が、最後の 25 分で初めて赤くなった」に続けて、
  **「その赤の最後の 1 件は、検査そのものの穴だった」**で閉じる
- 対になる教訓: **生成物を突き合わせる検査を書くときは、生成の入力も固定しないと検査が環境依存になる**
  （d5 の 1 巡目の「名前を自前で組み立てない / `unstable_readConfig` に解決させる」と同じ系統の学び）

---

# 【訂正】drift ガードの発火は 4 回ではなく **10 回**（d5 の実測による）

本ファイル上部で「typegen drift ガードが 4 回発火」と書いたが、**これは私（94）が
`gh run list` の表示範囲だけを見て数えた不完全な集計だった。** d5 の実測が正しい。

- **12:05:39 UTC 〜 12:39:44 UTC の 34 分間に 10 本**
- **全部同じステップ**（`Check generated Worker types are up to date`）
- ブランチは横断的: main / `chore/5-provision-d1` / `fix/deploy-client-bundle` /
  `feat/83-admin-role` / `test/28-basic-op-run` / `ci/stale-build-comment`
- **最初と最新で drift の中身が完全に一致**（`SIGNING_KEY_JWK` / `SIGNING_KEY_KID` / `IP_HASH_PEPPER` の 3 行が消える）
- 起点は `4859a7f`（D1 払い出しのコミット）。`git log -S "SIGNING_KEY_JWK: string;"` で特定

詳細と原因特定の順序は `12-interview-d5-round2b.md` を参照。

**この訂正自体が記事の素材になる**: 私は「4 回」と書いて user に報告していた。
**取材対象が自分で数え直して訂正してきた**という形で、本記事の「相手の測定を鵜呑みにしない」のもう 1 例。
