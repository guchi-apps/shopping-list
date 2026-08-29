# 買い物リスト

> [!IMPORTANT]
> **このアプリは2026-08-28に運用を終了しました。**
>
> - 機能を [Dayspan](https://github.com/guchi-apps/dayspan) へ集約したため、このアプリを個別に動かす必要が無くなりました。
> - 本番URL `https://gucchii.com/shopping-list/` は停止します。VPS上の常駐プロセス（PM2 `shopping-list`）とApacheのプロキシ設定も撤去します。
> - このリポジトリはアーカイブし、以降の機能追加・デプロイは行いません。
> - **データは失われません。** このアプリはDBを持たずNotionを唯一の情報源としているため、買い物リストの中身はNotionの「🛒 買い物リスト」データベースにそのまま残ります。期限の入力で作られた「☑️ Task」データベースのタスクも残り、Dayspanからそのまま扱えます。
> - スマートフォンのホーム画面に追加したPWAは、Service Workerのキャッシュから開けてしまうため手動で削除してください（バックエンド停止後はデータの読み書きができません）。
>
> 撤去の全手順と実行順序は末尾の「[運用終了の記録（#188）](#運用終了の記録188)」に残しています。以下の記述は運用当時のものです。

Notionの「🛒 買い物リスト」データベースと同期するPWA。スマホのホーム画面に追加して、Notionのデータをその場で見る・チェックする・追加する用途を想定しています。

- フロントエンド: Vanilla JS PWA（ビルド不要、`frontend/`）。`@supabase/supabase-js`はCDN（esm.sh）から動的importで読み込む
- バックエンド: Node.js（`node:http`のみ、npm依存パッケージなし、`backend/`）。Notion API用の薄いプロキシで、DBは持たずNotionを唯一の情報源とする
- 認証: Supabase Auth + Google OAuth（他アプリと共有のSupabaseプロジェクトを使用）。許可したGoogleアカウント（1Password `allowed-google-emails`）のみログイン可能で、バックエンドがJWTを`node:crypto`で自前検証する
- 本番ポート: `3101`（PM2）
- 本番URL: `https://gucchii.com/shopping-list/`（新規サブドメインは作らず、portfolioが稼働中のルートドメイン配下にパスとして同居させる。`uptime-kuma-backup`＝`gucchii.com/internal/...` と同じパターン）

構成・運用ルールは [guchi-apps/docs](https://github.com/guchi-apps/docs) の設計ガイドに準拠しています。

## Notionデータとのマッピング

| アプリ側 | Notionプロパティ |
|---|---|
| name | 項目（title） |
| category | カテゴリ（select。初期値は食品/消耗品/日用品/趣味/その他だが、アプリのプロフィールメニュー「ラベルを編集」からNotion側のselectオプションを追加・名称変更できる） |
| memo | メモ（rich_text） |
| priority | 優先度（select: 高/中/低/未設定） |
| bought | 購入済み（checkbox） |
| due | 期限（date。日付のみを扱う。#145） |
| taskId | タスク（relation → 「☑️ Task」データベース。サーバーが管理し、クライアントからは変更できない。#145） |

カテゴリのselectオプションはNotion API（`PATCH /v1/data_sources/{id}`、`properties.カテゴリ.select.options`に既存オプション全件を`{id}`参照で含めつつ追加・変更分を送る）で更新している。既存オプションはid参照のため、名称変更すると使用中アイテムの表示も自動で追従する。オプションを配列から除外すると削除される可能性があるが未検証のため、本アプリでは「追加」「名称変更」のみを提供し、削除機能は実装していない（#39）。

## 期限とタスクの連携（#145）

買い物リストの項目に「いつまでに買う」（期限）を入れると、Notionの「☑️ Task」データベース（DaySpanがタスクの一次情報源として使っているもの）へ `<項目名>を買う` というタスクを作り、買い物リスト側のrelation「タスク」で結び付けます。同期の実体は `backend/task-sync.js` です。

| 操作 | タスク側の結果 |
|---|---|
| 期限を入れる（追加・編集、またはNotionで直接入力） | タスクを作成し、期限・メモ・優先度・完了状態をコピーする |
| 項目名・期限・購入済みを変える | タスクのタイトル・期限・完了へ反映する |
| 期限を「なし」にする | タスクをゴミ箱へ入れ、relationを外す |
| 項目を削除する | タスクもゴミ箱へ入れる |
| タスク側で期限・完了を変える | 次に一覧を取得したときに買い物リストへ戻す |
| タスクをNotionで削除する | 次に一覧を取得したときに買い物リスト側の期限も消す |

- 突き合わせのタイミングは `GET /api/items`（アプリを開く・再読み込みする）だけで、常駐の監視は持ちません。このアプリは状態を保持するDBを持たず、Notionが唯一の情報源のためです。
- 両方で違う値になっている場合は、ページの `last_edited_time` が新しい側を採用します。メモの編集などでも更新時刻は動くため厳密ではありませんが、単一利用者のアプリでは実用上足ります。
- Task DBを読めないとき（Integrationが未接続、プロパティ名の変更など）は同期を丸ごと諦め、買い物リスト自体の操作は成功させます。APIレスポンスの `taskSyncWarning` としてクライアントへ返し、トーストで通知します。「タスクが見つからない＝消された」と誤認して期限を消してしまわないよう、一覧クエリ自体が失敗した場合は何も書き換えません。
- 期限は日付のみを扱います。タスク側で時刻付きの期限にしている場合、日付が同じなら上書きしません。

このため、Notion Integrationには「🛒 買い物リスト」だけでなく「☑️ Task」データベースの接続も必要です（下記チェックリスト参照）。接続が無い場合、買い物リスト側のrelationプロパティ「タスク」はAPIレスポンスに現れず、期限の入力自体は動くもののタスクは作られません。

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

`npm run dev` の実体は `scripts/dev.sh` で、次の処理を行います。

- `.env` があれば `node --env-file=.env` で読み込む（無い場合は `op run` 等で既に環境変数が注入済みと見なして起動する）
- ポートは「シェルの `PORT` > `.env` の `PORT` > 3101」の順で決まる（`PORT=4006 npm run dev` のように上書きできる）
- 同一LAN上の別端末（スマホ等）から確認できるよう、Windows側のポートフォワーディングを `scripts/setup-lan-access.sh` で設定する（WSL環境のみ。Windowsの管理者権限が必要なためUACダイアログが表示される。失敗しても `localhost` での確認は続行できる）

### Issueごとのマルチエージェント運用

Issueごとに専用ブランチ・git worktree・Claude Codeセッションを分離して実装する運用を導入しています（[guchi-apps/issue-deck](https://github.com/guchi-apps/issue-deck) の仕組みを移植したもの。運用ルールは [CLAUDE.md](CLAUDE.md)、設計の詳細は issue-deck の `docs/multi-agent-workflow.md` を参照）。

```bash
# Issueごとにworktreeを作成し、実装エージェントのセッションを起動する
scripts/start-issue.sh 12          # 単一Issue（このターミナルで起動）
scripts/start-issue.sh 12 13 14    # 複数Issue（Windows Terminalの新規タブで並行起動）

# develop向けの未処理PRを確認・マージするレビュー・統合エージェントを起動する
scripts/start-reviewer.sh
```

- worktreeは本体リポジトリの外（`~/apps/shopping-list-worktrees/issue-<番号>/`）に作成されます。本体（`~/apps/shopping-list`）は常に `develop` の最新チェックアウトとして空けておく運用です
- 開発サーバーのポートはIssueごとに `7000 + Issue番号` が自動で割り当てられ、worktreeの `.env` に書き込まれます（複数Issueを同時に起動しても衝突しません）
- 既にworktreeがある場合は作り直さず再利用します（一度閉じたセッションに戻れます）。`.env` も既にあるものをそのまま使います
- Googleログインが必須のため、割り当てられたポートの `/auth/callback` がSupabaseの Redirect URLs に登録されている必要があります
- GitHub上では、Issueへ `@claude` とコメントすることで同等の実装フローを無人実行することもできます（`.github/workflows/claude-issue-dispatch.yml`）。ローカルのスクリプトは、対話しながら進めたい場合・実機で画面を確認したい場合に使います

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

## シークレットの取得先（1Password → GitHub）

**GitHub Actions（CI・デプロイ・プレビュー）は実行時に1Passwordを読みません。** GitHubのsecret / variableに置いた値を各ワークフローの `env:` で受け取ります。1Passwordサービスアカウントの日次レート制限（**1Passwordアカウント全体で1,000リクエスト/日**。サービスアカウントを分けても分割されない）を使い切り、フリート全体のデプロイが止まったためです（[guchi-apps/issue-deck#1302](https://github.com/guchi-apps/issue-deck/issues/1302)・#129）。

1Passwordは引き続き「人が管理する唯一の正」で、値が変わったときだけGitHubへ同期します。

| 場所 | 役割 |
|---|---|
| 1Password（`apps` ボールト） | 実値の唯一の正 |
| `.github/secrets-manifest.tsv` | 「GitHub側の名前 ↔ 1Password上の正」の対応表 |
| `scripts/sync-github-secrets.sh` | マニフェストに従って1Password → GitHubへ同期する |
| `.env.tpl` | **ローカル開発専用。** `op run` / `op inject` で実値を注入する |

マニフェストの `SCOPE` 列が `inherit` の6件（`SERVER_*`・`SUPABASE_*`）はorganizationの共通値をそのまま使うため同期しません。残り5件（`ALLOWED_GOOGLE_EMAILS`・`FLY_API_TOKEN`・`NOTION_TOKEN`・`SIGNALY_WEBHOOK_URL`・`TARGET_DIR`）がこのリポジトリのrepository secretです。

```bash
eval $(op signin)                            # 個人アカウント。サービスアカウントの枠を消費しない
scripts/sync-github-secrets.sh --dry-run
scripts/sync-github-secrets.sh
scripts/sync-github-secrets.sh --only NOTION_TOKEN
```

GitHubの画面（Actions → Sync secrets）からも `workflow_dispatch` で起動できます（`.github/workflows/sync-secrets.yml`）。同期に使う `OP_SERVICE_ACCOUNT_TOKEN` はorganization secretから継承するため、このリポジトリに登録する必要はありません。

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
- [ ] 「☑️ Task」データベースも同じIntegrationに共有（期限とタスクの連携に必要。#145）
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
- [ ] repository secretを投入（`scripts/sync-github-secrets.sh`。organizationの共通値・`OP_SERVICE_ACCOUNT_TOKEN` は継承されるため登録不要。前項「シークレットの取得先」を参照）
- [ ] `ci.yml` を一度実行してジョブ名をGitHubに認識させる
- [ ] `main` のBranch protectionを設定（PR必須化 + `lint` ジョブを必須ステータスチェックに追加 + Bypassは自分のアカウントを *For pull requests only*）

### 6. VPS

- [ ] `/apps/shopping-list/` ディレクトリを作成（`target-dir` と一致させる）
- [ ] 初回のみ手動で `deploy.tar.gz` 相当のファイル一式を配置するか、`workflow_dispatch` でdeploy.ymlを手動実行
- [ ] PM2の自動起動設定（`pm2 startup && pm2 save`）が済んでいることを確認（他アプリと共通、通常は設定済み）

### 7. Apache（既存ドメイン配下にパスとして追加）

新規サブドメインは作らず、`gucchii.com`（portfolioの既存VirtualHost、HTTPS設定済み）に `/shopping-list` へのプロキシを追記する形にする（`guchi-apps/docs` の `apache-domain-setup.md` にある「既存サイトのパス」パターン、`uptime-kuma-backup` と同じ）。

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
- [ ] [guchi-apps/vps](https://github.com/guchi-apps/vps#アプリ一覧) の README にあるアプリ一覧に追加

## 運用終了の記録（#188）

Dayspanへ機能を集約したため、2026-08-28にこのアプリの運用を終了した。撤去対象は次の5系統に分かれ、このリポジトリで完結するのは A（ドキュメントの告知）だけである。

| 系統 | 対象 | 実施場所 |
|---|---|---|
| A. このリポジトリ | `README.md`・`CLAUDE.md` への運用終了の明記 | #188 のPull Request |
| B. VPS実機 | PM2プロセス削除・デプロイ先ディレクトリ削除・Apache reload | [guchi-apps/vps](https://github.com/guchi-apps/vps) のIssue |
| C. vpsリポジトリ | Apacheの `/shopping-list/` プロキシ設定・READMEのアプリ一覧 | 同上 |
| D. issue-deck | ポート帯対応表・対応リポジトリ一覧の更新 | [guchi-apps/issue-deck](https://github.com/guchi-apps/issue-deck) のIssue |
| E. 外部サービス・GitHub | Supabase Redirect URLs・1Password・Notion Integration・リポジトリのアーカイブ | ユーザーの手作業 |

### 実行順序

**GitHubのアーカイブは必ず最後に行う。** アーカイブするとIssue・PR・ラベルがすべて読み取り専用になり、残作業のコメントもIssueのクローズもできなくなるため。

1. #188 のPull Requestを `develop` へマージする
2. `develop` → `main` の反映は任意。本番を止めるためデプロイの実益は無いが、アーカイブ時に `main` を最新に揃えたい場合のみ `release-develop-to-main.yml` を patch で流す（**アーカイブ前に済ませる**）
3. B・C（vpsリポジトリのIssue）で本番を停止する
4. D（issue-deckのIssue）でローカルセッション用の登録を整理する
5. E のうち外部サービス（Supabase・1Password・Notion）を整理する
6. subpcローカルの `~/apps/shopping-list`・`~/apps/shopping-list-worktrees` を削除する
7. #188 をクローズしてから `gh repo archive guchi-apps/shopping-list` を実行する

### B. VPS実機

```bash
# 先にApache側からプロキシを外してからプロセスを落とす（順序を逆にすると502が出る）
sudo apachectl configtest && sudo systemctl reload apache2

pm2 delete shopping-list
pm2 save

# デプロイ先ディレクトリ（GitHub secretの TARGET_DIR。/apps/shopping-list/）を削除する
```

### C. vpsリポジトリ

- `apache/sites-available/gucchii-le-ssl.conf` から `/shopping-list` に関する3行（`RedirectMatch ^/shopping-list$` / `ProxyPass /shopping-list/` / `ProxyPassReverse /shopping-list/`）を削除する
- `README.md` のアプリ一覧から `shopping-list` の行を削除する
- `docs/tips.md` の「PM2配下（Next.jsアプリ群・shopping-listバックエンド）」という説明文からこのアプリへの言及を外す

### D. issue-deck

- `scripts/local-repo-ports.conf` の `guchi-apps/shopping-list 7000` は、**行を削除せずコメント化して7000帯を予約したまま残す。** 削除すると後続アプリへ同じ帯が払い出され、手元に残っているworktreeの開発サーバーと衝突しうるため
- `docs/supported-repositories.md` に運用終了を追記し、共有ワークフローの配布対象・ドリフト検査の対象から外す
- 無人ワークフローの停止に個別の作業は要らない。issue-deckはGitHubの `archived` フラグを同期し（`src/lib/github/repository-sync.ts`）、各sweepが `archived: false` で対象を絞る（`src/lib/github/progress-sweep-run.ts` ほか）ため、リポジトリをアーカイブすれば自動的に対象から外れる

### E. 外部サービス

- **Supabase**（他アプリと共有のプロジェクト）: Redirect URLsから `https://gucchii.com/shopping-list/auth/callback`・`http://localhost:3101/auth/callback`・ローカルセッション用の `http://localhost:71xx/auth/callback` を削除する。共有プロジェクトなので、他アプリのURLを消さないよう1件ずつ確認する
- **1Password**: `apps/shopping-list` のアイテム（`notion-token`・`allowed-google-emails`・`target-dir`）を削除する
- **Notion**: 「🛒 買い物リスト」データベース自体は残す（データの一次情報源のため）。Integrationの接続を外す場合は shopping-list 専用のトークンに限り、**Dayspanが使っているIntegrationと同一でないか確認してから外す**。「☑️ Task」データベースはDayspanが使い続けるため接続を外さない
- **GitHub**: repository secret / variable はアーカイブで凍結されるため削除不要。Fly.ioのプレビュー用アプリ（`issue-deck-preview`）はissue-deckとの共用のため、こちらで削除するものは無い
