#!/usr/bin/env bash
# 開発サーバーを起動する（`npm run dev` の実体）。
#
# m-guchi/issue-deck の scripts/dev.sh に相当するが、本リポジトリはシークレットを
# 1Password から注入するため、環境変数の供給方法が異なる。次の2通りをどちらも許容する。
#
#   1. .env を生成しておく方式（Issueごとのworktree運用で使う）
#        op inject -i .env.tpl -o .env
#        npm run dev
#      → .env があればこのスクリプトが `node --env-file=.env` で読み込む。
#         シェル側で設定済みの環境変数は .env の値で上書きされない（Nodeの仕様）ため、
#         `PORT=4006 npm run dev` のようにポートだけ差し替えられる。
#
#   2. op run で直接注入する方式（README記載の従来の手順）
#        op run --env-file=.env.tpl -- npm run dev
#      → 既に環境変数が注入済みなので、.env が無くてもそのまま起動する。
#
# あわせて、同一LAN上の別端末（スマホ等）から確認できるよう、Windows側のポート
# フォワーディングをベストエフォートで設定する（失敗しても起動は続行する）。

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

ENV_FILE_ARGS=()
if [ -f .env ]; then
  ENV_FILE_ARGS=(--env-file=.env)
elif [ -z "${NOTION_TOKEN:-}" ]; then
  echo "警告: .env が無く、NOTION_TOKEN も未設定です。次のいずれかで環境変数を用意してください。" >&2
  echo "  op inject -i .env.tpl -o .env && npm run dev" >&2
  echo "  op run --env-file=.env.tpl -- npm run dev" >&2
fi

# PORTの優先順位はシェル > .env > 既定値3101。Nodeの--env-fileはシェル側で設定済みの
# 変数を上書きしないため、ここで解決した値をそのまま渡してよい。
PORT="${PORT:-}"
if [ -z "$PORT" ] && [ -f .env ]; then
  PORT="$(grep -m1 '^PORT=' .env | cut -d= -f2- | tr -d '"' || true)"
fi
PORT="${PORT:-3101}"

bash "$(dirname "${BASH_SOURCE[0]}")/setup-lan-access.sh" "$PORT" \
  || echo "警告: LANアクセス設定に失敗しました。localhostでの確認は引き続き可能です。" >&2

echo "開発サーバーを起動します: http://localhost:${PORT}"
exec env PORT="$PORT" node "${ENV_FILE_ARGS[@]}" backend/index.js
