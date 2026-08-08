# shopping-list 固有ルール

このリポジトリで作業するClaude Codeエージェント向けのルールを記載する。

Issueごとの複数Claude Codeエージェント運用（`@claude`コメント起点の計画〜実装〜PR作成〜レビュー〜マージまでの無人実行）は、[m-guchi/issue-deck](https://github.com/m-guchi/issue-deck) で設計・運用されている仕組みを移植したものである。設計の背景は issue-deck の `docs/multi-agent-workflow.md`、他リポジトリへの導入手順は `docs/cross-repo-setup-guide.md` を参照する。

ローカル実行ではユーザー個人環境のグローバルルール（`~/.claude/CLAUDE.md`）と個人環境のスキルもあわせて読み込まれるが、GitHub Actions上での実行（`.github/workflows/claude-issue-dispatch.yml`など）はリポジトリをチェックアウトしたワークツリーしか参照できないため、それらは読み込まれない。したがってActions実行でも守られる必要があるルールは、このファイルか各ワークフローのプロンプトに明文化しておく必要がある。両方が読み込まれる環境で内容が矛盾する場合は、このファイルを優先する。

## このリポジトリの構成（エージェント向けの前提）

| 項目 | 内容 |
|---|---|
| 概要 | Notionの「🛒 買い物リスト」データベースと同期するPWA |
| フロントエンド | Vanilla JS PWA（`frontend/`）。**ビルド不要**。`@supabase/supabase-js`はesm.shからCDN動的import |
| バックエンド | Node.js（`backend/`）。`node:http`のみで**npm依存パッケージなし**。Notion APIの薄いプロキシ |
| DB | **なし**（Notionが唯一の情報源。マイグレーション・シードの概念が存在しない） |
| 認証 | Supabase Auth + Google OAuth。バックエンドが`node:crypto`でJWTを自前検証（`backend/auth.js`） |
| パッケージマネージャ | npm。ランタイムの`dependencies`は無いため通常の実装作業に`npm install`は不要。CI専用ツール（スクリーンショット撮影用のPlaywright）のみ`devDependencies`に持つ |
| 検証コマンド | `npm run check`（`node --check`による構文チェック）。テスト・ビルド・型チェックは存在しない |
| Node.jsバージョン | 20.19（`.github/workflows/ci.yml`の`actions/setup-node`指定値） |
| 開発サーバー | `npm run dev`（＝`node backend/index.js`）。ポートは`PORT`環境変数で変更可（既定3101） |
| デプロイ | `main`へのpushで`deploy.yml`がVPSへSSHデプロイ（PM2、ポート3101） |

## 共通ルール（ローカル実行・GitHub Actions実行の両方に適用）

コミットメッセージ・PRタイトル・PR本文・issueコメントを日本語で書くこと、コミットのAuthorを`Claude Code <claude-code@example.com>`にすること、ラベルの付け替え手順といった作業手順レベルの規約は、各ワークフローのプロンプト（`.github/workflows/claude-issue-dispatch.yml`・`.github/workflows/claude-review-develop.yml`）に記載している。ここには、それらに含まれていない横断的な判断基準のみを記載する。

### 依存関係の追加

新しい依存関係（パッケージ・ライブラリ・ツール）を追加する前には、必ずユーザーに確認を取る。`package.json`への追記や`npm install`等の実行は、確認が取れてから行う。

このリポジトリは「フロントエンド／バックエンドのランタイムはnpm依存パッケージを持たない」ことを意図的な設計方針としている（バックエンドは`node:http`のみ、フロントエンドはCDN動的import）。CI専用ツール（スクリーンショット撮影用のPlaywright、#9で追加）に限り`devDependencies`として例外的に許容しているが、それ以外の依存関係の追加はこの方針の変更にあたるため、判断のハードルは他リポジトリより高い。

GitHub Actions上の無人実行では、その場で確認を取る相手がいない。依存関係の追加が必要だと判断した場合は追加せずに作業を止め、`00.check-user`ラベルを付与したうえで、なぜ必要かをIssueコメントで相談する。

### シークレットの扱い

- APIキー・トークン・パスワード等の実シークレットをリポジトリにコミットしない。コミットしてよいのは、1Passwordの`op://vault/item/field`形式の参照だけを書いたテンプレート（`.env.tpl`・`.github/ci.env.tpl`・`.github/deploy.env.tpl`）に限る。実値は`.gitignore`済みの`.env`と1Password側にのみ置く。
- 実シークレットの値を、コミットメッセージ・PR本文・Issueコメント・ワークフローのログなど、リポジトリやGitHub上に残る場所へ出力しない。
- 既存のシークレット・環境変数の設定変更が必要になった場合は、自動で進めず`00.check-user`を付与してユーザーの確認を待つ（後述の「自動マージ不可カテゴリ」にも該当する）。

### バージョンとリリース履歴（changelog）

`package.json`のversion更新と`frontend/changelog.js`への追記は、`.github/workflows/release-develop-to-main.yml`（workflow_dispatchによる手動起動）だけが行う。このワークフローがdevelop/main間の差分全体からセマンティックバージョニングに基づく上げ幅と、ユーザーが画面で体感できる変更のみの更新履歴をまとめて生成する（内部実装・リファクタリング・インフラ更新は記載しない）。

Issueごとの実装エージェントは、`npm version`系コマンド（`npm run version:patch`等）を実行せず、`package.json`のversionフィールドと`frontend/changelog.js`を変更しない。かつては個々の実装コミットでもこれらを更新していたが、上記ワークフローがリリース単位でまとめて生成する方式に一本化したため廃止した（#55）。

## Issueごとの複数Claude Codeエージェント運用

### ブランチ運用

- `main`は本番環境と一致するリリース用ブランチで、直接コミット・pushしない。`develop`が日常の開発ブランチで、本番へ反映する変更は`develop`→`main`のPull RequestをCI通過後にマージする。
- Issue単位の作業ブランチは`develop`から作成し、ブランチ名は`issue-<Issue番号>`とする（例: `issue-123`）。この命名規則にワークフロー側のIssue番号特定処理が依存しているため、従わないブランチは全ワークフローの対象外になる。
- worktreeは本体リポジトリの外（`~/apps/shopping-list-worktrees/<ブランチ名>/`）に作成する。本体（`~/apps/shopping-list`）は常に`develop`の最新チェックアウトとして空けておく（レビュー・統合エージェント用）。
- ローカルでIssueごとのセッションを起動する場合は`scripts/start-issue.sh <Issue番号>`を使う（worktree作成・`.env`の用意・ポート割り当て・LANアクセス設定・プロンプト生成までを行う）。レビュー・統合エージェントは`scripts/start-reviewer.sh`で起動する。
- 開発サーバーのポートはIssueごとに`4000 + Issue番号`を割り当てる（例: issue-12 → 4012）。`scripts/start-issue.sh`がworktreeの`.env`へ自動設定するため、複数Issueのworktreeで同時に起動しても衝突しない。Googleログインが必須のため、そのポートの`/auth/callback`がSupabaseのRedirect URLsに登録されている必要がある。

### 実装エージェント（Issueごとに起動するセッション）の禁止事項

- `main`/`develop`への直接コミット・push
- 他Issueのブランチ・worktreeの編集
- 不要なforce push
- 自分が作成したPull Requestの自己マージ

### レビュー・統合エージェントの禁止事項

- `main`への直接マージ・push

### 実装前の計画フェーズ（`21.plan-required`ラベル）

- Issueに`21.plan-required`ラベルが付いている場合、実装前にPlan modeで計画（アプローチ・変更範囲・懸念点）を提示し、承認を得てから実装に入る。
- `01.planning`は計画の検討に着手した時点（Plan mode開始時点）で付与する。実装に着手した時点で`02.wip`へ遷移する。
- ラベルが付いていない場合は直接実装してよい（`01.planning`は経由せず`02.wip`から始まる）。
- 承認待ちの合図には`00.check-user`ラベルを使う。

### Issueラベルの状態遷移

マルチエージェント運用で進めるIssueは、原則として以下の順でラベルが遷移する。

1. `01.planning` — 実装エージェントが計画検討中（`21.plan-required`選択時のみ経由する）
2. `02.wip` — 実装エージェントがコード実装中
3. `03.d:marge` — developへPR作成・マージ中
4. `05.develop` — developへマージ完了（main未反映）
5. `07.m:marge` — mainへPR作成・マージ中
6. `09.main` — mainへマージ完了。**この時点でissueをclose**する

`00.check-user`（ユーザーのチェックが必要）は上記のどの段階でも他のラベルと併用して付与する。

`07.m:marge`・`09.main`に対応するdevelop→mainのリリースフロー自体は、バージョンbump PR・develop→mainのPR作成までを`.github/workflows/release-develop-to-main.yml`が自動化している。develop→mainの実際のマージは下記「自動マージ不可カテゴリ」に該当するため人間が手動で行う。

### オプション制御ラベル

| ラベル | 効果 |
|---|---|
| `21.plan-required` | 実装前にPlan modeでの計画提示・承認を必須にする |
| `22.merge-confirm-required` | 内容によらず常に`00.check-user`を付与し、自動マージをスキップする |
| `23.preview-required` | PR作成に連動してFly.ioへ自動デプロイし、そのプレビューURLでの画面確認が完了するまでdevelopへの自動マージを保留する |
| `24.screenshot-required` | 実装完了後にPlaywrightで画面を自動撮影し、Issueコメントに埋め込んだうえで`00.check-user`を付与する |

`24.screenshot-required`の無人撮影（#9で追加）は、CI専用ログインバイパス（`backend/auth.js`の`CI_AUTH_BYPASS_TOKEN`、#8）とNotion APIスタブ（`backend/notion-stub.js`、`NOTION_STUB=1`、#8）で開発サーバーを起動し、`scripts/capture-screenshots.mjs`（Playwright）で本体画面・追加/編集/更新履歴の3モーダルをデスクトップ／モバイルの2ビューポートで撮影、`scripts/capture-issue-screenshots.sh`が`scripts/post-issue-screenshot.sh`（#7）経由でscreenshotsブランチへ配置してIssueコメントに埋め込む。撮影は自動化されているが、developへのマージ前には必ず人間が結果を確認する設計のため、撮影後も`00.check-user`は付与される。`23.preview-required`は実装ブランチ（`issue-<番号>`）をFly.io Machines上へ自動デプロイし、ブラウザだけで動作確認できる専用URLを用意するラベルである（#54）。`CI_AUTH_BYPASS_TOKEN`（`backend/auth.js`）と`NOTION_STUB`（`backend/notion-stub.js`）を流用し、本番のSupabase認証・Notionデータには一切接続しない。デプロイは`.github/workflows/deploy-preview.yml`（`workflow_call`）が担い、`claude-issue-dispatch.yml`の`deploy-preview`・`notify-preview-url`ジョブが実装完了後に呼び出してプレビューURLをIssueへ別コメントで通知する。PRごとの個別環境ではなく、issue-deckと同様にリポジトリ全体で単一の共有Fly.ioアプリの中身を都度上書きする方式のため、同時に複数Issueのプレビューを別URLで確認することはできない（`concurrency`で直列化・後勝ち）。デプロイ先のFly.ioアプリ（`fly.toml`の`app`名）はshopping-list専用に新規作成せず、issue-deckリポジトリのプレビュー用アプリ（`issue-deck-preview`）をそのまま共通利用する（m-guchiの指示、#54）。そのため共有範囲は本リポジトリ内だけでなくissue-deckとの間にも及び、両リポジトリのいずれかが直近にデプロイした内容で上書きされる。developへのマージ前確認は`claude-review-develop.yml`の`risk-check`ジョブが`23.preview-required`を検知して`00.check-user`を付与する形でゲートする。

### 自動マージ不可カテゴリ（`00.check-user`付与対象）

以下に該当する変更は、レビュー・統合エージェントが自動マージせず`00.check-user`を付与し、ユーザーの確認を待つ。

- 認証・認可（`backend/auth.js`・`frontend/auth.js`・`frontend/auth/`）
- 本番環境の設定（`deploy/`・`scripts/update-env-file.sh`）
- GitHub Actionsやデプロイ設定（`.github/workflows/`）
- Secretsや環境変数（`.env.tpl`・`.github/*.env.tpl`）
- Notion APIとの連携仕様の変更（`backend/notion.js`のデータソースID・プロパティマッピング）
- 課金・決済
- 依存関係の追加（このリポジトリでは依存パッケージの追加自体が方針変更にあたる）
- `develop`→`main`のマージ

上記カテゴリに該当するかどうかによらず、Issueに`22.merge-confirm-required`ラベルが付いている場合も、develop向けPRへのpushのたびに常に`00.check-user`が付与され自動マージがスキップされる。

### PR本文テンプレート

`develop`宛のPRには以下を記載する。

- 対応Issue（`closes #番号`/`fixes #番号`は使わず`#番号`のみ記載する。developマージ時点ではissueをcloseしない運用のため）
- 実装内容
- テスト内容
- 確認方法
- 注意点
