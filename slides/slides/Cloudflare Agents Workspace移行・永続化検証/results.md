# results — Cloudflare Agents Workspace 移行・永続化検証

| | |
| --- | --- |
| 計測日 | 2026-10-21 |
| 環境 | ローカル（`wrangler dev`, miniflare）+ **本番 Cloudflare Workers / Durable Objects** |
| バージョン | `@cloudflare/shell@0.4.3` / `@cloudflare/computer@0.6.0` / wrangler 4.151.3 / node v24.22.1 |
| compatibility_date | `2026-10-20` |
| 再現 | `sandbox/README.md` |
| 生ログ | `sandbox/results/`（アカウント識別子はスクラブ済み） |

**観測と解釈を分けて書く。** 観測は動かない。解釈は対照が増えると変わる。

---

## サマリ

| # | 主張 | 判定 | ひとこと |
| --- | --- | --- | --- |
| C01–C02 | 書いて読み戻せる | ✅ | 土台 |
| **C03** | **DO 再起動後も読める** | **✅** | bootId が変わったうえで読めた |
| **C04** | **再デプロイ後も読める** | **✅** | 1 回目は再起動しておらず**証拠にならなかった** |
| **C05** | hibernate は無活動 10 秒 | **✅** | 9 秒セーフ / 11 秒で再起動。ドキュメント通り |
| C06 | 旧テーブルは `cf_workspace_default` | ✅ | |
| C07 | 新テーブルは `vfs_*` / `_vfs_*` | ✅ | `schema_version = 10` |
| S3 | テーブルが作られるタイミング | 📭→**構築時** | 初回 fs 操作を待たない |
| C08 | 新旧が同じ DO に共存する | ✅ | 旧 14 行のまま |
| **C09** | **移行しないと旧ファイルが見えない** | **✅** | `ENOENT`。対照で「消えていない」ことも示した |
| C10 | 旧データは残る | ✅ | 切り替え後も旧から読める |
| C11–C13, C15 | 公式移行でテキスト/階層/バイナリ/空ディレクトリが移る | ✅ | 13 件すべて SHA-256 一致 |
| **C14** | **シンボリックリンクのリンク先が保たれる** | **❌** | 絶対 + ルート超え `..` のとき静かに壊れる |
| **C16** | **フラグ無しで 2 回流しても壊れない** | **❌** | 2 回目が `EEXIST` で中断 |
| C17 | フラグで 2 回目をスキップできる | ✅ | |
| **C18** | 旧 Shell の inline 格納の上限 | **❌** | ファイル約 6 MiB で頭打ち。原因は未特定 |
| **R3** | DO SQLite / KV の値の上限 | **❌ doc と 4 倍違う** | doc 2 MB、実測 **約 8 MiB**（TEXT/BLOB/KV とも） |
| **C19** | **新スキーマを書くと古い版で開けない** | **✅（ドキュメント未記載）** | `EIO` |
| C20 | 同一バイト列は blob 1 行を共有 | ✅ | 対照も効いた |
| C21 | 旧 R2 退避ファイルも移行できる | ✅ | 対照は Shell のガードで測れず |
| **C22** | 新旧の速度差 | **✅ 1MB で 13.5 倍** | 1KB/100KB はノイズに埋もれる |
| C23 | `created_at`/`modified_at` は保持されない | ✅ | 新スキーマに置き場所が無い |
| C24 | `mime_type` は保持されない | ✅ | 型で確定 |
| C25 | `glob()` は親が子より先 | ✅ | 公式スクリプトの前提は成立 |

---

## 1. 永続化（C01–C05）

### 観測

本番デプロイ。同じ DO 名に対して write → read を繰り返し、
**コンストラクタで生成した `bootId`** を毎回記録した。

```
                        bootId                                read
① 書く                  1cadfbdd-7595-4879-94c1-43abca4688c0   ok
② 直後に読む             1cadfbdd-7595-4879-94c1-43abca4688c0   ok   ← 同じ incarnation
③ 15 秒後               e4f5f2ab-3d7d-4389-8e2d-ee32fdd97b02   ok   ← 変わった
④ 150 秒後              c602f7f1-c9f6-465e-9b36-0c3259706d64   ok   ← また変わった
```

hibernate の閾値（待ち時間を変えて bootId を見る。対照は 0 秒）:

```
待ち(s)   再起動   読めた
     0    いいえ    ✅   ← 対照
     3    いいえ    ✅
     6    いいえ    ✅
     9    いいえ    ✅
    11    はい      ✅
    13    はい      ✅
    15    はい      ✅
```

再デプロイ:

```
① 書く              bootId 90fc101e…
② wrangler deploy
③ 15 秒待つ
④ 読む              bootId 20c118b6…（変わった）
   中身 = "written-by 90fc101e… at 2026-10-21T13:54:29.143Z"
```

### 解釈

- **永続化は成立している。** ③④ は別の incarnation から読めており、
  ④ の中身が**書いた側の古い bootId を含んでいる**ので、同一データだと証明できる。
- hibernate の境界は **9 秒と 11 秒の間** = ドキュメントの「無活動 10 秒」と一致。
- ② は対照として機能した。**②だけなら永続化の証拠にならない。**

### ⚠️ 一度間違えかけた

再デプロイ検証の 1 回目は「待たずに」読んだ。**読めたが bootId が同じだった** ——
DO は旧コードのままメモリに居座っていて、再起動していない。
対照を置いていなければ「再デプロイ後も読めた」と書いて終わっていた。

---

## 2. 移行しないとどうなるか（C09 / C10）— 記事の中心

### 観測

同じ Durable Object storage の上で、旧 Shell に 13 エントリを書いてから
新 Computer の `Workspace` を構築した。

```
[C09] 対照: 旧から読む                → {found: true, length: 23}
[C09] tables before switch           → ["cf_workspace_default"]
[C09] 新 Workspace を構築
!!    新から読む /workspace/notes.md  → ENOENT no such file
!!    新から読む /notes.md            → ENOENT no such file
[C09] 新側のツリー                    → [{path: "/workspace", type: "dir"}]  ← これだけ
[C10] 対照: 切り替え後に旧から読む      → {found: true, length: 23}
[C10] cf_workspace_default rows       → 14（切り替え前と同じ）
[C09] tables after switch            → cf_workspace_default + vfs_* / _vfs_* 15 本
```

ローカル・本番の両方で同一。

### 解釈

- **データは消えていない。参照できなくなっただけ。** 2 つの対照がそれを示している。
  切り替え前も切り替え後も、旧 Workspace からは同じ内容が読める。
- 新旧のテーブルは**同じ DO の中に並んで存在する**。衝突しない。
- 新側から見えるのは自分で作った `/workspace` だけ。

記事では「データが消えた」ではなく **「保存場所が変わった」** と書く。

---

## 3. 公式移行スクリプト（C11–C17, C23–C25）

### 観測 — 全体

公式ガイドの `copyShellWorkspace()` を**一字一句そのまま**流した。

```
[C25] glob order → {isSorted: true, parentsBeforeChildren: true}
[C11] comparison → {total: 13, missing: [], typeChanged: [], contentMismatch: [], extra: []}
```

- 13 エントリすべて移行。64KB バイナリも SHA-256 一致。空ディレクトリ `/empty` も維持。
- negative control: 1 ビットだけ変えたバイト列のハッシュは別物になる
  （`af2ba40f…` vs `73734ea1…`）。**ハッシュ比較は不一致を検出できる。**
- `[C23]` 新側の `mtime` は全件**コピー実行時刻**。Shell の `createdAt` は失われる。
- `[C24]` Shell が持っていた `text/typescript` / `application/json` 等は新側に受け皿が無い。

### 観測 — C14 シンボリックリンク

```
link              Shell の target      移行後の target              読めるか
/links/rel.md     ../notes.md       → /workspace/notes.md          ✅
/links/abs.md     /notes.md         → /workspace/notes.md          ✅
/links/dotdot.md  /src/../notes.md  → /workspace/src/../notes.md   ✅
/links/esc.md     /../notes.md      → /workspace/../notes.md       ❌ ENOENT
```

修正版（絶対ターゲットも正規化する、2 行の差）での対照:

```
/links/esc.md     /../notes.md      → /workspace/notes.md          ✅
```

### 観測 — C16 再実行

```
1 回目の移行（公式そのまま）     ok
2 回目の移行（公式そのまま）  !! EEXIST path exists: /workspace/links/abs.md
1 回目の移行（修正版）          ok
2 回目の移行（修正版）          ok
1 回目（公式 + フラグ）         ok
2 回目（公式 + フラグ）         スキップ
```

### 解釈

**公式スクリプトはシンボリックリンクに 2 つ弱点がある。ほかは問題ない。**

1. **C14** — `resolveTarget()` が絶対ターゲットを正規化せず素通しする
   （`if (target.startsWith("/")) return target;`）。Shell 側は `normalizePath()` を通す。
   そのため**「絶対パスで、かつルートより上へ登る `..` を含む」リンクに限り**、
   移行後のリンク先が `/workspace` の外を指す。
   - 相対ターゲット、`.` や `//` を含む絶対パス、ルートを超えない `..` は**すべて正しい**
   - `symlink()` は target を検証せず生で格納し、追従時も throw せずクランプするだけなので
     **移行は成功したように見える**
   - **素朴な移行後チェックでは見つからない。** 実際この検証の `comparison` も
     `missing: [], contentMismatch: []` を返した。リンクは「存在する」から

2. **C16** — `mkdir(recursive)` と `writeFile` は冪等だが、`symlink()` は
   常に `EEXIST` を投げ、`force` 相当のオプションが無い。
   ガイドの `onStart` 例はコピー**完了後**にフラグを立てるので、
   中断するとフラグが立たず、起動のたびに同じ場所で失敗し続ける。
   - シンボリックリンクを含まない Workspace なら再実行しても壊れない

### 狭めた主張

> 公式移行スクリプトは、**シンボリックリンクを含まない Workspace では正しく動く**。
> シンボリックリンクがある場合、(a) 再実行が `EEXIST` で中断し、
> (b) 絶対かつルート超えの `..` を含むターゲットは静かに壊れる。

### この欠陥が出荷コードではなく「コピペ用の文章」にあること

`copyShellWorkspace` は**どのパッケージにも含まれていない**。
`cloudflare/agents` を検索しても `docs/shell/migrating-to-computer.md` にしか無い
（`shellMigrated` も同じ。`packages/think/.../chat-sdk.ts` の `resolveTarget` は
メッセンジャー配信先の解決で、名前が同じだけの別物）。

```
copyShellWorkspace → docs/shell/migrating-to-computer.md のみ
cf_workspace_      → packages/shell/src/filesystem.ts（Shell 本体）+ docs
```

つまりこのスクリプトは、**読んだ人が自分のエージェントに写して使うもの**。

| | パッケージのバグ | 今回 |
| --- | --- | --- |
| 修正の届き方 | `npm update` で収束する | **収束しない** |
| すでに実行した人 | 直せる | **届かない。移行は 1 回きり** |

深刻度そのものは低い（条件が「絶対パスでルートを超える `..` を含む
シンボリックリンク」に限られる）。ただし**直っても遡れない**ので、
報告の価値は条件の狭さから受ける印象より高い。

---

## 4. サイズの壁（C18 / R3）— 予測が外れ、ドキュメントとも合わなかった

### Phase 3 の予測

> DO SQLite の行上限は 2 MB（公式 Limits）。旧 Shell は base64 で 1 セルに入れるので、
> 4MB ファイル（base64 5.59MB）は保存できないはず。

### 観測① 旧 Shell の境界

**4MB は通った。** 二分探索で境界を 1 バイトまで詰めた（本番、DO はプローブごとに新規）:

```
旧 Shell が通る最大: 6,291,408 バイト（base64 8,388,544 文字）
落ちる最小:          6,291,409 バイト（base64 8,388,548 文字）→ SQLITE_TOOBIG
```

対照: 同じ 8MB / 16MB / 32MB を新 Computer に書くと**すべて通る**（512 KiB チャンク）。

### 観測② ライブラリを経由しない素の上限

`ctx.storage.sql` と `ctx.storage.kv` を直接叩いて二分探索した:

```
size          TEXT   BLOB   KV
   8388624     OK     OK    NG
   8388627     OK     OK    NG      ← 通る最大
   8388628     NG     NG    NG      ← 落ちる最小
  12582912     NG     NG    NG
```

**8 MiB = 8,388,608。** TEXT / BLOB / KV 値のいずれも約 8 MiB で、
ドキュメントの **2 MB とは 4 倍ずれている**。

### 観測③ Shell だけが低い — しかも複製すると再現しない

同じ DO・同じ base64 文字列（8,388,548）で並べた:

```
(a) shell.writeFileBytes                    !! SQLITE_TOOBIG
(b) Shell と同じ列構成への素の UPSERT         OK
(d) Shell の DDL・INDEX・INSERT 文を完全複製   OK
(e) Shell が作る base64 そのものを bind       OK
(c) 2 列テーブルへの素の INSERT               OK
```

スタックは Shell の INSERT を指している:

```
Error: string or blob too big: SQLITE_TOOBIG
  at Object.run (index.js:367:17)
  at Workspace.writeFileBytes (index.js:652:22)
```

UPSERT の `excluded` が値を二重に持つ、という仮説も立てたが**外れた**
（行が既にある状態の UPSERT も同サイズで通る）。

### 解釈

- **公式ドキュメントの「Maximum string, BLOB or table row size: 2 MB」および
  KV の「Key and value combined cannot exceed 2 MB」は、実測と合わない。**
  ライブラリを介さない測定で、3 つの面すべてが約 8 MiB。
- 旧 Shell の実用上の上限は **ファイル約 6 MiB**（base64 が 4/3 に膨らむ）。
  Shell の行には `path` / `name` / `mime_type` 等が約 68 バイト乗るので、
  8 MiB の行上限に当たっていると考えると桁は合う。
- **ただし、その行構成を完全に複製した素の SQL は同じサイズで通る。**
  → Shell の境界が素の SQL より低い理由は**特定できていない**。
  実行経路の何かに起因するが、本検証では切り分けきれなかった。
- 新 Computer はチャンク化するのでこの壁が無い。
  「チャンク化は性能の話ではなく上限の話」という当初の見立ては、
  **上限値を間違えたまま結論だけ当たった**形。

> ⚠️ ローカル（miniflare）では 4MB までしか試していない。同じ 8 MiB かは未確認。

## 5. ロールバック（C19）— ドキュメントに無い制約

### 観測

```
[C19] まず普通に書く
[C19] schema_version（現在）        → 10
[C19] 対照: 同じ版で再構築           → {read: "hello"}
[C19] schema_version を 11 に偽装
!!    古いバイナリで開き直す          → EIO Unsupported workspace filesystem schema version 11
[C19] schema_version を 10 に戻す
[C19] 戻したら開けるか               → {read: "hello"}
```

ローカル・本番とも同一。

### 解釈と、狭めた主張

実際に古い `@cloudflare/computer` をデプロイしたわけではない。測ったのは:

> **on-disk の `schema_version` がバイナリの対応版より新しいと、`EIO` で開けない。**

これが「古い版にロールバックできない」を意味するのは、
**新しい版がスキーマを上げた場合に限る**。ただし `@cloudflare/computer@0.6.0` には
v1→v10 のマイグレータが 9 本登録されており、過去に 9 回上げている。
前方移行は自動、後方は不可。

- 移行ガイドにも Changelog にも、ロールバック不可の記述は無い
- `computer/docs/03_filesystem_schema.md` に
  *"Open() refuses to run if the binary is older than the on-disk `schema_version`."*
  と 1 行だけある（ユーザー向けドキュメントではない）

---

## 6. 速度（C22）

### 計測方法

**Worker の中では `Date.now()` が進まない。** 本番では 4MB の書き込みすら `0ms` と
記録された（ローカル miniflare では進む）。Spectre 対策の時計粗化。

→ ドライバの壁時計で測り、**`rounds=0` の素通しリクエストを対照に引いた**。

```
1 サイクル = (T_60 - T_0) / 60       write + read の往復。7 回の中央値
```

### 観測（本番）

```
size    side      素通し(ms)  60回(ms)   1サイクル(ms)
1KB     shell           459       554         1.58
1KB     computer        598       553        -0.75
100KB   shell           462       757         4.92
100KB   computer        537       585         0.80
1MB     shell           615      5850        87.25
1MB     computer        411       798         6.45
```

### 解釈

- **1KB・100KB は結論を出せない。** 負の値が出ており、HTTP RTT のばらつきに埋もれている。
- **1MB では差がはっきりする: 87.25ms 対 6.45ms（13.5 倍）。**
  旧 Shell は毎回 1MB を base64 に変換して 1 行に入れ、読むときに戻している。
- write と read を分離していないので、「書きが遅いのか読みが遅いのか」は言えない。

---

## 7. 検証中に出た副産物

| | 内容 | 効く先 |
| --- | --- | --- |
| F1 | **Worker 内で `Date.now()` が進まない**（本番のみ。ローカルは進む） | 計測はすべて外から |
| F2 | **再デプロイしただけでは DO は再起動しない** | 対照が無いと誤判定する |
| F3 | ローカルだけ `__miniflare_do_name` テーブルが増える | テーブル一覧を比べるとき |
| F4 | 移行後の素朴な存在/ハッシュ比較は**シンボリックリンクの破損を見逃す** | 検証スクリプトの設計 |
| F5 | Shell は同じ storage + namespace で**異なるオプションの Workspace 構築を拒否する** | C21 の対照が置けなかった理由 |

---

## 8. ハーネス側でやらかしたこと（記録）

- **DO 名にパラメータを入れ忘れ**、`variant=fixed` が同じ DO に当たった。
  seed が `EEXIST` になって初めて気づいた。自分で claims.md に
  「DO 名は検証ごとに新しくする」と書いていたのに破った
- **`sizes` シナリオで `/workspace` を作り忘れ**、対照が全件 `ENOENT` で落ちていた。
  「旧は通る / 新は落ちる」と読めてしまう状態だった。**対照が効いているか必ず見る**

---

## 9. 未確認・積み残し

- [ ] ローカル miniflare の行上限が本番と同じ 8 MiB か（4MB までしか試していない）
- [ ] C22 の write / read 分離。いまは往復の合計
- [ ] 実際に古い `@cloudflare/computer` をデプロイしてのロールバック再現（C19 は偽装で代替）
- [ ] Think 予約パス（`/workspace/fetched/` 等）と旧ファイルの衝突
- [ ] `exec` バックエンド経由のファイル操作（T13。Dynamic Worker Loader が要る）
- [ ] 同時書き込み（T12）
