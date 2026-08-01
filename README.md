# 買い物リスト

Notionの「🛒 買い物リスト」データベースと同期するPWA。スマホのホーム画面に追加して、Notionのデータをその場で見る・チェックする・追加する用途を想定しています。

- フロントエンド: Vanilla JS PWA（ビルド不要、`frontend/`）。`@supabase/supabase-js`はCDN（esm.sh）から動的importで読み込む
- バックエンド: Node.js（`node:http`のみ、npm依存パッケージなし、`backend/`）。Notion API用の薄いプロキシで、DBは持たずNotionを唯一の情報源とする
- 認証: Supabase Auth + Google OAuth（他アプリと共有のSupabaseプロジェクトを使用）。許可したGoogleアカウント（1Password `allowed-google-emails`）のみログイン可能で、バックエンドがJWTを`node:crypto`で自前検証する
- 本番ポート: `3101`（PM2）
- 本番URL: `https://gucchii.com/shopping-list/`（新規サブドメインは作らず、portfolioが稼働中のルートドメイン配下にパスとして同居させる。`uptime-kuma-backup`＝`gucchii.com/internal/...` と同じパターン）

構成・運用ルールは [m-guchi/docs](https://github.com/m-guchi/docs) の設計ガイドに準拠しています。

## Notionデータとのマッピング

| アプリ側 | Notionプロパティ |
|---|---|
| name | 項目（title） |
| category | カテゴリ（select: 食品/消耗品/日用品/趣味/その他） |
| memo | メモ（rich_text） |
| priority | 優先度（select: 高/中/低/未設定） |
| bought | 購入済み（checkbox） |

## ローカル開発

事前に1Password CLI（`op`）にログインしていること、Notion Integrationのトークンが `apps/shopping-list/notion-token` に登録済みであることが前提です（下記チェックリスト参照）。Googleログインが必須のため、Supabaseの共有プロジェクトの Redirect URLs に `http://localhost:3101/auth/callback` を追加し、許可するGoogleアカウントを1Password `apps/shopping-list/allowed-google-emails` に登録しておく必要があります。

```bash
# 1Passwordからシークレットを注入して起動
op run --env-file=.env.tpl -- npm run dev

# または .env を生成してから直接起動
op inject -i .env.tpl -o .env
npm run dev
```

`http://localhost:3101` で確認できます。

### 構文チェック

```bash
npm run check
```

## バージョン・更新履歴

`package.json` の `version` を上げると、npmのlifecycleフックで `frontend/changelog.js` にスタブが自動挿入されます。

```bash
npm run version:patch   # 0.1.0 → 0.1.1
npm run version:minor   # 0.1.0 → 0.2.0
npm run version:major   # 0.1.0 → 1.0.0
```

実行後、`frontend/changelog.js` の `changes` の中身を編集してからコミットしてください。リリースコミットのメッセージは `v0.2.0 をリリースする。` のように統一します。

## セットアップ・デプロイ チェックリスト（ユーザー側作業）

このリポジトリのコード・ワークフローは実装済みです。以下は実際に稼働させるために必要な、リポジトリ外の手作業です。

### 1. Supabase（Googleログイン）

他アプリ（asset-manager等）と共有の既存Supabaseプロジェクトを使う。新規プロジェクト作成は不要。

- [ ] Supabaseダッシュボードの Authentication > URL Configuration > Redirect URLs に以下を追加
  - `https://gucchii.com/shopping-list/auth/callback`（本番）
  - `http://localhost:3101/auth/callback`（ローカル開発）
- [ ] Google OAuthプロバイダーは共有プロジェクトで設定済みのため追加設定不要

### 2. Notion

- [ ] [notion.so/my-integrations](https://www.notion.so/my-integrations) で新規Integrationを作成
- [ ] 「🛒 買い物リスト」データベースをそのIntegrationに共有（データベースページ右上の「…」→「接続を追加」）
- [ ] 発行されたシークレットを1Passwordに登録（次項）

### 3. 1Password（`apps` ボールト）

- [ ] `shopping-list` アイテムを新規作成し、以下のフィールドを追加
  - `notion-token`: Notion Integrationのシークレット
  - `target-dir`: VPS上のデプロイ先ディレクトリ（例: `/apps/shopping-list`）
  - `ci-webhook-url`: Signalyのアプリ用チャンネルのWebhook URL（後述）
  - `allowed-google-emails`: ログインを許可するGoogleアカウントのメールアドレス（複数ならカンマ区切り）
- [ ] 共通アイテム `Server`（`host`/`username`/`ssh-port`）・`githubaction-sshkey`（`private_key`）・`Supabase`（`project-url`/`publishable-key`）が既に存在することを確認（他アプリと共通）

### 4. Signaly

- [ ] 「買い物リスト」用の通知チャンネルを作成し、Webhook URLを上記 `ci-webhook-url` に登録

### 5. GitHubリポジトリ

- [ ] リポジトリを作成し、このディレクトリの内容をpush
- [ ] デフォルトブランチを `develop` に設定
- [ ] Settings → Secrets and variables → Actions に `OP_SERVICE_ACCOUNT_TOKEN`（`apps`ボールト読み取り権限を持つ1Password Service Account）を登録
- [ ] `ci.yml` を一度実行してジョブ名をGitHubに認識させる
- [ ] `main` のBranch protectionを設定（PR必須化 + `lint` ジョブを必須ステータスチェックに追加 + Bypassは自分のアカウントを *For pull requests only*）

### 6. VPS

- [ ] `/apps/shopping-list/` ディレクトリを作成（`target-dir` と一致させる）
- [ ] 初回のみ手動で `deploy.tar.gz` 相当のファイル一式を配置するか、`workflow_dispatch` でdeploy.ymlを手動実行
- [ ] PM2の自動起動設定（`pm2 startup && pm2 save`）が済んでいることを確認（他アプリと共通、通常は設定済み）

### 7. Apache（既存ドメイン配下にパスとして追加）

新規サブドメインは作らず、`gucchii.com`（portfolioの既存VirtualHost、HTTPS設定済み）に `/shopping-list` へのプロキシを追記する形にする（`m-guchi/docs` の `apache-domain-setup.md` にある「既存サイトのパス」パターン、`uptime-kuma-backup` と同じ）。

1. portfolioの既存VirtualHost設定（`:443`）に以下を追記:

   ```apache
   # /shopping-list（末尾スラッシュなしは付与してからプロキシする）
   RedirectMatch ^/shopping-list$ /shopping-list/

   ProxyPass /shopping-list/ http://127.0.0.1:3101/
   ProxyPassReverse /shopping-list/ http://127.0.0.1:3101/
   ```

2. `apache2ctl configtest` → `systemctl reload apache2`
3. `curl`・ブラウザで `https://gucchii.com/shopping-list/` の動作確認

新規DNS登録・certbotでの証明書取得は不要（ルートドメインで既にHTTPS化済みのため）。

### 8. 完了後

- [ ] `main` へのデプロイでPWAが実機（iPhone）にインストールできるか確認
- [ ] [m-guchi/vps](https://github.com/m-guchi/vps#アプリ一覧) の README にあるアプリ一覧に追加
