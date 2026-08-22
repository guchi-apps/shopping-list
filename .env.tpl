# ローカル開発用のシークレット参照テンプレート（1Password CLI）。
#
# **このファイルはローカル開発専用。** GitHub Actions（CI・デプロイ）は実行時に1Passwordを
# 読まず、GitHubのsecret / variableから値を受け取る。その対応表は
# `.github/secrets-manifest.tsv` にある（#129・guchi-apps/issue-deck#1307）。
#
# 使い方:
#   op run --env-file=.env.tpl -- npm run dev
#   # または .env を生成してから起動（git管理外）
#   op inject -i .env.tpl -o .env

NOTION_TOKEN=op://apps/shopping-list/notion-token

# Notion データソースID（機密情報ではないため固定値）
NOTION_DATA_SOURCE_ID=e011508b-b1b2-47aa-a604-178bf64158b8

# 認証（Supabase Auth + Google、複数アプリ共通プロジェクト）
SUPABASE_URL=op://apps/Supabase/project-url
SUPABASE_PUBLISHABLE_KEY=op://apps/Supabase/publishable-key
ALLOWED_GOOGLE_EMAILS=op://apps/shopping-list/allowed-google-emails

# 待受ポート。1Passwordには入れない（guchi-apps/docs の standards/ports.md）
PORT=3101
