#!/usr/bin/env python3
from __future__ import annotations

import html
from pathlib import Path

BASE = Path(__file__).resolve().parent
E = BASE / "evidence"


def read(name: str) -> str:
    path = E / name
    if not path.exists():
        return f"(missing: {name})"
    return path.read_text(encoding="utf-8", errors="replace")


def esc(text: str) -> str:
    return html.escape(text)


def pre(name: str, max_lines: int | None = None) -> str:
    text = read(name)
    lines = text.splitlines()
    if max_lines is not None and len(lines) > max_lines:
        text = "\n".join(lines[:max_lines]) + f"\n... ({len(lines) - max_lines} lines omitted)"
    return f'<pre><code>{esc(text)}</code></pre>'


def badge(kind: str, text: str) -> str:
    return f'<span class="pill {kind}">{esc(text)}</span>'


def section(num: str, title: str, body: str) -> str:
    return f'<h2><span class="n">{num}</span>{esc(title)}</h2>\n{body}\n'


env_text = read("00_env.txt")
run_time = "2026-10-21"
for line in env_text.splitlines():
    if line.startswith("date_jst:"):
        run_time = line.split(":", 1)[1].strip()
        break

nginx = read("08_nginx_access.log").splitlines()
nginx_cur = [
    line for line in nginx
    if (
        "POST /index.php" in line
        or "GET /index.php?file=" in line
        or "POST /temp.php" in line
    )
]
nginx_block = '<pre><code>' + esc("\n".join(nginx_cur)) + "</code></pre>"

sessions = read("09_session_files_vuln.txt").split("\n==")
session_block = '<pre><code>' + esc(sessions[0] if sessions else "(missing)") + "</code></pre>"

apache = read("12_apache_access.log").splitlines()
apache_cur = [line for line in apache if "/index.php" in line or "/temp.php" in line][-6:]
apache_block = '<pre><code>' + esc("\n".join(apache_cur)) + "</code></pre>"

summary_rows = [
    ("公開 PoC 618/619（PHP 8.4.4 ASAN）", "再現せず", "crit"),
    ("258B trigger の進捗ストア経路", "到達", "ok"),
    ("session.upload_progress + LFI（cleanup=0）", "RCE 成功", "ok"),
    ("cleanup=1（既定）のレース", "3/3 成功", "ok"),
    ("enabled=0 + 一時ファイル include", "RCE 成功", "ok"),
    ("use_strict_mode=1（SID 指定）", "失敗", "warn"),
    ("use_strict_mode=1 + Set-Cookie 追従", "RCE 成功", "ok"),
    ("mod_php (Apache)", "RCE 成功", "ok"),
    ("ASAN レポート", "なし", "ok"),
]
summary_table = "".join(
    f"<tr><td>{esc(a)}</td><td>{badge(b, c)}</td></tr>" for a, b, c in summary_rows
)

html_doc = f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PHP2SHELL ローカル検証レポート</title>
<style>
:root{{
  --bg:#f6f7f9;--card:#fff;--ink:#1a1d21;--muted:#5b636c;--line:#e3e6ea;
  --accent:#2f6f4f;--accent-weak:#e8f1ec;--crit:#b3261e;--crit-weak:#fbe9e7;
  --warn:#9a6700;--warn-weak:#fff6e0;--ok:#1f6f43;--ok-weak:#e6f4ea;
  --code:#0f172a;--code-ink:#e2e8f0;
}}
@media (prefers-color-scheme:dark){{
  :root:not([data-theme="light"]){{
    --bg:#0f1114;--card:#171a1f;--ink:#e8eaed;--muted:#9aa2ab;--line:#2a2f36;
    --accent:#6fcf97;--accent-weak:#16271d;--crit:#ff6b5e;--crit-weak:#2a1512;
    --warn:#e5b955;--warn-weak:#2a2310;--ok:#6fcf97;--ok-weak:#152417;
    --code:#0b0e13;--code-ink:#e2e8f0;
  }}
}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",Meiryo,sans-serif;line-height:1.75;font-size:15px}}
.wrap{{max-width:920px;margin:0 auto;padding:40px 16px 80px}}
header.doc{{border-bottom:3px solid var(--accent);padding-bottom:20px;margin-bottom:8px}}
.kicker{{color:var(--accent);font-weight:700;letter-spacing:.08em;font-size:12px;text-transform:uppercase}}
h1{{font-size:26px;line-height:1.35;margin:.3em 0 .2em}}
.meta{{color:var(--muted);font-size:13px}}
h2{{font-size:20px;margin:48px 0 4px;padding-top:8px;display:flex;align-items:baseline;gap:10px}}
h2 .n{{color:var(--accent);font-variant-numeric:tabular-nums;font-size:15px;font-weight:800;border:2px solid var(--accent);border-radius:999px;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}}
h3{{font-size:15.5px;margin:26px 0 2px}}
p{{margin:.5em 0}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:14px 0}}
.lead{{font-size:16px}}
.pill{{display:inline-block;font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:999px;border:1px solid currentColor;line-height:1.6;white-space:nowrap}}
.ok{{color:var(--ok);background:var(--ok-weak)}} .warn{{color:var(--warn);background:var(--warn-weak)}} .crit{{color:var(--crit);background:var(--crit-weak)}}
table{{width:100%;border-collapse:collapse;margin:12px 0;font-size:13.5px}}
th,td{{border:1px solid var(--line);padding:9px 11px;text-align:left;vertical-align:top}}
th{{background:var(--accent-weak);font-weight:700}}
code{{background:var(--accent-weak);color:var(--ink);padding:1.5px 6px;border-radius:5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}}
pre{{background:var(--code);color:var(--code-ink);padding:14px 16px;border-radius:10px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.2px;line-height:1.55}}
pre code{{background:none;color:inherit;padding:0;font-size:inherit}}
.note{{font-size:12.8px;color:var(--muted)}}
.box-ok{{border-left:5px solid var(--ok);background:var(--ok-weak);border-radius:8px;padding:14px 16px;margin:12px 0}}
.box-warn{{border-left:5px solid var(--warn);background:var(--warn-weak);border-radius:8px;padding:14px 16px;margin:12px 0}}
.box-crit{{border-left:5px solid var(--crit);background:var(--crit-weak);border-radius:8px;padding:14px 16px;margin:12px 0}}
ul{{margin:.4em 0 .6em;padding-left:1.25em}} li{{margin:.3em 0}}
footer{{margin-top:60px;border-top:1px solid var(--line);padding-top:16px;color:var(--muted);font-size:12px}}
</style>
</head>
<body><div class="wrap">
<header class="doc">
<div class="kicker">Local Security Verification / Reproduction Report</div>
<h1>PHP2SHELL ローカル検証レポート<br><span class="note">session.upload_progress + 別脆弱性の鎖を、通信ログと実行ログで確認する</span></h1>
<div class="meta">実施: {esc(run_time)} / 環境: Docker Desktop 29.7.2, macOS 25.5.0 arm64 / 対象: 自分専用のローカルラボ</div>
</header>

<div class="box-warn">
<b>対象と限界:</b> 本レポートは、公開情報の「PHP コア UAF」と、PHP の
<code>session.upload_progress</code> とアプリ側 LFI を組み合わせる既知の鎖を分けて検証したものです。
後者は <b>意図的に脆弱な LFI アプリ</b>をラボ内に置いて再現しています。
公開 PoC のコア UAF は、本ラボでは再現していません。外部システムには一切送信していません。
</div>

<div class="card">
<h3 style="margin-top:0">判定サマリ</h3>
<table><thead><tr><th>検証項目</th><th>結果</th></tr></thead><tbody>{summary_table}</tbody></table>
<p class="note">「RCE 成功」は、ラボ内の <code>id</code> 実行結果 <code>uid=33(www-data)</code> を確認したことを意味します。
公開 PoC の「コア UAF」とは別の鎖です。</p>
</div>

{section("1", "検証環境", f'''
<p>すべて <code>127.0.0.1</code> のみに公開した Docker ラボです。PHP 8.4.4 は ASAN ビルドで、
<code>USE_ZEND_ALLOC=0</code> を設定して Zend ヒープも ASAN の対象にしています。</p>
{pre("00_env.txt", 35)}
''')}

{section("2", "攻撃チェーンの概要", f'''
<p>今回再現したのは、次の鎖です。</p>
<div class="card">
<ol>
<li><code>main/rfc1867.c</code> の <code>MULTIPART_EVENT_FORMDATA</code> が
<code>PHP_SESSION_UPLOAD_PROGRESS</code> の値を <code>event_formdata.value</code> として渡す。</li>
<li><code>ext/session/session.c</code> の <code>php_session_rfc1867_callback()</code> が
<code>progress-&gt;key = "upload_progress_" + 値</code> を作る。</li>
<li><code>php_session_rfc1867_update()</code> が <code>php_session_initialize()</code> →
<code>zend_hash_update()</code> を実行し、<b>アプリのスクリプトが動く前</b>に
<code>sess_&lt;PHPSESSID&gt;</code> へシリアライズして書き込む。</li>
<li><code>php_session_rfc1867_early_find_sid()</code> は Cookie / GET の
<code>PHPSESSID</code> を先に読むため、攻撃者がセッションファイル名を選べる
（<code>session.use_strict_mode=0</code> の既定）。</li>
<li>アプリに LFI があると、<code>sess_&lt;id&gt;</code> を <code>include</code> した瞬間に、
シリアライズされたキー文字列内の <code>&lt;?php ... ?&gt;</code> が実行される。</li>
</ol>
</div>
<p>今回のラボでは、この「アプリ側 LFI」を <code>lfi-demo/index.php</code> に意図的に置いています。</p>
''')}

{section("3", "実験1: cleanup=0 の LFI チェーン", f'''
<p><code>session.upload_progress.cleanup=0</code> の PHP-FPM（8087）に対して、
<code>PHP_SESSION_UPLOAD_PROGRESS=&lt;?php system($_GET[0]);?&gt;</code> を送り、
その直後に <code>/tmp/sess_&lt;id&gt;</code> を LFI で include しました。</p>
<h3>攻撃スクリプトの出力</h3>
{pre("02_lfi_cleanup0.txt")}
<h3>セッションファイルの実体</h3>
{session_block}
<p>レスポンスの <code>upload_progress_uid=33(www-data)...</code> が、
セッションファイル内の PHP コードが実行された証拠です。</p>
''')}

{section("4", "実験2: 既定 cleanup=1 のレース", f'''
<p><code>session.upload_progress.cleanup=1</code> は、リクエスト終了時に進捗データを削除します。
しかし、アップロードを遅くすれば、終了前の window に LFI を間に合わせられます。
FPM の <code>FILLUNIT=5120</code> を満たす初回チャンク（6000B）を送り、1.5 秒 stall しました。</p>
{pre("03_race_cleanup1.txt")}
<div class="box-ok"><b>3/3 で成功。</b> 既定の <code>cleanup=1</code> だけでは、
この鎖を防げないことを確認しました。</div>
''')}

{section("5", "実験3: enabled=0 でも残る一時ファイル経路", f'''
<p><code>session.upload_progress.enabled=0</code> の PHP-FPM（8089）では、
セッションへの進捗書き込みは止まります。しかし multipart のアップロード自体は続き、
<code>$_FILES['f']['tmp_name']</code> は作られます。アプリがそれを include すると RCE になります。</p>
{pre("04_enabled0_temp_include.txt")}
<div class="box-warn"><b>設定だけでは不完全。</b> アプリ側の upload-include sink は別途塞ぐ必要があります。</div>
''')}

{section("6", "実験4: use_strict_mode=1 の効果と限界", f'''
<p><code>session.use_strict_mode=1</code> の PHP-FPM（8090）では、攻撃者が指定した
未知の SID は拒否されます。そのため、指定 SID での LFI は失敗します。</p>
{pre("05_strict_chosen_sid.txt")}
<p>ただし、アップロード応答の <code>Set-Cookie</code> には新しい SID が入ります。
応答を読める状況では、その SID を使って LFI が成立します。</p>
{pre("06_strict_follow_cookie.txt")}
<div class="box-warn"><b>strict mode は SID を選ばせないだけ。</b> progress の書き込み自体は続くため、
応答を読める攻撃者には有効ではありません。</div>
''')}

{section("7", "実験5: mod_php (Apache) でも成立", f'''
<p>PHP-FPM だけでなく、公式 <code>php:8.4.4-apache</code>（mod_php）でも同じ鎖を確認しました。</p>
{pre("07_modphp.txt")}
<h3>Apache アクセスログ</h3>
{apache_block}
''')}

{section("8", "実験6: 公開 PoC 618/619 のコア UAF は再現せず", f'''
<p>公開バンドルの <code>poc0_109618.py</code> / <code>poc1_109619.py</code> を、
PHP 8.4.4 ASAN（<code>USE_ZEND_ALLOC=0</code>）に送りました。</p>
{pre("01_public_poc.txt")}
<p>進捗ストア経路（<code>bytes_processed=258</code>）には到達しますが、
ASAN レポートは出ず、<code>uid=</code> も出ません。8.5.4 ASAN、5.6.40、
ASLR 無効 + 実 call アドレス、毒 call アドレスでも同様でした。
（8.5.4 ASAN / 5.6.40 の追試は <code>ANALYSIS.md</code> を参照。）</p>
<div class="box-crit"><b>公開 PoC の「コア UAF」は未再現。</b>
公開バンドル自身の <code>VALIDATION.md</code> も「ASAN crash はローカルで未観測」と明記しています。
今回の LFI 鎖は、コア UAF とは別の、アプリ側 LFI を必要とする経路です。</div>
''')}

{section("9", "通信ログ（nginx access log）", f'''
<p>8087/8088/8089/8090 の通信を nginx の access log から抜粋します。
<code>POST /index.php</code> の後、<code>GET /index.php?file=/tmp/sess_...&amp;0=id</code>
が続いていることが分かります。</p>
{nginx_block}
''')}

{section("10", "対策と限界", f'''
<ul>
<li><b>session.upload_progress.enabled=Off</b> は、この session 書き込み primitive を止めるため、
今回の鎖には最も強い対策です。</li>
<li><b>cleanup=1</b> は終了時に消すだけで、アップロード中のレースには耐えません。</li>
<li><b>use_strict_mode=1</b> は SID を選ばせないだけで、progress の書き込みは続きます。
応答の <code>Set-Cookie</code> を読める状況では回避されます。</li>
<li><b>multipart の一時ファイル</b>は <code>enabled=0</code> でも作られます。
アプリがアップロードファイルを include する sink を持っている場合は別途遮断が必要です。</li>
<li>本レポートの LFI 鎖は、<b>アプリ側に LFI（またはセッションファイルを読む sink）があること</b>
が前提です。PHP コアだけで万能に RCE になる、という主張ではありません。</li>
<li>公開 PoC のコア UAF / 公式 CVE の原因は、公式パッチ公開後に差分を確認する必要があります。</li>
</ul>
''')}

{section("11", "証跡ファイル", f'''
<ul>
<li><code>report/evidence/00_env.txt</code> — 環境・バージョン</li>
<li><code>report/evidence/01_public_poc.txt</code> — 公開 PoC の結果（UAF 未再現）</li>
<li><code>report/evidence/02_lfi_cleanup0.txt</code> — cleanup=0 の LFI</li>
<li><code>report/evidence/03_race_cleanup1.txt</code> — cleanup=1 のレース</li>
<li><code>report/evidence/04_enabled0_temp_include.txt</code> — enabled=0 + temp include</li>
<li><code>report/evidence/05_strict_chosen_sid.txt</code> / <code>06_strict_follow_cookie.txt</code> — strict mode</li>
<li><code>report/evidence/07_modphp.txt</code> — mod_php</li>
<li><code>report/evidence/08_nginx_access.log</code> — nginx access log</li>
<li><code>report/evidence/09_session_files_vuln.txt</code> — セッションファイル実体</li>
<li><code>report/evidence/12_apache_access.log</code> — Apache access log</li>
<li><code>report/evidence/13_asan_check.txt</code> — ASAN チェック</li>
<li><code>report/run_repro.sh</code> — 再実行スクリプト</li>
</ul>
''')}

<footer>
PHP2SHELL ローカル検証レポート / 2026-10-21 作成。<br>
本レポートは自分専用の隔離ラボでの防御・検証を目的としたものであり、外部システムへの攻撃を意図しません。
</footer>
</div></body></html>
"""

(BASE / "index.html").write_text(html_doc, encoding="utf-8")
print("wrote", BASE / "index.html", len(html_doc), "bytes")
