# `kaname` インターフェース・契約仕様書 (contracts/mcp-contracts.md)

## 1. GitHub MCP ツールインターフェース契約

GCP Cloud Run Jobs内のオーケストレーター（stdio通信）を介して、Aegisエージェント群がGitHub公式MCPサーバー（`@modelcontextprotocol/server-github`）に対して呼び出すJSON-RPC 2.0メッセージの、主要なツール定義およびパラメーター構造を規定する。


### 1.1 create_or_update_file (ファイルの新規作成・既存更新用)

```json
{
	"jsonrpc": "2.0",
	"method": "tools/call",
	"params": {
		"name": "create_or_update_file",
		"arguments": {
			"owner": "対象リポジトリオーナー名 (環境変数より動的に注入)",
			"repo": "対象リポジトリ名 (環境変数より動的に注入)",
			"path": "topics/gov-agencies/NCO.md",
			"content": "---フロントマター---\n# 本文...",
			"branch": "osint/content-acd-update-20260527",
			"message": "[Aegis-Writer] Update NCO cybersecurity policy"
		}
	},
	"id": 101
}
```


### 1.2 create_pull_request (インテリジェンスブランチからmainへのPR起票用)

```json
{
	"jsonrpc": "2.0",
	"method": "tools/call",
	"params": {
		"name": "create_pull_request",
		"arguments": {
			"owner": "対象リポジトリオーナー名",
			"repo": "対象リポジトリ名",
			"title": "[Wiki-Sync] Intelligence Update (2026-05-27)",
			"head": "osint/content-acd-update-20260527",
			"base": "main",
			"body": "## 提案要約\n- SSoTから能動的サイバー防御の新方針を検知。\n- 既存のトピック `[[能動的サイバー防御]]` のインクリメンタル更新を完了。\n- 関連する孤立ノート `[[サイバー演習CYDER]]` への内部リンク自動マッピングを実施。"
		}
	},
	"id": 102
}
```


### 1.3 merge_pull_request (Aegis-Reviewerによる承認合意後の自動マージ用)

```json
{
	"jsonrpc": "2.0",
	"method": "tools/call",
	"params": {
		"name": "merge_pull_request",
		"arguments": {
			"owner": "対象リポジトリオーナー名",
			"repo": "対象リポジトリ名",
			"pull_number": 42,
			"merge_method": "squash",
			"commit_title": "[Aegis-Reviewer] Self-Merge: Intelligence Update Passed Review"
		}
	},
	"id": 103
}
```


### 1.4 create_issue (システムエラー検知時の自律Issue起票用)

```json
{
	"jsonrpc": "2.0",
	"method": "tools/call",
	"params": {
		"name": "create_issue",
		"arguments": {
			"owner": "対象リポジトリオーナー名",
			"repo": "対象リポジトリ名",
			"title": "[System Error] Crawling Failed for ID: nco",
			"body": "## 障害発生報告\n- **発生日時**: 2026-05-27T18:30:00JST\n- **対象ソース**: 国家サイバー統括室 (NCO: National Cyber Office)\n- **エラー内容**: HTTP 500 Internal Server Error (連続3回失敗)\n- **ステータス**: 縮退運転を継続中です。GCP Cloud Loggingおよび接続ステータスを確認してください。"
		}
	},
	"id": 104
}
```

## 2. Tool policy and merge preconditions

### 2.1 Branch policy

- Aegis-Writer may write only to `osint/*` branches.
- Aegis-Reviewer may merge only `osint/*` into `main`.
- Direct writes to `main` are prohibited.
- Force push is prohibited.

### 2.2 Allowed write paths

Aegis-Writer may write only approved content paths:

- `topics/**`
- `reports/YYYY-MM-DD_Report.md`
- generated indexes explicitly listed in the feature plan

`crawler-state.json` is not an approved Git write path because runtime state is stored in Cloud Storage.

### 2.3 Merge preconditions

`merge_pull_request` may be called only when all conditions are true:

- CI passed.
- Takumi Guard passed.
- deterministic content guards passed.
- branch policy passed.
- immutable files were not modified.
- internal links are valid.

If any gate is failed, unavailable, or indeterminate, Aegis-Reviewer must not merge.
