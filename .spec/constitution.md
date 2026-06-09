# `kaname` 開発綱領 (constitution.md)


## 0. 原則レベル

本綱領は絶対不変の憲法ではなく、SDD の反復に合わせて改訂される制約レイヤーである。各ルールは以下の強度で解釈する。

- **MUST**: 違反すると秘密情報漏えい、データ破壊、壊れた公開物、または自律マージ事故につながるため、CI / Reviewer で機械的に遮断する。
- **SHOULD**: 標準方針。例外は `decisions/` の ADR に理由、代替案、検証方法を残す。
- **MAY**: 実装上許容される選択肢。

## 1. コード品質と設計思想

### 単一言語の徹底（TypeScript）

- 主要アプリケーションロジックは、Quartz v5 エコシステムとの親和性を最大化するため TypeScript に統一する **SHOULD**。
- IaC、CI、ポリシー、schema、fixture、運用スクリプトは、目的に応じて TypeScript 以外の形式・言語を採用してよい **MAY**。ただし採用理由は ADR または該当 feature plan に記録する。

### 先進的な高速開発・ビルド環境の採用

- パッケージマネージャーには、インストール速度、ディスクスペースの節約、厳格な依存関係解決において npm より優れた機能を持つ pnpm を採用する。
- TypeScriptのコンパイル、ビルド、およびコンテナランタイム実行には、極めて高速なパフォーマンスを誇る esbuild（本番ビルド用）および tsx（開発およびワンタイム実行ランタイム用）を組み合わせて採用し、開発者・エージェントのエンジニアリング体験を最大化する。

### 完全サーバーレス・アーキテクチャ

- GCP環境において、Compute Engine 等の常時起動型（常に課金が発生する）仮想マシンの使用を一切禁止する。
- 起動・実行スケジュールは GCP Cloud Scheduler で完全に一元管理し、実行時のみコンテナインスタンスを起動する GCP Cloud Run Jobs を組み合わせるサーバーレスバッチ設計を採用することで、待機時の課金コストを完全にゼロ（無風時ゼロコスト）とする。

### AIモデルの抽象化

- LLMの呼出しを行うクライアント層は、特定のAIベンダーのSDKやAPIに密結合（ロックイン）させない抽象化レイヤーを介して設計・実装する。
- 将来的なモデルの追加や別ベンダーへの移行が、抽象インターフェースの実装差し替えのみで実現可能であることを担保する。

### Obsidian Flavored Markdown（OFM）規格への厳格な準拠

- 生成・更新するすべてのトピックページおよびレポート（Markdownファイル群）は、kepano/obsidian-skills 内の obsidian-markdown/SKILL.md 規格、および Obsidian Flavored Markdown (Basic / Advanced Syntax含む) に厳密に準拠する。
- 単なるプレーンなMarkdown/GFMとしての出力に留まらず、概念・組織・技術要素間の関連性を相互にリンクさせセマンティックな情報ネットワークを構築するため、Obsidian標準的内部リンク記法 `[[Internal Link]]` を能動的に挿入する。

### ナレッジベースの更新特性（ミュータビリティ）制御

- **静的データおよび情報源（SSoT）の不変性（Immutability）：**
    情報源を記述したYAMLファイル、および過去に発行が完了した日付スタンプ付き「定時レポートMarkdown」は、情報の真正性を担保するため、システムによる事後的な改ざん・上書きを原則禁止（不変）とする。
- **Wikiコンテンツの可変性（Mutability）：**
    Obsidian Vault 内に蓄積される個別トピック/概念/組織の解説Markdownファイルは、最新ファクトの追記・名寄せ・関連性の追加に伴って、LLM Wikiのエコシステム内で常に可変（Mutable）であり、継続的に拡張・洗練されるものとする。

### リソース負荷の排除

ビルドプロセスおよびクライアントのレンダリング負荷を最小にするため、Quartz v5 の Graph View 機能は設定レベルで完全に無効化（disabled）する **MUST**。


## 2. テストおよび検証基準

### 継続的インテグレーション（CI/CD）における自動検証とブランチ運用

- main ブランチへの手動での直接プッシュ（Direct Push）は原則として禁止し、収集プロセスの自律実行はすべてインテリジェンス専用のブランチ（osint/* 等）で行う。
- 個別ブランチへの自動プッシュ、および main ブランチに対するプルリクエスト（PR）の作成・同期時をトリガーとして、GitHub ActionsにおけるCIパイプライン（Markdownのリンター、内部リンクの破損チェック、その他システムの妥当性検証）を自動実行する。
- CIパイプラインのすべての自動検証とテストが正常に完了し、かつ後述する「マルチエージェントによる査読プロセス」がマージ合意（Approve）を形成した場合のみ、main ブランチへの自動マージ実行を許可する。
- マージされた main ブランチの最新コンテンツは、Cloudflare Pages のGitHubネイティブビルド・デプロイ連携機能をトリガーさせ、Cloudflare側のエッジネットワーク上でQuartz v5を用いた本番静的サイトビルドおよびホスティングを自律進行させる。

### テスト駆動開発（TDD）の順守

クローラーのデータ収集処理、YAMLパーサー、抽象化されたLLM連携レイヤー、定時レポート作成処理などのコアロジックに対して単体テストを必須とする。


## 3. エラーハンドリングと例外設計

### べき等性の確保（不要更新の防止）

定時で動作するクローラーおよびレポート作成処理において、同一コンテンツや不要な差分によるMarkdownファイルの強制上書き・コミットを防止する制御を徹底する。

### 安全な縮退運転（レジリエンス）

- SSoT（Single Source of Truth）内に定義された特定サイトのクローリング失敗、またはLLM APIの一時的なレートリミット到達時においても、システム全体をクラッシュさせない。
- 該当する特定ソースのみの処理をスキップまたは遅延させ、他の健全なリソース処理および定時レポートの作成・送信を継続する。

### エラー情報の可視化

例外の発生（通信不全、パース不全、デプロイエラー等）は一元化されたエラーログ（Cloud Logging等）に構造化して記録し、Discordへの通知を介して迅速に管理者に伝達する。


## 4. セキュリティ、依存関係管理およびクレデンシャル管理

### セキュアな依存関係管理とサプライチェーン保護

- 車輪の再発明によるコード品質低下を防ぐため、サードパーティ製ライブラリ（パーサー等）の導入は「必要最小限」に抑えて許容する。
- 依存関係の脆弱性、ゼロデイ、不審なパブリッシュを常時監視・排除するため、Flatt Security社が提供する Takumi Guard を開発パイプラインおよびGitHub Actions（CI/CD）の検証プロセスへ緊密に組み込む。脆弱性やライセンス違反が検知されたプルリクエストはビルドを遮断する。

### ゼロ・シークレットポリシー

- APIキー、GitHubアクセストークン、Discord Webhook URL などの秘匿情報はコードベースやリポジトリに直接書き込むことを厳禁とする。
- すべて環境変数、または GCP Secret Manager などの適切なシークレット管理サービスから動的に注入・利用する。

### 最小権限 of 最小（Least Privilege）

GCPのサービスアカウント、および GitHub Actions に付与するトークン権限は、システム実行およびデプロイに必要不可欠な最小限 of 最小のロールのみをアサインする。


## 5. GitHub MCP統合とマルチエージェント協調・自律マージ方針

### MCP（Model Context Protocol）によるGitHub連携

GCP（Cloud Run等）で稼働するLLMエージェントクライアントが、GitHub公式のMCPサーバーにシームレスにアクセスし、自律的なGitHub操作を行える基盤を構築する。

### マルチエージェント協調体制と自律的マージ

- 独立した役割を持つ「提案エージェント（Aegis-Writer）」と「査読エージェント（Aegis-Reviewer）」の2つ（またはそれ以上）のLLMモデルによる相互レビュー体制（マルチエージェント方式）を確立する。
- 提案エージェントが収集データに基づくファイルの新規作成・既存ファイルの更新を行い、機能ブランチにプッシュしてPRを作成する。
- 査読エージェントがそのPRに対し、CI結果および本憲章・機能仕様への適合性を自動でコードレビューし、基準を満たした場合のみ「Approve（承認）」を付与して自律マージを完了させる。
- 無限マージループやコンフリクト発生時の暴走を防ぐため、1回の処理における自動マージ実行件数には最大しきい値（クォータ）を厳格に設け、違反時は即座に処理を停止して人間に通知（GitHub Issue起票）する。


## 6. 書誌情報

- Karpathy, Andrej. "LLM Wiki." GitHub Gist, 2025, gist.github.com/karpathy/442a6bf555914893e9891c11519de94f.
- "Quartz." GitHub, 2026, github.com/jackyzha0/quartz.
- "Obsidian." Obsidian, 2026, obsidian.md.
- GitHub. "GitHub MCP Server." GitHub, 2026, github.com/github/github-mcp-server.
- kepano. "Obsidian Skills." GitHub, 2026, github.com/kepano/obsidian-skills/blob/main/skills/obsidian-markdown/SKILL.md.
- Flatt Security. "Takumi Guard." Flatt Security Inc., 2026, flatt.tech/takumi/features/guard.

### パーサー依存ポリシー

HTML/XML/RSS パースは依存最小化を標準方針とする **SHOULD**。ただし Regex only は絶対要件ではない。実サイトの HTML / Feed 形式の揺れにより正確性・安全性・保守性が低下する場合、`decisions/ADR-0003-parser-dependency-policy.md` に従って parser 依存を導入してよい **MAY**。

### セキュリティゲートと Takumi Guard

保護対象 PR の自律マージでは、Takumi Guard を必須 security gate として扱う **MUST**。Takumi Guard が通信不通、Takumi サーバ側障害、または indeterminate status の場合、Aegis-Reviewer は fail-closed とし、merge せず Issue escalation する **MUST**。Takumi Guard は唯一の品質検証ではなく、typecheck、test、secret scanning、deterministic content guards と合成して評価する **MUST**。
