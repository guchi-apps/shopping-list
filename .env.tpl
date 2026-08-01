# ローカル開発用。1Password CLI で実値を注入する:
#   op run --env-file=.env.tpl -- npm run dev
# または .env を手動生成（git 管理外）:
#   op inject -i .env.tpl -o .env

NOTION_TOKEN=op://apps/shopping-list/notion-token

# Notion データソースID（機密情報ではないため固定値）
NOTION_DATA_SOURCE_ID=e011508b-b1b2-47aa-a604-178bf64158b8

# 認証（Supabase Auth + Google、複数アプリ共通プロジェクト）
SUPABASE_URL=op://apps/Supabase/project-url
SUPABASE_PUBLISHABLE_KEY=op://apps/Supabase/publishable-key
ALLOWED_GOOGLE_EMAILS=op://apps/shopping-list/allowed-google-emails

PORT=3101
