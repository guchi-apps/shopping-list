# Vault: apps — issue-deck
# .github/workflows/deploy-preview.yml（#54）用。
#
# issue-deckリポジトリが既に使っているFly.ioデプロイトークンをそのまま共用する
# （shopping-list専用の1Password項目は新設しない）。本リポジトリはNotionが唯一の
# 情報源でDBを持たないため、issue-deck側のような本番DBダンプ・サニタイズ処理は不要。
# 認証・データソースはCI_AUTH_BYPASS_TOKEN（backend/auth.js）とNOTION_STUB=1
# （backend/notion-stub.js）を流用し、本番Supabase・Notionには一切接続しない。

FLY_API_TOKEN=op://apps/issue-deck/fly-api-token
