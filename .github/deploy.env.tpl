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

# 認証（Supabase Auth + Google、複数アプリ共通プロジェクト）
SUPABASE_URL=op://apps/Supabase/project-url
SUPABASE_PUBLISHABLE_KEY=op://apps/Supabase/publishable-key
ALLOWED_GOOGLE_EMAILS=op://apps/shopping-list/allowed-google-emails

# CI / デプロイ通知（Signaly）
SIGNALY_WEBHOOK_URL=op://apps/shopping-list/ci-webhook-url
