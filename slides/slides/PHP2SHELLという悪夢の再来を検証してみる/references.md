# references — PHP2Shell（CVE-2026-109618 / CVE-2026-109619）

| | |
| --- | --- |
| 調査日 | 2026-10-21（JST 16:40 時点） |
| 対象 | PHP の重大脆弱性 2 件「php2shell」。CVE-2026-109618 / CVE-2026-109619 |
| 用途 | slide.md / article.md（PRD.md 準拠） |
| 計測環境 | php/php-src master を raw 取得して静的に確認。Apple M4 (arm64) / macOS 25.5.0 |

> ⚠️ **公式パッチはまだ出ていない。** PHP 公式の予告は 2026-10-21 **14:00 UTC（＝23:00 JST）**。
> 本調査はその**7時間前**に実施。「原因」「影響バージョン」「修正版番号」は**公式未開示**で、
> 下の表で ✅ になっているのは (a) PHP 公式が予告で明言した事実、(b) php-src を自分で読んで確認できた構造、
> この 2 つだけ。原因まわりはほぼ ⚠️（二次・推測）か ⬜（パッチ公開待ち）。
> **記事・スライドの最終版は 23:00 JST のリリース後に必ず更新すること**（PRD §執筆方針）。

## 確認した主張

| # | 主張 | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | CVE 2 件、ともに CVSS v4.0 **9.2** | ✅ 確認 | php.net 公式予告 + Flatt が一致 |
| 2 | 公式リリースは 2026-10-21 14:00 UTC（23:00 JST）、"two critical vulnerabilities" | ✅ 一次 | php.net/archive/2026 |
| 3 | 公式が言っているのは「2 件・critical・CVSS 9.2・日時」**だけ**。CVE番号/原因/RCE/影響バージョンは公式が**一切出していない** | ✅ 確認 | php.net 予告に記載なし（実確認） |
| 4 | CVE 番号・"Session Upload Progress"・"RCE" はリークと研究者発であって公式ではない | ✅ 確認 | php.net に無し / Flatt も「Embargoに不関与」と明記 |
| 5 | 推定原因は `ext/session` の Session Upload Progress に関わる**メモリ破壊** | ⚠️ 二次のみ | Flatt（「見られます」と推測で明記） |
| 6 | 具体的には `php_session_rfc1867_callback()` の heap UAF | ⚠️ 二次・未確認 | J4ck3LSyN の分析（lilting.ch 経由） |
| 7 | **その関数は実在し、ext/session が multipart パーサにフックしている** | ✅ **実測** | php-src を読んだ（下の「計測」） |
| 8 | `session.upload_progress.enabled=0` は**完全な対策ではない** | ✅ 確認 | Flatt の 14:00 追記 + 複数研究者 |
| 9 | なぜ不完全か＝upload_progress を切ると session コールバックは早期 return するが、multipart パーサ本体は動き続ける | ✅ **実測（構造）** | php-src。ただし「2つ目のバグがそこにある」は ⚠️未確認 |
| 10 | `session.upload_progress.enabled` のデフォルトは **On** | ✅ 実測 | php-src の INI 既定値 `"1"` |
| 11 | 影響は **PHP 5.4 以降すべて** | ⚠️ リークの主張 | リークツールのバナー主張。Sansec は断定気味だが根拠はリーク。公式未確認 |
| 12 | 修正版は 8.5.12 / 8.4.27 / 8.3.36 / 8.2.35 | ⬜ 未確認 | J4ck3LSyN の**推測**。パッチ未公開。直近の実在リリースは 8.x.11 系（9月） |
| 13 | watchTowr が **CVE-2026-109618 を再現**（もう片方は未記載） | ⚠️ 二次 | Huntress 経由 |
| 14 | 野良攻撃（ITW）は未観測 | ✅ 一次（時点付き） | Huntress「As of October 20 … has not seen in-the-wild exploitation」 |
| 15 | 重大度が**公式 9.2 と watchTowr 10.0 で食い違う** | ✅ **両方実在（実確認）** | 公式=CVSS v4.0 9.2 / watchTowr CEO **Benjamin Harris** が実名で "Both of them are **CVSS10**"（BleepingComputer）＋削除済み HN ポスト（`petecooper`）も 10.0 |
| 16 | 8.1 以下は EOL で**公式修正なし** | ✅ 確認 | php.net「8.2 以降のみサポート」+ Sansec / Huntress |

---

## 1. 公式が「確定」として出した事実はどこまでか

**判定: 確認。ここが記事の背骨になる。**

- [Upcoming Critical PHP Security Release](https://www.php.net/archive/2026.php)（2026-10-20）— 一次。全文はこれだけ:
  > "advance notice of an upcoming security release." / "scheduled for Wednesday, 21 October 2026 at 14:00 UTC." /
  > "It addresses two critical vulnerabilities, both rated CVSS v4.0 9.2." /
  > "We reserve the right to release earlier should details … become public, or … active exploitation appear in the wild." /
  > "Full details, affected versions, and the fixed versions will be published with the release."
- **公式が言っていないこと**（実確認）: CVE 番号 / 脆弱性クラス（RCE とすら書いていない）/ 原因機能 / 影響バージョン / 修正版番号。

### 記事に使える切り口

- **「公式が確定した事実」と「リーク・研究者の推測」を分ける軸**が、そのまま記事の構成になる（PRD §2 の 3 分類）。
- 公式は "RCE" とも "session upload progress" とも書いていない。**この見出しは全部二次情報由来**。ここを混ぜると記事の信頼が落ちる。
- **スコアそのものが割れている**のが、その軸の一番分かりやすい実例（#15）。公式 PHP は CVSS v4.0 **9.2**、
  一方で再現に成功したと主張する watchTowr の CEO Benjamin Harris は **"Both of them are CVSS10"**（BleepingComputer）。
  「同じ脆弱性の重大度が、公式と第三者で違う数字で流通している」＝**読者が今まさに混乱しているポイント**なので、記事の早い段階で両論を並べて整理すると効く。

---

## 2. 推定原因（Session Upload Progress / メモリ破壊）

**判定: 二次ソースのみ。すべて「推測」と出どころを付けて書く。**

- [GMO Flatt Security Blog（php2shell）](https://blog.flatt.tech/entry/php2shell) — 日本語の主力二次ソース。原文の留保がそのまま使える:
  > 「PHP の Session Upload Progress 機能に関わるもの（ext/session に関わるもの）と見ています」
  > 「これによれば本脆弱性はメモリ破壊脆弱性と見られます」
  > 「弊社の独自調査と『php2shell脆弱性』が一致する限りにおいて」
  - Flatt は「Embargo ないしは開示調整に関与していません」「記述の一部には不正確な情報が含まれている可能性があります」と明記。**推測であることを自分で強調している。**
- [lilting.ch（session-upload-progress UAF）](https://lilting.ch/en/articles/php2shell-session-upload-progress-uaf) — 二次。研究者 J4ck3LSyN の分析を引用:
  > "Heap UAF in `php_session_rfc1867_callback()`" / もう 1 件は "triggered in the multipart parser … regardless of this setting"
- [Sansec](https://sansec.io/research/php2shell) / [Huntress](https://www.huntress.com/blog/php2shell-leaked-critical-php-vulnerabilities) — **技術的な原因には踏み込んでいない**。「RCE in PHP core」までしか言わない。UAF / session / multipart という語は出てこない（実確認）。

### 記事に使える切り口

- 原因の具体性は **J4ck3LSyN（最も具体・自力検証）＞ Flatt（自社調査との一致範囲）＞ Sansec/Huntress（クラスのみ）** の順。記事ではこの濃淡をそのまま書く。
- **関数名が出たからといって確定ではない。** そこで「じゃあその関数は本当に存在するのか、構造はどうなっているのか」を自分で確かめたのが下の計測。

---

## 3. 「upload_progress を切れば安全」はなぜ不完全なのか

**判定: 不完全という結論は確認。理由の“機構”は php-src で裏が取れた。**

- Flatt の **2026-10-21 14:00（JST）追記**（原文）:
  > 「本設定変更は、役に立つ可能性はありますが、攻撃は依然として可能であると見られ、ややの緩和策に留まります。根本的にはパッチが必要です。」
  > TL;DR 追記:「攻撃自体は回避できない見込みです」
- [ITmedia](https://www.itmedia.co.jp/news/article/2610/21/2000002462/) も同じ追記を報道（「単体では完全な対策にならないことが判明」）。
- 研究者（J4ck3LSyN）:「この設定で止まるのは 2 件のうち 1 件だけ。もう 1 件は multipart パーサで発火し、設定に関係ない」。

### 記事に使える切り口（←ここが本デッキの独自パート）

- 「なぜ 1 件しか止まらないのか」を**ソースの構造で説明できる**。下の計測で、
  - 設定を切ると session 側コールバックは `if (!PS(rfc1867_enabled)) return;` で即抜ける＝1 件は塞がる
  - でも multipart パーサ（`main/rfc1867.c`）は**全ての multipart アップロードで無条件に走る**
  - → 「設定 ≠ 根本対策」が、推測ではなく**コードの事実**として言える。
- ⚠️ ただし「2 件目が本当に multipart パーサにある」ことは**未確認**（研究者の主張）。記事では「設定が効かない経路がコード上あり得る」までに留め、断定しない。

---

## 計測（自分で取った一次ソース）

### php-src の構造マップ：multipart パーサ → session コールバック

二次ソースが名指しした `php_session_rfc1867_callback()` が**実在するか・どう呼ばれるか**を、
php/php-src の master を直接読んで確認した。

```sh
# ext/session のソースを raw で取得
curl -sL https://raw.githubusercontent.com/php/php-src/master/ext/session/session.c -o /tmp/php_session.c

# 名指しされた関数が実在するか
grep -nE "php_session_rfc1867_(callback|early_find_sid)" /tmp/php_session.c
#  59: 宣言 / 3221: 定義 / 3142: php_session_rfc1867_early_find_sid

# 設定を切ったときの早期 return
sed -n '3221,3230p' /tmp/php_session.c
#  if (!PS(rfc1867_enabled)) { return retval; }   ← enabled=0 ならここで抜ける

# INI の既定値
grep -n "session.upload_progress" /tmp/php_session.c
#  enabled  "1"   cleanup "1"   prefix "upload_progress_"
#  name "PHP_SESSION_UPLOAD_PROGRESS"   freq "1%"   min_freq "1"

# multipart パーサ側のグローバルフック
curl -sL https://raw.githubusercontent.com/php/php-src/master/main/rfc1867.c \
  | grep -nE "php_rfc1867_callback"
#  51: PHPAPI ...(*php_rfc1867_callback)(...) = NULL;   ← グローバルフック
#  767,878,971,...: multipart の各イベントで無条件に呼ばれる
```

確認できた構造:

| レイヤ | ファイル | いつ動くか |
| --- | --- | --- |
| multipart パーサ本体 | `main/rfc1867.c` | **全ての `multipart/form-data` POST で無条件**。グローバル `php_rfc1867_callback` を各イベントで呼ぶ |
| session のフック登録 | `ext/session/session.c` MINIT (L3034-3035) | `php_rfc1867_callback = php_session_rfc1867_callback;` でパーサに相乗りする |
| session のコールバック | `ext/session/session.c` (L3221) | 先頭で `if (!PS(rfc1867_enabled)) return;` ＝ **`session.upload_progress.enabled=0` なら即抜ける** |

→ **`session.upload_progress.enabled`（既定 On）を切っても、multipart パーサ本体は走り続ける。**
これが「設定変更だけでは不完全」の構造的な裏付け。

> ⚠️ これは「設定を切っても動く経路がある」ことの証明であって、
> **「2 件目の脆弱性がそこにある」ことの証明ではない。** 原因の特定はパッチ公開後。

### Session Upload Progress の正常仕様（記事の前提説明用）

- [PHP Manual — Session Upload Progress](https://www.php.net/manual/en/session.upload-progress.php) — 一次。
  - トリガ: `multipart/form-data` に `session.upload_progress.name`（既定 `PHP_SESSION_UPLOAD_PROGRESS`）という hidden field を**ファイル入力より前に**置く。
  - 保存先: `$_SESSION["upload_progress_<value>"]` に `content_length` / `bytes_processed` / `files[]` などが書かれる。
  - 進捗はユーザスクリプトが走る**前**に書かれる（＝アプリ認証より手前で動く。PRD S-02 の「認証境界の手前」の裏付け）。
  - `enabled` の既定値はマニュアル本文に明記なし → **ソースで `"1"`（On）を確認**（上記）。

### 環境・時点

- php/php-src master を 2026-10-21 16:40 JST 時点で取得。行番号は master のスナップショット。
- **パッチ未公開のため、ここで見ているのは「修正前の現行コード」**。23:00 JST の修正後に diff を取る（PRD R-07 / D-09）。

---

## 未確認・積み残し（パッチ公開＝23:00 JST 後にやる）

- [ ] **公式リリース本文**（CVE 番号・影響バージョン・修正版番号・クラス）の確認 → 表 #3 #11 #12 を更新
- [ ] 修正コミットの diff を読む（根本原因の確定）→ #5 #6 #9 を推測から事実へ
- [ ] `php_session_rfc1867_callback()` / `main/rfc1867.c` が実際に触られたか、別の場所か
- [ ] 影響バージョン 5.4+ が公式に裏付くか（#11）／修正版が 8.2.35 系かどうか（#12）
- [ ] Docker で修正前後の正常系比較（PRD D-01〜D-09）。※攻撃再現は対象外（PRD §4.2）
- [ ] `session.upload_progress.enabled=0` が正常系にどこまで影響するか（機能互換）を実測

## 探したが取れなかった / 使わないもの

- **原因の一次情報** — 公開時点では存在しない（Embargo 中）。Flatt も「不関与」。推測を事実として書かない。
- **CVSS 10.0 を「与太」として切り捨てない（#15）** — 匿名 SNS の数字ではなく、**実名・記録に残る発言**。
  記事では「公式 9.2 と watchTowr の 10.0 が食い違っている」と**両論で**書く。CVSS v4.0 は評価者で割れる余地があり、どちらかを「誤り」と断じない。
- **実際の攻撃コード / PoC・ペイロード** — PRD §4.2 で対象外。references にも貼らない。
- **リークツール（PHP2Shell, Calif.IO 作とされる）の動画・スクショ** — 「5.4+ に効く」はツール側バナーの主張であって検証事実ではない（Sansec も "the tool's own claim" と明記）。出どころ付きで「主張」としてのみ言及可。

## ソース一覧

| ソース | 種別 | URL |
| --- | --- | --- |
| PHP 公式リリース予告 | 一次 | https://www.php.net/archive/2026.php |
| PHP Manual（Session Upload Progress） | 一次 | https://www.php.net/manual/en/session.upload-progress.php |
| php/php-src（session.c / main/rfc1867.c） | 一次（自分で読む） | https://github.com/php/php-src |
| GMO Flatt Security Blog | 二次（主力・日本語） | https://blog.flatt.tech/entry/php2shell |
| Sansec research | 二次 | https://sansec.io/research/php2shell |
| Huntress Rapid Response | 二次 | https://www.huntress.com/blog/php2shell-leaked-critical-php-vulnerabilities |
| lilting.ch（UAF 技術解説） | 二次（研究者分析の集約） | https://lilting.ch/en/articles/php2shell-session-upload-progress-uaf |
| ITmedia（Flatt 追記を報道） | 二次 | https://www.itmedia.co.jp/news/article/2610/21/2000002462/ |
| 窓の杜 | 二次 | https://forest.watch.impress.co.jp/docs/news/2149962.html |
| BleepingComputer | 二次 | https://www.bleepingcomputer.com/news/security/php-warns-admins-of-two-critical-flaws-emergency-patches-coming-tomorrow/ |
