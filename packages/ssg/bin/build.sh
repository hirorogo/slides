#!/usr/bin/env bash
#
# 静的サイトを一式ビルドする。アプリのディレクトリで実行する。
#
#   bash ../../packages/ssg/bin/build.sh scripts/build-articles.js
#
# 引数はそのアプリ固有の「本文を作る」ステップ。スライドならデッキを
# marp / ippon で起こすスクリプト、記事なら Markdown を HTML にする
# スクリプトを渡す。それ以外の工程は両サイトで同じ。
#
# 順番には意味がある:
#   - メタデータ(src/data/*.json)は tsc と vp build より前。ページが import する
#   - 本文とOGPとフィードは prerender より後。vp build が dist を空にするため
set -euo pipefail

CONTENT_STEP="${1:?本文を作るスクリプトを引数で渡してください}"
BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$BIN/../../.." && pwd)"

# vp run 経由なら通っているが、bash で直接叩いたときは tsc / vp が見つからない。
# どちらで呼んでも動くようにここで通す。
export PATH="$PWD/node_modules/.bin:$ROOT/node_modules/.bin:$PATH"

step=0
run() {
  step=$((step + 1))
  printf '\n\033[1m[%d/8] %s\033[0m\n' "$step" "$1"
  shift
  "$@"
}

run "メタデータを集める"        node scripts/build.js
run "型チェック"                tsc
run "クライアントをビルド"       vp build
run "SSR をビルド"              vp build --ssr src/entry-server.tsx --outDir .vite-ssg
run "ルートをプリレンダ"         node "$BIN/prerender.js"
run "本文を生成"                node "$CONTENT_STEP"
run "OGP 画像を生成"            node "$BIN/ogimages.js"
run "feed / sitemap を生成"     bash -c "node '$BIN/feed.js' && node '$BIN/sitemap.js'"

printf '\n\033[32m✓ ビルド完了\033[0m\n'
