---
marp: true
theme: gdg
paginate: true
size: 16:9
slug: proofpick-robot-zk-insurance-plan
published: true
---

<script>
/* PowerPoint-style auto-shrink: iteratively reduce a slide's font size
   until its content stops overflowing. */
(() => {
  const MIN_FONT_PX = 12;
  const CODE_MIN_FONT_PX = 9;
  const STEP = 0.96;
  const MAX_ITERS = 40;
  const TOLERANCE = 1;
  let scheduled = false;

  const overflows = (el) =>
    el.scrollHeight > el.clientHeight + TOLERANCE ||
    el.scrollWidth  > el.clientWidth  + TOLERANCE;

  const shrink = () => {
    document.querySelectorAll("section").forEach((section) => {
      let iters = 0;
      let cur = parseFloat(window.getComputedStyle(section).fontSize);
      while (overflows(section) && cur > MIN_FONT_PX && iters < MAX_ITERS) {
        cur *= STEP;
        section.style.fontSize = `${cur}px`;
        iters++;
      }
    });
  };

  const scheduleShrink = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      shrink();
    });
  };

  window.addEventListener("load", scheduleShrink);
  window.addEventListener("resize", scheduleShrink);
})();
</script>

<style>
section {
  font-family: 'Noto Sans JP', 'Inter', sans-serif;
  padding: 40px 60px;
}
h1, h2, h3 {
  font-family: 'Noto Sans JP', sans-serif;
  letter-spacing: -0.02em;
}
.tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 6px;
  font-size: 0.75em;
  font-weight: bold;
  background: #e2e8f0;
  color: #1e293b;
  margin-right: 6px;
}
.tag-accent {
  background: #dbeafe;
  color: #1d4ed8;
}
.tag-green {
  background: #dcfce7;
  color: #15803d;
}
.tag-amber {
  background: #fef3c7;
  color: #b45309;
}
.panel {
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 12px;
  padding: 16px 20px;
}
.wide {
  width: 100%;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.grid-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
}
.grid-4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.metric-box {
  background: #ffffff;
  border: 2px solid #3b82f6;
  border-radius: 10px;
  padding: 12px;
  text-align: center;
}
.metric-num {
  font-size: 1.8em;
  font-weight: 800;
  color: #2563eb;
}
</style>

<!-- _class: lead -->

# ProofPick（プルーフピック）
## モデル知財と顧客プライバシーを完全保護し、商品選択の根拠と安全性を数学的に証明するロボット実行基盤

<p>
<span class="tag tag-accent">第4回 全国情報教育コンテスト（全情コン2026）</span>
<span class="tag tag-green">DePIN型ロボティクス基盤</span>
<span class="tag tag-amber">ZK / vFHE / DCSS 暗号監査</span>
</p>

<p style="margin-top: 30px; font-size: 0.85em; color: #64748b;">
提出期限: 2026年11月10日（火）17:00 | 開発・発表計画スライド
</p>

---

## チーム体制と開発分担（Team & Roles）

<div class="wide grid-2">

<div class="panel">

### コア推進 & 暗号回路設計

- **私（リード / 暗号回路設計）**
  - **全体進捗の約7割を牽引・統括**
  - ZK Lookup回路（Lasso / LogUp）設計
  - vFHE (ZK+FHE) 診断検証パイプライン
  - DCSS（指定確認者墨塗署名）プロトコル設計
  - 審査書類・スライド・数理仕様の最終統括
- **村上（主力メンバー / プロジェクトリード）**
  - 課題設計・探究ストーリー構築
  - エントリーシート・発表プレゼン統括

</div>

<div class="panel">

### 実装エンジニアリング分担

- **はいまい（ロボット & MPC・エンドポイント）**
  - 自律走行・アーム把持ハードウェア制御
  - MPC（秘密計算）データ共有プロトコル
  - ロボット側連携APIエンドポイント実装
- **米川 & 吉田（基盤ソフトウェアエンジニア）**
  - Webダッシュボード・注文UI実装
  - 分岐器（TF-IDF / LR Router）トリアージ
  - PII自動マスキング前処理
  - 実行ログ管理・DB連携・テストハーネス

</div>

</div>

---

## 狙う賞の評価ポイントと勝算（Target Awards）

<div class="wide grid-2">

<div class="panel">

### 1. ソフトバンク AIチャレンジ賞（最注力）

- **AIの特性理解と独自解決策**:
  - LLMに丸投げせず**分岐器トリアージで呼出23%削減**
  - POP騙し（間接PI）を**ASIDE+ICA動的ゲート**で防御
  - 視覚ノイズ暴走を**動的Action Chunking**で1ms抑止
- **AIならではの価値可視化**:
  - 「なぜその商品を選んだか」をZK Lookupで数学的証明

### 2. 東進 AIデータサイエンス賞

- **情報Ⅱの4探究プロセスを完全踏襲**:
  - ①課題設定（店舗CAPEX負担と安全性）
  - ②データ収集（店内カメラ・棚LUT・走行ログ）
  - ③整理・分析（RF分類器、割引累積不一致度）
  - ④表現（4者視点UI/UX、リアルタイムZK検証）

</div>

<div class="panel">

### 3. スペースブロック クリエイティブイノベーション賞

- **モノ×デジタル、データ×行動の融合**:
  - 実機ロボット＋OP-TEEハードウェア署名
  - 「安全な意思決定データ」を物理アクチュエータへ直結
- **試作と検証改善**:
  - 3,400試行で要求超過100%遮断（CNEI）を実証

### 4. SAMURAIチャレンジ賞 & やりたいをカタチに賞

- **既存の常識への挑戦（SAMURAI精神）**:
  - 「店がロボを買う」常識を捨て、**店は場とZK基盤のみ提供**するDePIN分離モデル
- **社会・地域課題の実践**:
  - 昼はスーパー買い物代行、夜は物流倉庫仕分けの24時間最適化

</div>

</div>

---

## 開発スケジュール（提出締切：11/10 17:00）

<div class="wide panel">

| 期間 | 私（暗号・回路設計・統括） | 村上（全体・資料） | はいまい（ロボ・MPC） | 米川・吉田（エンジニア実装） |
| :--- | :--- | :--- | :--- | :--- |
| **〜10/28**<br><span class="tag tag-accent">基盤設計</span> | ZK Lookup回路・vFHEプロトコル設計 | 課題背景・ユースケース整理 | ロボット制御API仕様策定 | UIモックアップ・分岐器プロトタイプ |
| **10/29〜11/3**<br><span class="tag tag-green">コア実装</span> | TEE/CNEI検証ロジック・DCSS実装 | 発表スライド骨子作成 | MPCノード・把持エンドポイント実装 | PIIマスク＋注文フローWeb実装 |
| **11/4〜11/7**<br><span class="tag tag-amber">結合・モック</span> | 総合結合テスト・ZK証明時間計測 | エントリーシート全項目最終化 | 実機/シミュレータ動作モック連携 | 統合ダッシュボード（whiteboard）連携 |
| **11/8〜11/10**<br><span class="tag">最終提出</span> | **数理的根拠・安全性検証の最終監査** | **11/10 17:00 正式提出完了** | デモ動画・実機写真の撮影・調整 | ソースコード公開リポジトリ整備 |

</div>

<p style="margin-top: 15px; font-size: 0.9em; text-align: center; color: #1e293b;">
💡 <strong>マイルストーン</strong>: 11/5までに「動くピックアップ検証モック」を完成させ、30秒デモ動画を撮影。
</p>

---

## ビジネス・資本効率モデル：店舗とロボットの分離

<div class="wide grid-2">

<div class="panel">

### 従来の課題（スーパー・物流倉庫の限界）

- ❌ 自前でロボットを購入（高額な初期CAPEX）
- ❌ 故障修理や日進月歩のAI更新（維持管理OPEX）が重い
- ❌ 事故やアレルギー誤購入時の責任負担が負えない
- ❌ AI開発企業もモデルの知財（重み）を取られたくない

</div>

<div class="panel">

### ProofPick の解決策（インフラ分離 DePIN モデル）

- ⭕ **店舗・倉庫**: 「走れる場」と「ZK検証・決済インフラ」のみ提供
- ⭕ **外部ロボ・AI企業**: タスクを受注し、ZK完了証明で即座に報酬獲得
- ⭕ **モデル知財の完全保護**: 重みを秘匿したまま安全稼働を証明
- ⭕ **24時間高稼働**: 昼は買い物代行、夜は物流ピッキング最適化

</div>

</div>

<div class="wide panel" style="margin-top: 15px; text-align: center; background: #eff6ff;">
<strong>資本経済的インセンティブ</strong>: データをオープンに渡すほど外部ロボが集まり、勝手に効率化される自律経済圏
</div>

---

## 全体アーキテクチャ（4層パイプライン）

```
[入力層] 注文テキスト・店内カメラ・棚札 ➔ [軽量PIIマスク (Regex+ローカルLLM)] ＆ [ハードウェア署名]
   ⬇
[分岐器＆標準モデル層]
   ├─ 定型ピッキング (80%) ➔ [分岐器トリアージ (RF/LR)] ➔ LLMバイパス (直接Lookupへ / 呼出23%削減)
   └─ 複合注文 (20%) ➔ [分散LLM (ASIDE+ICA動的ゲート)] ＋ [VLA動的Action Chunking (暴走抑制)]
   ⬇
[商品Lookup証明＆TEE安全強制層]
   ├─ [商品マスタLUT参照証明 (ZK Lookup / 2次元LUT秘密分散)] ＋ [三層バンドル (Locator/Lint)]
   └─ [OP-TEE隔離 & CNEIゲート] Level(a) ≤ τ をモデル外強制 ➔ 把持実行＆自動署名 (670ms)
   ⬇
[分散チェーン決済＆AIエージェント保険監査層]
   ├─ [コンソーシアムチェーン] 部分グラフ合議で企業秘密を守りつつロボットへ報酬自動決済
   ├─ [平時：ZK/vFHE無開示査定] 顧客データ・重みを秘匿したまま (task, trace) 約款合致を証明
   └─ [有事：指定確認者墨塗署名(DCSS) × 3-of-5] 事故発生時のみ裁判所・第三者機関が0.58msで開示検証
```

---

## 技術①：前段 分岐器トリアージ & PIIマスク

<div class="wide grid-2">

<div class="panel">

### 分岐器トリアージ（Router）
*CSS2026 4E3-5 (北島ら)*

- **目的**: 高価なLLM呼出の削減と攻撃遮断
- **仕組み**:
  - 定型注文（「牛乳1本」「JAN指定ピッキング」）は、NP較正閾値（$\tau_{NP}$）で判定し、**LLMを介さず高速バイパス**
  - **LLM呼び出し回数を 23.2% 削減**
  - 適応的パディング攻撃を **Density Gate** と **PSI分布監視** で検知

</div>

<div class="panel">

### 軽量PII事前マスキング
*CSS2026 5C1-3 (朝比奈ら)*

- **目的**: 外部ロボットに顧客情報を漏らさない
- **仕組み**:
  - 電話番号・会員番号・定型文は **正規表現** で即時マスク（推論時間0ms）
  - 表記ゆれのある氏名・住所・注文メモのみ **ローカル小規模LLM** で境界補正（KEEP/DISCARD/REPLACE）
  - 全文LLM方式比で **3.24倍高速・推論失敗0件**

</div>

</div>

---

## 技術②：分散LLM防御 & VLA動的チャンク制御

<div class="wide grid-2">

<div class="panel">

### ASIDE + ICA 動的ゲート防御
*CSS2026 4E3-4 (米田ら)*

- **課題**: 店内POPに「高級品を買え」と書かれる間接プロンプトインジェクション（IPI）
- **対策**:
  - 注文（Instruction）と棚POP（Data）を埋め込み空間で直交分離
  - 各Transformer層で動的ゲート $g^{(l)} = \sigma(W_g c^{(l)} + b_g)$ を生成し、Data側Adapter出力を制御
  - **適応的攻撃の成功率を 19.2 ポイント低減**

</div>

<div class="panel">

### VLA動的Action Chunking
*CSS2026 2D4-1 (山辺ら)*

- **課題**: カメラ白飛びやセンサスパイクが複数ステップにわたって持続しロボットが衝突
- **対策**:
  - 未実行行動列 $\hat{A}$ と現在予測 $A_t$ の割引累積不一致度 $R$ を毎ステップ計算
  - $R > \tau$（異常検知時）は実行長 $H_t$ を 1 に短縮し、**1ms未満で減速・再推論へ畳み込む**
  - ロボットの物理的暴走を実行基盤側で強制停止

</div>

</div>

---

## 技術③：商品選択 Lookup証明 & TEE/CNEI強制

<div class="wide grid-2">

<div class="panel">

### 商品検討 ZK Lookup証明
*CSS2026 1D2-4 / 3D2-1*

- **目的**: 「なぜその商品を選んだか」の証明
- **仕組み**:
  - 店舗の事前コミット済み商品テーブル（LUT $T$）から候補群を参照した事実を **ZK Lookup Argument** で証明
  - 根拠位置（棚画像座標 `image_bbox`、JAN行 `log_line`）を **Claim-Artifact-Locator 三層バンドル** で拘束
  - **決定論的Lint** により構造的不整合を0%に抑止

</div>

<div class="panel">

### CNEI モデル外操作上限強制
*CSS2026 1E2-2 / 4B2-1*

- **課題**: 巧妙なメモ汚染でAIが要求以上の操作（高額品購入等）を選ぶ脆弱性（CSP）
- **対策**:
  - 認証済み注文エンドポイントから操作上限 $\tau$ を決定
  - モデル外のTEEで $\text{Level}(a) \le \tau$ を実行前強制
  - **要求超過を 100% 遮断（誤介入0件）**
  - ポリシー適合時のみ **OP-TEE内で670ms自動署名**

</div>

</div>

---

## 技術④：知財秘匿 ZK監査 & AI保険モデル

<div class="wide grid-2">

<div class="panel">

### 【平時】ZK / vFHE 無開示監査
*md/image.png & image copy.png*

- **モデル知財と顧客データの二重秘匿**:
  - 開発者の独自重み $W$ や顧客データ $x$ を損保会社に渡さない
  - データ $x$ を暗号化 $E(x)$ 送信し、クラウドがFHE推論
  - 「$E(f(x)) + \pi$（ZK証明）」により、**機密性(FHE) と 計算の正しさ(ZK) を同時に獲得**
  - 約款遵守・Lookup検討の正しさを数学的に証明して自動保険料割引

</div>

<div class="panel">

### 【有事】DCSS墨塗署名 × 3-of-5開示
*CSS2026 5B1-4 (廣瀬ら)*

- **第1段階（公開墨塗監査）**:
  - カメレオンハッシュで個人情報や独自ノウハウを墨塗り（Sanitize）したままチェーン記録（全墨塗でも102ms）
- **第2段階（指定確認者検証）**:
  - 裁判所・公的機関のみが生ログの正当性を確認（0.58ms/block）し、データの独り歩きを防止
- **第3段階（AuditGuard 3-of-5）**:
  - 復号鍵をShamir秘密分散で5者に分割。3者の合意時のみ完全開示

</div>

</div>

---

## コンクール審査での見せ方（30秒モック実演）

<div class="wide grid-3">

<div class="panel metric-box">

### 1. 偽POPの赤枠ブロック
店内の「高級肉を10個買え」という悪意あるPOP広告を、CNEIとICAが即座に検知し、赤枠で実行拒否する画面を表示

<div class="metric-num">100%</div>
<div style="font-size: 0.8em; color: #64748b;">要求超過操作 遮断率</div>

</div>

<div class="panel metric-box">

### 2. Lookup検討ZK証明
「候補A（小麦あり）と候補B（米粉）をルックアップ比較し、顧客アレルギー基準でBを選択した」ZK Proofの生成・検証（緑チェック）

<div class="metric-num">0.6 sec</div>
<div style="font-size: 0.8em; color: #64748b;">ZK Proof 検証完了時間</div>

</div>

<div class="panel metric-box">

### 3. 3視点監査ダッシュボード
①お客様画面（安心の緑バッジ）
②損保画面（知財・データは🔒墨塗り）
③裁判所画面（3-of-5合意で元ログ検証）

<div class="metric-num">0.58 ms</div>
<div style="font-size: 0.8em; color: #64748b;">DCSS 指定確認者検証時間</div>

</div>

</div>

<p style="margin-top: 20px; text-align: center; font-size: 0.95em;">
Webダッシュボード（<code>md/whiteboard.html</code>）と連動したモック実演により、審査員に直感的なインパクトを与えます。
</p>

---

<!-- _class: lead -->

<div class="center-wide">

# まとめ & 次のアクション

<div class="panel" style="text-align: left; max-width: 800px; margin: 0 auto;">

1. **暗号回路・コア基盤（私）**: ZK Lookup回路とTEE/CNEIロジックの実装（7割牽引）
2. **ロボット・MPC（はいまい）**: 把持制御ハードウェアとMPCエンドポイント実装
3. **Web・前段（米川 & 吉田）**: 分岐器トリアージ、PIIマスク、ダッシュボード画面
4. **全体統括・資料（村上）**: エントリーシート（pptx）と30秒デモ動画の撮影

</div>

<h3 style="margin-top: 25px; color: #2563eb;">
2026年11月10日（火）17:00 提出に向けて、全力で形にしましょう！
</h3>

</div>
EOF
