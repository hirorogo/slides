# 取材 2 巡目（第 2 便）: services-d5 — typegen drift 10 連発 / ドライバ 3 版 / CI 設計の反省

## ★A. typegen drift は 4 回ではなく **10 回**。全部同じ根

> **12:05:39 UTC から 12:39:44 UTC の 34 分間に 10 本の CI 実行が落ちている。全部同じステップ**
> （`Check generated Worker types are up to date`）。

落ちたブランチは横断的: main / `chore/5-provision-d1` / `fix/deploy-client-bundle` /
`feat/83-admin-role` / `test/28-basic-op-run` / `ci/stale-build-comment`

**最初と最新で drift の中身が完全に一致**:
```diff
@@ -13,9 +13,6 @@ interface __BaseEnv_Env {
-	SIGNING_KEY_JWK: string;
-	SIGNING_KEY_KID: string;
-	IP_HASH_PEPPER: string;
```

**起点の特定方法**: `git log -S "SIGNING_KEY_JWK: string;"` で、コミット済み `.d.ts` に Secret 行が入ったのが
**`4859a7f chore(infra): D1 を払い出して database_id を設定する (#5)`** だと判明。
→ **本番 D1 払い出しと同じ根。**

### 「CI にだけ出て手元には出ない」構造
`wrangler types` は Secret の名前を **`.dev.vars` から拾う**。`.dev.vars` は gitignore 済み。
→ **生成結果が「生成した人の手元に何があったか」で変わる。**
D1 を払い出した人は Secret をローカルに設定済みだったので、その環境で生成した `.d.ts` に 3 行が入った。
CI には `.dev.vars` が無いので再生成すると消える。**手元では絶対に再現しない。**

### ★記事向けの言い方（d5 本人が提案）
> **これは「再生成を忘れた」ではなく「再生成したからこそ壊れた」ケースです。**
> drift ガードは普通「忘れ」を捕まえる道具ですが、**入力が環境依存だと正しく実行した人が壊す側に回ります。**

### 原因特定までの順序（ミスリードを含む）
1. **自分の PR #133 の CI が落ちた。まず自分の変更を疑った。**（#133 はコメント 5 行の修正で型に触っていないので筋が悪いと思いつつ）
2. 手元で `pnpm cf-typegen` を回したら drift が出た。
   **ただしこの時点では自分のローカル `.dev.vars` の行の順序（`SIGNING_KEY_KID` が先）による「並び替え差分」で、
   CI の「3 行消える」とは違う差分だった。ここで一度ミスリードされている**
3. main を直接チェックアウトして再生成 → やはり drift。自分の変更は無関係と確定
4. **main の CI ログを読んだら `@@ -13,9 +13,6 @@` で 3 行減。手元の差分と形が違う。**
   この食い違いが決め手で「**入力が環境ごとに違う**」という仮説に到達
5. `wrangler types --help` に **`--env-file`** を発見
6. `.dev.vars` の有無 × `--env-file .dev.vars.example` で A/B を取り、**出力が一致**することを確認

> **2 の「自分の `.dev.vars` の順序で別の drift が出る」が、気づきを遅らせもし早めもしました。**
> 最初は混乱しましたが、**「同じ検査が人によって違う差分を出す」という事実そのものが答えでした。**

---

## B-1. 適合性スイートのドライバ 3 版 — 各版が何で詰まったか

### v1（素の版）
認可 URL を叩いてリダイレクトを追うだけ。
→ **行き詰まり**: テストが `WAITING` のまま終わらない。ログでは「コールバックは届いている」のに完了しない。
スイートが返す HTML に **`Processing Implicit Callback`** という title があり、
**JS が `XMLHttpRequest` で fragment を POST し返す**構造だと判明。**curl はそれを実行しない。**

### v2（implicit callback 対応）
返ってきた HTML から `xhr.open('POST', "...")` の URL を正規表現で抜き、空ボディを `text/plain` で POST。
→ PKCE を送らないモジュール群は最後まで進むようになり、**1 周目 37 件を完走**。
→ **行き詰まり**: PKCE を送る唯一のモジュールだけが `WAITING` で停止。
PKCE があると `/authorize` が **`303 → /login`** に進むため、**ログインが要る**。

### （パッチ a）`mapfile: command not found`
macOS の bash 3.2 に `mapfile` が無い。consent.py の出力をタブ区切り 1 行にして `${line%%<TAB>*}` で分解。

### v3（cookie + 同意フォーム対応）
OTP でログインしてセッションを作り、cookie jar を渡し、同意画面の hidden フィールドをそのまま `decision=allow` で POST。
→ **行き詰まり**: 同意の POST が **403**、画面は「ログイン要求の内容が正しくありません」。**実装のバグかと思った。**

### （パッチ b）★一番危なかった箇所
ソースを読んだら CSRF が **double-submit cookie**（`ui/csrf.ts`）。
**d5 は cookie jar を手で組み立てていて、セッション Cookie しか入れていなかった。**
curl に `-c` を足して集めさせたら通り、そのモジュールが **PASSED**。

> **403 を「実装の不具合」として起票していたら、存在しないバグを報告していました。**

### ログインに辿り着くまでの横道（全部数えられる形で）
- `POST /api/auth/email/start` → 202 だが OTP がログに出ない。
  **未登録アドレスには送らない**作り（アカウントの有無を漏らさないため）。`purpose: "signup"` が要ると判明
- それでも出ない。**`send_email` バインディングがあると `ConsoleEmailSender` に落ちない。**
  `send_email` を外した設定を別名で置いて `--config` で起動
  （**`apps/*/wrangler.jsonc` の glob に当たらない名前**にする必要があった。
  **自分が書いた preflight と本番 dry-run が走査しているため** ← 自分の検査に自分が引っかかった）
- それでも標準出力に出ない。**wrangler の observability API**
  （`/cdn-cgi/local/explorer/api/local/observability/query`）で SQL を投げて captured logs から取得

### 通し実行の回数: **4 回**（37 / 37 / 8 で中断 / 35）
中断した 1 回は**自分が原因**:
> 検証スクリプトの `bash -x` トレースに**テストクライアントの secret が出力された**ので、そのクライアントを失効させたが、
> **実行中のプランがそれを使っていた。** 8/35 の時点で気づいて停止。

---

## B-2. `minimumReleaseAge` で install が止まったとき
**気づくまでは一瞬**（自分で有効にして自分で `pnpm install --frozen-lockfile` を叩いたので、その場で返ってきた）。
```
help: The lockfile contains entries that the active policies reject.
exit=1
```
手順:
1. ブランチを切って `pnpm-workspace.yaml` に `minimumReleaseAge: 10080` を追加
2. **`rm -rf node_modules apps/*/node_modules packages/*/node_modules` してから** `--frozen-lockfile` で install
   （**キャッシュで誤魔化されないように**）
3. 失敗。**公開 7 日未満が 20 件**。最新は `miniflare@5.20261019.2-beta`（10/22）
4. **その場で `git checkout -- pnpm-workspace.yaml` して再 install。**
   node_modules を消した状態を放置すると他の検証が全部できなくなるので最優先で戻した

> **巻き戻しは 1 コマンド。怖いのは巻き戻しではなく、これを「たぶん大丈夫」で PR にして CI に判断させていた場合。**
> そうなると **main にマージされた瞬間に全ブランチの install が止まる。**

→ ここから「cooldown を先に入れて、本体は 10/29 以降」という 2 段構えが出た。

---

## ★B-3. いま振り返って CI の設計を間違えたと思う箇所 — 4 つ（うち 2 つ未解決）

### (1) #68 の drift ガードで、生成の入力を固定しなかった
今日の 10 連発の原因。生成物を突き合わせる検査なのに入力が環境依存だった。
> **「出力を比較するなら入力を固定する」は当たり前で、それをやっていませんでした。** #136 で修正中。

### (2) preflight の `grep -c` + `pipefail`
placeholder が全部埋まった瞬間に無言で死ぬ。
> **デプロイが通るようになる当日にだけ発動するバグを、デプロイが通らない時期に書いて、通らないから気づけませんでした。**
> **構造的に「動く条件でしかテストできない」ものを書いたのが設計ミスです。**

### (3)【未解決】スモークテストを「変数未設定なら warning で skip」にした
ドメイン確定前に deploy.yml を動かすための妥協。
> **設定し忘れると検査が静かに消えます。** #110 で公開前チェックリストに入れましたが、**機械的には塞いでいません。**
> **`--passWithNoTests` と同じ構図を別の場所に作った自覚があります。**

→ **実際に本番デプロイでスモークテストが skip された**（6f 証言）。予言が当日に的中した形。

### (4)【未解決】`.github/**` を自分の lane として囲いすぎた
> #98 で「本番 dry-run は直前の `pnpm build` に依存」とコメントを書いたのに、
> **`deploy.yml` にも同じ依存があることを見ていませんでした。**
> deploy.yml は `pnpm build` を一度も走らせないので条件はもっと悪い。
> 結果、**最初の本番デプロイがこの理由で落ちています**（= PR #132）。
> 同じファイル群を自分で持っているのに、**片方に書いて満足した。結合に気づいた瞬間に横展開しなかった**のが失敗。

### ★d5 本人による (2) と (4) の対比（記事にそのまま使える）
> (2) と (4) は対になっていて面白いと思います。
> **(2) は「まだ起きない条件のコードは検証できない」、(4) は「気づいたのに運ばなかった」**
> —— 前者は構造的な難しさ、後者は単なる注意不足です。

---

## 記事での重要な含意
**PR #132（デプロイでバンドル生成が走らなかった件）の原因は、6f の整理では「`deploy` だけが別経路」だったが、
d5 の自己分析では「自分が #98 で同じ依存に気づいていながら deploy.yml へ横展開しなかった」。**
→ **同じ事象に 2 つの説明があり、両方正しい。** 前者は構造、後者は人的な見落とし。記事では両方併記するのが誠実。
