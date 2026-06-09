# `kaname` 外部通知・連携仕様書 (contracts/webhook-contracts.md)

## 1. Cloudflare Pages デプロイ完了フック

マージされた main ブランチの変更に基づくビルド＆デプロイ完了時に、Cloudflare Pagesが送信するWebhook通知ペイロード、またはGitHub ActionsでCloudflare Pages Deploymentステータスを監視する際のAPIフックのハンドリング。本システムでは、この完了通知を受け取って初めてDiscord通知をトリガーする。

```json
{
	"id": "evt_pages_deploy_success",
	"project_name": "osint-kaname",
	"deployment": {
		"id": "deploy_id_98765",
		"url": "https://osint-kaname.pages.dev",
		"environment": "production",
		"status": "success",
		"created_on": "2026-05-27T09:45:00Z",
		"modified_on": "2026-05-27T09:50:00Z",
		"meta": {
			"branch": "main",
			"commit_hash": "a1b2c3d4e5f6g7h8i9j0",
			"commit_message": "[Aegis-Reviewer] Self-Merge: Intelligence Update Passed Review"
		}
	}
}
```


## 2. Discord Webhook ペイロードフォーマット

デプロイ完了通知をトリガーとして、AegisシステムがDiscord Webhook URL（環境変数 DISCORD_WEBHOOK_URL から注入）へ送信する構造化Rich Embed JSONオブジェクトの標準仕様。

```json
{
	"username": "Aegis-Intelligence",
	"avatar_url": "https://raw.githubusercontent.com/github/spec-kit/main/media/logo_small.webp",
	"embeds": [
		{
			"title": "🛡️ インテリジェンス更新 ＆ 本番デプロイ成功報告",
			"description": "提案・査読エージェントによる検証をすべてパスし、最新のサイバーセキュリティインテリジェンスが本番環境へ安全にホスティングされました。",
			"url": "https://osint-kaname.pages.dev",
			"color": 3066993,
			"fields": [
				{
					"name": "📑 更新要約レポート (最新)",
					"value": "[2026-05-27_Report](https://osint-kaname.pages.dev/reports/2026-05-27_Report)",
					"inline": true
				},
				{
					"name": "🔗 関連トピック解説",
					"value": "- [[能動的サイバー防御]](https://osint-kaname.pages.dev/topics/gov-agencies/NCO)\n- [[サイバー演習CYDER]](https://osint-kaname.pages.dev/topics/cyber-exercises/CYDER)",
					"inline": false
				},
				{
					"name": "⚙️ 実行履歴",
					"value": "マージコミット: `a1b2c3d4e5` by Aegis-Reviewer",
					"inline": false
				}
			],
			"footer": {
				"text": "`kaname` • サーバーレス自律監視システム",
				"icon_url": "https://raw.githubusercontent.com/github/spec-kit/main/media/logo_small.webp"
			},
			"timestamp": "2026-05-27T09:50:00.000Z"
		}
	]
}
```

## 3. Discord notification gate

Discord notification is allowed only when all conditions are true:

- `deployment.status` is `success`.
- `deployment.environment` is `production`.
- `deployment.meta.branch` is `main`.
- `deployment.url` matches the configured public base URL.
- the latest report URL is live and returns a successful response.
- the deployment commit hash has not already been notified.

Duplicate deployment events for the same commit hash must be ignored. Notification idempotency state should use the same external state backend family as crawler state unless a later ADR chooses a separate backend.
