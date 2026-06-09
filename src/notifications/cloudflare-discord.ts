import * as path from "node:path";

const avatarUrl =
	"https://raw.githubusercontent.com/github/spec-kit/main/media/logo_small.webp";

export type JsonObject = Record<string, unknown>;
export type ProbeResult = { ok: boolean; status: number };
export type UrlProbe = (url: string) => Promise<ProbeResult>;
export type DiscordSendResult = "sent" | "escalate_issue";

export interface CloudflareDeploymentEvent {
	id: string;
	project_name: string;
	deployment: {
		id: string;
		url: string;
		environment: "production" | "preview";
		status: "success" | "failure" | "pending" | "skipped" | "canceled";
		created_on: string;
		modified_on: string;
		meta: {
			branch: string;
			commit_hash: string;
			commit_message: string;
		};
	};
}

export interface NotificationState {
	notifiedDeploymentIds: string[];
	notifiedCommitHashes: string[];
}

export interface NotificationStateSnapshot {
	state: NotificationState;
	generation: number;
}

export interface NotificationStateBackend {
	load(): Promise<NotificationStateSnapshot>;
	save(
		nextState: NotificationState,
		options: { ifGenerationMatch: number },
	): Promise<void>;
}

export interface NotificationConfig {
	publicBaseUrl: string;
	latestReportUrl: string;
}

export interface NotificationDecision {
	shouldNotify: boolean;
	reason: string;
	reportUrlChecked: boolean;
}

export interface PersistedNotificationDecision extends NotificationDecision {
	stateSaved: boolean;
}

export interface DiscordPayloadInput {
	deployment: CloudflareDeploymentEvent["deployment"];
	publicBaseUrl: string;
	latestReportUrl: string;
	relatedTopics: Array<{ title: string; url: string }>;
}

export interface RetryPolicy {
	maxAttempts: number;
	backoffMs: number[];
}

export class GenerationMismatchError extends Error {
	constructor() {
		super("notification state generation mismatch");
	}
}

export async function evaluateDiscordNotification(
	event: CloudflareDeploymentEvent,
	state: NotificationState,
	config: NotificationConfig,
	probeReportUrl: UrlProbe,
): Promise<NotificationDecision> {
	const deployment = event.deployment;
	if (deployment.status !== "success") {
		return {
			shouldNotify: false,
			reason: "deployment status is not success",
			reportUrlChecked: false,
		};
	}
	if (deployment.environment !== "production") {
		return {
			shouldNotify: false,
			reason: "deployment is not production",
			reportUrlChecked: false,
		};
	}
	if (deployment.meta.branch !== "main") {
		return {
			shouldNotify: false,
			reason: "deployment branch is not main",
			reportUrlChecked: false,
		};
	}
	if (!isHttpsUrl(deployment.url) || !isHttpsUrl(config.publicBaseUrl)) {
		return {
			shouldNotify: false,
			reason: "deployment and public base URLs must be HTTPS",
			reportUrlChecked: false,
		};
	}
	if (!isHttpsUrl(config.latestReportUrl)) {
		return {
			shouldNotify: false,
			reason: "latest report URL must be HTTPS",
			reportUrlChecked: false,
		};
	}
	if (normalizeUrl(deployment.url) !== normalizeUrl(config.publicBaseUrl)) {
		return {
			shouldNotify: false,
			reason: "deployment URL does not match public base URL",
			reportUrlChecked: false,
		};
	}
	if (state.notifiedDeploymentIds.includes(deployment.id)) {
		return {
			shouldNotify: false,
			reason: "deployment id was already notified",
			reportUrlChecked: false,
		};
	}
	if (state.notifiedCommitHashes.includes(deployment.meta.commit_hash)) {
		return {
			shouldNotify: false,
			reason: "commit hash was already notified",
			reportUrlChecked: false,
		};
	}

	const reportProbe = await probeReportUrl(config.latestReportUrl);
	if (
		!reportProbe.ok ||
		reportProbe.status < 200 ||
		reportProbe.status >= 300
	) {
		return {
			shouldNotify: false,
			reason: "latest report URL is not live",
			reportUrlChecked: true,
		};
	}

	return {
		shouldNotify: true,
		reason: "production deployment and report are live",
		reportUrlChecked: true,
	};
}

export function recordNotificationState(
	state: NotificationState,
	event: CloudflareDeploymentEvent,
): NotificationState {
	return {
		notifiedDeploymentIds: unique([
			...state.notifiedDeploymentIds,
			event.deployment.id,
		]),
		notifiedCommitHashes: unique([
			...state.notifiedCommitHashes,
			event.deployment.meta.commit_hash,
		]),
	};
}

export async function evaluateAndPersistNotification(
	event: CloudflareDeploymentEvent,
	backend: NotificationStateBackend,
	config: NotificationConfig,
	probeReportUrl: UrlProbe,
): Promise<PersistedNotificationDecision> {
	const snapshot = await backend.load();
	const decision = await evaluateDiscordNotification(
		event,
		snapshot.state,
		config,
		probeReportUrl,
	);
	if (!decision.shouldNotify) {
		return { ...decision, stateSaved: false };
	}

	try {
		await backend.save(recordNotificationState(snapshot.state, event), {
			ifGenerationMatch: snapshot.generation,
		});
		return { ...decision, stateSaved: true };
	} catch (error) {
		if (error instanceof GenerationMismatchError) {
			return {
				shouldNotify: false,
				reason: "notification state generation precondition failed",
				reportUrlChecked: decision.reportUrlChecked,
				stateSaved: false,
			};
		}
		throw error;
	}
}

export function buildDiscordPayload(input: DiscordPayloadInput): JsonObject {
	const reportTitle = path.basename(input.latestReportUrl);
	return {
		username: "Aegis-Intelligence",
		avatar_url: avatarUrl,
		embeds: [
			{
				title: "🛡️ インテリジェンス更新 ＆ 本番デプロイ成功報告",
				description:
					"提案・査読エージェントによる検証をすべてパスし、最新のサイバーセキュリティインテリジェンスが本番環境へ安全にホスティングされました。",
				url: input.publicBaseUrl,
				color: 3066993,
				fields: [
					{
						name: "📑 更新要約レポート (最新)",
						value: `[${reportTitle}](${input.latestReportUrl})`,
						inline: true,
					},
					{
						name: "🔗 関連トピック解説",
						value: input.relatedTopics
							.map((topic) => `- [[${topic.title}]](${topic.url})`)
							.join("\n"),
						inline: false,
					},
					{
						name: "⚙️ 実行履歴",
						value: `マージコミット: \`${input.deployment.meta.commit_hash.slice(0, 10)}\` by Aegis-Reviewer`,
						inline: false,
					},
				],
				footer: {
					text: "`kaname` • サーバーレス自律監視システム",
					icon_url: avatarUrl,
				},
				timestamp: new Date(input.deployment.modified_on).toISOString(),
			},
		],
	};
}

export async function sendDiscordWithBoundedRetry(
	sendWebhook: () => Promise<{ ok: boolean; status: number }>,
	sleep: (ms: number) => Promise<void>,
	policy: RetryPolicy,
): Promise<DiscordSendResult> {
	for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
		const result = await sendWebhook();
		if (result.ok && result.status >= 200 && result.status < 300) {
			return "sent";
		}
		if (attempt < policy.maxAttempts - 1) {
			await sleep(policy.backoffMs[attempt] ?? policy.backoffMs.at(-1) ?? 0);
		}
	}
	return "escalate_issue";
}

function isHttpsUrl(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

function normalizeUrl(value: string): string {
	return value.replace(/\/+$/, "");
}

function unique(values: string[]): string[] {
	return Array.from(new Set(values));
}
