# PRD：Cloudflare Agents Workspace移行・永続化検証

Product Requirements Document — 2026年10月21日

## 1. プロジェクト概要

記事タイトル（仮）

「Cloudflare AgentsのWorkspaceが刷新されたので、永続化と移行時の挙動を検証する」

目的

Cloudflare AgentsのThink Harnessで使用するWorkspaceが `@cloudflare/shell` から `@cloudflare/computer` に移行したことを受け、旧実装と新実装の差異を、実際のCloudflare Workers / Durable Objects環境で検証する。

特に以下の4点を明らかにする。

1. 新Workspaceはどのような仕組みでファイルを永続化するのか。
2. 既存のWorkspaceを移行せずにアップデートするとどうなるのか。
3. 公式の移行手順で、ファイルやディレクトリを正しく引き継げるのか。
4. 新Workspaceは従来と比較してどのような制約や利点を持つのか。

成果物

- 再現可能なTypeScriptの検証用プロジェクト
- 旧Workspaceと新Workspaceの比較データ
- 永続化・移行・例外系のテスト結果
- 技術ブログ記事（日本語、Markdown）
- 検証環境、実行手順、ログを記録したREADME

## 2. 背景・変更内容

2026年10月20日のCloudflare Changelogを起点として、仕様変更の内容を整理する。

| 比較項目          | 旧Workspace          | 新Workspace             |
| ------------- | ------------------- | ---------------------- |
| パッケージ         | `@cloudflare/shell` | `@cloudflare/computer` |
| ストレージ         | SQLite + オプションのR2   | Durable Object SQLite  |
| テーブル構造        | `cf_workspace_*`    | `vfs_*` / `_vfs_*`     |
| ファイル表現        | パス単位のレコード           | inode・チャンクベース          |
| R2への大容量ファイル退避 | 対応                  | 現時点では未対応               |
| Namespace     | 対応                  | 同等機能は未実装               |
| コード実行         | 旧Execute Toolなど     | 複数の実行Backend           |
| 旧データの自動移行     | ―                   | 非対応                    |

公式移行ドキュメントによると、新しいComputer WorkspaceはDurable Object内での動作を前提とし、従来のD1やカスタムSQL Backendは直接の移行先としてサポートされていません。

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+2



### 技術的な注目点

- ストレージ互換性: 同一Durable Object内でも、新旧Workspaceは異なるテーブルを使用する。
- データ保持: アップデートによって旧データが物理的に削除されるわけではない。
- 永続化: 新WorkspaceもDurable ObjectのSQLiteを使用し、再起動後の状態保持を目的としている。
- 実行環境: `WorkerJavaScriptBackend` などにより、Workspaceに対する操作とコード実行を統合できる。
- 移行の制約: メタデータや一部の旧機能は完全互換ではない。

## 3. 検証範囲

P0＝必須、P1＝推奨、P2＝余裕があれば実施

| ID  | 優先度 | テスト内容                   | 確認したいこと            |
| --- | --- | ----------------------- | ------------------ |
| T01 | P0  | 新Workspaceへのファイル書き込み    | 正しく保存・読み込みできるか     |
| T02 | P0  | Durable Object再起動後の読み込み | ファイルが永続化されているか     |
| T03 | P0  | 旧Workspaceからの無移行アップデート  | 旧ファイルが見えなくなるか      |
| T04 | P0  | 公式スクリプトでのデータ移行          | 内容を維持して移行できるか      |
| T05 | P0  | 移行後の旧データ確認              | 旧テーブルが保持されているか     |
| T06 | P1  | 階層ディレクトリの移行             | 構造が維持されるか          |
| T07 | P1  | バイナリファイルの移行             | バイト列が一致するか         |
| T08 | P1  | シンボリックリンクの移行            | リンク先が正しいか          |
| T09 | P1  | 移行処理の再実行                | 重複・破損が発生しないか       |
| T10 | P1  | サイズ別ファイル操作              | 保存速度・読み込み速度の差      |
| T11 | P1  | 旧R2退避ファイルの移行            | ファイル本体をコピーできるか     |
| T12 | P2  | 同時書き込み                  | 更新競合時の挙動           |
| T13 | P2  | Backendからのファイル操作        | `exec` と `fs` の整合性 |

### 3.1 検証時の共通条件

すべての検証で、次の情報を記録する。

- Node.js / Wrangler / 各Cloudflareパッケージのバージョン
- ローカル環境かデプロイ環境か
- Durable Objectのクラス名・インスタンス識別用ID（検証用）
- 操作前後のファイル一覧・ファイルサイズ・SHA-256
- 各操作の実行時間
- 成功・失敗とエラーメッセージ

旧バージョンは、旧Workspaceが正常動作することを確認できるバージョンに固定する。新バージョンについても、検証開始時点の具体的なバージョンを記録する。

## 4. 実装要件

### 4.1 検証プロジェクト構成

```
cloudflare-workspace-migration-lab/
├── src/
│   ├── index.ts
│   ├── agents/
│   │   ├── legacy-agent.ts
│   │   └── computer-agent.ts
│   ├── migration/
│   │   └── migrate.ts
│   └── fixtures/
│       └── manifest.ts
├── scripts/
│   ├── prepare-fixtures.ts
│   ├── verify-files.ts
│   └── benchmark.ts
├── results/
│   ├── persistence.json
│   ├── migration.json
│   └── benchmark.json
├── wrangler.jsonc
├── package.json
└── README.md
```

実装は同じDurable Objectの既存データを使いながら旧版から新版に切り替えられる構成とする。

旧版と新版を別のDurable Object namespaceにデプロイすると、同じストレージを使った移行検証にならない点に注意する。

### 4.2 新Workspaceの最小実装

公式の新APIに基づき、ファイル読み書きを行う。

```
import { Think } from "@cloudflare/think";
import { Workspace } from "@cloudflare/computer";

export class MyAgent extends Think<Env> {
  override workspace = new Workspace({
    storage: this.ctx.storage,
  });

  async writeTestFile() {
    await this.workspace.fs.mkdir("/workspace", {
      recursive: true,
    });

    await this.workspace.fs.writeFile(
      "/workspace/hello.txt",
      "Hello from Computer!"
    );
  }

  async readTestFile() {
    return this.workspace.fs.readFile(
      "/workspace/hello.txt",
      "utf8"
    );
  }
}
```

これはWorkspace操作部分の例示コード。実際の検証ではThinkの要求するメソッドやWorkerルーティング等を追加し、公開可能な実行プロジェクトに仕上げる。

重要: 新Workspaceでは `/workspace` を基本的な作業ディレクトリとして扱う。旧Workspaceの `/hello.txt` をThink向けに移行する場合、移行先は `/workspace/hello.txt` になる。

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+1



## 5. 詳細テスト仕様

### T01 / T02：永続化テスト

目的は、Workspaceインスタンスのメモリ状態ではなく、Durable Object SQLiteによる永続化を確認すること。

手順

1. `hello.txt` を作成する。
2. 書き込み完了後に読み取る。
3. 別のHTTPリクエストから読み取る。
4. Workerの新しいバージョンをデプロイする。
5. 同じDurable Object IDのファイルを読み取る。
6. 必要に応じて十分なアイドル時間を設け、休止・再起動後の動作も調べる。

期待結果は、すべての操作でファイル内容が一致すること。

なお、別リクエストから読み取れたことだけではDurable Objectが再起動した証拠にならない。インスタンスの起動識別子をログに記録するなどして、同一インスタンス内の読み込みと再起動を伴う読み込みを区別する。

### T03：移行しないとどうなるのか

今回の記事の中心となるテスト。

手順

1. 旧Workspaceで `/notes.md` を作成する。
2. 旧Workspaceで正常に読めることを確認する。
3. 旧版のデプロイを新Workspace実装に更新する。
4. 新Workspaceから `/workspace/notes.md` を読み取る。
5. 旧テーブルと新テーブルの存在を調査する。

検証仮説

- 新Workspaceから既存ファイルを参照できない。
- 旧テーブルには元のファイルが残っている。
- 新Workspace側に新しいSQLiteテーブルが作成される。

これらは公式説明に基づく予測であり、実際の結果はテストから記録する。

記事では「データが消えた」のではなく、保存場所が変わった結果、参照できなくなったという違いを明確にする。

### T04〜T09：データ移行テスト

公式の移行スクリプトを基準に実装する。

[Cloudflare公式：Migrating from @cloudflare/shell to @cloudflare/computer](https://github.com/cloudflare/agents/blob/main/docs/shell/migrating-to-computer.md)

移行対象のテストデータは以下とする。

| ファイル                 | 内容         | 検証ポイント    |
| -------------------- | ---------- | --------- |
| `/notes.md`          | UTF-8テキスト  | 通常ファイル    |
| `/src/index.ts`      | TypeScript | 階層構造      |
| `/data/config.json`  | JSON       | 内容の完全一致   |
| `/assets/sample.bin` | バイナリ       | SHA-256一致 |
| `/links/notes.md`    | シンボリックリンク  | リンク先の維持   |
| `/empty/`            | 空ディレクトリ    | ディレクトリの維持 |

確認対象を以下に分ける。

- ファイル内容の一致
- パス・ディレクトリ構造の一致
- リンク先の一致
- 移行による欠落ファイルの有無
- 二重実行による不整合の有無
- 移行前後のメタデータの差

公式ドキュメントによると、提供されているコピー処理では `created_at`、`modified_at` およびファイルごとの `mime_type` は保持されない。今回のテストでは、この制約も検証結果として記録する。

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub



また、二重実行テストには、同じ移行関数をもう一度直接実行するケースと、移行済みフラグを使って二度目のコピーをスキップするケースを分けて用意する。

## 6. 比較・ベンチマーク要件

機能比較だけではもったいないので、パフォーマンスも簡単に測定する。

実施するファイルサイズ

1 KB

100 KB

1 MB

4 MB

各サイズで測定する操作は書き込み、読み込み、ファイル一覧取得。可能なら各10回程度実施し、ウォームアップを除いた中央値を比較する。

測定時には、Durable Objectの実行環境、インスタンス状態、ネットワーク往復時間などが結果に影響するため、HTTP経由の総時間とWorkspace操作自体の所要時間を区別する。

なお、旧WorkspaceではR2への退避が可能だった一方、新Workspaceではまだ同等機能が実装されていない。大容量ファイルのテストではR2使用有無を統一できない場合、単純な速度比較を避ける。

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub



## 7. 記事構成案

以下の流れで記事を組み立てる。

### 1. はじめに

- Cloudflareが2026年10月20日に発表した変更を紹介
- `@cloudflare/shell` の非推奨化
- なぜ永続化とデータ移行を検証しようと思ったのか

### 2. そもそもWorkspaceとは？

- AI Agentにおけるファイルシステムの役割
- Durable ObjectとSQLiteの関係
- 再起動してもファイルが残る仕組み

### 3. 新旧Workspaceの違い

- パッケージとAPIの変更
- SQLiteのテーブル構造
- Computerによる実行Backendの統合
- R2やnamespace等の制約

### 4. 新Workspaceでファイルを永続化してみる

- 最小限の実装
- ファイルの保存と読み込み
- 再デプロイ・再起動後の挙動
- 実験結果

### 5. 旧Workspaceからそのまま更新するとどうなる？

- 旧実装でデータを作成
- 新実装へアップデート
- ファイル参照結果を確認
- SQLiteテーブルの調査

### 6. 公式の移行スクリプトを試す

- 移行スクリプトの解説
- テキスト・バイナリ・ディレクトリの移行
- シンボリックリンクの取り扱い
- 移行後の整合性確認
- 再実行時の挙動

### 7. パフォーマンスと制約を比較する

- ファイルサイズ別のベンチマーク
- 実行時間の比較
- R2やメタデータに関する注意点

### 8. まとめ

- 移行前に注意すべきポイント
- 新Workspaceのメリットと制約
- 実際に使ってみた所感
- 今後の改善への期待

## 8. 成果物の品質要件

記事の公開条件を以下に定める。

公開前チェックリスト

0/8 完了

旧・新の両環境でファイル操作を再現できる

実際のDurable Objectを使った永続化検証が完了している

無移行アップデート時の挙動を確認している

公式移行スクリプトによるコピーを実行している

テキスト・バイナリファイルの内容をハッシュで検証している

結果と検証仮説が明確に分離されている

検証したパッケージバージョンをすべて記録している

読者が追試できるREADMEとコードを用意している

## 9. 非対象

今回の記事では、以下は原則として扱わない。

- LLM自体の性能・回答精度の比較
- 本格的なAI Agentアプリケーションの構築
- 大規模分散環境での負荷試験
- Container Backendの詳細な性能比較
- Cloudflareの他のストレージ製品との総合比較

あくまでWorkspaceの永続化・移行・互換性に集中する。

## 10. 参考資料

- [Cloudflare Changelog — Think agents now use a @cloudflare/computer workspace](https://developers.cloudflare.com/changelog/post/2026-10-20-think-computer-workspace/)
- [公式移行ガイド](https://github.com/cloudflare/agents/blob/main/docs/shell/migrating-to-computer.md)
- [Think Tools Documentation](https://developers.cloudflare.com/agents/harnesses/think/tools/)
- [cloudflare/computer — GitHub](https://github.com/cloudflare/computer)
- [Computer Filesystem Schema](https://github.com/cloudflare/computer/blob/main/docs/03_filesystem_schema.md)
