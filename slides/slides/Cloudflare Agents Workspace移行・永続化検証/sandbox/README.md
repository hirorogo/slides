# sandbox — Cloudflare Agents Workspace 移行・永続化検証

旧 Workspace（`@cloudflare/shell`）と新 Workspace（`@cloudflare/computer`）を
**同じ Durable Object storage** の上に同居させ、永続化・移行・互換性を測る。

結果は `../results.md`、検証計画は `../claims.md`。

## 構成

```
src/
  index.ts      Worker ルーター  GET /run/<scenario>?do=<name>
  lab.ts        Durable Object。シナリオはここ。claims.md の C 番号と対応
  migrate.ts    公式移行スクリプト（一字一句そのまま）+ 修正版（対照）
  evidence.ts   証跡レコーダ。fs 操作はすべてここを通す
  walk.ts       ツリー列挙と突き合わせ
  fixtures.ts   移行テスト用の固定データ（決定的に生成）
scripts/
  run.mjs                 シナリオ一括実行
  bench.mjs               C22。外から時間を測る
  hibernate.mjs           C05。hibernate の閾値
  bisect-rowlimit.mjs     C18。行上限の二分探索
  diff-resolve-target.mjs C14。公式サンプルと Shell 実装の差分（実機不要）
results/                  生ログ。アカウント識別子はスクラブ済み
```

## 前提

- Node.js 24 / bun
- Cloudflare アカウント（Workers Paid 不要。DO SQLite は Free でも使える）
- R2 バケット 1 つ（C21 のみ。無くても他は動く）

## 手順

```sh
bun install
bunx tsc --noEmit                      # 公式サンプルの型検証を含む
node scripts/diff-resolve-target.mjs   # 実機不要。C14 の机上検証

# ローカル
bunx wrangler dev --port 8787
node scripts/run.mjs --base=http://localhost:8787 --env=local

# 本番（永続化と速度は実デプロイが要る）
bunx wrangler r2 bucket create workspace-migration-lab
CLOUDFLARE_ACCOUNT_ID=<your-account-id> bunx wrangler deploy
BASE=https://workspace-migration-lab.<your-subdomain>.workers.dev
node scripts/run.mjs --base=$BASE --env=deployed
node scripts/run.mjs --base=$BASE --env=deployed --only=persist   # 約 3 分
node scripts/hibernate.mjs --base=$BASE
node scripts/bench.mjs --base=$BASE --env=deployed --rounds=60 --repeats=7
node scripts/bisect-rowlimit.mjs --base=$BASE
```

## 設計メモ

- **1 クラスで新旧を切り替える。** 別の DO namespace に分けると
  「同じストレージを使った移行」にならない
- **DO 名はシナリオ+パラメータごとに新しくする。** 移行は不可逆なので使い回すと前提が壊れる
- **`bootId` をコンストラクタで 1 回だけ生成する。** 値が変わった = 新しい incarnation。
  これが無いと「再起動後も読めた」を主張できない
- **Worker の中では `Date.now()` が進まない**（本番のみ）。速度はドライバの壁時計で測る
- **公式スクリプトは手を入れない。** 修正版は別関数にして対照にする

## 注意

- `workers.dev` のサブドメインはアカウント識別子になる。`results/` はスクラブ済み
- `wrangler dev` のローカルは `__miniflare_do_name` テーブルが増える。本番には無い
