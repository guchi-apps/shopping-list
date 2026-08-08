#!/usr/bin/env bash
# m-guchi/issue-deck の scripts/start-issue.sh を移植したもの。
#
# Issueごとに専用ブランチ・git worktreeを作成し、実装エージェント用のClaude Codeセッションを起動する。
#
# 使い方:
#   scripts/start-issue.sh <issue番号> [issue番号...]
#
# 前提:
#   - gh コマンドで認証済みであること
#   - op（1Password CLI）にログイン済みであること（worktreeの .env を生成するため。
#     本体リポジトリに .env がある場合はそれをコピーするためopは不要）
#
# 移植元との差分:
#   - 依存パッケージを持たないリポジトリのため `pnpm install` 相当の処理は行わない
#   - 環境変数は .env.local のコピーではなく、本体の .env のコピー、または
#     `op inject -i .env.tpl -o .env` による生成で用意する
#   - スクリーンショット（24.screenshot-required）は本リポジトリでは未対応のため、
#     撮影を指示せず画面プレビューでの確認へ倒す（#6 で対応予定）
#
# 本体リポジトリの作業ツリー（ブランチ・uncommitted changes）には一切触れない。
# develop の最新化は git fetch のみで行い、git worktree add で新しいブランチ・作業ディレクトリを作る。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE_BASE="${SHOPPING_LIST_WORKTREE_BASE:-$HOME/apps/shopping-list-worktrees}"
PROMPT_TEMPLATE="$ROOT/scripts/prompts/implementation-agent.md"
PROMPT_DIR="$WORKTREE_BASE/.prompts"
REPO="m-guchi/shopping-list"

if [[ $# -eq 0 ]]; then
  echo "Usage: scripts/start-issue.sh <issue番号> [issue番号...]" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh コマンドが見つかりません。" >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "Error: claude コマンドが見つかりません。" >&2
  exit 1
fi

if [[ ! -f "$PROMPT_TEMPLATE" ]]; then
  echo "Error: $PROMPT_TEMPLATE がありません。" >&2
  exit 1
fi

for n in "$@"; do
  if [[ ! "$n" =~ ^[0-9]+$ ]]; then
    echo "Error: issue番号は数字で指定してください: $n" >&2
    exit 1
  fi
done

mkdir -p "$PROMPT_DIR"

# issue番号ごとにworktree・ブランチを準備し、起動用プロンプトを生成する。
# 戻り値として WORKTREE_DIR / PROMPT_FILE / DEV_PORT をグローバル変数に設定する。
prepare_issue() {
  local n="$1"
  WORKTREE_DIR="$WORKTREE_BASE/issue-$n"
  PROMPT_FILE="$PROMPT_DIR/issue-$n.md"

  if [[ -e "$WORKTREE_DIR" ]]; then
    echo "Error: $WORKTREE_DIR は既に存在します（issue #$n は起動済みの可能性があります）。" >&2
    exit 1
  fi

  echo "#$n: Issue内容を取得しています..."
  local issue_json
  if ! issue_json="$(gh issue view "$n" --repo "$REPO" --json number,title,body,labels,comments)"; then
    echo "Error: issue #$n の取得に失敗しました。" >&2
    exit 1
  fi

  echo "#$n: develop を最新化しています..."
  git -C "$ROOT" fetch origin develop

  echo "#$n: worktree・ブランチ issue-$n を作成しています..."
  if ! git -C "$ROOT" worktree add "$WORKTREE_DIR" -b "issue-$n" origin/develop; then
    echo "Error: worktree/ブランチの作成に失敗しました（ブランチ issue-$n が既に存在する可能性があります）。" >&2
    exit 1
  fi

  # 開発サーバーのポートをIssueごとに一意にする（複数worktreeで同時に起動しても衝突しないように）。
  DEV_PORT=$((4000 + n))

  # 環境変数（.env）を用意する。本体に .env があればコピーし、無ければ1Password CLIで生成する。
  # symlinkではなくコピーとし、将来worktreeごとに値を変える余地を残す。
  if [[ -f "$ROOT/.env" ]]; then
    cp "$ROOT/.env" "$WORKTREE_DIR/.env"
    echo "#$n: 本体の .env をコピーしました。"
  elif command -v op >/dev/null 2>&1; then
    echo "#$n: 1Passwordから .env を生成しています..."
    if ! op inject -i "$ROOT/.env.tpl" -o "$WORKTREE_DIR/.env"; then
      echo "警告: op inject に失敗しました。worktreeで手動で .env を用意してください。" >&2
    fi
  else
    echo "警告: .env も op コマンドも無いため .env を用意できませんでした。worktreeで手動で用意してください（op inject -i .env.tpl -o .env）。" >&2
  fi

  if [[ -f "$WORKTREE_DIR/.env" ]]; then
    bash "$ROOT/scripts/update-env-file.sh" "$WORKTREE_DIR/.env" PORT "$DEV_PORT"
  fi
  echo "#$n: 開発サーバーはポート $DEV_PORT を使用します（http://localhost:$DEV_PORT）"
  echo "#$n: Googleログインが必須のため、Supabaseの Redirect URLs に http://localhost:$DEV_PORT/auth/callback 相当が登録されている必要があります。"

  echo "#$n: LANアクセス用のポートフォワーディングを設定しています（Windowsの管理者権限が必要です）..."
  SSLIP_URL=""
  if bash "$ROOT/scripts/setup-lan-access.sh" "$DEV_PORT"; then
    WSL_IP="$(ip -4 addr show eth0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' || true)"
    if [[ -n "$WSL_IP" ]]; then
      SSLIP_URL="http://${WSL_IP}.sslip.io:${DEV_PORT}"
    fi
  else
    echo "#$n: 警告: LANアクセス設定に失敗しました。localhostでの確認は引き続き可能です。" >&2
  fi

  echo "#$n: 起動用プロンプトを生成しています..."
  local issue_json_file
  issue_json_file="$(mktemp)"
  printf '%s' "$issue_json" >"$issue_json_file"
  python3 - "$issue_json_file" "$PROMPT_TEMPLATE" "$DEV_PORT" "$SSLIP_URL" >"$PROMPT_FILE" <<'PY'
import json
import sys

issue_json_path, template_path, dev_port, sslip_url = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

with open(issue_json_path, encoding="utf-8") as f:
    issue = json.load(f)
with open(template_path, encoding="utf-8") as f:
    template = f.read()

label_names = {l["name"] for l in issue.get("labels", [])}
labels = ", ".join(sorted(label_names)) or "(なし)"

if sslip_url:
    sslip_note = f"（スマホ等、同一LAN上の別端末から確認する場合は`{sslip_url}`を使う）"
else:
    sslip_note = ""

start_command = f"`PORT={dev_port} npm run dev`（`.env`に設定済みのため`npm run dev`だけでも同じポートで起動する）"

if "23.preview-required" in label_names:
    preview_instructions = (
        "このIssueには`23.preview-required`ラベルが付いています。実装・テストが完了したら、"
        "PRを作成する**前**に次の手順を行ってください。\n\n"
        "1. このworktreeの開発サーバーを {start_command} で起動する\n"
        "2. `http://localhost:{port}` で実際の画面を確認する{sslip_note}\n"
        "3. 確認した画面・操作手順をユーザーに提示し、問題ないか明示的な承認を得る\n"
        "4. 承認が得られてから初めてPRを作成する（承認が得られるまで応答を止めて待つ）"
    ).format(port=dev_port, sslip_note=sslip_note, start_command=start_command)
else:
    preview_instructions = (
        "このworktreeの開発サーバーはポート`{port}`を使うよう`.env`に設定済みです"
        "（他Issueのworktreeと同時に起動しても衝突しません）。起動コマンドは {start_command} です。"
        "画面に関わる変更を行った場合、PR本文の「確認方法」に次の情報を含めてください。\n\n"
        "- 起動コマンドとアクセスURL（`http://localhost:{port}`）{sslip_note}\n"
        "- 実際に確認すべき画面・操作手順\n\n"
        "承認待ちで止まる必要はなく、そのままPR作成まで進めてよいです。"
    ).format(port=dev_port, sslip_note=sslip_note, start_command=start_command)

if "24.screenshot-required" in label_names:
    screenshot_instructions = (
        "このIssueには`24.screenshot-required`ラベルが付いていますが、**本リポジトリはスクリーンショットの"
        "自動撮影に未対応です**（全画面がGoogleログインの背後にあり、CIログインバイパスとNotion APIの"
        "スタブが未実装のため。対応は #6 で予定）。\n\n"
        "Playwright等の新規依存関係を勝手に追加せず、上記「開発環境での画面確認」と同じ手順"
        "（開発サーバーを起動して画面をユーザーに提示し、承認を得てからPRを作成する）で進めてください。"
        "どうしても画像が必要な場合は、ユーザーに手動での撮影を依頼してください。"
    )
else:
    screenshot_instructions = (
        "このIssueには`24.screenshot-required`ラベルが付いていないため、スクリーンショットの取得は不要です。"
    )

comments = issue.get("comments", [])
if comments:
    comment_text = "\n\n".join(
        "- {login} ({created_at}):\n{body}".format(
            login=(c.get("author") or {}).get("login", "unknown"),
            created_at=c.get("createdAt", ""),
            body=c.get("body", ""),
        )
        for c in comments
    )
else:
    comment_text = "(コメントなし)"

result = (
    template.replace("{{ISSUE_NUMBER}}", str(issue["number"]))
    .replace("{{ISSUE_TITLE}}", issue["title"])
    .replace("{{ISSUE_LABELS}}", labels)
    .replace("{{ISSUE_BODY}}", issue.get("body") or "(本文なし)")
    .replace("{{ISSUE_COMMENTS}}", comment_text)
    .replace("{{DEV_PORT}}", dev_port)
    .replace("{{PREVIEW_INSTRUCTIONS}}", preview_instructions)
    .replace("{{SCREENSHOT_INSTRUCTIONS}}", screenshot_instructions)
)
sys.stdout.write(result)
PY
  rm -f "$issue_json_file"
}

# 全アプリ共通の共有知識リポジトリ（m-guchi/docs）をローカルにcloneしてある場合は、
# --add-dir でworktree外のそのディレクトリも参照できるようにする（issue-deckの
# docs/shared-knowledge.md「8. Claude Codeへのコンテキストの渡し方」）。cloneしていない
# 環境でも起動できるよう、存在しない場合は --add-dir を付けずにそのまま起動する。
SHARED_CONTEXT_DIR="${SHOPPING_LIST_SHARED_CONTEXT_DIR:-$HOME/apps/_docs}"
CLAUDE_EXTRA_ARGS=()
if [[ -d "$SHARED_CONTEXT_DIR" ]]; then
  CLAUDE_EXTRA_ARGS+=(--add-dir "$SHARED_CONTEXT_DIR")
  echo "共有知識リポジトリを参照可能にします: $SHARED_CONTEXT_DIR"
else
  echo "共有知識リポジトリ（$SHARED_CONTEXT_DIR）が見つからないため、参照なしで起動します。"
fi

# 単一worktree内でclaudeを起動するコマンド文字列を作る（PROMPT_FILEのパスのみを埋め込み、
# Issue本文・コメントなどの外部由来テキストはコマンド文字列に直接展開しない）。
build_claude_cmd() {
  local worktree_dir="$1"
  local prompt_file="$2"
  local add_dir_arg=""
  if [[ ${#CLAUDE_EXTRA_ARGS[@]} -gt 0 ]]; then
    add_dir_arg="$(printf " --add-dir %q" "$SHARED_CONTEXT_DIR")"
  fi
  printf "cd %q && claude --permission-mode acceptEdits%s \"\$(cat %q)\"" "$worktree_dir" "$add_dir_arg" "$prompt_file"
}

if [[ $# -eq 1 ]]; then
  n="$1"
  prepare_issue "$n"
  echo "#$n: Claude Codeセッションを起動します（このターミナルで実行）..."
  cd "$WORKTREE_DIR"
  PROMPT_CONTENT="$(cat "$PROMPT_FILE")"
  # set -u 下で空配列の展開がエラーにならないよう ${arr[@]+...} で囲む
  exec claude --permission-mode acceptEdits ${CLAUDE_EXTRA_ARGS[@]+"${CLAUDE_EXTRA_ARGS[@]}"} "$PROMPT_CONTENT"
fi

# 複数issue指定時は、それぞれ独立したセッションを同時に使うため新しいWindows Terminalタブで起動する。
WT_AVAILABLE=0
if command -v wt.exe >/dev/null 2>&1; then
  WT_AVAILABLE=1
fi
DISTRO="${WSL_DISTRO_NAME:-}"

for n in "$@"; do
  prepare_issue "$n"
  if [[ "$WT_AVAILABLE" -eq 1 && -n "$DISTRO" ]]; then
    echo "#$n: 新しいWindows Terminalタブでセッションを起動します..."
    cmd="$(build_claude_cmd "$WORKTREE_DIR" "$PROMPT_FILE")"
    wt.exe -w 0 new-tab --title "issue-$n" -- wsl.exe -d "$DISTRO" -- bash -lc "$cmd"
  else
    echo "#$n: worktreeの準備ができました。以下を手動で実行してください:"
    echo "  $(build_claude_cmd "$WORKTREE_DIR" "$PROMPT_FILE")"
  fi
done
