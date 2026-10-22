# PRD：Cloudflare AgentsのAI Providerが統合されたので、モデル切り替えとFallbackの挙動を検証する

技術検証記事

Cloudflare Agents

TypeScript

AI SDK v7

## 1. 企画概要

2026年10月21日、CloudflareはAgents SDKにおけるAI Providerの統合を発表した。

従来の`workers-ai-provider`と`ai-gateway-provider`の機能が、新しい`createAI` APIに統合され、Workers AI、AI Gateway経由の外部モデル、Dynamic Routes、ベンダー純正のモデルオブジェクトを共通のインターフェースで扱えるようになった。

従来の2つのProviderは非推奨となり、新しいProviderは現在Betaとして提供されている。

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare Agents docs

+1



本記事では、この変更を実際のCloudflare Workers環境で検証し、モデルを切り替えるだけで正常に動作するのか、障害発生時にどのような条件でFallbackが実行されるのかを確認する。

特に重要なのは、Fallbackが単純な例外処理ではないという点だ。

公式ドキュメントでは、Fallbackは最初のモデルが出力を生成する前に失敗した場合に実行され、出力開始後のエラーでは切り替わらないとされている。また、現在のFallbackはCloudflare Gateway側ではなくWorker内で実行される。

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare Agents docs

+1



この仕様を実験で確認することが、本記事の中心となる。

## 2. 記事の目的

読者に伝えたいこと

- `createAI`で複数のAI Providerを統一的に扱えること
- モデルの指定方法によってルーティングが異なること
- Fallbackが発動する条件と発動しない条件
- Streaming時のFallbackの制限
- 実運用でのモデル選択・障害対策における注意点

本記事のゴール

公式ドキュメントのサンプルコードを動かすだけで終わらず、正常系・異常系を比較し、どこまでをAgents SDKに任せられるかを検証結果から判断できる記事にする。

## 3. 技術スタック・検証環境

| 項目     | 採用技術                        |
| ------ | --------------------------- |
| 言語     | TypeScript                  |
| 実行環境   | Cloudflare Workers          |
| SDK    | `agents`                    |
| AI統合   | `agents/models/ai-sdk`      |
| AI SDK | Vercel AI SDK v7            |
| モデル    | Workers AI、AI Gateway経由のモデル |
| 設定     | Wrangler                    |
| 観測     | 実行ログ、Gateway Metadata       |

検証時点の`agents`、`ai`、`wrangler`のバージョンは、実際にインストールされたものを記録する。

検証コードでは、AI Providerを生成する部分とリクエスト処理を分離し、モデルの切り替えとFallbackの結果を比較しやすい構造にする。

## 4. 検証の全体設計

検証対象の概念図。実際の通信経路やFallback処理の実行場所はモデル指定方式によって異なる。

### 検証ケース一覧

| ID  | 検証内容                       | 優先度 |
| --- | -------------------------- | --- |
| T01 | Workers AIのモデルを呼び出す        | 必須  |
| T02 | AI Gatewayのモデルを呼び出す        | 必須  |
| T03 | モデル切り替えによる挙動の比較            | 必須  |
| T04 | 存在しないモデルでFallbackするか       | 必須  |
| T05 | 認証・権限エラーでFallbackするか       | 必須  |
| T06 | Streaming開始前の失敗            | 必須  |
| T07 | Streaming開始後の失敗            | 必須  |
| T08 | 全モデル失敗時のエラー                | 必須  |
| T09 | Gateway Metadataから実行モデルを特定 | 必須  |
| T10 | Dynamic Routesとの違い         | 推奨  |
| T11 | RetryとFallbackの組み合わせ       | 推奨  |
| T12 | Fallback時のレイテンシ比較          | 推奨  |

## 5. 各検証の詳細

### Phase 1：統合されたProviderでモデルを切り替える

仮説 H1： `createAI`を使用すれば、モデルIDを変更するだけでWorkers AIとAI Gateway経由のモデルを切り替えられる。

検証するモデル指定方法は次の4つ。

| 指定方法            | 例                              | 経路                  |
| --------------- | ------------------------------ | ------------------- |
| Workers AI      | `@cf/zai-org/glm-4.7-flash`    | Workers AI          |
| Gateway Catalog | `anthropic/claude-opus-5.5`    | AI Gateway          |
| Dynamic Route   | `dynamic/support`              | Gateway設定済みルート      |
| Vendor Model    | `anthropic("claude-opus-5-5")` | Provider Native API |

これらの指定方法は公式ドキュメントでサポートされている。なお、Dynamic Routeは事前設定が必要であり、モデルIDの指定方式と実際の通信方式は必ずしも同じではない。

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare Agents docs



最小実装例

```
import { createAI } from "agents/models/ai-sdk";
import { generateText } from "ai";

export default {
  async fetch(request: Request, env: Env) {
    const ai = createAI({
      binding: env.AI,
    });

    const result = await generateText({
      model: ai("@cf/zai-org/glm-4.7-flash"),
      prompt: "Explain Cloudflare Workers in one sentence.",
    });

    return Response.json({
      text: result.text,
      metadata: result.providerMetadata,
    });
  },
};
```

同一プロンプトでモデルIDを切り替え、レスポンス形式、エラー、Gateway Metadataを比較する。

成功条件： 対象モデルが正常に動作し、アプリケーション側の`generateText`呼び出しを変更することなくモデル切り替えが成立する。

### Phase 2：Fallbackの基本動作を調べる

仮説 H2： Primary Modelの呼び出しに失敗すると、Fallback配列に指定したモデルが順番に呼び出される。

```
import { createAI } from "agents/models/ai-sdk";
import { generateText } from "ai";

const ai = createAI({ binding: env.AI });

const result = await generateText({
  model: ai("@cf/zai-org/glm-4.7-flash", {
    fallback: [
      "anthropic/claude-opus-5.5",
    ],
  }),
  prompt: "Hello, Cloudflare!",
});
```

検証パターン：

- Primaryが成功する場合、Fallbackは呼ばれないか
- Primaryに存在しないモデルIDを指定するとFallbackするか
- PrimaryとFallbackの両方が失敗した場合、どのようなエラーになるか
- Workers AIから外部モデルへの切り替えが成立するか
- 複数のFallbackを指定した場合、宣言した順番で試行されるか

存在しないモデルIDはエラーを再現するためのテスト入力として使う。ただし、エラーの種類と発生箇所が変わる可能性があるため、モデル未発見とプロバイダー障害は別ケースとして記録する。

### Phase 3：StreamingとFallbackの境界を調べる

本記事で特に重点的に検証する部分。

仮説 H3： Streaming開始前の失敗ではFallbackが発生するが、出力開始後の失敗ではFallbackしない。

公式仕様では、Fallbackは最初の出力前に発生したエラーを対象とする。

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare Agents docs



Fallbackの判定フロー

公式仕様をもとにした想定フロー。実際の境界を検証で確かめる。

テスト内容：

1. Streaming開始前にAPIエラーが返るケース
2. Stream開始後、最初の出力前にエラーになるケース
3. 最初のテキスト出力後にエラーになるケース
4. 正常にStreamingが完了するケース

実装は`streamText`を使用する。

障害の再現には、実際の外部プロバイダーを故障させるのではなく、ローカルのテスト用モデルやMock Streamでエラーを注入する方法を優先する。 実環境で再現できるケースについては、別途デプロイ環境でも検証する。

また、AI SDKの内部イベントとユーザーに表示されたテキストは区別する。

### Phase 4：エラーハンドリングを検証する

仮説 H4： Agents SDK固有のエラーでは、失敗したモデルの情報や試行履歴を取得できる。

公式ドキュメントでは`CloudflareAIError`に`status`、`code`、`logId`、`model`、`attempts`などが用意されている。

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare Agents docs



以下を確認する。

- `CloudflareAIError`が発生する条件
- Provider Native API由来のエラーとの違い
- すべてのFallbackが失敗した場合の試行履歴
- AI SDK側の自動Retryによる影響
- 認証エラーとRate Limitエラーの分類

重要なのは、すべてのエラーが`CloudflareAIError`になるとは限らないという点。

ベンダー独自のProviderを利用する場合、ベンダー由来のエラーはそのProvider独自の型で返ることがある。これも検証結果に含める。

### Phase 5：Gateway Metadataと実行モデルの確認

仮説 H5： Fallbackによって最終的に利用されたモデルをGateway Metadataから識別できる。

以下の情報を可能な範囲で取得する。

| 項目            | 確認目的               |
| ------------- | ------------------ |
| `model`       | 実際に回答したモデル         |
| `gateway`     | 利用したGateway        |
| `logId`       | Gatewayのログとの照合     |
| `cacheStatus` | キャッシュの影響           |
| `runId`       | リクエストの追跡           |
| `step`        | Gateway Routeの処理段階 |

これらの値はすべてが常に存在するわけではないため、未定義を考慮する。

[image](https://www.google.com/s2/favicons?domain=https://developers.cloudflare.com\&sz=32)

Cloudflare Agents docs



成功時のモデル情報だけでなく、Fallbackが実行された回数や処理時間も別途ログとして記録する。

### Phase 6：RetryとFallbackの関係（追加検証）

仮説 H6： Retryの設定とFallbackの設定が重なる場合、エラーの種類やRetryの実行箇所によって、最終的なモデル選択と処理時間が変化する。

検証するケース：

- Retryなし・Fallbackあり
- Retryあり・Fallbackなし
- Retryあり・Fallbackあり
- PrimaryとFallbackの双方でRetryが必要なケース

注意点として、AI SDKのRetryとAI Gateway側のRetryは別のレイヤーなので、それぞれ独立して試す。

同一エラーを使用して、呼び出し回数、処理時間、最終的なレスポンスを比較する。

## 6. 検証結果の記録形式

検証結果を以下のような表にまとめる。現時点では結果は未測定とし、公式仕様から想定できるものも実測後に確定させる。

| ケース               | Fallback予想 | 実測結果 |
| ----------------- | ---------- | ---- |
| Primary正常終了       | なし         | 未検証  |
| Primaryが404相当のエラー | あり         | 未検証  |
| Primaryの認証エラー     | あり         | 未検証  |
| Streaming出力前に失敗   | あり         | 未検証  |
| Streaming出力後に失敗   | なし         | 未検証  |
| 全Fallbackが失敗      | 最終的にエラー    | 未検証  |
| GatewayのRetryで回復  | 条件依存       | 未検証  |

各テストはできれば5回程度繰り返す。レイテンシ比較が必要なケースは試行回数を増やし、平均値だけでなく中央値、最小値、最大値を記録する。

特に、Cache HitやAI SDKのデフォルトRetryによって実行回数の観測結果が変わらないよう、条件を統一する。

## 7. 記事構成

記事本文は以下の流れを推奨する。

1\. はじめに

Cloudflare AgentsのAI Providerが統合されたニュースと、今回気になった点を紹介する。Workers AIとAI Gatewayが共通のAPIで扱えるようになったことに注目する。

2\. 何が変わったのか

旧Providerと`createAI`の違い、モデル指定方法、AI SDKとの関係を簡潔に整理する。

3\. 実際にモデルを切り替えてみる

検証環境の構築、Workers AIからGateway Catalogへの切り替え、結果の比較。

4\. Fallbackはどのように動くのか

正常系と異常系を用いたモデル切り替え、Fallbackの優先順位、最終的なモデルの特定。

5\. Streaming途中で失敗したら？

出力前・出力後のエラーを比較し、Fallbackの制限を検証する。記事の技術的な見どころ。

6\. Retry・Metadata・処理時間

Fallbackの観測方法と、障害時の応答時間への影響を整理する。

7\. まとめ

できたこと、できなかったこと、実運用で考慮すべき点を検証結果に基づいて紹介する。

## 8. 成果物・完了条件

実装成果物

- TypeScript製の最小検証Worker
- モデル切り替えを再現できるコード
- Fallbackテスト用のコード
- Streaming障害を再現するMock
- 実験結果のログ・表
- 公開用のMarkdown記事

完了条件

- 必須テストT01〜T09が実施されている
- 公式仕様と実測結果を明確に区別している
- Fallbackが発生する条件を再現可能な形で説明している
- 実際に利用されたモデルを確認できている
- 実運用での利用可否について根拠付きで考察している

## 9. スコープ外

今回の記事では、以下は深入りしない。

- 各LLMの回答精度やベンチマーク比較
- プロンプトエンジニアリング
- Agentの長期記憶・Durable Objectsの永続化
- Pi AIとAI SDKの機能比較
- 全AI Providerの対応状況調査
- AI Gatewayの料金詳細比較

モデル切り替え時の回答品質の違いは今回の主題ではなく、あくまでProvider統合とFallbackの実行制御に集中する。

## 10. 参考資料

- [Cloudflare Agents — Models](https://developers.cloudflare.com/agents/models/)
- [Cloudflare Agents — AI SDK Provider](https://developers.cloudflare.com/agents/models/ai-sdk/)
- [Cloudflare Agents — Pi AI Provider](https://developers.cloudflare.com/agents/models/pi-ai/)
- [Cloudflare AI Gateway Changelog](https://developers.cloudflare.com/changelog/product/ai-gateway/)
- [cloudflare/agents — GitHub](https://github.com/cloudflare/agents)

## 11. 執筆方針

この記事は、新機能を紹介するチュートリアルではなく、公式仕様を読んで抱いた疑問を、実験によって検証する技術記事として執筆する。

特に、次の問いを記事全体の軸にする。

> Cloudflare AgentsのAI Providerが統合されたことで、異なるモデルを簡単に切り替えられるようになった。しかし、モデルが途中で失敗したとき、本当に別のモデルへ切り替えてくれるのだろうか？

成功事例だけでなく、Fallbackが動作しないケースも扱い、その理由をSDKの仕様から考察する。

記事として最も面白いのは「モデルが切り替わること」よりも、「どの時点までなら切り替わるのか」という境界条件の検証。 ここを中心にすれば、単なるリリース情報の焼き直しではない、技術的な発見のある記事にできる。

Beta APIであるため、検証環境のバージョンを明示し、今後仕様が変更される可能性にも触れる。