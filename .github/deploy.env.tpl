# デプロイ用シークレット参照（1Password CLI）
# 手順の詳細: m-guchi/docs リポジトリの README・guides/github-actions.md

# SSH / デプロイ先
SSH_PRIVATE_KEY=op://apps/githubaction-sshkey/private_key?ssh-format=openssh
HOST=op://apps/Server/host
USERNAME=op://apps/Server/username
SSH_PORT=op://apps/Server/ssh-port
TARGET_DIR=op://apps/shopping-list/target-dir

# Notion API（アプリ固有）
NOTION_TOKEN=op://apps/shopping-list/notion-token

# CI / デプロイ通知（Signaly）
SIGNALY_WEBHOOK_URL=op://apps/shopping-list/ci-webhook-url
