# 公開 php2shell PoC の解析と再現結果

対象: `https://jackalsyn.com/posts/php-up-2026.html` の公開バンドル
（`poc0_109618.py` / `poc1_109619.py` / `poc_trigger.py`）
実施: 2026-10-21 17:20 JST 時点（公式パッチ公開前）

## 結論

**公開バンドルの PoC 618 / 619 は、このラボでは UAF も RCE も再現しませんでした。**

- PHP 8.4.4 ASAN + `USE_ZEND_ALLOC=0` で、258B trigger と 618/619 を実行。
- 進捗ストア経路（`bytes_processed`、`files[]`）には到達する。
- ASAN レポートなし、`uid=` なし、ワーカー異常終了なし。
- ASLR を無効化し、`zend_call_function` の実アドレスを渡しても変化なし。
- 偽造レコードの call 先を `0x4141414141414141`（毒アドレス）にしてもクラッシュしない。
  → 古い `zval *` が関数ポインタとして使われている形跡がない。
- ソース計測で、キャッシュされた `post_bytes_processed` が指す配列は、
  `track_init` が解放する「セッションからデコードされたコピー」とは別物で、
  使用中は生存していることを確認。

公開バンドルの `status: weaponized (lab)` と "verified" は、主に **ソース行の確認** を指します。
同梱の `VALIDATION.md` 自身も「ASAN crash はローカルで未観測」と明記しています。
公式パッチが公開されるまで、公開 PoC を RCE の再現証明として扱うべきではありません。

## 1. 実行したもの

```sh
cd sandbox
docker compose up -d --build
python3 attacker/attack.py --mode all
python3 attacker/attack.py --mode poc618
python3 attacker/attack.py --mode poc619
```

結果:

```text
[probe:vuln]       status=200 upload_progress=present
[probe:mitigated]  status=200 upload_progress=absent file_parsed=True
[trigger-single]   status=200 bytes_processed=258 file_bytes=1 done=True asan=no
[trigger-stall]    status=200 bytes_processed=258 file_bytes=1 done=True asan=no
[poc618]           status=200 resp=467B rce=no asan=no failure=no
[poc619]           status=200 resp=357B rce=no asan=no failure=no
```

証跡: `data/evidence.jsonl`、`data/raw/`、`data/logs/`。

## 2. ソース計測（PHP 8.4.4、一時的なデバッグビルド）

`ext/session/session.c` に以下の点で `fprintf(stderr, ...)` を入れ、
`php -S`（ASAN、`USE_ZEND_ALLOC=0`）で 258B trigger を送りました。

- `FILE_START` 直後: `progress->data` / `post_bytes_processed` / `current_file_bytes_processed`
- `php_session_rfc1867_update()` の入口・`php_session_initialize()` 後・`zend_hash_update()` 後
- `php_session_track_init()` の入口
- `MULTIPART_EVENT_END` の `SEPARATE_ARRAY` 前後・最終 `zval_ptr_dtor` 前

代表的な出力:

```text
[dbg] FS progress=0x50d000001d80 data=0x506000019940 data_rc=1 post=0x51200001aac0 current=0x51200001acc0 current_rc=1
[dbg] update enter force=0 ... data=0x506000019940 data_rc=1 post=0x51200001aac0 post_val=258 status=1
[dbg] track_init before http=0xaaaab0925f48 rc=-1
[dbg] update after_init ... data=0x506000019940 data_rc=1 post=0x51200001aac0 status=2
[dbg] update after_hash ... data=0x506000019940 data_rc=2 post=0x51200001aac0 session_val=0x51200001ad80

[dbg] END before_sep data=0x506000019940 data_rc=2 post=0x51200001aac0
[dbg] END after_sep  data=0x506000019d00 data_rc=1 post=0x51200001aac0
[dbg] update enter force=1 ... data=0x506000019d00 data_rc=1 post=0x51200001aac0
[dbg] track_init before http=0xaaaab0925f48 rc=2
[dbg] update after_init ... data=0x506000019d00 data_rc=1 post=0x51200001aac0 status=2
[dbg] update after_hash ... data=0x506000019d00 data_rc=2 post=0x51200001aac0 session_val=0x51200001bb00
[dbg] END final_dtor data=0x506000019d00 data_rc=2 post=0x51200001aac0
```

読み方:

1. `FILE_START` で `data`（`progress->data`）が作られ、`post` は**その中**の
   `bytes_processed` zval を指す。`data_rc=1`。
2. 最初の `update()` 後、`data_rc=2`。1 つは `progress`、1 つは `$_SESSION`。
3. `FILE_DATA` / 2 ファイル目の `FILE_START` では `data_rc=2` のまま。
   `post` は同じ `progress->data` を指しており、**まだ生存**。
4. `MULTIPART_EVENT_END` の `SEPARATE_ARRAY` で `progress->data` が新しい配列
   （`0x506000019d00`）に分離される。古い配列（`0x506000019940`）は
   `$_SESSION` が保持したまま。`post` は古い配列内を指すが、まだ生存。
5. `force=1` の `update()` は入口の `if (!force_update)` を**スキップ**する。
   つまり `post` の読み取り（`Z_LVAL_P(post) < next_update`）は行われない。
   書き込み `Z_LVAL_P(post) = ...` は `update()` の**前**に済んでおり、
   この時点で古い配列はまだ生きている。
6. `track_init` が `$_SESSION` 側の参照を落とし、古い配列がここで解放される。
   しかし、その後に `post` を読むコードはない。最終 `zval_ptr_dtor` も
   `data`（新しい配列）を落とすだけで、`post` は使わない。

### 公開 PoC の想定とのズレ

公開バンドルは「2 回目の update() が session file を再デコードし、
`zend_hash_update` が前のツリーを `zval_ptr_dtor` で破壊する。その解放済み
バケットを stale pointer が指す」と説明しています。

計測では、`track_init` / `zend_hash_update` が解放するのは
**セッションからデコードされたコピー**です。`post_bytes_processed` が指す
`progress->data` は `progress` 自身が参照を持っており、この時点では解放されません。
また、`update()` の `post` 読み取りは `php_session_initialize()` の**前**にあり、
解放はその後の `track_init` で起きます。つまり「解放後に読む」順序になっておらず、
公開 PoC が想定する UAF になりません。

`current_file_bytes_processed` も同様です。`FILE_START` のたびに新しい
`current_file` に張り直され、`files[]` が配列を保持します。`FILE_END` で
`tmp_name` / `error` / `done` を更新しても、これらは既存キーの更新で、
`current_file` 自体を解放しません。

## 3. ASLR 無効 + 実アドレスでの追試

公開フレームワークの `--lab` を、`setarch -R`（`seccomp=unconfined`）で
ASLR を切った php-fpm に対して実行しました。

- FPM の PIE base: `0xaaaaaaaa0000`
- `zend_call_function`: `0xaaaaab35fa4c`
- `zval_ptr_dtor`: `0xaaaaab5fbb04`
- `--syms` の delta: `0x29c0b8`

`--call` に実アドレスを渡した 618/619、および毒アドレス
`0x4141414141414141` を渡した 618/619 のいずれも、
`command_in_body: False`、ASAN レポートなし、ワーカー生存でした。
古いポインタが call に使われていれば、毒アドレスで少なくともクラッシュするはずです。

## 4. PHP 8.5.4（公開 PoC の DELTA が想定するビルド）

公開 `poc0` / `poc1` の `DELTA_CALL=0x43EF0` は Ubuntu PHP 8.5.4 向けと明記されています。
そこで 8.5.4 も ASAN ビルドして同じ trigger / PoC を送りました。

- 258B trigger: `bytes_processed=258`、`files[0].bytes_processed=1`、`done=true`。
- 618/619: HTTP 200、`uid=` なし、ASAN レポートなし。
- 8.5.4 の `session.c` も、`post_bytes_processed` が `progress->data` 内を指す
  8.4 と同じ構造でした。

## 5. PHP 5.6.40

公式 `php:5.6.40-fpm`（非 ASAN）でも 258B trigger と 618/619 を送りました。

- `upload_progress` は書かれる（`bytes_processed=258`）。
- 618/619 は HTTP 200、`uid=` なし、FPM 異常終了なし。
- 5.6 は `post_bytes_processed` を別 zval として確保する実装で、
  8.x の「HashTable 内バケットを指す」構造とは異なります。
  公開 PoC の 8.x 向けオフセットをそのまま 5.6 の証明には使えません。
- 非 ASAN のため、UAF の有無そのものは判定できません。


## 6. マルチパート + LFI の鎖（CVE とは別）

公開バンドルの「PHP コア UAF」とは別に、`session.upload_progress` の
**書き込み primitive** とアプリ側 LFI を組み合わせる既知の鎖は再現できました。
`lfi-demo/index.php` は意図的に `include($_GET['file'])` するアプリです。

```sh
docker compose up -d
python3 attacker/lfi_demo.py
```

結果は `upload_progress_uid=33(www-data) ...` で、`system($_GET[0])` が実行されています。

ソース上の流れ:

- `main/rfc1867.c` `MULTIPART_EVENT_FORMDATA` → `event_formdata.value` に
  `PHP_SESSION_UPLOAD_PROGRESS` の値。
- `ext/session/session.c` `php_session_rfc1867_callback()` → `progress->key` に
  `upload_progress_` + 値。
- `php_session_rfc1867_update()` → `php_session_initialize()` / `zend_hash_update()` →
  アプリ実行前に `sess_<PHPSESSID>` へ書き込み。
- `php_session_rfc1867_early_find_sid()` → Cookie/GET の SID を使用。
- アプリの LFI が `sess_<id>` を include → キー文字列内の `<?php ... ?>` が実行。

成立条件は「アプリ側の LFI（またはセッションファイルを読む sink）」です。
`cleanup=0` なら確実、既定の `1` ならアップロード中のレース。
`session.upload_progress.enabled=Off` はこの session 書き込み primitive を止めます。
ただし multipart のアップロード自体は続き、`$_FILES` の一時ファイルは作られるため、
アプリがアップロードファイルを include する sink を持つ場合は別の鎖が残ります。
公開バンドルが主張するコア UAF の対策になるかは別問題です。


### 追加検証（2026-10-21 17:35 JST）

| 条件 | 結果 |
| --- | --- |
| `cleanup=1`（既定）で 1.5s の stall + 6000B の初回チャンク | `race_demo.py` が 3/3 で `uid=33(www-data)` |
| `enabled=0` + `$_FILES['f']['tmp_name']` を include | `upload_include.py` が `uid=33(www-data)` |
| `use_strict_mode=1` + 攻撃者指定 SID | LFI は失敗 |
| `use_strict_mode=1` + 応答の `Set-Cookie` を追従 | `uid=33(www-data)` |
| mod_php（`php:8.4.4-apache`） | `uid=33(www-data)` |

- `cleanup=1` の race は、FPM の `FILLUNIT=5120` を満たす初回チャンクを送り、
  その後 stall することで成立します。初回チャンクが小さいと `fill_buffer` が
  残りを待つため、セッションファイルができません。
- `use_strict_mode=1` は「SID を選ばせない」だけで、progress の session 書き込みは
  続きます。新しい SID はアップロード応答の `Set-Cookie` に出るため、
  応答を読める状況では `--follow-cookie` で chain が成立します。
- `enabled=0` は session 書き込みを止めますが、multipart の upload と temp file 生成は
  残るため、アプリ側の upload-include sink は別途塞ぐ必要があります。

## 7. 判定

| 項目 | 結果 |
| --- | --- |
| 258B trigger が進捗ストア経路に到達 | 確認 |
| `session.upload_progress.enabled=0` で進捗が止まる | 確認 |
| 設定を切っても multipart ファイル解析は動く | 確認 |
| 公開 PoC 618/619 で ASAN UAF | 再現せず |
| 公開 PoC 618/619 で RCE（`uid=`） | 再現せず |
| ASLR 無効 + 実 call アドレス | 再現せず |
| 毒 call アドレスでクラッシュ | 起きず（ポインタ未使用の傍証） |
| PHP 8.5.4 で ASAN UAF / RCE | 再現せず |
| PHP 5.6.40 で RCE | 再現せず（非 ASAN） |

## 8. 限界

- これは **公開 PoC の再現失敗** であり、公式 CVE が存在しないことの証明ではありません。
  公式の原因・影響バージョン・修正内容は 2026-10-21 23:00 JST のリリース後に確認が必要です。
- デバッグビルドは一時的な解析用で、`sandbox/` の通常ラボには含めていません。
  同じ計測をする場合は `ext/session/session.c` の上記 5 点に `fprintf` を入れ、
  `USE_ZEND_ALLOC=0` で ASAN ビルドしてください。
- 公式パッチが出たら、`session.c` / `rfc1867.c` の差分をこのラボに反映し、
  修正前後の trigger / PoC を同じ条件で再実行してください。
