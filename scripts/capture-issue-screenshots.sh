#!/usr/bin/env bash
# Issue #9: scripts/capture-screenshots.mjs で撮影したPNGを
# scripts/post-issue-screenshot.sh（#7）でIssueコメント用URLに変換し、
# Markdown（画像埋め込み）を組み立てて標準出力に出す。
#
# 使い方: scripts/capture-issue-screenshots.sh <issue番号>
#
# 前提:
#   - CI_AUTH_BYPASS_TOKEN・NOTION_STUB=1 を設定した状態で開発サーバーが起動済みであること
#     （PORT・CAPTURE_BASE_URLはcapture-screenshots.mjs側の既定値に従う）
#   - gh コマンドで認証済み・git push できる権限があること（post-issue-screenshot.shの前提と同じ）

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: scripts/capture-issue-screenshots.sh <issue番号>" >&2
  exit 1
fi
ISSUE_NUMBER="$1"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CAPTURE_OUTPUT_DIR="$(mktemp -d)"
export CAPTURE_OUTPUT_DIR
cleanup() {
  rm -rf "$CAPTURE_OUTPUT_DIR"
}
trap cleanup EXIT

mapfile -t IMAGE_PATHS < <(node "$ROOT/scripts/capture-screenshots.mjs")

if [[ ${#IMAGE_PATHS[@]} -eq 0 ]]; then
  echo "Error: スクリーンショットが1枚も生成されませんでした。" >&2
  exit 1
fi

mapfile -t URLS < <("$ROOT/scripts/post-issue-screenshot.sh" "$ISSUE_NUMBER" "${IMAGE_PATHS[@]}")

declare -A VIEWPORT_LABELS=([desktop]="デスクトップ" [mobile]="モバイル")
declare -A SCREEN_LABELS=([app]="本体画面" [add]="アイテム追加" [edit]="アイテム編集" [changelog]="更新履歴")

for i in "${!URLS[@]}"; do
  BASE_NAME="$(basename "${IMAGE_PATHS[$i]}" .png)"
  VIEWPORT="${BASE_NAME%%-*}"
  SCREEN="${BASE_NAME#*-}"
  VIEWPORT_LABEL="${VIEWPORT_LABELS[$VIEWPORT]:-$VIEWPORT}"
  SCREEN_LABEL="${SCREEN_LABELS[$SCREEN]:-$SCREEN}"
  printf '![%s / %s](%s)\n' "$VIEWPORT_LABEL" "$SCREEN_LABEL" "${URLS[$i]}"
done
