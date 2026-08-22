# shopping-list 固有ルール

このリポジトリで作業するClaude Codeエージェント向けのルールを記載する。

Issueごとの複数Claude Codeエージェント運用（`@claude`コメント起点の計画〜実装〜PR作成〜レビュー〜マージまでの無人実行）は、[guchi-apps/issue-deck](https://github.com/guchi-apps/issue-deck) で設計・運用されている仕組みを移植したものである。設計の背景は issue-deck の `docs/multi-agent-workflow.md`、他リポジトリへの導入手順は `docs/cross-repo-setup-guide.md` を参照する。

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

- APIキー・トークン・パスワード等の実シークレットをリポジトリにコミットしない。コミットしてよいのは、1Passwordの`op://vault/item/field`形式の参照だけを書いたファイル（`.env.tpl`・`.github/secrets-manifest.tsv`）に限る。実値は`.gitignore`済みの`.env`と1Password側にのみ置く。
- **GitHub Actionsは実行時に1Passwordを読まない。** CI・デプロイ・プレビューの値はGitHubのsecret / variableから`env:`で受け取る。1Passwordサービスアカウントの日次レート制限（1Passwordアカウント全体で1,000リクエスト/日。サービスアカウントを分けても分割されない）を使い切ってフリート全体のデプロイが止まったため移行した（guchi-apps/issue-deck#1302・#129）。ワークフローに`1password/load-secrets-action`や`op://`参照を新たに足さない。
  - GitHub側の名前と1Password上の正の対応は`.github/secrets-manifest.tsv`が持つ。`SCOPE`が`inherit`の行はorganizationの共通値のため同期しない。値が変わったときだけ`scripts/sync-github-secrets.sh`（またはActionsの`Sync secrets`）で同期する。
  - `.env.tpl`は**ローカル開発専用**。`op run` / `op inject`で実値を注入する用途にのみ使い、ワークフローからは参照しない。
- 実シークレットの値を、コミットメッセージ・PR本文・Issueコメント・ワークフローのログなど、リポジトリやGitHub上に残る場所へ出力しない。
- 既存のシークレット・環境変数の設定変更が必要になった場合は、自動で進めず`00.check-user`を付与してユーザーの確認を待つ（後述の「自動マージ不可カテゴリ」にも該当する）。

### バージョンとリリース履歴（changelog）

`package.json`のversion更新と`frontend/changelog.js`への追記は、`.github/workflows/release-develop-to-main.yml`（workflow_dispatchによる手動起動）だけが行う。このワークフローがdevelop/main間の差分全体からセマンティックバージョニングに基づく上げ幅と、ユーザーが画面で体感できる変更のみの更新履歴をまとめて生成する（内部実装・リファクタリング・インフラ更新は記載しない）。

Issueごとの実装エージェントは、`npm version`系コマンド（`npm run version:patch`等）を実行せず、`package.json`のversionフィールドと`frontend/changelog.js`を変更しない。かつては個々の実装コミットでもこれらを更新していたが、上記ワークフローがリリース単位でまとめて生成する方式に一本化したため廃止した（#55）。

生成物の受け取りは`"version"` lifecycleスクリプト（`scripts/version-changelog.mjs`）が担い、共有ワークフローから2つの環境変数を受け取る。`RELEASE_CHANGELOG`（何が変わったか）は`changes`へ、`RELEASE_USAGE`（どう使うか＝どこを開く/何を押す/どうなれば成功か）は`usage`へ入り、`frontend/changelog.js`の各エントリは`version` / `date` / `changes` / `usage`の4項目になる（#150）。`usage`は画面で使える変化が無いリリースでは空文字で渡るため項目ごと出力されず、更新履歴の画面（`frontend/app.js`の`openChangelog`）でも存在するときだけ変更点の下に「使い方」として番号付きで表示する。したがって`usage`は常にあるものとして参照しない。

## 全アプリ共通の共有知識（shared context）

複数アプリで再利用できる知識は、このリポジトリではなく共有知識リポジトリ（`guchi-apps/docs`）で管理する。設計の全体像は`guchi-apps/issue-deck`の`docs/shared-knowledge.md`を参照。

### 参照先

- **GitHub Actions実行**: 各ワークフローが実行前に`.shared-context/`へcheckoutする。存在しない場合（checkout失敗時など）は共有知識なしでそのまま作業を進めてよい。
- **ローカル実行**: `~/apps/_docs`（`scripts/start-issue.sh`・`scripts/start-reviewer.sh`が`--add-dir`で参照可能にする）。

読む順序は、`CLAUDE.md`（索引）→ 自分の役割の`agent-rules/`（実装エージェントなら`agent-rules/implementation.md`、レビュー・統合エージェントなら`agent-rules/review.md`）→ 必要に応じて`knowledge/`の該当ファイル → 設計判断が要るときだけ`standards/`の該当ファイル → 手作業の設定手順が要るときだけ`guides/`。最初から全部を読む必要はない。各ファイルの冒頭に「いつ読むか」の1行があるので、それで読むかどうかを判断する。

### 参照の優先順位

内容が矛盾する場合は、具体的で近いものを優先する。

1. Issue本文・コメントでの明示的な指示
2. このファイル（`CLAUDE.md`）
3. `.shared-context/CLAUDE.md`・`.shared-context/agent-rules/`
4. `.shared-context/knowledge/`・`.shared-context/standards/`・`.shared-context/guides/`

共有知識は「他のアプリではこうしている」という既定値であり、shopping-list固有のルールを上書きしない。

### 書き込みの禁止と知見の残し方

- `.shared-context/`配下は**読み取り専用**として扱う。編集・`git add`・コミットは一切行わない（`.gitignore`済み）。
- 実装・調査で得た非自明な知見は、次の2つを**両方**行う。
  - **このリポジトリのドキュメントへ書く。** 実装PRに同梱して、このファイルまたは`README.md`の適切な箇所へ追記する（新規ファイルを増やす前に既存ドキュメントへの追記で済まないか検討する）。
  - **同じ内容を「知見メモ」コメントとして対応Issueへ投稿する。** マーカー`<!-- knowledge-candidate -->`をコメントの先頭に1つだけ置き、知見ごとに`###`の見出しを立てて1つのコメントにまとめる。各知見には「状況 / 結論 / 根拠 / 確認日 / 出典（`guchi-apps/shopping-list#<Issue番号>`）」を書く。1回の実装で残す知見は目安3件までとし、残す知見が無ければコメント自体を投稿しない（「知見なし」の空コメントは不要）。
- **その知見を共有知識へ格上げすべきかどうかは、実装エージェントもレビュー・統合エージェントも判定しない。** 判定と共有知識リポジトリ（`guchi-apps/docs`）への反映は、同リポジトリ側の専用エージェントが全リポジトリの知見メモをまとめて審査して行う。エージェントは「何が分かったか」と「その根拠」を正確に書くことに集中する。
- かつては実装エージェントの「追加提案」コメント（`<!-- shared-knowledge-proposal -->`）とレビューエージェントの4観点審査（`<!-- shared-knowledge-verdict:approved -->`）を条件に、`.github/workflows/shared-knowledge-propose.yml`が共有知識リポジトリへのPull Requestを作成していた。どちらのマーカーも投稿されなくなったため、このワークフローは削除した（guchi-apps/issue-deck#2029、#160）。
- シークレットの実値・個人情報・一時的な障害情報は、ドキュメント・知見メモのいずれにも記録しない。

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
- 共有知識リポジトリ（`.shared-context/`・ローカルの`~/apps/_docs`）の編集・コミット

### レビュー・統合エージェントの禁止事項

- `main`への直接マージ・push
- 共有知識リポジトリの編集・コミット（共有知識へ格上げするかどうかの判定と反映は`guchi-apps/docs`側の専用エージェントが行う）
- 対応Issueに残った知見メモ（`<!-- knowledge-candidate -->`）の審査。メモがあることを理由に「要修正」と判定したり`00.check-user`を付与したりしない

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
- Secretsや環境変数（`.env.tpl`・`.github/secrets-manifest.tsv`）
- Notion APIとの連携仕様の変更（`backend/notion.js`のデータソースID・プロパティマッピング、`backend/task-sync.js`の同期ルール。後者はNotionの「☑️ Task」データベースを書き換えるため、買い物リスト以外のデータへ影響が及ぶ）
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