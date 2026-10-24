# PRD：Cloudflare AgentsがPi 1.4に対応したので、Agentの中断・復旧・永続化を検証する

Technical Article PRD

Cloudflare Agents

Pi Durable 1.4

## 1. プロジェクト概要

2026年10月22日、CloudflareはAgents SDK v0.30.0におけるPi 1.4対応を発表した。

今回のアップデートでは、単なるPiのバージョン更新にとどまらず、Durable Objects上で実行されるAgentの中断・復旧・永続化に関する信頼性改善が実施されている。

特に注目すべき変更は以下の4点。

1. Hibernation：リトライ待機中のAgentがメモリ上で動き続ける必要がなくなった。
2. Parked Tasks：クラッシュを繰り返すタスクを一定回数で停止し、無限再起動を防止する。
3. Storage Error Recovery：ストレージエラー発生後にPiを再オープンし、処理を復旧できるようになった。
4. Model Stream Retry：途切れたモデルストリームを一時的なエラーとして扱い、再試行できるようになった。

出典：[Cloudflare公式Changelog（2026年10月22日）](https://developers.cloudflare.com/changelog/post/2026-10-22-pi-harness-pi-1-4/)&#x20;

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Changelog

+1



本記事では、これらの機能について公式仕様を整理したうえで、実際にCloudflare WorkersとDurable Objects上でAgentを構築し、実行途中に障害を発生させることで挙動を検証する。

単に「Agentが復旧した」という結果を確認するのではなく、どの状態が永続化され、どの処理が再実行され、どの処理は再実行されないのかを明らかにする。

### 記事の中心となる問い

> Cloudflare AgentsとPi Durableを組み合わせたAgentは、実行途中に停止しても、どこまで正しく処理を再開できるのか？

## 2. 記事の目的

### 主要目標

- Pi 1.4対応によって追加・改善された復旧機構を理解する。
- 実際のDurable Object環境で、Agentの中断と復旧を再現する。
- Agentの会話履歴・実行タスク・ツール実行状態の永続化を確認する。
- 再実行可能なツールと、再実行してはいけないツールの扱いを比較する。
- 復旧機構の制約、想定外の挙動、運用上の注意点を整理する。

### 非目標

- Piと他のAgentフレームワークの一般的な性能比較。
- LLMの推論精度や回答品質のベンチマーク。
- 完全なチャットUIの開発。
- Cloudflare Agents全体の網羅的な解説。
- 実際の障害に遭遇しない限り、未検証の脆弱性を主張すること。

## 3. 技術的な背景とアーキテクチャ

検証対象は、以下の構成とする。

概念図：PiHarnessがSQLiteへの状態保存とLifecycleによる再起動を橋渡しする

Pi DurableはAgentの実行ループを担当し、PiHarnessはDurable Object上のSQLiteストレージとLifecycleジョブを提供する。

Piは会話履歴、入力キュー、タスクなどを`pi_`で始まるSQLiteテーブルに保存する。実行途中でDurable Objectが停止しても、LifecycleのAlarmによって再起動され、最後のチェックポイントから復旧できる設計である。

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare Agents docs

+1



重要なのは、会話履歴の永続化と処理の復旧は異なる機能だという点である。記事でも両者を分けて検証する。

## 4. 検証環境

| 項目              | 採用技術                                  |
| --------------- | ------------------------------------- |
| Language        | TypeScript                            |
| Runtime         | Cloudflare Workers                    |
| Agent           | Cloudflare Agents SDK `0.30.0`        |
| Harness         | `PiHarness`                           |
| Agent Loop      | `@earendil-works/pi-durable` `~1.4.0` |
| Model Interface | `@earendil-works/pi-ai`               |
| Storage         | Durable Objects SQLite                |
| Scheduling      | Lifecycle / Durable Object Alarms     |
| Model           | Workers AI経由の対応モデル                    |
| Testing         | Vitest / Wrangler / 実デプロイ環境           |

Pi関連パッケージには`@earendil-works/chord`も必要。正式な検証ではパッケージの実際の解決バージョンとlockfileを保存し、再現性を確保する。

`PiHarness`は現時点でBetaであり、Pi Durableも実験的なパッケージとして案内されている。

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare Agents docs

+1



## 5. 検証シナリオ

今回の記事では、以下の7つの実験を実施する。

検証項目チェックリスト

執筆・実装管理用

0/7

会話とタスクの永続化

クライアント切断と再接続

モデルストリーム中断

ツール実行中断とReplay

Parked Tasksと手動復旧

Storage Error Recovery

HibernationとWake-up

### EXP-01：会話履歴とタスクの永続化

Priority P0

目的： Durable Objectのインスタンスが再生成されても、会話履歴とAgentの状態が維持されることを確認する。

手順：

1. `PiHarness`を利用したAgentを作成する。
2. `submit()`で固有の識別子を含む指示を送信する。
3. `messages()`と`pending()`を取得して記録する。
4. Agentの処理が完了した後、別のリクエストから同じDurable Objectにアクセスする。
5. `messages()`の内容とSQLiteの保存状態を比較する。
6. 実際にインスタンスの再起動が確認できた条件で、同じ比較を行う。

期待結果： 保存済みの会話履歴が新たなインスタンスから読み出せる。完了済みタスクは二重実行されない。

注意： クライアントの再接続だけではDurable Objectの再起動を証明できない。インスタンス生成を記録するログを設け、プロセス再生成の有無を区別する。

### EXP-02：クライアント切断と再接続

Priority P0

目的： WebSocket接続が切断されてもAgentの実行を継続できるか確認する。

手順：

1. 数秒以上かかる制御されたタスクをAgentに実行させる。
2. 実行途中でクライアントのWebSocketを切断する。
3. 別のクライアントから同じAgentに再接続する。
4. `session.events()`から取得できる`snapshot`を確認する。
5. Agentの最終結果と、再接続後のイベントを比較する。

期待結果： クライアント接続に依存せず実行が継続し、再接続後のSnapshotから会話の現在状態を再構築できる。

検証のポイント： Piのイベントストリームはメモリ上に存在し、カーソルによる途中からのイベント再生には対応していない。したがって、復旧できるのは状態であり、切断中のすべてのイベントをそのまま受け取れるとは限らない。

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare Agents docs



### EXP-03：モデルストリーム中断とRetry

Priority P0

目的： モデル応答のストリームが途中で途切れた場合、Agentがどのように再試行するか検証する。

手順：

1. 制御可能なモデルストリームのテスト用Providerを用意する。
2. 正常にストリームを返すケースを測定する。
3. 一定量の出力後にストリームが異常終了するケースを再現する。
4. ストリームが一定時間進まなくなるケースを再現する。
5. 再試行回数、待機時間、最終応答を記録する。
6. 再試行前後で部分出力の扱いを比較する。

検証する主な観点：

- 途中で途切れたストリームは再試行対象になるか。
- リトライはモデルリクエスト全体の再実行なのか。
- 途中まで保存した回答はどう表示されるか。
- 再試行によってツール処理の重複が生じないか。

期待結果： 再試行可能なモデルストリーム障害は一時的エラーとして扱われ、設定されたリトライ動作に従う。

注意： モデルリクエストが最初から再実行される可能性を考慮し、生成内容が完全一致することは成功条件にしない。また、モデルエラーとDurable Object自体のクラッシュは別の障害として整理する。

### EXP-04：ツール実行中の中断とReplay

Priority P0 / 記事の中核

この検証を記事のメインに据える。

Piでは、ツールの`replay`設定によって再実行の扱いが変化する。

| ツールの種類           | 中断後の公式仕様            |
| ---------------- | ------------------- |
| `replay: "safe"` | ツールを再実行             |
| Unsafeなツール       | 自動再実行せず、中断結果をモデルに渡す |

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare Agents docs

+1

検証用に以下の2つのツールを実装する。

Tool A：Replay-safe

- テスト用ストレージに特定キー・特定値を書き込む。
- 同じ処理を複数回実行しても結果が変わらない。
- 実行回数を独立したログに記録する。

Tool B：Replay-unsafe

- テスト用カウンターに1を加算する。
- 二度実行すると結果が変わる。
- 実行回数と副作用の発生回数を別々に記録する。

手順：

1. ツールを実行するAgentを作成する。
2. ツールの開始・副作用の確定・終了を記録する。
3. ツールが実行されている最中に、検証用の制御された障害を発生させる。
4. Durable Objectが再起動したことを確認する。
5. Agentの復旧結果を確認する。
6. Replay-safeとReplay-unsafeで再実行回数を比較する。

期待結果： Replay-safeなツールは再実行可能である。一方、Replay-unsafeなツールは自動で再実行されず、モデルに中断が通知される。

ここで特に確認したいのは、副作用が確定した直後に中断したケースである。

Unsafeなツールが自動再実行されないことと、実際のビジネス処理がExactly-onceで実行されることは同義ではない。Agentが新たなツール呼び出しを判断する可能性もあるため、外部操作には冪等性キーや重複防止機構が必要になる。

比較するタイミング

副作用確定前

副作用確定直後

ツール完了後

実験の障害注入は隔離された検証環境で実施する。例外送出やHTTPリクエスト中断だけでは実際のDurable Objectクラッシュとは異なるため、ログを根拠に結果を区別すること。

### EXP-05：Parked Tasksと手動復旧

Priority P0 / Pi 1.4の新機能

目的： クラッシュを繰り返すタスクがParked状態に移行し、無限再起動を防止できるか確認する。

公式ドキュメントでは、進捗のないクラッシュやEvictionが連続して発生した場合、デフォルトで5回を上限としてタスクをParkする仕様となっている。

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare Agents docs

+1



手順：

1. テスト専用の`restartLimit`を設定する。
2. タスクを開始し、進捗が発生しない障害条件を繰り返す。
3. 再起動回数を記録する。
4. `pending()`を利用して`parked`状態を確認する。
5. 障害条件を解除する。
6. `session.retry()`によって処理を再開する。
7. 最終的にタスクが正常終了するか確認する。

期待結果： 再起動上限に達したタスクがParkされ、無限に再起動することなく停止する。障害解除後は手動で再開できる。

追加で`session.abort()`による処理の放棄も確認する。

なお、通常のモデルAPIエラーを繰り返すだけではParked Tasksの条件を満たすとは限らないため、クラッシュ・Evictionに相当する障害と区別する。

### EXP-06：Storage Error Recovery

Priority P1

目的： 一時的なSQLiteストレージエラーの後、PiHarnessが復旧できることを確認する。

手順：

1. Harness起動時とストレージ操作時のログを追加する。
2. ストレージアダプターに一時的なエラーを返す障害注入機構を実装する。
3. 検証可能な呼び出し境界でストレージエラーを発生させる。
4. 次回操作でPiが再オープンされるか確認する。
5. 復旧後に`submit()`と`messages()`が使用可能か検証する。
6. Lifecycleジョブのリトライとバックオフを観察する。

期待結果： 対象となるストレージエラーからPiを再オープンでき、継続的な失敗状態に陥らない。

注意： 任意のSQLiteエラーがすべて回復可能であるとは仮定しない。エラーの種類と発生箇所を記録し、PiHarnessが再オープンを行う経路とLifecycleジョブが再試行する経路を分けて分析する。

### EXP-07：HibernationとWake-up

Priority P1 / Pi 1.4の新機能

目的： モデルリトライ待機中にDurable ObjectがHibernation可能になり、予定されたタイミングで処理を再開できるか確認する。

手順：

1. モデルAPIが一時的に失敗するProviderを用意する。
2. 再試行間隔を設定する。
3. Agentに処理を実行させる。
4. リトライ待機中のSchedulerとLifecycleジョブの状態を記録する。
5. 待機終了後のAgent再開を確認する。
6. 起動回数と復旧遅延を測定する。

期待結果： インメモリタイマーで待機し続けるのではなく、`onWake`経由で次回処理をスケジュールできる。

なお、単に待機中のCPU使用量が低いことや、WebSocket接続が切れたことだけではHibernationの証明にならない。

Cloudflare公式仕様では、処理中のLifecycleジョブは30秒ごとにHeartbeatを実行する一方、PiのタスクがSleepしているときは次のWake時刻に合わせてジョブをスケジュールする。

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare Agents docs



## 6. 実験結果の記録方法

すべての実験で、以下の共通ログを残す。

```
type RecoveryEvent = {
  experimentId: string;
  operationId: string;
  instanceId: string;
  sessionId?: string;
  timestamp: string;
  event:
    | "started"
    | "checkpoint"
    | "tool_started"
    | "tool_committed"
    | "tool_finished"
    | "interrupted"
    | "instance_started"
    | "retry"
    | "parked"
    | "recovered"
    | "completed";
  metadata?: Record<string, unknown>;
};
```

`instanceId`はインスタンス生成時に付与する観測用識別子とし、`operationId`は再試行しても変わらない値とする。

重要なのは、障害を受けるDurable Objectのローカルログだけに依存しないこと。実行途中で消える情報があるため、Cloudflare Workersのログや、対象Agentから独立した検証用ストレージにも記録する。

### 比較する指標

| 指標                     | 意味                                 |
| ---------------------- | ---------------------------------- |
| Recovery Success Rate  | 中断した試行のうち復旧に成功した割合                 |
| Recovery Latency       | 中断から復旧確認までの時間                      |
| Tool Execution Count   | 同一ツールの実行回数                         |
| Side-effect Count      | 実際に確定した副作用の回数                      |
| Retry Count            | モデル・タスクの再試行回数                      |
| Transcript Consistency | 復旧前後の会話履歴の整合性                      |
| Task Final Status      | `done` / `unanswered` / `parked`など |

最初は各シナリオを1回ずつ実施し、成功したケースについて複数回再現性を確認する。成功率や平均復旧時間を記事で扱う場合は、試行回数と測定条件を必ず併記する。

## 7. 比較検証：Pi 1.3とPi 1.4

可能であれば、Pi 1.4の新機能に関係する実験を旧バージョンと比較する。

単に新バージョンで動作することを示すだけでなく、アップデートによって何が改善されたのかを確認するためである。

| 検証項目                   | Pi 1.3  | Pi 1.4      |
| ---------------------- | ------- | ----------- |
| 会話履歴の永続化               | 基本動作を確認 | 基本動作を確認     |
| リトライ待機時のHibernation    | 旧方式を観測  | `onWake`を利用 |
| Parked Tasks           | 旧方式を観測  | 停止・手動復旧を検証  |
| Storage Error Recovery | 旧方式を観測  | 再オープンを検証    |
| Model Stream Retry     | 旧方式を観測  | 再試行を検証      |

ただし、Pi 1.4ではSQLiteのセッションストレージスキーマが変更され、1.3からアップグレードしたデータを1.3に戻して開くことはできない。

そのため、新旧比較には必ず別々のDurable Objectとデータベースを使用する。Cloudflare公式も、このアップグレードをロールバックできない変更として注意喚起している。

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Changelog



また、旧版を比較対象に含める場合は、Pi 1.3と互換性があるAgents SDKのバージョンを選定し、各バージョンの組み合わせを明記する。

## 8. 記事の構成案

はじめに

Cloudflareの2026年10月22日の発表を紹介する。Pi 1.4への対応と、なぜAgentの耐障害性に注目したのかを説明する。

Pi DurableとPiHarnessの仕組み

Durable Objects、Lifecycle、SQLite、Alarmの役割を説明する。「状態を保存できる」ことと「処理を再開できる」ことの違いを整理する。

実際にAgentを作成してみる

実装に必要なコードと環境を紹介し、最小構成のAgentを構築する。`submit()`、`wait()`、`pending()`によって実行状態を観察する。

Agentを中断させてみる

会話履歴、クライアント切断、モデルストリーム中断、ツール実行中断の検証結果を掲載する。特にReplay-safeとUnsafeの比較を詳しく扱う。

Pi 1.4の復旧機構を検証する

Parked Tasks、Storage Error Recovery、Hibernationを検証する。旧バージョンとの差分も可能な範囲で掲載する。

検証結果と考察

何が永続化され、何が再実行されるのかをまとめる。冪等性、Exactly-once、復旧可能性と副作用の問題を考察する。

まとめ

Pi 1.4によって改善された点と、実用的なAgentを設計するときに引き続き開発者が責任を持つべき点を整理する。

## 9. 完了条件（Acceptance Criteria）

- 公式ドキュメントとソースコードに基づき、PiHarnessの復旧機構を説明できる。
- Durable Objects上でPi 1.4を使用したAgentが動作する。
- 会話履歴の永続化を確認できる。
- クライアント接続切断とAgent停止の違いを実証できる。
- ツール実行中断時のReplay-safe / Unsafeの扱いを観測できる。
- Parked Tasksと`session.retry()`の挙動を再現できる。
- Storage Error RecoveryとHibernationは再現できた範囲、または検証できなかった理由を明記する。
- 実験ログ、検証コード、使用バージョン、検証手順を公開できる。
- 公式仕様、実測結果、考察を明確に区別している。

## 10. 参考資料

- [Agents SDK now supports the latest Pi 1.4 release](https://developers.cloudflare.com/changelog/post/2026-10-22-pi-harness-pi-1-4/) — 今回のアップデート内容。
- [Cloudflare Docs — Pi](https://developers.cloudflare.com/agents/harnesses/pi/) — PiHarness、Recovery、Parked Tasksなどの仕様。
- [cloudflare/agents](https://github.com/cloudflare/agents) — Agents SDKの実装。
- [Cloudflare Docs — File system](https://developers.cloudflare.com/agents/tools/filesystem/) — Pi向けツールとReplay設定の参考実装。
- [Run the Pi Durable harness on Cloudflare](https://developers.cloudflare.com/changelog/post/2026-10-02-pi-harness/) — PiHarness初期対応時の発表。

## 11. 記事で最も伝えたい結論

記事の結論は検証前に確定させない。ただし、検証を通して明らかにしたい中心的な論点は次のとおり。

> Agentが復旧できることと、Agentの処理が重複せず正しく完了することは別問題である。

Pi DurableはAgentの状態を永続化し、停止後に処理を再開するための機構を提供している。

しかし、モデル呼び出しや外部ツールの実行には、再試行や副作用の重複といった問題が残る。Pi 1.4がこれらをどのように扱い、開発者がどこまで対策する必要があるのかを実測によって確認する。

### 実装に着手する際の優先順位

最初に作るべきものは、チャットUIではなく観測可能な最小構成のAgent。

`submit()`で処理を開始し、ログで状態を追い、`wait()`で最終結果を確認できるだけで十分。そのうえでReplay-safeとUnsafeのツールを追加するのがよい。

特にEXP-04とEXP-05が再現できれば、記事として十分に技術的な読み応えが出る。Pi 1.4のアップデート固有の価値も示しやすい。

また、検証途中で期待結果と実測が食い違った場合は、その条件を最小化して切り出す。仕様との差異をきちんと実証できれば、単なる技術記事にとどまらず、Cloudflare AgentsやPi DurableへのIssueとして報告できる成果につながる可能性もある。