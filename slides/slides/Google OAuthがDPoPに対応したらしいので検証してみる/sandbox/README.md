# sandbox — references.md の計測を再現するスクリプト

`../references.md` の「計測」セクションに対応。実行には `jose@6.2.12` が要る。

```sh
npm init -y && npm i jose@6.2.12
```

| ファイル | references.md | 内容 |
| --- | --- | --- |
| `check_jti.py` | 計測 A | 公式サンプルの `jti = base64url(sha256(code))` を再現 |
| `verify-doc-sample.mjs` | 計測 B | 公式 2 サンプル proof の署名検証（Refresh 側が 70B DER で落ちる） |
| `measure-node.mjs` | 計測 C / D | 非 extractable 鍵の export 不可、署名フォーマット、proof 生成 |
| `measure-perf.mjs` | 計測 D | 鍵の永続化ラウンドトリップ、ES256 sign/verify ベンチ |

Node.js v24.22.0 / Apple M4 で 2026-10-19 に実行した結果を references.md に記録している。
