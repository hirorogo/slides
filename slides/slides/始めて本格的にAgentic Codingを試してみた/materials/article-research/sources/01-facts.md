# 記事用ファクトシート（リポジトリ一次情報）

## 1. プロダクト概要
- 名称: **u18 Identity**（under18dev/services）
- 正体: u18 の複数 Web サービスで共通利用する **OpenID Connect Identity Provider**
- 基盤: Cloudflare Workers + D1（Drizzle ORM）、pnpm workspaces monorepo
- Worker 3 本:
  - `auth-worker` — OIDC + 認証 API。**Identity D1 の唯一の所有者**
  - `dashboard-worker` — アカウント設定 UI / BFF。**D1 binding を持たない**。Service Bindings の RPC で auth を呼ぶ
  - `nfc-worker` — 文化祭 NFC カードの短縮 URL 解決と管理 API。**別 D1**
- 各 Worker 内部は Presentation / Application / Domain / Infrastructure + composition。依存方向は **ESLint で強制**

## 2. 規模と速度（記事の核になる数字）
- origin/main のコミット: **154**
- 期間: **2026-10-23 に dependabot 2 件 → 実作業は 2026-10-24 の 07:00〜21:00 のほぼ 1 日**
  - 時間帯別: 07時5 / 08時1 / 09時1 / 13時9 / 14時35 / 15時22 / 16時24 / 18時22 / 19時19 / 20時15 / 21時15
- PR: **約 70 本**（#1〜#131、MERGED 多数 / OPEN 5 / CLOSED 1）
- Issue: **約 75 本**
- `Co-Authored-By: Claude Opus 5` が付いたコミット: **104**
- コード行数: TS/TSX/MJS 合計 **約 30,800 行**（生成物除く）
  - domain 26 files / 2,085 行
  - application 58 files / 4,529 行
  - infrastructure 30 files / 2,598 行
  - presentation 32 files / 3,477 行
  - composition 3 files / 552 行
  - テスト 65 files / **14,175 行**（本体とほぼ同規模）
- テスト件数: **617 件**（domain 25 / auth-worker 477 / dashboard-worker 26 / nfc-worker 89）
- ドキュメント: runbook 224KB / threat-model 186KB / architecture 50KB / spec 33KB / README 37KB

## 3. Agent 構成（観測された事実）
- 同時に走っていた Claude Code セッション: **5**（services-94=本セッション, services-85, services-d5, services-6f, services-66）
- 稼働時間: d5 と 66 が 13h、85 と 6f が 7h（本記事執筆時点）
- セッションには役割名が付いていた形跡あり（PR コメントに「**services-d5 / CI 担当**」という自称）
- worktree を多用した並行作業:
  - `.claude/worktrees/agent-<id>` 配下に 12 個の agent worktree
  - scratchpad 配下にセッション固有の `wt-106` `wt-22` `wt-47` `wt-54` `wt-27` `wt-33` `verify` など
  - リポジトリ兄弟ディレクトリに `services-66`, `services-ci`
- ブランチ命名が役割で割れている: `feat/` `fix/` `ci/` `docs/` `test/` `chore/` + issue 番号
- PR 1本あたり comments=1〜4 / reviews=1〜2。**レビューは別セッションが担当**

## 4. マルチエージェント協業のガバナンス（記事の目玉）
- ルール: **マージは PR を出したエージェント以外が行う**（user の方針）
- 技術的背景 = issue #58:
  - 全セッションが同じ GitHub アカウント `tanahiro2010` で認証 → `Can not approve your own pull request`
  - **プランを上げても public 化しても解消しない**（GitHub はアカウント単位で拒否）
  - ruleset で `required approvals >= 1` を張ると **誰も満たせずマージが永久に止まる**
  - → 「保護を張れるようになって初めて、張ると詰むことに気づく」順序の罠
  - 現状は**完全に社会的な制御。バックストップがゼロ**
  - 選択肢: 別アカウント/GitHub App を用意 / 受容して threat-model に明記 / 人間が全 PR を Approve
  - 実際の着地: `docs/threat-model.md` に受容済みリスクとして記録（commit 918537b）
- 外部レビュアーも動いていた: **Codex（chatgpt-codex-connector）** と **Copilot**（quota 切れで実質不参加）
- PR #60 の実際のコメント: 「LGTM、マージして良いと思います（**私はマージしません**）」＋「同じ GitHub アカウントで動いているため正式な Approve は API に拒否されます。コメントで代替します」

## 5. セッション間レビューが実際に捕まえたもの（PR 本文・コメントから）
### PR #45 レビュー（別セッションによる）
- **`LogoutUseCase` に失効済みトークンで全デバイスログアウトできる欠陥**
  - `findByTokenHash` は契約上「期限切れ・失効済みも返す」。logout だけが `isUsableAt` を通っていなかった
  - 影響: 盗まれたトークンを利用者が失効させても、`logout?all=true` は通り続ける。**失効させたトークンが「その利用者を永久に締め出す権限」として残る**
  - 「今は OTP 未実装で悪用できないが、**#9 が入った瞬間に有効になり、そのとき誰もこのコードを見返さない**」という指摘
  - → commit f2ddc75 `fix(auth): 失効済みトークンでの全デバイスログアウトを塞ぐ`
### PR #60 レビュー
- 修正対象の隣のテーブルに**同じバグが残っている**ことを指摘（`users.primary_email` の一意制約が無条件）→ issue #62 へ
- 「適用済みマイグレーションを書き換える習慣そのものが後で刺さる。**追記のみ、という不変条件は保てるうちに保つ方が安い**」
### PR #41（scaffold）で脅威モデル作成レビューが捕まえた 5 件
- `IP_HASH_PEPPER` 未設定時に公開既定値 `"dev-pepper"` へ無言フォールバック
- `SessionListItem` に `ipHash` が載り dashboard がブラウザへ中継していた
- Origin 検証が fail-open（`origin !== undefined &&`）
- dashboard が開発用 Cookie 名をハードコード（本番 `__Host-` を永久に読めない）
- `User.isActive` が `status` しか見ず、論理削除ユーザーがログインし続けられた
### PR #41 の独立検証（services-d5 / CI 担当）
- main に CI が無い段階で、**PR #1 の CI と本 PR を実際にマージしたツリーを作って手元で CI 相当を全部流した**
- 「マージ順は本 PR → PR #1。逆順だと PR #1 が baseline 失敗で赤くなる」という順序の提言

## 6. 技術的な工夫（コードとドキュメントから確認済み）
### 6.1 レイヤ依存の ESLint 強制が設計圧力として働いた
- `packages/config/eslint.layers.js` の `no-restricted-imports`
- 禁止リスト: `hono`, `hono/*`, `drizzle-orm`, `drizzle-orm/*`, `cloudflare:*`, `@u18/db`
- Domain は上位 4 ディレクトリも全部禁止（外向きの矢印を 1 本も引けない）
- **実例**: `health.routes.ts` が疎通確認で `sql\`select 1\`` を直接呼び lint が落ちた
  - 「ヘルスチェックくらい例外でよいのでは」→ **例外を足さず Port を 1 本足した**
  - `DatabaseProbe.ping()` を定義、`DrizzleDatabaseProbe` が到達不能も例外でなく `false` で返す
  - 結果、Presentation には「DB に到達できるか」という**意味だけ**が残った
### 6.2 認可コードの原子的単回交換
- `UPDATE ... WHERE code_hash=? AND consumed_at IS NULL AND expires_at>? RETURNING *` の **1 文**
- SQLite が書き込みを直列化するので同時 N 本でも成立は 1 本
- 「SELECT → 判定 → UPDATE の 2 文に分けないこと」をコメントで明示
- `test/oauth-code-concurrency.test.ts` が**実 D1 上の 10 並列**で固定。2 文に戻すと 10 件全部成功してテストが落ちることを確認済み
- リプレイ時は RFC 9700 §4.1.2 に従い **1 回目に発行した Access Token も失効させる**
### 6.3 署名鍵ローテーションを Domain に置いた
- `domain/services/signing-key-rotation.ts`
- **Worker 本体と運用スクリプト `scripts/signing-key.mjs` が文字どおり同じ関数を呼ぶ**
  - 理由: 検査を別コードで書くと「スクリプトは OK と言ったのに Worker は署名できない」が起こる
- `SIGNING_KEY_JWK` を **単一 JWK でも JWK Set でも**受ける
  - 新旧 2 鍵を 1 Secret に同居 → **どちらで署名するかを Secret ではなく DB の `signing_key_metadata.active_from/active_until` が決める**
  - 却下案: `SIGNING_KEY_JWK_NEXT` を足す形。理由は「鍵の切り替えが複数 Secret を矛盾なく更新する操作のままになる」
  - 旧実装は Secret 2 本を数秒以内に更新しろという runbook だった（その窓で発行されたトークンは「旧 kid を名乗る新鍵署名」で全 RP 検証失敗）
- 不整合の種類を型で列挙し、**ローテーション中に正常に現れるもの**と**運用ミス**を `isMisconfiguration()` で区別
### 6.4 アカウント列挙を 1 バイト単位で塞ぐ
- `StartEmailOtpUseCase` は未登録アドレスでも成功と同じ応答
- `PasskeyLoginOptionsUseCase` は**入力を一切受け取らない**（`allowCredentials` を返さない）
- OTP 検証の失敗は不一致・期限切れ・試行上限・形式不正を**すべて同じ文言・同じ 400 に畳む**
  - 「上限だけ 429 にすると『そのアドレス宛にコードを出した』＝登録済み、と分かる」
- `test/login.ui.test.ts` が**登録済みと未登録で応答が 1 バイトも変わらない**ことを固定
- NFC も同様: 解決できないカードは未発行・未紐づけ・無効化済み・遷移先未設定で**全部同じ 404**
### 6.5 JS 無しで成立するログイン
- `hono/jsx` の SSR。**メール OTP でのログインは JavaScript を 1 行も必要としない**
- JS が要るのは `navigator.credentials.get()` を呼ぶ Passkey のボタンだけ → `hono/jsx/dom` のアイランドに切り出し
- 同意画面は **JS を 1 行も使わない**（認可の可否を決める画面が JS 読み込み失敗で操作不能になるのを避ける）
- HonoX を入れなかった理由: ファイルベースルーティングと Vite 前提が Layered Architecture（ESLint 強制）と `wrangler.jsonc` に噛み合わない
- CSP に `'unsafe-inline'` も nonce も使わない → アイランドもスタイルも外部ファイル配信
  - `test/login.ui.test.ts` が `'unsafe-inline'` の混入とインライン `<script>` の出現を落として止める
- クライアント JS は esbuild で **TypeScript の文字列定数**として吐く（`ui/generated/login-island.bundle.ts`）
  - Workers Assets を使わなかった理由 2 つ: ①静的ファイルが Worker より先にリクエストを拾う経路が増える ②`pnpm test` が workerd 上なのでアセットサーバーの挙動まで再現できるとは限らない
  - **生成物はコミットしない**（ソースと食い違う状態を作らない）。dev/build/typecheck/test が全部先にスクリプトを走らせる
- アイランドの型検査は `tsconfig.client.json` で**別に**行う（本体に `lib: ["DOM"]` を足すと Domain 層から `document`/`window` が見えてしまう）
### 6.6 form POST は Origin 検証 + CSRF トークンの二重
- JSON API は `isAllowedOrigin()` だけで足りる（`fetch` は必ず Origin を送る）
- HTML の form は Origin の付き方がブラウザ・設定依存 → fail-closed な Origin 検証だけに寄せると**正規の利用者が締め出される側に倒れる**
### 6.7 `return_to` の許可制
- `/oauth/authorize` で始まる相対パスだけを通す
- 「同一オリジンなら」でも「相対パスなら」でもない理由: `//evil.test/` と `/\evil.test` がブラウザによって別オリジンの絶対 URL として解釈される
### 6.8 失敗を例外でなく値で返す
- UseCase の戻り値は `UseCaseResult<T>`、RPC 境界は `RpcResult`
- 監査ログの書き込み失敗がそのまま認証停止にならないよう `settleSideEffects`（`Promise.allSettled`）
  - 一方 `IssueSessionUseCase` のトークンハッシュ / IP ハッシュは保存必須なので `Promise.all` と使い分け
### 6.9 D1 を 2 つに分けた理由
- Identity と NFC は別パッケージ・別 D1・別マイグレーション
- 「将来分けやすいから」ではなく **D1 binding に行レベルの粒度が無いので、同じ DB を共有した時点で nfc-worker の侵害が `sessions` の露出になる**から
### 6.10 NFC の不変条件
- カード ID はユーザー ID と独立した 100bit 乱数（タグを読んでも `sub` は分からない）
- タグ自体は資格情報ではない。紐づけに「セッション」と「タグに書かれていない紐づけコード」の両方が要る
- 遷移先は `https:` のみ。URL 内資格情報 / IP リテラル / イントラネット名 / 既定外ポート / IdP 自身のオリジンを拒否
- **ここで登録された URL を OIDC の `redirect_uri` として許可しない**（IdP 公認のオープンリダイレクタになる）
- リダイレクトは **302 + `no-store`**（301 だとブラウザが無期限キャッシュし、紛失時の無効化が届かない）
- 譲渡は「相手の userId を指定する API」にしていない（ユーザー検索 RPC を足したくない＝任意ユーザーを引ける入口になる）
### 6.11 Cookie 境界の設計（決定 1）
- `__Host-` 接頭辞は Domain 属性を持てず発行ホストにしか送られない
- → auth と dashboard を**同一ホストに載せ `/account/*` のパスで分離**（Cloudflare は長い pattern を優先）
- WebAuthn の RP ID はホストではなく**ゾーン `under18.dev`**（IdP のホスト名を変えても登録済み Passkey を失わない）
- 落とし穴: Cloudflare は一致した接頭辞を URL から取り除かない → Worker には `/account/api/me` がそのまま届く（#106 で全エンドポイント到達不能だった）

## 7. 記録された「決定」10 件（docs/u18-identity-spec.md §14.1）
1. Issuer `https://auth.under18.dev` / 同一ホスト + `/account/*` / RP ID はゾーン
2. 初回登録に Passkey を必須にしない（復旧手段がメール OTP だけの現状で必須化すると紛失時に詰む）
3. Email OTP は **Cloudflare Email Sending**（`send_email` binding）。外部 API キーの Secret を持たない
4. Auth UI は auth-worker から配信（Cookie 境界と CSRF 境界を増やさない）
5. Access Token は **不透明トークン + DB 失効**（JWT だと失効に introspection が要る）
6. OIDC Provider フレームワークは採らず、組み立ては自前・暗号は `jose`・WebAuthn は `@simplewebauthn/server`
7. アカウント削除は**物理削除しない**（凍結/BAN/無効化。メールは解放されない）
8. 管理者は **Passkey 必須**。メール OTP 単独ではログインも復旧も不可。一般利用者に TOTP は入れない
9. **PKCE S256 必須を維持し、OIDC Basic OP の認証取得を狙わない**
   - Basic OP プランの大半は `code_challenge` を送らないので PKCE 必須だと `invalid_request`
   - 認証のために免除フラグを入れると「**PKCE 無しでも認可が成功するため防御が消えたことに気づく手段が無くなる**」
   - Basic OP も流すが目的は合格でなく「**落ちる理由が PKCE 必須だけであることの証明**」
10. **ES256 のみ維持。Discovery が RS256 を MUST としているが意図的に非適合とし記録に残す**
   - 2 つの alg を広告＝RP に選択させる＝alg の多様性の導入。alg confusion は OIDC で最も繰り返された脆弱性系統
   - RS256 MUST の目的は「任意の RP が任意の OP を検証できる」相互運用だが、**外部 Developer Portal が非目標でクライアントは内部管理のみ＝その保証の受益者が存在しない**
   - 広告だけ RS256 を足して実際は ES256 でしか署名しない形は採らない

## 8. CI/CD の工夫
- `ci.yml`: lint / typecheck / test / build。PR は後続 push で打ち切り、**main は打ち切らない**（デプロイ判断の根拠を消さない）
- GitHub Actions を**コミット SHA で固定**（#49）
- **静的な突き合わせ検査**を 3 つ入れている（デプロイしてみるまで待てないため）:
  1. `pnpm check:bindings` — Service Binding の宛先が同じ env の Worker 名と一致するか（#57/#42）
     - `wrangler deploy --dry-run` はリモートを見ないので存在しない Worker を指しても正常終了する
     - 「#42 の取り違えは**レビューで見つかったのであって CI では一度も捕まっていない**」
  2. codeql-action の init / analyze が**同一 SHA か**を grep で検査
     - CodeQL ジョブは public リポジトリでしか動かない → private の間は壊れた組み合わせでも無信号。**public 化した日に初めて露見する**
  3. `worker-configuration.d.ts` の drift 検査（`cf-typegen` を走らせて差分が出たら落とす）
     - 再生成を忘れると「実際の binding と食い違った型のまま typecheck が緑で通る」
- `pnpm audit` は `--prod` を blocking、dev を informational に分離
  - 理由: dev の `zod` 脆弱性は pool-workers 配下で、**pool-workers を上げない限り消えない**
- Dependabot に **7 日の cooldown**（#101）、Cloudflare ランタイム一式を同一グループ（#24）、codeql init/analyze を同一グループ（#71）
- デプロイ後に `/health` を叩くスモークテスト（#66, #97, #107）

## 9. バージョン固定という名の地雷原（README に長文で記録）
- TypeScript **5.9.3** 固定 — `typescript-eslint@8.72.0` の peer が `<6.1.0`。上げると型情報を使う lint が壊れるが **`pnpm typecheck` だけは通ってしまう**
- vitest **4.1.12** 固定 — `@cloudflare/vitest-pool-workers@0.23.0` の peer。0.23 で `defineWorkersConfig()` は廃止、`cloudflareTest()` プラグインへ
- `compatibility_date` = **2026-08-15**（今日の日付ではない）
  - pool-workers 同梱 workerd のビルド日より後にすると **テストが 1 件も実行されず `ERR_FUTURE_COMPATIBILITY_DATE`**
  - `wrangler dev` と `deploy` は新しい日付でも通る → 「**ローカルの dev は動くのに `pnpm test` だけ全滅する**」という形で現れる
- **lockfile に wrangler / miniflare / workerd がそれぞれ 2 つずつ入っている**（#108）
  - テスト: pool-workers 0.23.0 → miniflare 5.20260815.0-**alpha** → workerd 1.20260815.1（8/15 ビルド）
  - dev/deploy: wrangler 4.152.0 → miniflare 5.20261019.2-**beta** → workerd 1.20261019.1（10/19 ビルド）
  - **どちらの miniflare も prerelease。テストが緑であることの意味がその分弱い**と明記
- `minimumReleaseAgeExclude` は書いてあるが `minimumReleaseAge` 本体が未設定 → **現状この除外は何も除外していない**（#101）と正直に記録

## 10. テストの仕組み
- `@cloudflare/vitest-pool-workers` の `cloudflareTest()` で **テスト本体が workerd の中で実行**され、`cloudflare:test` から実物の D1 binding を触る
- `packages/domain` だけ素の `defineConfig()`（Node 上）→ **レイヤ分割の副次的な検算になっている**
- マイグレーションは **Node 側で `readD1Migrations` して読み、workerd 内の `test/setup.ts` で `applyD1Migrations`**（workerd 内では `node:fs` が使えないため）
- テストは wrangler ではなく生成済み SQL を直接流す → 生成を忘れるとテストと実装のスキーマがずれる

## 11. 未解決で残したもの（記事の誠実さのため）
- #5 本番 D1 未払い出し（`database_id` が placeholder）
- #26 public 化 + CodeQL / dependency-review
- #28 OIDC 適合性テスト（Config OP は通した。Basic OP は決定 9 の通り）
- #58 マージの機械的バックストップ無し → threat-model に受容済みリスクとして記録
- #83 管理者ロール（実装中。is_admin 列 / Passkey 限定 / 最後の Passkey 削除禁止 / 内部 CLI）
- #101 `minimumReleaseAge` 未設定
- #108 テストと deploy で別 workerd
- #119 dashboard のルート定義がレイヤ lint の対象外
- #122 監査ログに ip_hash / user_agent がほぼ空（対応 PR #131 進行中）
- #125 `/api/me` 系に `Cache-Control: no-store` が無い（RR-10）
- #126 セッション検証の応答時間からトークンの実在が漏れる（RR-15）
  - 修正に `waitUntil()` が要り、`ExecutionContext` を Application 層へ引き回す設計判断を伴うため**意図的に保留**
- #39 外部 Developer Portal（決定 11 として方針記録中、PR #130）

---

## 12. 【追記】本番デプロイ成功（2026-10-24 21:26、指揮役 services-6f が実施）
取材中に状況が動いた。**§11 の「本番 D1 未払い出し」は解消済み。**

- **#5 CLOSED** / **PR #129 MERGED** — `chore(infra): D1 を払い出して database_id を設定する`
  - 続けて `e5b7463 chore(infra): EMAIL_FROM を no-reply@ に揃え、本番の署名鍵と pepper を投入する (#5)`
  - → `REPLACE_WITH_D1_DATABASE_ID` の placeholder が実値に。本番の `SIGNING_KEY_JWK` と `IP_HASH_PEPPER` も投入済み
- **PR #132 MERGED** — `fix(deploy): クライアントバンドルの生成を Worker のビルド定義に移す`
- PR #133 OPEN — そのコメントを実態に合わせる追従

### PR #132: 初回の実デプロイが落ちて初めて見つかった穴（記事の締めに最適）
```
✘ [ERROR] Could not resolve "./generated/login-island.bundle"
    src/presentation/http/ui/login.routes.tsx:12:32
```
**原因が二重だった**:
1. `package.json` の `dev` / `build` / `typecheck` / `test` は生成を前に挟んでいたが、**`deploy` だけが挟んでいなかった**
2. さらに `deploy.yml` は `pnpm exec wrangler deploy` を**直接**呼ぶので、package.json のスクリプト自体を迂回する
→ **`deploy` スクリプトを直しても CI は救えない。**

**直し方**: 生成を npm スクリプトではなく **Worker のビルド定義**（`wrangler.jsonc` の `build.command`）に置いた。
```jsonc
"build": { "command": "node scripts/build-client.mjs" },
```
→ `dev` / `deploy` / `--dry-run` のどの経路から入っても必ず走る。`.github/**` を触らずに CI も救える。
**生成物をコミットする案は採らない**（#36 が避けた理由「ソースと食い違ったバンドルが本番へ出る」がそのまま残っている）。
検証: 生成物を `rm -rf` した状態から `wrangler deploy --dry-run` が `Total Upload: 2024.24 KiB` で通ることを確認。

**なぜ CI をすり抜けたか**（PR 本文の自己分析が秀逸）:
> `build` ジョブは `pnpm build` を呼び、それは package.json 経由なので生成が走る。
> **`deploy` だけが別経路で、しかも deploy は PR では動かない。**「CI が緑でも deploy で落ちる」経路が 1 本だけ残っていた。
> このリポジトリで繰り返し出ている「**検査はあるがこの経路だけ通らない**」の系統（#88 / #96 / #106 / #122）にもう 1 件加わった形。

→ **記事の第 4 章「検査が嘘をつく」カタログの 8 件目であり、同時に最終章の締めになる。**
　「1 日の最後に本番へ出したら、その日ずっと追いかけていたのと同じ形のバグが 1 件出てきた」という構図。

### §11（未解決）の訂正
- ~~#5 本番 D1 未払い出し~~ → **解消**
- 残るもの: #26 public 化 / #28 適合性テスト（d5 が最終結果を取りまとめ中）/ #83 管理者ロール /
  #101 / #108 / #119 / #122（PR #131 レビュー待ち）/ #125 / #126（意図的に保留）/ #39（PR #130）
- **RR-19 の記録（PR #128）もまだ未マージ**
