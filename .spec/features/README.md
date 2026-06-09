# Feature-oriented spec index

`kaname` の仕様は、横断原則（constitution / policies / decisions）と、実装単位の feature spec に分離して管理する。

## Feature specs

| Feature | Scope | Primary acceptance gate |
| --- | --- | --- |
| [`001-crawler-idempotency`](./001-crawler-idempotency/spec.md) | SSoT 読込、クロール、差分検知、`crawler-state.json` の Cloud Storage 永続化 | 未更新ソースで LLM / commit / PR が発生しない |
| [`002-wiki-incremental-update`](./002-wiki-incremental-update/spec.md) | OFM トピック更新、上書き禁止、孤立ノート接続、差分レポート | 既存ファクト保持、リンクグラフ改善、重複排除 |
| [`003-orchestrator-mcp-review-loop`](./003-orchestrator-mcp-review-loop/spec.md) | Aegis-Orchestrator、MCP、Writer / Reviewer ループ、GitHub App 認証 | 最大3ループ、CI / security gate 前提の merge、Issue escalation |
| [`004-cloudflare-discord-notification`](./004-cloudflare-discord-notification/spec.md) | Quartz / Cloudflare Pages / Discord 通知 | production + success + main deploy のみ通知 |

## Cross-cutting specs

- [`../constitution.md`](../constitution.md): MUST / SHOULD / MAY の原則レイヤー。
- [`../traceability.md`](../traceability.md): 仕様、コード、テスト、未実装ギャップの対応表。
- [`../decisions/`](../decisions/): Constitution を固定化しすぎないための ADR。
- [`../policies/`](../policies/): セキュリティ、自律性、コンテンツ整合性の運用方針。
- [`../schemas/`](../schemas/): 将来 CI で直接読み込む実行可能 schema の配置先。
