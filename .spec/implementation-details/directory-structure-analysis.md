# ディレクトリ構造分析・妥当性評価報告書 (directory-structure-analysis.md)

本報告書は、日本のサイバーセキュリティインテリジェンス自動収集システム「`kaname`」における、現在の仕様設計ディレクトリ構造の妥当性について、仕様駆動開発（SDD）の原則、関心の分離（SoC）、および将来のシステム実装への拡張性の観点から多角的に評価・議論したものである。


## 1. 現状のディレクトリ構造（再掲）

```text
└── .specs/
    ├── constitution.md                      # 開発憲章（開発規律、セキュリティ、TDD、マージ方針）
    ├── spec.md                              # 機能仕様書（ストーリー、BDDシナリオ、エラー時挙動）
    ├── ui-spec.md                           # UI仕様書（Quartz表示制約、Graph View無効化）
    ├── business-rules.md                    # 業務ルール（中間ディレクトリ自動分類、べき等性、更新、通知契機）
    ├── plan.md                              # 技術設計計画書（アーキテクチャ、技術スタック選定、マイルストーン）
    ├── data-model.md                        # データモデル（SSoTスキーマ、べき等ハッシュ、中間ディレクトリMermaid）
    ├── contracts/
    │   ├── mcp-contracts.md                 # MCPインターフェース契約（Stdio JSON-RPCスキーマ定義）
    │   └── webhook-contracts.md             # 外部通知契約（Cloudflare Webhook、Discord Rich Embeds）
    ├── research.md                          # 技術リサーチ（pnpm、esbuild/tsx、Takumi Guardセキュリティ監査）
    ├── implementation-details/
    │   └── agent-logic.md                   # アルゴリズム・プロンプト詳細（Orchestrator、リンク補正、上書き禁止）
    ├── checklist.md                         # 品質検証チェックリスト（TDD対応、適合性・サプライチェーン監査）
    └── tasks.md                             # 実装タスクリスト（pnpm、esbuild、Takumi Guard、カテゴリ制限）
```


## 2. 妥当性評価（3つの優れた設計ファクト）

### 2.1 仕様駆動開発（SDD）の大局から詳細へのドリルダウン構造

本ディレクトリ構造は、開発全体の行動を規制する超上流定義である「憲章（`constitution.md`）」を起点とし、振る舞いを定義する「仕様書（`spec.md`）」、運用の境界線を敷く「ルール（`business-rules.md`）」、そして具体的な手法を規定する「計画・設計（`plan.md`）」へと流れるようにマッピングされている。
さらに、データ・プロトコル・アルゴリズムに及ぶ「物理的詳細」を `data-model.md` や `contracts/` フォルダへ分離隠蔽している。この階層化は、人間（開発者）とAIエージェントの双方にとって、ドキュメントの「責任範囲（Separation of Concerns）」を迷いなく追跡可能にする極めて高い妥当性を有する。

### 2.2 進化する「契約（Contracts）」の集約

本システムの中核は、オーケストレーターとGitHub MCP、およびCloudflare PagesとDiscordという「外部SaaSとのセキュアなインプロセス/イベント通信」である。これらを独立したフォルダ `contracts/` に集約したことは非常に妥当性が高い。
将来、GitHub MCPのAPI仕様変更やDiscord Webhookのペイロード改訂が発生した場合、開発者はこのフォルダのみを監査・改訂すればよく、システム全体の憲章やロジックを変更する必要がないため、保守の結合度が最小限に抑えられている。

### 2.3 監査可能性と実装タスクの自己整合

開発の完了・受け入れ基準となる品質検証チェックリスト（`checklist.md`）と、それを実装プロセスに分解したタスクリスト（`tasks.md`）が最下流に配置されている。これは設計段階で定めたセキュリティ基準やロジック（Takumi Guard、最大100フォルダ未満の中間分類など）が、単なる「机上の空論」にならず、実際に検証可能なテスト要件として1対1にマッピングされているため、設計書の完結性を完璧に補正している。


## 3. さらなる洗練に向けた「3つの議論ポイント（拡張性検証）」

現在のスペック（設計）フェーズにおいてはこの構造で完璧に調和しているが、「実際のコードベース構築・実装フェーズ（Implementation Phase）」に移行するにあたり、以下の拡張性についてあらかじめ議論・合意しておく必要がある。

### 議論 1: プロジェクトの論理ルートとの関係性

実際の開発時には、リポジトリルートに `.specs/` としてそのまま「本設計ドキュメントパッケージ」を配置し、同列にソースコードやテストコード、およびパッケージ構成ファイルを配置する以下の「ハイブリッド構造」にするのが妥当と考えられる。

```text
kaname/
├── .specs/                       # 本設計ドキュメントパッケージ
│   ├── constitution.md
│   └── ...
├── src/                          # TypeScript ソースコード
│   ├── crawler/                  # ビルトインFetch & 正規表現パーサー
│   ├── agents/                   # Aegis-Writer, Aegis-Reviewer コア
│   └── orchestrator.ts           # メイン制御スクリプト (tsx 起動対象)
├── tests/                        # TDD単体・統合テストコード
├── package.json                  # pnpm 依存管理
├── pnpm-lock.yaml                # pnpm 決定論的ロック
├── .takumiguard.yml              # Takumi Guard 設定ファイル (GHA自動連動)
└── tsconfig.json                 # strict型チェック設定
```

この全体配置との整合をとることで、`tasks.md` に記載されたアトミックタスクの実行がファイル位置的にも完全にマッピングされる。

### 議論 2: べき等ハッシュや状態JSONの「永続化ストレージ」の扱い

現在 `data-model.md`（第2項）で定義されている状態管理ファイル `crawler-state.json` は、バッチがコンテナ（GCP Cloud Run Jobs）上でステートレスに動くため、実行ごとにリセットされる。
この状態は Git repository へ commit せず、Cloud Storage の object として保存する方針を採用する。これにより、state-only commit、main 履歴のノイズ、並行 job の merge conflict、immutable content と mutable runtime metadata の混在を避ける。競合制御には Cloud Storage generation precondition を用いる。

### 議論 3: スキーマ物理ファイルの独立

`data-model.md` に記述されている `ssot.yml` のYAMLスキーマ、および `crawler-state.json` のJSONスキーマを、将来的にテスト検証（Ajv等のバリデーターによる自動パース検証）で物理的に読み込むため、`.specs/` の中に留めるか、それとも `src/schemas/` などのコード側に移動させるべきか。
SDDの原則に従うならば、「ドキュメント（specs）側をスキーマの原本（SSoT）とし、コード側がここ参照してテスト実行する」設計を維持し、物理的なスキーマファイルも `.specs/data-model.md` または `.specs/schemas/` 配下で一元管理するのが最もクリーンである。

---

## 4. 結論

現状の `.spec/` は global documents と feature-oriented specs を併用する構造へ移行する。状態管理は Cloud Storage、schema は `.spec/schemas/` を原本候補、PR 単位の実装追跡は `.spec/traceability.md` で管理する。
