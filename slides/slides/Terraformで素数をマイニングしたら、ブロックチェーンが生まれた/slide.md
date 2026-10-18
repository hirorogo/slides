---
title: Terraformで素数をマイニングしたら、ブロックチェーンが生まれた
description: 〜 Infrastructure as Code。つまりCode。なら何でもできますよね？ 〜
author: 田中博悠 / tanahiro2010
slug: terraform-prime-blockchain
published: true
---

::title::

# Terraformで素数をマイニングしたら、ブロックチェーンが生まれた

〜 Infrastructure as Code。つまりCode。なら何でもできますよね？ 〜

田中博悠 / tanahiro2010

::note::

「Terraformで素数をマイニングしたら、ブロックチェーンが生まれた」というタイトルで発表します。田中博悠です。よろしくお願いします。

全 98 枚・想定 12 分。巻くなら ①Phase 2 のハマりポイント → ②Phase 4 の検証 HCL → ③destroy ログ 2 枚目 の順で落とす。

---

## 田中博悠 / tanahiro2010

- 三田学園高等学校 1年
- TypeScript / Web / CLI / AI Agent / Security
- 個人開発・OSS・脆弱性調査・イベント運営

# バンジージャンプ

::right::
![tanahiro2010](./img/tanahiro_hono.jpg)

::note::

高校1年で、普段は TypeScript で Web とか CLI とか AI エージェントとか、あとセキュリティまわりを触っています。写真はバンジージャンプしてるところです。あとで聞いてください。

笑いが取れなくても気にせず次へ。**15 秒で切る。**

---

::center::

Terraform、使ってますか？

::note::

まず、Terraform 使ってる方ってどのくらいいますか？

軽く手を挙げてもらう。挙手が少なければ「大丈夫です、今日は Terraform の話ほぼしません」と足す。

---

::center::

インフラをコードで管理するやつ

::note::

インフラをコードで管理するツールですね。

---

::center::

Infrastructure as Code

::note::

Infrastructure as Code、略して IaC。

---

::center::

Infrastructure as **Code**

::note::

Infrastructure as、**Code**。

---

::center::

つまり

::note::

つまり、

---

::center size=2::

**Code**

::note::

**Code** なんですよ。

ここは溜める。1 拍置く。

---

::center::

Code なら

::note::

Code なら……

---

::center::

素数のマイニングもできますよね？

::note::

素数のマイニングも、できますよね？

---

::center size=2::

🤔

::note::

何も言わずに 1 拍。

---

::center bg=purple::

できました

::note::

できました。

**ここが一つ目の山。** 拍手や笑いが来たら待つ。

---

## 今日の話

1. **Prime Discovery** — HCL だけで素数を探す
2. **Recursive Terraform** — Terraform が Terraform を起動する
3. **Distributed Prime Mining** — Terraform を並列で動かす
4. **PrimeChain** — 素数でブロックチェーンを作る
5. **Terraform Destroy** — 全部壊す

::note::

今日は 5 つのフェーズで話します。HCL だけで素数を探して、Terraform が Terraform を起動して、それを並列にして、素数でブロックチェーンを作って、最後に全部壊します。

---

## ルール

- 計算ロジックは **すべて HCL**
- Python / JS / Go などで計算するのは禁止
- シェルは「Terraform の起動」と「ファイル配置」だけ
- Provider は Terraform 組み込みのものだけ
  - `terraform_data` / `terraform_remote_state`

::note::

ルールがあります。計算ロジックは**すべて HCL**。Python や JS で計算したら負け。シェルがやっていいのは「Terraform を起動する」ことと「ファイルを置く」ことだけ。Provider も Terraform 組み込みのものだけです。

---

::center::

**Terraform 以外に計算させたら負け**

::note::

Terraform 以外に計算させたら、負けです。

---

::center size=1.5 bg=white::

Phase 1

Prime Discovery

::note::

まず Phase 1、素数を探します。

---

::center::

HCL にはループがない

::note::

HCL にはループ構文がありません。for 文も while もない。

---

::center::

でも `for` 式はある

::note::

でも、**for 式**はあります。リスト内包表記みたいなやつですね。

---

::center::

`n` が素数 ⇔ `2..√n` のどれでも割り切れない

::note::

素数判定はシンプルに試し割り法です。n が素数っていうのは、2 からルート n までのどれでも割り切れない、ということ。これ、for 式で書けます。

---

```hcl
locals {
  candidates = range(var.start, var.end)

  # n が素数 ⇔ 2..floor(√n) のどれでも割り切れない
  primes = [
    for n in local.candidates : n
!!     if alltrue([for d in range(2, floor(pow(n, 0.5)) + 1) : n % d != 0])
  ]
}
```

::note::

これが全部です。range で候補を作って、for 式で回して、`alltrue` で「全部の割り算の余りがゼロじゃない」ことを判定する。強調行を指して、この 1 行が素数判定です。

**コードは全部読まない。ハイライト行だけ指す。**

---

::center::

`terraform apply` すると

::note::

これを `terraform apply` すると、

---

```console
$ terraform apply -var start=1 -var end=100

Apply complete! Resources: 0 added, 0 changed, 0 destroyed.

Outputs:

primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41,
          43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97]
summary = "[1, 100) の 98 個の整数を判定し、25 個の素数を発見しました（最大: 97）"
```

::note::

素数が出てきます。1 から 100 までで 25 個。

---

::center::

**Resources: 0 added**

::note::

ここ見てください。**Resources: 0 added**。

---

::center::

インフラは何も作っていない

-# terraform apply が素数を計算しているだけ

::note::

インフラは何も作ってません。`terraform apply` が、ただ素数を計算しているだけです。

---

::center bg=blue::

ハマりポイント

::note::

ここでハマりポイントがありました。

---

::center::

`range()` は **1024 要素** までしか作れない

::note::

`range()` 関数、1024 要素までしか作れないんです。

---

```console
$ echo 'length(range(1025))' | terraform console

Error: Error in function call
```

::note::

`range(1025)` やるとエラーになります。知らなかった。

---

```hcl
locals {
  # range() は 1 回で最大 1024 要素まで
  # → 探索範囲を 1024 ずつのチャンクに分割してから flatten する
!!   chunk_starts = range(local.lower, var.end, 1024)
  candidates = flatten([
    for s in local.chunk_starts : range(s, min(s + 1024, var.end))
  ])
}
```

-# 除数側の range(2, √n) も 1024 以内 → n は 1024² = 1,048,576 まで

::note::

なので探索範囲を 1024 ずつのチャンクに分けて、flatten で平らにしました。

ちなみに割る側の `range(2, √n)` も 1024 以内に収める必要があるので、扱える n の上限は 1024 の 2 乗、だいたい 100 万です。

---

::center::

10 万までやってみた

::note::

で、10 万までやってみました。

---

```console
$ make prime START=1 END=100000

summary = "[1, 100000) の 99998 個の整数を判定し、9592 個の素数を発見しました（最大: 99991）"

real  2:02.14
```

::note::

9592 個見つかりました。かかった時間が、

---

::center size=2::

**2 分**

::note::

2 分。

---

::center::

遅い

::note::

遅い。

---

::center size=1.5 bg=white::

Phase 2

Recursive Terraform

::note::

Phase 2。遅いので並列化したい。そのためにまず範囲を分割したい。

---

::center::

範囲を分割したい

::note::

範囲を分割したい。

---

::center::

でも HCL には再帰関数もない

::note::

でも HCL には再帰関数もないんですよ。ループもない、再帰もない。

---

::center::

なら

::note::

なら、

---

::center::

**Terraform を再帰起動すればいい**

::note::

**Terraform 自体を再帰起動すればいい**。

---

## 自分自身を子 Terraform として起動する

```hcl
module "child" {
  source   = "../modules/spawn"
  for_each = local.is_leaf ? {} : {
    L = { start = var.start, end = local.mid }
    R = { start = local.mid, end = var.end }
  }

  name       = "${var.node_id}.${each.key}"
!!   config_dir = abspath(path.root) # ← 自分自身
  vars = {
    start = tostring(each.value.start)
    end   = tostring(each.value.end)
  }
}
```

::note::

範囲が大きければ半分に割って、自分自身を子 Terraform として 2 つ起動します。強調行を指して、`config_dir` に自分のディレクトリを渡しているのがポイントです。自分で自分を apply します。

---

## spawn モジュール

```hcl
resource "terraform_data" "process" {
  triggers_replace = var.vars
  input            = { env = local.env } # TF_VAR_* と TF_DATA_DIR

  provisioner "local-exec" {
    environment = self.input.env
    command     = <<-EOT
      terraform -chdir="$CONFIG_DIR" init \
        -backend-config="path=$RUN_DIR/terraform.tfstate"
!!       terraform -chdir="$CONFIG_DIR" apply -auto-approve
    EOT
  }
}
```

::note::

起動の実体がこれ。`terraform_data` の `local-exec` で `terraform init` して `terraform apply` する。子ごとに State の置き場所と `TF_DATA_DIR` を分けているので、同じディレクトリを何個でも同時に apply できます。

---

## 子の結果は子の State から読む

```hcl
data "terraform_remote_state" "process" {
  backend = "local"
  config = {
    path = "${local.run_dir}/terraform.tfstate"
  }

!!   depends_on = [terraform_data.process] # 子の apply が終わってから読む
}
```

-# 引数は TF_VAR_*、戻り値は terraform_remote_state。プロセス間通信です

::note::

結果は `terraform_remote_state` で子の State を読んで回収します。`depends_on` で、子の apply が終わってから読むようにする。

引数は環境変数の `TF_VAR_*`、戻り値は State。これ、要するに**プロセス間通信**です。

---

```console
$ make recursive END=8000 LEAF=1000

🚀 23:33:14 spawn terraform: root.L
🚀 23:33:14 spawn terraform: root.R
✅ 23:33:15 done:            root.L
✅ 23:33:15 done:            root.R

tree = [
  "root [1, 8000) → split",
  "    root.L [1, 4000) → split",
  "        root.L.L [1, 2000) → split",
  "            root.L.L.L [1, 1000) → 168 primes",
  "            root.L.L.R [1000, 2000) → 135 primes",
  "        root.L.R [2000, 4000) → split",
  ...
  "            root.R.R.R [7000, 8000) → 107 primes",
]
```

::note::

動かすとこうなります。root が L と R に割れて、その下もまた割れて、葉だけが素数を計算している。

---

::center::

**15 個の Terraform** が

自分自身を起動している

::note::

このとき、**15 個の Terraform** が自分自身を起動しています。

---

::center bg=blue::

ハマりポイント

::note::

ここでもハマりました。

---

::center::

1 回目は動くのに

2 回目の apply で子が全滅

::note::

1 回目の apply は通るのに、2 回目で子が全滅する。

---

```console
$ terraform apply -var end=3000

🚀 23:31:35 spawn terraform: root.L
Error: Error acquiring the state lock
Error message: resource temporarily unavailable
Lock Info:
  Path:      terraform.tfstate
  Operation: OperationTypeApply
```

::note::

`Error acquiring the state lock`。State のロックが取れない。

---

::center::

子の `terraform init` が

親の `terraform.tfstate` を見つけて

::note::

原因は、子の `terraform init` が、親の `terraform.tfstate` を見つけてしまうことでした。

---

::center::

「**古い State を移行しなきゃ！**」

-# → 親が掴んでいるロックとぶつかる

::note::

「あっ、古い State がある。backend に移行しなきゃ！」って気を利かせてくれて、親が掴んでいるロックとぶつかる。

---

```hcl
terraform {
  # 直接 apply したときの State も config_dir 直下に置かない
  # （./terraform.tfstate があると子の init が「移行」しに行く）
!!   backend "local" {
!!     path = ".runs/root/terraform.tfstate"
!!   }
}
```

::note::

対策は、起動される側の State をディレクトリ直下に置かないこと。`backend "local"` で `.runs` の下に逃がしました。

---

::center size=1.5 bg=white::

Phase 3

Distributed Prime Mining

::note::

Phase 3。再帰できるなら、

---

::center::

再帰できるなら

並列もできる

::note::

並列もできます。

---

## Pool と Miner

```hcl
locals {
  assignments = {
    for i in range(var.miners) : format("miner-%02d", i + 1) => {
      start = var.start + i * local.span
      end   = min(var.start + (i + 1) * local.span, var.end)
    }
  }
}

module "miner" {
  source   = "../modules/spawn"
!!   for_each = local.assignments
  name     = each.key
}
```

-# Miner ごとに State を分けるので、ロック競合は起きない

::note::

親を Pool、子を Miner と呼ぶことにして、範囲を Miner の数で割って `for_each` で起動します。Miner ごとに State が別なので、さっきのロック競合は起きません。

---

```console
$ make pool

🚀 23:33:44 spawn terraform: miner-04
🚀 23:33:44 spawn terraform: miner-01
🚀 23:33:44 spawn terraform: miner-03
🚀 23:33:44 spawn terraform: miner-02
✅ 23:33:46 done:            miner-01
✅ 23:33:47 done:            miner-02
✅ 23:33:48 done:            miner-03
✅ 23:33:48 done:            miner-04

summary = "4 台の Terraform Miner が [1, 20000) から 2262 個の素数を発見しました（最大: 19997）"
```

::note::

動かすと、4 台の Miner が同時に起動して、同時に終わります。

---

::center::

Terraform はリソースを **10 並列** で作る

::note::

これ、並列化のコードは書いてません。Terraform はもともとリソースを最大 10 並列で作るので、

---

::center::

= Miner が勝手に並列で動く

::note::

Miner が勝手に並列で動くんです。

---

## [1, 100000) の素数 9592 個

| 構成                |       時間 |
| ------------------- | ---------: |
| Phase 1: 1 プロセス | 2 分 02 秒 |
| Phase 3: 8 Miner    |  **38 秒** |

::note::

10 万までの素数 9592 個で比べると、1 プロセスで 2 分 2 秒、8 Miner で 38 秒。

---

::center size=2::

**3.2 倍**

::note::

3.2 倍速くなりました。

---

::center::

（Python なら一瞬）

-# 言わない約束

::note::

Python なら一瞬です。言わない約束でお願いします。

---

::center size=1.5 bg=white::

Phase 4

PrimeChain

::note::

Phase 4。素数が掘れるようになりました。

---

::center::

素数が掘れるようになった

::note::

素数が掘れるようになりました。

---

::center::

掘る（マイニング）といえば

::note::

掘る、マイニングといえば、

---

::center size=1.5::

ブロックチェーン

::note::

ブロックチェーンですよね。

---

## ブロック

| フィールド  | 中身                                               |
| ----------- | -------------------------------------------------- |
| `height`    | ブロック番号                                       |
| `prev_hash` | 前ブロックのハッシュ                               |
| `miner`     | 掘った Miner                                       |
| `prime`     | 発見した素数                                       |
| `nonce`     | Nonce                                              |
| `hash`      | `sha256("height\|prev_hash\|miner\|prime\|nonce")` |

::note::

ブロックの中身はこうです。ブロック番号、前のブロックのハッシュ、掘った Miner、発見した素数、Nonce、そしてそれ全部を連結して sha256 したブロックハッシュ。

---

::center::

`terraform apply` 1 回 = **ブロック 1 個**

::note::

`terraform apply` 1 回で、ブロックが 1 個増えます。

---

## 採掘も HCL

```hcl
locals {
  # 見つけた素数 × nonce の全組み合わせで sha256 を計算
  attempts = flatten([
    for p in module.prime.primes : [
      for n in range(var.max_nonce) : {
        prime = p
        nonce = n
        hash  = sha256(format("%d|%s|%s|%d|%d",
          var.height, var.prev_hash, var.miner_id, p, n))
      }
    ]
  ])

  # 先頭が 0 * difficulty のものだけ残す
!!   hits = [for a in local.attempts : a if startswith(a.hash, local.target)]
}
```

::note::

採掘も HCL です。見つけた素数と nonce の全組み合わせで sha256 を計算して、強調行を指して、ハッシュの先頭が 0 で始まるものだけ残す。これが Proof of Work です。

---

::center::

採用ルール：

ハッシュ値が **いちばん小さい** 候補

::note::

条件を満たす候補が複数あったときは、ハッシュ値がいちばん小さいものを採用します。

Terraform は何度 plan しても同じ結果じゃないと困るので、**採用ルールは決定的にしてあります。**

---

```console
$ make mine BLOCKS=3

🚀 23:37:49 spawn terraform: miner-04
🚀 23:37:49 spawn terraform: miner-01
...
⛏️ Block #0 mined by miner-01: prime=101 nonce=23 hash=001817dc39715b1f... (4 candidates, 5056 hashes)
⛏️ Block #1 mined by miner-02: prime=593 nonce=19 hash=0008d290675e22b3... (4 candidates, 3840 hashes)
⛏️ Block #2 mined by miner-04: prime=1103 nonce=48 hash=001d824ab4d1be8c... (4 candidates, 3712 hashes)

$ make explorer

#0   001817dc39715b1f ← 0000000000000000  miner-01 prime=101    nonce=23
#1   0008d290675e22b3 ← 001817dc39715b1f  miner-02 prime=593    nonce=19
#2   001d824ab4d1be8c ← 0008d290675e22b3  miner-04 prime=1103   nonce=48
```

::note::

掘ってみるとこうなります。ブロック 0 を miner-01 が素数 101 で掘って、1 を miner-02 が 593 で、2 を miner-04 が 1103 で。ハッシュがちゃんと前のブロックとつながっています。

---

::center::

チェーンの検証も HCL

::note::

検証も HCL です。

---

```hcl
verifications = [
  for i, b in local.chain : {
    height = b.height == i
    link   = b.prev_hash == try(local.chain[i - 1].hash, local.genesis_hash)
    hash   = b.hash == sha256(format("%d|%s|%s|%d|%d",
               b.height, b.prev_hash, b.miner, b.prime, b.nonce))
    work   = startswith(b.hash, join("", [for _ in range(b.difficulty) : "0"]))
    prime  = b.prime >= 2 && alltrue([
      for d in range(2, max(2, floor(pow(b.prime, 0.5)) + 1)) : b.prime % d != 0
    ])
  }
]
```

::note::

ブロック番号が連番か、前のハッシュとつながっているか、ハッシュを計算し直すと一致するか、難易度条件を満たしているか、そして**素数が本当に素数か**。最後のやつは Phase 1 の判定式を再利用しています。

---

## 1 ブロック = 1 リソース

```hcl
resource "terraform_data" "block" {
  for_each = { for i in range(local.height + 1) : format("%04d", i) => i }
  input    = local.chain[each.value]

  lifecycle {
!!     precondition {
!!       condition     = alltrue(values(local.verifications[each.value]))
!!       error_message = "ブロック #${each.value} の検証に失敗しました"
!!     }
  }
}
```

::note::

ここが個人的にいちばん気に入っているところで。ブロック 1 個を `terraform_data` のリソース 1 個として管理して、強調行を指して、`precondition` に検証を書いています。

---

::center bg=red::

改ざんしてみる

::note::

改ざんしてみましょう。

**ライブデモするならここ。** しないならスライドのまま読む。時間が余ったらここを伸ばす。

---

```console
$ make tamper BLOCK=1
😈 Block #1 の prime を 4 に書き換えました

$ make mine

Error: Resource precondition failed

  on main.tf line 173, in resource "terraform_data" "block":
 173:       condition     = try(alltrue(values(local.verifications[each.value])), false)

ブロック #1 の検証に失敗しました:
{"hash":false,"height":true,"link":true,"prime":false,"work":true}
make: *** [mine] Error 1
```

::note::

台帳のブロック #1 の素数を 4 に書き換えます。4 は素数じゃないですね。この状態で `make mine` すると、`Resource precondition failed`。ブロック #1 の検証に失敗しました、と出て、hash と prime が false になっています。

---

::center::

**plan の時点でバレる**

-# Miner を起動する前に止まる

::note::

しかも**plan の時点でバレる**。Miner を起動する前に止まります。

---

::center bg=blue::

ハマりポイント

::note::

ここでもハマりました。台帳をどこに置くか問題です。

---

::center::

台帳をどこに置くか

::note::

台帳をどこに置くか問題です。

---

::center::

最初の案：

自分自身の `terraform.tfstate` を

`jsondecode(file())` で読む

::note::

最初は「State に全部入ってるんだから、自分の `terraform.tfstate` を読めばいいじゃん」と思ったんです。

---

```console
$ terraform apply

Error: Error in function call

Call to function "try" failed: panic in function implementation:
returned value cty.EmptyTupleVal does not conform to expected return type
...
goroutine 397 [running]:
runtime/debug.Stack()
```

::note::

Terraform が panic しました。

---

::center size=2::

**panic**

::note::

panic です。goroutine のスタックトレースが出ました。

---

::center::

apply 中に Terraform が State を書き換える

-# → plan と apply で読める値が変わる

::note::

当たり前なんですが、apply 中に Terraform 自身が State を書き換えるので、plan のときと apply のときで読める値が変わるんですよね。自分の State を自分で読むのは無理でした。

---

::center::

検証済みのチェーンだけを

**ledger.json** に書き出すことにした

-# 中身は HCL が jsonencode した JSON。シェルはファイルに置くだけ

::note::

なので、検証を通ったチェーンだけを `ledger.json` に書き出すことにしました。中身は HCL が `jsonencode` した JSON で、シェルはファイルに置くだけ。**ルールは守っています。**

---

::center size=1.5 bg=white::

Phase 5

Terraform Destroy

::note::

Phase 5。最後に、

---

::center::

最後に

::note::

最後に、

---

::center::

Terraform 本来の機能を使います

::note::

ようやく Terraform 本来の機能を使います。

---

::center size=1.5::

`terraform destroy`

::note::

`terraform destroy` です。

---

## 親が消えたら子も消す

```hcl
provisioner "local-exec" {
!!   when        = destroy
  environment = self.input.env
  command     = <<-EOT
    terraform -chdir="$CONFIG_DIR" destroy -auto-approve
    rm -rf "$RUN_DIR"
    echo "💥 destroyed: $RUN_NAME"
  EOT
}
```

-# 子が孫を持っていれば、孫も連鎖して destroy される

::note::

`local-exec` には `when = destroy` が書けるので、親が destroy されたら子を destroy する、と書いておきます。子が孫を持っていれば、孫も連鎖して destroy されます。

---

```console
$ make destroy

== terraform destroy: chain
💥 ledger.json destroyed. PrimeChain is gone.
💥 Block #0 destroyed. prime 101 is gone.
💥 Block #2 destroyed. prime 1103 is gone.
💥 Block #1 destroyed. prime 593 is gone.
💥 23:39:16 destroyed:       miner-02
💥 23:39:16 destroyed:       miner-04
💥 23:39:16 destroyed:       miner-01
💥 23:39:16 destroyed:       miner-03
Destroy complete! Resources: 9 destroyed.
```

::note::

実行すると、台帳が消えて、ブロックが消えて、Miner が消えていきます。「prime 101 is gone」。

---

```console
== terraform destroy: recursive
💥 23:39:19 destroyed:       root.R.L.L
💥 23:39:19 destroyed:       root.R.L.R
💥 23:39:19 destroyed:       root.R.L
💥 23:39:19 destroyed:       root.R.R.L
💥 23:39:19 destroyed:       root.R.R.R
💥 23:39:19 destroyed:       root.R.R
💥 23:39:19 destroyed:       root.L.L.L
💥 23:39:19 destroyed:       root.L.L.R
💥 23:39:19 destroyed:       root.L.L
💥 23:39:19 destroyed:       root.L.R.R
💥 23:39:19 destroyed:       root.L.R.L
💥 23:39:19 destroyed:       root.L.R
💥 23:39:19 destroyed:       root.R
💥 23:39:19 destroyed:       root.L
Destroy complete! Resources: 2 destroyed.
```

::note::

再帰のほうはもっと壮観で、root.R.L.L から順に 14 個消えます。

**巻くならこの 1 枚を飛ばす。**

---

::center::

親から見ると **リソース 2 個**

::note::

でも親から見ると、`Destroy complete! Resources: 2 destroyed`。リソースは 2 個です。

---

::center::

その裏で **14 個の Terraform** が消えていく

::note::

その裏で 14 個の Terraform が消えている。

---

::center::

そして Phase 1 の素数は

::note::

そして Phase 1 の素数はどうなるかというと、

---

```console
== terraform destroy: prime-discovery
Destroy complete! Resources: 0 destroyed.
```

::note::

`0 destroyed`。

---

::center::

そもそもリソースじゃなかった

::note::

そもそもリソースじゃなかったです。

---

::center bg=purple::

Terraform で素数を構築し、

Terraform で素数を破壊する

::note::

Terraform で素数を構築し、Terraform で素数を破壊する。これが本プロジェクトの到達点です。

---

::center size=1.5 bg=white::

まとめ

::note::

まとめます。

---

## 分かったこと

- HCL は思ったより書ける
  - `for` 式・`alltrue`・`sha256`・`precondition`
- `local-exec` + `TF_VAR_*` + `terraform_remote_state` で **プロセス間通信** ができる
- Terraform は **State を中心に** 動いている
  - init は State の移行を気にするし、apply 中は State を書き換え続ける
- `range()` の 1024 制限など、計算基盤ではない前提が随所にある

::note::

分かったことです。HCL は思ったより書けます。for 式、`alltrue`、`sha256`、`precondition`。そして `local-exec` と `TF_VAR_*` と `terraform_remote_state` を組み合わせるとプロセス間通信ができる。

あとこれが一番大きいんですが、**Terraform は State を中心に動いている**。init は State の移行を気にするし、apply 中は State を書き換え続ける。今回ハマったところは、全部 State 絡みでした。

---

::center::

技術的に可能なことと

技術的に適切なことは違う

::note::

技術的に可能なことと、技術的に適切なことは違います。

---

::center::

しかし、それを知るためには

時として技術を間違った方向に

**全力で使う** 必要がある

::note::

しかし、それを知るためには、時として技術を間違った方向に全力で使う必要があると思っています。

---

::center size=2::

All You Need Is Terraform.

::note::

All You Need Is Terraform.

---

::title::

# ありがとうございました

Terraform PrimeChain

田中博悠 / tanahiro2010
https://github.com/tanahiro2010/terraform-primechain
https://github.com/tanahiro2010/ippon-slides

::note::

ありがとうございました。

リポジトリは github.com/tanahiro2010/terraform-primechain。質問あればぜひ。
