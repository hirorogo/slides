# references — PHP2Shell（CVE-2026-109618 / CVE-2026-109619）

| | |
| --- | --- |
| 調査日 | 2026-10-21（JST 16:40 時点） |
| 対象 | PHP の重大脆弱性 2 件「php2shell」。CVE-2026-109618 / CVE-2026-109619 |
| 用途 | slide.md / article.md（PRD.md 準拠） |
| 計測環境 | php/php-src のタグ（8.5.11 / 8.5.12）を raw 取得して diff。Docker + ASAN PHP 8.5.12 で実行確認。Apple M4 (arm64) / macOS 25.5.0 |

> ✅ **公式リリースは 2026-10-21 22:45 JST 時点で既に公開済み。** 予定は 14:00 UTC（23:00 JST）だったが、
> それより前に出た（予告にあった「詳細が公開された場合は前倒しする」のとおり）。修正版は
> **8.5.12 / 8.4.27 / 8.3.36 / 8.2.35** で、CVE 番号・原因・影響が公式に確定した。
> 初版の調査はリリース**約 6 時間前**に行ったため、当時の記述と現在の公式見解が混ざらないよう、
> 下の表と「2026-10-21 22:45 JST 追記」で**時点を明示して**更新している。

## 確認した主張

| # | 主張 | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | CVE 2 件、ともに CVSS v4.0 **9.2** | ✅ 確認 | php.net 公式予告 + Flatt が一致 |
| 2 | 公式リリースは 2026-10-21 14:00 UTC（23:00 JST）、"two critical vulnerabilities" | ✅ 一次 | php.net/archive/2026 |
| 3 | 公式が言っているのは「2 件・critical・CVSS 9.2・日時」**だけ**。CVE番号/原因/RCE/影響バージョンは公式が**一切出していない** | ✅ 当時（10/20 予告） → 10/21 リリースで全項目が公開 | php.net 予告 vs リリース本文の差分。記事では「予告時点」と明記 |
| 4 | CVE 番号・"Session Upload Progress"・"RCE" はリークと研究者発であって公式ではない | ✅ 当時 → リリースで CVE 番号と RCE が公式化。Session Upload Progress は 619 の**確認済み consumer** として公式 GHSA に記載 | 予告には無し。10/21 リリース＋GHSA で確定 |
| 5 | 推定原因は `ext/session` の Session Upload Progress に関わる**メモリ破壊** | ❌ 主原因ではない | 公式 GHSA は 2 件とも「stale state / OOM」。session は 619 の consumer の 1 つで、原因そのものではない |
| 6 | 具体的には `php_session_rfc1867_callback()` の heap UAF | ❌ 公式原因と不一致 | 公式は「リクエストを跨ぐ stale global state」と「OOM 時の longjmp」。同関数は**修正対象ではある**が、直すのは状態初期化と pre-RINIT の unserialize 制限 |
| 7 | **その関数は実在し、ext/session が multipart パーサにフックしている** | ✅ **実測** | php-src を読んだ（下の「計測」） |
| 8 | `session.upload_progress.enabled=0` は**完全な対策ではない** | ✅ 確認 | 公式「no complete mitigations, updating is the only safe choice」＋ GHSA「other lifecycle paths は塞がない」 |
| 9 | なぜ不完全か＝upload_progress を切ると session コールバックは早期 return するが、multipart パーサ本体は動き続ける | ✅ **実測（構造）** → 公式見解と整合 | php-src。619 の session 経路は塞げるが、別の producer/consumer は残る（GHSA） |
| 10 | `session.upload_progress.enabled` のデフォルトは **On** | ✅ 実測 | php-src の INI 既定値 `"1"` |
| 11 | 影響は **PHP 5.4 以降すべて** | ⚠️ 部分確認 | 公式修正は 8.2–8.5。7.4 / 8.0 / 8.1 に source backport あり。5.4–7.3 は公式の対象外で「5.4+」は依然としてリーク/ツール側の主張 |
| 12 | 修正版は 8.5.12 / 8.4.27 / 8.3.36 / 8.2.35 | ✅ **確認（推測が的中）** | php.net リリース本文＋各リリース告知 |
| 13 | watchTowr が **CVE-2026-109618 を再現**（もう片方は未記載） | ⚠️ 二次 | Huntress 経由。公式 GHSA は mod_php での RCE を確認済み |
| 14 | 野良攻撃（ITW）は未観測 | ✅ 一次（時点付き） | Huntress「As of October 20 … has not seen in-the-wild exploitation」。リリース後は未調査 |
| 15 | 重大度が**公式 9.2 と watchTowr 10.0 で食い違う** | ✅ **両方実在（実確認）** | 公式=CVSS v4.0 9.2 / watchTowr CEO **Benjamin Harris** が実名で "Both of them are **CVSS10**"（BleepingComputer） |
| 16 | 8.1 以下は EOL で**公式修正なし** | ⚠️ 一部訂正 | 8.1 以下はサポート外のまま。ただし 7.4 / 8.0 / 8.1 向けに**最小 source backport ブランチ**が公式から提供された |
| 17 | CVE-2026-109618 = **RCE via OOM corruption** | ✅ 一次 | [GHSA-w8hw-w9fx-j79w](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w) |
| 18 | CVE-2026-109619 = **RCE via stale global state** | ✅ 一次 | [GHSA-6wmf-4rv5-p3rp](https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp) |
| 19 | 619 の確認済み consumer に **Session Upload Progress** が含まれる | ✅ 一次 | GHSA-6wmf。`session.upload_progress.enabled=0` は「demonstrated early session producing and consuming operations」を止める |
| 20 | 修正コミットは `31c0ea7d7f` で、`ext/session` / `main/rfc1867.c` / `Zend/zend_alloc.c` を変更 | ✅ **実測** | 8.5.11 と 8.5.12 のタグを取得して diff（下の「パッチ差分」） |
| 21 | 公開 PoC の「2 回目 update の zval UAF」は公式の原因記述と一致しない | ⚠️ 自力分析 | 公式が実証した producer/consumer は**別リクエスト**。ラボは単一リクエストの UAF を試していた |
| 22 | 公式は「完全な緩和策は存在しない、更新だけが安全」と明言 | ✅ 一次 | php.net リリース本文 / 各 GHSA の Warning |

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
- ⚠️ 「2 件目が本当に multipart パーサにある」は、リリース後に**否定**された。
  618 は multipart 解析中に OOM を起こして `longjmp()` で不正状態を残す話で、
  パーサ内の zval UAF ではない。619 はリクエスト横断の stale global state。
  記事では「設定が効かない経路がコード上あり得る」までに留め、原因の断定はしない。

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
- **パッチ未公開時点（16:40 JST）では「修正前の現行コード」を見ていた。** 22:45 JST の公開後に
  `php-8.5.11` → `php-8.5.12` の diff を取り、下の「パッチ差分」に追記した（PRD R-07 / D-09）。

---

## 2026-10-21 17:50 JST 追記：ローカル検証の結果

**判定: 公開 PoC の「コア UAF」は再現せず。一方、`session.upload_progress` + アプリ側 LFI の鎖は再現。**

| 検証 | 結果 |
| --- | --- |
| 公開 PoC 618/619（8.4.4 ASAN, `USE_ZEND_ALLOC=0`） | ASAN レポートなし、`uid=` なし |
| 同（8.5.4 ASAN / 5.6.40） | 同様に再現せず |
| ASLR 無効 + 実 `zend_call_function` アドレス | 変化なし |
| 毒 call アドレス `0x4141414141414141` | クラッシュせず（stale pointer 未使用の傍証） |
| `cleanup=0` の LFI | `uid=33(www-data)` |
| `cleanup=1`（既定）のレース | 3/3 で `uid=33(www-data)` |
| `enabled=0` + `$_FILES['f']['tmp_name']` include | `uid=33(www-data)` |
| `use_strict_mode=1` + 攻撃者指定 SID | 失敗 |
| `use_strict_mode=1` + `Set-Cookie` 追従 | `uid=33(www-data)` |
| mod_php (`php:8.4.4-apache`) | `uid=33(www-data)` |

ソース計測で分かったこと:

- `post_bytes_processed` が指すのは `progress->data` 内の zval で、更新中は生存している。
- `track_init` / `zend_hash_update` が解放するのは、セッションからデコードされたコピー。
- `update()` の `post` 読み取りは `php_session_initialize()` の前にあり、解放はその後。
- `MULTIPART_EVENT_END` の `force=1` 更新は読み取りをスキップする。
- 公開バンドルの `VALIDATION.md` 自身が「ASAN crash はローカルで未観測」と明記している。
- ツイートの画像は機構説明のスクリーンショットで、`uid=` / ASAN の実行証跡ではない。
- 配布 tarball はページ記載の SHA-256 と実ファイルが一致しない（`a29d…` vs `0c254d…`）。

この追記の位置づけ:

- 公開 PoC の「コア UAF」は**未再現**。公式 CVE が存在しないことの証明ではない。
- 実際に成立するのは **multipart + アプリ側 LFI** の鎖。アプリ側 sink が必須。
- 共有された影響調査レポートは**露出評価**であり、RCE の実行証明ではない。
  固有のアプリ名・秘密情報のキー名は記事に載せない。
- PRD §4.2 の「攻撃再現は対象外」は、ユーザーの依頼による**ローカル検証**として更新された。
  記事本文ではターンキーな攻撃手順・ペイロードを貼らない。

詳細: `sandbox/ANALYSIS.md`、`sandbox/report/REPORT.md`、`sandbox/attacker/README.md`

## 2026-10-21 22:45 JST 追記：公式リリースとパッチ差分

**判定: 公式は 2 件とも CVE を確定。原因は「セッションの zval UAF」ではなく、
「別リクエストを跨ぐ stale global state」と「OOM 時の longjmp」だった。
公開 PoC の主張は原因の特定を外しているが、Session Upload Progress が
619 の consumer であることは公式に確認された。**

### 公式リリース本文（一次）

- [Security advisory: Critical remote code execution vulnerabilities, update now](https://www.php.net/archive/2026.php#2026-10-21-5)（2026-10-21）
  - 修正版: **8.5.12 / 8.4.27 / 8.3.36 / 8.2.35**
  - 対象: 「all PHP installations serving web requests, including PHP-FPM, Apache with mod_php, php-cgi, FrankenPHP and LiteSpeed」
  - 「We consider the risk highest for mod_php, with a demonstrated exploit where an unauthenticated request can trigger the attack before any application code runs.」
  - **CVE-2026-109618**（GHSA-w8hw-w9fx-j79w）: "RCE via OOM corruption" — OOM 処理がリクエストデータの初期化途中で割り込み、cleanup が不正なデータを有効として扱う。
  - **CVE-2026-109619**（GHSA-6wmf-4rv5-p3rp）: "RCE via stale global state" — リクエスト所有の内部状態が、そのメモリ解放後も worker に残り、次のリクエストが通常初期化の前に stale state を使う。
  - 「There are no complete mitigations, updating is the only safe choice.」
  - 8.1 以下は公式サポート外。ただし 7.4 / 8.0 / 8.1 に **minimal source backports** のブランチが用意された。
- 各リリース告知（8.5.12 / 8.4.27 / 8.3.36 / 8.2.35）も同じ文面で「two critical vulnerabilities (CVE-2026-109618, CVE-2026-109619)」「no complete mitigations」。

### GHSA で確認できたこと（一次）

- 619 の影響: 「unauthenticated heap use-after-free, memory disclosure and remote code execution with the web worker's privileges」。mod_php の fatal backtrace 経路で RCE 確認、session lifecycle 経路は mod_php と FPM で検証済み。
- **実証された producer と consumer は別リクエスト**で、同じ worker に到達する必要がある。
  - producer: fatal error / OOM で reset が飛ばされ、request-owned state が global に残る。
  - consumer: 次のリクエストで、通常初期化より前にその stale state を読む。
  - 具体例: INI diagnostics（`.htaccess` / FPM の `PHP_VALUE`）と **Session Upload Progress**。
- 618 の OOM 経路: multipart で「Content-Length が使えない」「part 内ヘッダ無制限」「空 file control が `max_file_uploads` に数えられない」などで、`post_max_size` 内でも `memory_limit` に到達できる。
- 618 の patch: OOM の `longjmp()` を廃止し、**delayed soft OOM + 二段目の hard OOM（`_exit()`）** に変更。
- 緩和策の限界:
  - `memory_limit=-1` は「controllable な OOM」を消すが、`mmap()` 失敗などは残る。`RLIMIT_AS` / `RLIMIT_DATA` は **使ってはいけない**（`mmap()` 失敗で vulnerable な `longjmp()` を踏む）。
  - `session.upload_progress.enabled=0` は「demonstrated early session producing and consuming operations」を止めるが、「other lifecycle paths」は塞がない。`ini_set()` / `.user.ini` は不可（リクエスト解析前に効かない）。
  - 8.5 は `fatal_error_backtraces=0` で fatal backtrace 経路のみ遮断。
  - 「There is no complete generic configuration mitigation」。

### パッチ差分の実測

タグ `php-8.5.11`（修正前）と `php-8.5.12`（修正後）の該当ファイルを取得して diff した。

```sh
for v in 8.5.11 8.5.12; do
  for f in ext/session/session.c main/rfc1867.c Zend/zend_alloc.c; do
    curl -sL "https://raw.githubusercontent.com/php/php-src/php-${v}/${f}" -o "/tmp/${v}-$(echo $f | tr / _)"
  done
done

diff -u /tmp/8.5.11-ext_session_session.c /tmp/8.5.12-ext_session_session.c
diff -u /tmp/8.5.11-main_rfc1867.c      /tmp/8.5.12-main_rfc1867.c
```

修正コミット: `31c0ea7d7ff1d1fccb6492e52dab544011628065`（"Avoid state corruption via bailout"、
Fix GHSA-w8hw-w9fx-j79w / GHSA-6wmf-4rv5-p3rp）。8.5.11 → 8.5.12 の差分には他分支の修正も
混ざるため、セキュリティ修正の同定はコミット本文と GHSA の Fix 表記で行った。

`ext/session/session.c` の実測差分（要旨）:

```diff
 static inline void php_rinit_session_globals(void)
 {
 	...
 	PS(module_number) = my_module_number;
+	PS(in_rfc1867_update) = false;
 	ZVAL_UNDEF(&PS(http_session_vars));
 }

+/* The upload progress handler (php_session_rfc1867_update()) decodes and
+ * re-encodes the session during request startup, before RINIT, when no user
+ * code may run. Objects are then kept as __PHP_Incomplete_Class: no
+ * autoloading, no unserialize_callback_func, no __wakeup() or __unserialize(),
+ * and they are written back unchanged. */
+static void php_session_unserialize_init(php_unserialize_data_t *var_hash)
+{
+	PHP_VAR_UNSERIALIZE_INIT(*var_hash);
+	if (PS(in_rfc1867_update)) {
+		php_var_unserialize_set_incomplete_classes_only(*var_hash, true);
+	}
+}

 static void php_session_rfc1867_update(php_session_rfc1867_progress *progress, bool force)
 {
 	...
-	php_session_initialize();
-	PS(session_status) = php_session_active;
+	/* Runs before RINIT: no user code may be invoked, see php_session_unserialize_init() */
+	PS(in_rfc1867_update) = true;
+	if (php_session_initialize() == FAILURE || PS(session_status) != php_session_active) {
+		PS(in_rfc1867_update) = false;
+		return;
+	}
 	...
 	php_session_flush(1);
+	PS(in_rfc1867_update) = false;
 }

 	case MULTIPART_EVENT_START: {
+		/* This runs before RINIT, so we need to clear these early */
+		php_rinit_session_globals();
 		progress = ecalloc(1, sizeof(php_session_rfc1867_progress));
```

```diff
+	if (PG(modules_activated)) {
+		/* request_parse_body(). Do not run here as it corrupts the session. */
+		return retval;
+	}
```

`main/rfc1867.c` の実測差分（要旨）:

```diff
+	if (ZEND_HAS_OOM()) {
+		goto oom;
+	}
...
-	out = erealloc(out, total_bytes + read_bytes + 1);
+	char *new_out = safe_ferealloc(out, 1, total_bytes, read_bytes + 1, /* fallible */ true);
+	if (!new_out) {
+		break;
+	}
...
+		/* Keep only headers we use, and ignore duplicates */
+		if (!php_mime_should_save_hdr(line)
+				|| php_mime_get_hdr_value(*header, line)) {
+			key = NULL;
+		}
```

`Zend/zend_alloc.c` の実測差分（要旨）:

```diff
+	size_t             hard_limit;
+	zend_long          hard_limit_percent;
...
+ZEND_API void ZEND_FASTCALL zend_handle_delayed_oom(void)
...
+static ZEND_COLD ZEND_NORETURN void zend_mm_hard_limit_error(...)
```

**読み取れること:**

| 論点 | 修正前（8.5.11） | 修正後（8.5.12） |
| --- | --- | --- |
| `MULTIPART_EVENT_START` での session globals | 初期化しない（RINIT 任せ） | `php_rinit_session_globals()` を**先に**呼ぶ |
| upload progress 中の unserialize | 通常どおり autoload / `__wakeup` が動き得る | `__PHP_Incomplete_Class` 固定。ユーザコードを呼ばない |
| session 初期化失敗時 | `session_status = active` を無条件に設定 | FAILURE / 非 active なら**何もせず return** |
| `request_parse_body()` 経由 | callback が動く | `PG(modules_activated)` で早期 return |
| OOM | `longjmp()` で一気に脱出 | delayed OOM + hard limit（`_exit()`） |
| multipart のメモリ | ヘッダを全部保持、`erealloc` 失敗で bailout | 必要なヘッダだけ保持、`ZEND_HAS_OOM()` で中断 |

→ **公開分析が名指しした `php_session_rfc1867_callback()` は、確かに修正対象だった。**
ただし直っているのは「2 回目の update で zval が壊れる」という単一リクエストの UAF ではなく、
**RINIT 前に動く session の状態初期化と、pre-RINIT でのユーザコード実行**である。
これはラボが単一リクエストの PoC で再現しなかったことと整合する。

### なぜラボでは再現しなかったのか（公式原因との突き合わせ）

- ラボは「1 リクエスト内で 2 回 update させ、`post_bytes_processed` の zval を壊す」という
  公開 PoC の筋書きを試した。公式の 619 は **producer と consumer が別リクエスト**で、
  同じ worker に割り当たる必要がある。単一リクエストでは条件が揃わない。
- 619 の producer は「fatal error / OOM で reset が飛ぶ」こと。ラボの trigger は正常終了しており、
  producer になっていない。
- 619 の確認済み consumer は「INI diagnostics」と「Session Upload Progress」。
  ラボが見ていたのは後者の**正常系の書き込み経路**で、stale state を読む経路ではなかった。
- 618 は mod_php で「アプリコード実行前に request startup が失敗しても shutdown が走る」ことが本質。
  ラボの主環境は FPM で、FPM は startup 失敗時に child を終了するため、同じ経路にならない。
- したがって「ラボで再現しなかった」は、**CVE が存在しないことの証明でも、
  公式原因が間違いであることの証明でもない**。単に別の攻撃条件を試していた。

### 緩和策の再評価（公式見解ベース）

| 対策 | 公式の位置づけ | ラボの鎖（multipart + LFI）への効果 |
| --- | --- | --- |
| 8.5.12 / 8.4.27 / 8.3.36 / 8.2.35 へ更新 | **唯一の完全な対策** | コアの CVE は塞がる。アプリ側 LFI 鎖は**残る** |
| `memory_limit=-1`（管理者設定） | 618 の主要緩和。ただし完全ではない | 無関係 |
| `post_max_size` を小さく、front 側で decoded size 制限 | 618 の緩和 | 巨大 multipart を止める意味はある |
| cgroup / container limit | 618 の代替。`RLIMIT_AS`/`DATA` は禁止 | 被害範囲の制限 |
| `session.upload_progress.enabled=0` + worker restart | 619 の**確認済み session 経路のみ** | 進捗書き込みは止まる。`$_FILES` の一時ファイルは残る |
| `fatal_error_backtraces=0`（8.5） | fatal backtrace 経路のみ | 無関係 |
| `pm.max_requests=1` | 別リクエストへの持ち越しを切る（性能と引き換え） | レース窓を狭める |
| アプリ側 LFI / upload include の除去 | 公式の対象外 | **この鎖には必須** |

### ラボでのパッチ後再実行

`PATCHED_VERSION=8.5.12` で ASAN ビルドを作成（`php2shell-asan:8.5.12`、PHP 8.5.12 / fpm-fcgi）し、
8082（通常）と 8084（LFI デモ用に追加）で再実行した。

```sh
PATCHED_VERSION=8.5.12 docker compose -f compose.yaml -f compose.patched.yaml \
  --profile patched up -d --build php-patched nginx

python3 attacker/attack.py --mode all \
  --target http://127.0.0.1:8082/index.php \
  --mitigated http://127.0.0.1:8081/index.php \
  --asan-dir data/logs-patched

python3 attacker/lfi_demo.py --target http://127.0.0.1:8084/index.php
```

実測（2026-10-21 22:50 JST）:

| 検証 | 8.5.12 の結果 |
| --- | --- |
| `probe` | `upload_progress=present`, `file_parsed=True` |
| `trigger-single` | `bytes_processed=258`, `file_bytes=1`, `done=True`, `asan=no` |
| `trigger-stall` | 同上 |
| `poc618` | HTTP 200、`rce=no`, `asan=no` |
| `poc619` | HTTP 200、`rce=no`, `asan=no` |
| LFI 鎖（8084） | `upload_progress_uid=33(www-data) ...` → `command output present: True` |
| `data/logs-patched/fpm-error.log` | FPM の起動 / 終了 NOTICE のみ。ASAN なし |

読み取り:

- パッチ後も `session.upload_progress` の**書き込み primitive は動く**（意図された機能）。
  修正は「状態の reset と pre-RINIT の安全性」であって、進捗書き込みの無効化ではない。
- **アプリ側 LFI の鎖は 8.5.12 でも成立**する。コア CVE の修正とアプリ側 sink は別レイヤー。
- 8.5.12 で PoC がクラッシュしないことは、パッチ効果の証明にはならない。
  8.5.11 でもこの PoC はクラッシュしていない。効果の根拠は GHSA と差分側に置く。
- 8.5.11 の ASAN ビルドは作っていないため、「修正前後で PoC の挙動が変わった」比較は未実施。
  修正前の比較対象は既存の 8.4.4 / 8.5.4 ラボ。



## 未確認・積み残し

- [x] **公式リリース本文**（CVE 番号・影響バージョン・修正版番号・クラス）の確認 → 表 #3 #11 #12 を更新
- [x] 修正コミットの diff を読む（根本原因の確定）→ #5 #6 #9 を推測から事実へ
- [x] `php_session_rfc1867_callback()` / `main/rfc1867.c` が実際に触られたか → 両方とも修正対象。ただし内容は別（状態初期化 / OOM 会計）
- [x] 影響バージョン 5.4+ が公式に裏付くか（#11）／修正版が 8.2.35 系かどうか（#12）
- [x] パッチ後の 8.5.12 ラボ再実行（trigger / PoC 618・619 / LFI 鎖）
- [ ] **公式 CVE の producer / consumer を実際に再現する**（別リクエスト・同一 worker・fatal/OOM 中断）。現状は GHSA と差分の読解まで
- [ ] PHP 8.5.11（修正前）の ASAN ビルドで、8.5.12 と同じ trigger を比較する
- [ ] `request_parse_body()` 経由の consumer を実際に試す
- [ ] リリース後の ITW 攻撃・悪用状況を確認する（2026-10-21 時点では未調査）
- [ ] 5.4–7.3 の影響有無（公式対象外。7.4–8.1 は source backport あり）
- [ ] `session.upload_progress.enabled=0` が正常系にどこまで影響するか（機能互換）を実測
- [ ] 公式パッチ後の 8.2 / 8.3 / 8.4 系でも同じ LFI 鎖が残るか（今回は 8.5.12 のみ）

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
| PHP 公式セキュリティアドバイザリ（2026-10-21） | 一次 | https://www.php.net/archive/2026.php#2026-10-21-5 |
| GHSA-w8hw-w9fx-j79w（CVE-2026-109618 / OOM corruption） | 一次 | https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w |
| GHSA-6wmf-4rv5-p3rp（CVE-2026-109619 / stale global state） | 一次 | https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp |
| php-src 修正コミット `31c0ea7d7f` | 一次 | https://github.com/php/php-src/commit/31c0ea7d7ff1d1fccb6492e52dab544011628065 |
| PHP Manual（Session Upload Progress） | 一次 | https://www.php.net/manual/en/session.upload-progress.php |
| php/php-src（session.c / main/rfc1867.c） | 一次（自分で読む） | https://github.com/php/php-src |
| GMO Flatt Security Blog | 二次（主力・日本語） | https://blog.flatt.tech/entry/php2shell |
| Sansec research | 二次 | https://sansec.io/research/php2shell |
| Huntress Rapid Response | 二次 | https://www.huntress.com/blog/php2shell-leaked-critical-php-vulnerabilities |
| lilting.ch（UAF 技術解説） | 二次（研究者分析の集約） | https://lilting.ch/en/articles/php2shell-session-upload-progress-uaf |
| ITmedia（Flatt 追記を報道） | 二次 | https://www.itmedia.co.jp/news/article/2610/21/2000002462/ |
| 窓の杜 | 二次 | https://forest.watch.impress.co.jp/docs/news/2149962.html |
| BleepingComputer | 二次 | https://www.bleepingcomputer.com/news/security/php-warns-admins-of-two-critical-flaws-emergency-patches-coming-tomorrow/ |
