#!/usr/bin/env bash
# 無人実行(claude-issue-dispatch)の実装完了後に呼ばれる後処理。
#
# issue-deck の再利用可能ワークフロー(reusable-issue-dispatch.yml)の
# `post-implement-script` inputs から呼ばれることを想定している
# (m-guchi/issue-deck#952)。同フックは用途固有の条件をワークフロー側の `if:` に持たず、
# 判断材料を環境変数で渡すだけの設計のため、絞り込みは本スクリプトが行う。
#
# 現状の後処理はスクリーンショット撮影のみ。撮影が必要なのは 24.screenshot-required が
# 付いているIssueだけなので、それ以外は何もせず正常終了する。
#
# 期待する環境変数:
#   ISSUE_NUMBER        対象Issue番号（必須）
#   SCREENSHOT_REQUIRED "true" のときだけ撮影する
#   GH_TOKEN            gh コマンド用
#   BRANCH / MODE / PREVIEW_REQUIRED / GH_REPO  （本スクリプトでは未使用。フックが渡す）
#
# 撮影は scripts/capture-issue-screenshots.sh に委ねるが、同スクリプトは
# 「開発サーバーが起動済みであること」を前提とするため、その起動と待機も本スクリプトが行う。
set -e

if [ "${SCREENSHOT_REQUIRED:-}" != "true" ]; then
  echo "24.screenshot-required が付いていないため、実装後の後処理は行いません"
  exit 0
fi

if [ -z "${ISSUE_NUMBER:-}" ]; then
  echo "::error::ISSUE_NUMBER が渡されていません"
  exit 1
fi

npm ci
npx playwright install --with-deps chromium

CI_AUTH_BYPASS_TOKEN="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
echo "::add-mask::$CI_AUTH_BYPASS_TOKEN"

PORT=3101 CI_AUTH_BYPASS_TOKEN="$CI_AUTH_BYPASS_TOKEN" NOTION_STUB=1 node backend/index.js &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

READY=false
for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:3101/healthz" >/dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 1
done
if [ "$READY" != "true" ]; then
  echo "::warning::開発サーバーの起動を確認できなかったため、スクリーンショット撮影をスキップします"
  exit 0
fi

MARKDOWN="$(CAPTURE_BASE_URL="http://localhost:3101" CI_AUTH_BYPASS_TOKEN="$CI_AUTH_BYPASS_TOKEN" NOTION_STUB=1 bash scripts/capture-issue-screenshots.sh "$ISSUE_NUMBER")"
if [ -z "$MARKDOWN" ]; then
  echo "::warning::スクリーンショットの生成に失敗したため、投稿をスキップします"
  exit 0
fi

BODY='📸 実装後の画面をデスクトップ／モバイルの2ビューポートで自動撮影しました。developへのマージ前に内容を確認してください。'
BODY="$BODY"$'\n\n'"$MARKDOWN"
BODY="$BODY"$'\n\n<!-- issue-deck-source:claude-issue-dispatch -->'$'\n\n<!-- issue-deck-agent:implementer -->'
gh issue comment "$ISSUE_NUMBER" --body "$BODY"
gh issue edit "$ISSUE_NUMBER" --add-label "00.check-user"
