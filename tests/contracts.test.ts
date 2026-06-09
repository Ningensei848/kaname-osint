/**
 * Executable contract tests derived from `.spec/contracts/**`,
 * `.spec/policies/**`, and feature acceptance criteria.
 *
 * The helpers in this file are intentionally deterministic: they encode the
 * fail-closed gates that must protect autonomous GitHub MCP writes, merges,
 * runtime state, and Discord notifications before production adapters exist.
 */

import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
	allGreenMergePreconditions,
	type MergePreconditions,
	validateToolPolicy,
} from "../src/mcp/tool-policy";
import { isAllowedMcpWriterPath } from "../src/policies/mcp-write-policy";

interface JsonRpcToolCall {
	jsonrpc: "2.0";
	method: "tools/call";
	params: {
		name:
			| "create_issue"
			| "create_or_update_file"
			| "create_pull_request"
			| "merge_pull_request";
		arguments: Record<string, unknown>;
	};
	id: number;
}

type JsonObject = Record<string, unknown>;
type JsonSchema = Record<string, unknown>;
type ProbeResult = { ok: boolean; status: number };
type UrlProbe = (url: string) => Promise<ProbeResult>;

interface CloudflareDeploymentEvent {
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

const owner = "example-org";
const repo = "kaname-vault";

function baseCall(
	name:
		| "create_issue"
		| "create_or_update_file"
		| "create_pull_request"
		| "merge_pull_request",
	args: Record<string, unknown>,
	id: number,
): JsonRpcToolCall {
	return {
		jsonrpc: "2.0",
		method: "tools/call",
		params: { name, arguments: args },
		id,
	};
}

function canAutonomouslyMerge(gates: MergePreconditions): boolean {
	return Object.values(gates).every((status) => status === "passed");
}

function readJson(relativePath: string): unknown {
	return JSON.parse(fs.readFileSync(relativePath, "utf8"));
}

function validateWithSchema(schemaPath: string, value: unknown): string[] {
	const schema = readJson(schemaPath) as JsonSchema;
	return validateJsonSchema(schema, value).map(
		(error) => `${error.path}: ${error.message}`,
	);
}

function validateJsonSchema(
	schema: JsonSchema,
	value: unknown,
	currentPath = "$",
): Array<{ path: string; message: string }> {
	const errors: Array<{ path: string; message: string }> = [];

	if (schema.type !== undefined && !matchesSchemaType(schema.type, value)) {
		return [
			{
				path: currentPath,
				message: `expected type ${JSON.stringify(schema.type)}`,
			},
		];
	}

	if (schema.const !== undefined && value !== schema.const) {
		errors.push({
			path: currentPath,
			message: `expected const ${schema.const}`,
		});
	}
	if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
		errors.push({ path: currentPath, message: "expected enum value" });
	}

	if (typeof value === "string") {
		if (
			typeof schema.minLength === "number" &&
			value.length < schema.minLength
		) {
			errors.push({
				path: currentPath,
				message: `expected minimum length ${schema.minLength}`,
			});
		}
		if (
			typeof schema.pattern === "string" &&
			!new RegExp(schema.pattern).test(value)
		) {
			errors.push({ path: currentPath, message: "expected pattern match" });
		}
		if (schema.format === "uri" && !isValidUrl(value)) {
			errors.push({ path: currentPath, message: "expected uri" });
		}
		if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) {
			errors.push({ path: currentPath, message: "expected date-time" });
		}
	}

	if (
		typeof value === "number" &&
		typeof schema.minimum === "number" &&
		value < schema.minimum
	) {
		errors.push({
			path: currentPath,
			message: `expected minimum ${schema.minimum}`,
		});
	}

	if (schema.type === "array" && Array.isArray(value)) {
		if (typeof schema.minItems === "number" && value.length < schema.minItems) {
			errors.push({
				path: currentPath,
				message: `expected at least ${schema.minItems} items`,
			});
		}
		if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
			errors.push({
				path: currentPath,
				message: `expected at most ${schema.maxItems} items`,
			});
		}
		if (isRecord(schema.items)) {
			for (const [index, item] of value.entries()) {
				errors.push(
					...validateJsonSchema(schema.items, item, `${currentPath}[${index}]`),
				);
			}
		}
	}

	if (schema.type === "object" && isRecord(value)) {
		const properties = isRecord(schema.properties) ? schema.properties : {};
		const required = Array.isArray(schema.required) ? schema.required : [];
		for (const requiredKey of required) {
			if (typeof requiredKey === "string" && !(requiredKey in value)) {
				errors.push({
					path: currentPath,
					message: `missing required property ${requiredKey}`,
				});
			}
		}
		if (schema.additionalProperties === false) {
			for (const key of Object.keys(value)) {
				if (!(key in properties)) {
					errors.push({
						path: `${currentPath}.${key}`,
						message: "additional property is not allowed",
					});
				}
			}
		}
		for (const [key, propertySchema] of Object.entries(properties)) {
			if (key in value && isRecord(propertySchema)) {
				errors.push(
					...validateJsonSchema(
						propertySchema,
						value[key],
						`${currentPath}.${key}`,
					),
				);
			}
		}
	}

	return errors;
}

function matchesSchemaType(typeRule: unknown, value: unknown): boolean {
	const allowedTypes = Array.isArray(typeRule) ? typeRule : [typeRule];
	return allowedTypes.some((type) => {
		switch (type) {
			case "array":
				return Array.isArray(value);
			case "boolean":
				return typeof value === "boolean";
			case "integer":
				return Number.isInteger(value);
			case "number":
				return typeof value === "number";
			case "object":
				return isRecord(value);
			case "string":
				return typeof value === "string";
			default:
				return false;
		}
	});
}

function isRecord(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidUrl(value: string): boolean {
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}

interface NotificationState {
	notifiedDeploymentIds: string[];
	notifiedCommitHashes: string[];
}

interface NotificationConfig {
	publicBaseUrl: string;
	latestReportUrl: string;
}

interface NotificationDecision {
	shouldNotify: boolean;
	reason: string;
	reportUrlChecked: boolean;
}

type ShouldNotifyDiscord = (
	event: CloudflareDeploymentEvent,
	state: NotificationState,
	config: NotificationConfig,
	probeReportUrl: UrlProbe,
) => Promise<NotificationDecision>;

interface DiscordPayloadInput {
	deployment: CloudflareDeploymentEvent["deployment"];
	publicBaseUrl: string;
	latestReportUrl: string;
	relatedTopics: Array<{ title: string; url: string }>;
}

function buildDiscordPayload(input: DiscordPayloadInput): JsonObject {
	const reportTitle =
		input.latestReportUrl.split("/").at(-1) ?? "latest-report";
	return {
		username: "Aegis-Intelligence",
		avatar_url:
			"https://raw.githubusercontent.com/github/spec-kit/main/media/logo_small.webp",
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
					icon_url:
						"https://raw.githubusercontent.com/github/spec-kit/main/media/logo_small.webp",
				},
				timestamp: new Date(input.deployment.modified_on).toISOString(),
			},
		],
	};
}

const allGreenGates: MergePreconditions = allGreenMergePreconditions;

const deploymentSuccess: CloudflareDeploymentEvent = {
	id: "evt_pages_deploy_success",
	project_name: "osint-kaname",
	deployment: {
		id: "deploy_id_98765",
		url: "https://osint-kaname.pages.dev",
		environment: "production",
		status: "success",
		created_on: "2026-05-27T09:45:00Z",
		modified_on: "2026-05-27T09:50:00Z",
		meta: {
			branch: "main",
			commit_hash: "a1b2c3d4e5f6g7h8i9j0",
			commit_message:
				"[Aegis-Reviewer] Self-Merge: Intelligence Update Passed Review",
		},
	},
};

test("MCP JSON-RPC contracts from .spec/contracts/mcp-contracts.md", async (t) => {
	await t.test(
		"accepts all canonical tool fixtures with strict envelopes",
		() => {
			const calls = [
				baseCall(
					"create_or_update_file",
					{
						owner,
						repo,
						path: "topics/gov-agencies/NCO.md",
						content: "---\ntitle: NCO\n---\n# 本文...",
						branch: "osint/content-acd-update-20260527",
						message: "[Aegis-Writer] Update NCO cybersecurity policy",
					},
					101,
				),
				baseCall(
					"create_pull_request",
					{
						owner,
						repo,
						title: "[Wiki-Sync] Intelligence Update (2026-05-27)",
						head: "osint/content-acd-update-20260527",
						base: "main",
						body: "## 提案要約\n- 既存のトピック `[[能動的サイバー防御]]` のインクリメンタル更新を完了。",
					},
					102,
				),
				baseCall(
					"merge_pull_request",
					{
						owner,
						repo,
						pull_number: 42,
						merge_method: "squash",
						commit_title:
							"[Aegis-Reviewer] Self-Merge: Intelligence Update Passed Review",
					},
					103,
				),
				baseCall(
					"create_issue",
					{
						owner,
						repo,
						title: "[System Error] Crawling Failed for ID: nco",
						body: "## 障害発生報告\n- **発生日時**: 2026-05-27T18:30:00JST\n- **対象ソース**: 国家サイバー統括室\n- **エラー内容**: HTTP 500\n- **ステータス**: 縮退運転中",
					},
					104,
				),
			];

			for (const call of calls) {
				assert.deepStrictEqual(validateToolPolicy(call, allGreenGates), []);
			}
		},
	);

	await t.test(
		"rejects Writer calls outside osint branches and approved paths",
		() => {
			const invalidCalls = [
				baseCall(
					"create_or_update_file",
					{
						owner,
						repo,
						path: "topics/gov-agencies/NCO.md",
						content: "# overwrite",
						branch: "main",
						message: "[Aegis-Writer] direct main write",
					},
					201,
				),
				baseCall(
					"create_or_update_file",
					{
						owner,
						repo,
						path: "crawler-state.json",
						content: "{}",
						branch: "osint/runtime-state",
						message: "[Aegis-Writer] Commit crawler state",
					},
					202,
				),
				baseCall(
					"create_or_update_file",
					{
						owner,
						repo,
						path: "src/orchestrator.ts",
						content: "malicious code",
						branch: "osint/content-update",
						message: "[Aegis-Writer] Modify runtime code",
					},
					203,
				),
				readJson(
					"tests/fixtures/f003/mcp/invalid/writer-nested-topic-path.json",
				) as JsonRpcToolCall,
				baseCall(
					"create_or_update_file",
					{
						owner,
						repo,
						path: "topics/../nco.md",
						content: "# traversal",
						branch: "osint/content-update",
						message: "[Aegis-Writer] Attempt path traversal",
					},
					205,
				),
				baseCall(
					"create_or_update_file",
					{
						owner,
						repo,
						path: "topics/gov-agencies/NCO\u0000.md",
						content: "# control",
						branch: "osint/content-update",
						message: "[Aegis-Writer] Attempt control char path",
					},
					206,
				),
			];

			for (const call of invalidCalls) {
				assert.notDeepStrictEqual(validateToolPolicy(call, allGreenGates), []);
			}
		},
	);
	await t.test("uses production writer path allowlist directly", () => {
		assert.strictEqual(
			isAllowedMcpWriterPath("topics/gov-agencies/NCO.md"),
			true,
		);
		assert.strictEqual(isAllowedMcpWriterPath("src/orchestrator.ts"), false);
	});
});

test("Protected merge and Takumi Guard gates fail closed", async (t) => {
	await t.test(
		"all protected autonomous merge requirements must be green",
		() => {
			assert.strictEqual(canAutonomouslyMerge(allGreenGates), true);
		},
	);

	await t.test(
		"any failed, unavailable, or indeterminate gate blocks merge_pull_request",
		() => {
			const gateNames = Object.keys(allGreenGates) as Array<
				keyof MergePreconditions
			>;

			for (const gateName of gateNames) {
				for (const badStatus of [
					"failed",
					"unavailable",
					"indeterminate",
				] as const) {
					const gates = { ...allGreenGates, [gateName]: badStatus };
					assert.strictEqual(
						canAutonomouslyMerge(gates),
						false,
						`${gateName}=${badStatus} must fail closed`,
					);
				}
			}
		},
	);
});

test("Cloudflare Pages deployment and Discord webhook cross-contracts", async (t) => {
	await t.test(
		"Cloudflare deployment fixture satisfies the webhook event schema",
		() => {
			assert.deepStrictEqual(
				validateWithSchema(
					".spec/schemas/cloudflare-pages-deployment.schema.json",
					deploymentSuccess,
				),
				[],
			);
		},
	);

	await t.test(
		"notification gate contract is the async DI surface owned by F004 tests",
		async () => {
			const probeReportUrl: UrlProbe = async (url) => ({
				ok: url === "https://osint-kaname.pages.dev/reports/2026-05-27_Report",
				status: 200,
			});
			const contract: ShouldNotifyDiscord = async (
				event,
				state,
				config,
				probe,
			) => {
				assert.strictEqual(event, deploymentSuccess);
				assert.deepStrictEqual(state, {
					notifiedDeploymentIds: [],
					notifiedCommitHashes: [],
				});
				assert.strictEqual(
					config.latestReportUrl,
					"https://osint-kaname.pages.dev/reports/2026-05-27_Report",
				);
				const probeResult = await probe(config.latestReportUrl);
				return {
					shouldNotify: probeResult.ok,
					reason: "contract shape only; decision logic is covered in F004",
					reportUrlChecked: true,
				};
			};

			const decision = await contract(
				deploymentSuccess,
				{ notifiedDeploymentIds: [], notifiedCommitHashes: [] },
				{
					publicBaseUrl: "https://osint-kaname.pages.dev",
					latestReportUrl:
						"https://osint-kaname.pages.dev/reports/2026-05-27_Report",
				},
				probeReportUrl,
			);

			assert.deepStrictEqual(decision, {
				shouldNotify: true,
				reason: "contract shape only; decision logic is covered in F004",
				reportUrlChecked: true,
			});
		},
	);

	await t.test(
		"Discord rich embed payload satisfies schema and MCP audit trail expectations",
		() => {
			const payload = buildDiscordPayload({
				deployment: deploymentSuccess.deployment,
				publicBaseUrl: "https://osint-kaname.pages.dev",
				latestReportUrl:
					"https://osint-kaname.pages.dev/reports/2026-05-27_Report",
				relatedTopics: [
					{
						title: "能動的サイバー防御",
						url: "https://osint-kaname.pages.dev/topics/gov-agencies/NCO",
					},
					{
						title: "サイバー演習CYDER",
						url: "https://osint-kaname.pages.dev/topics/cyber-exercises/CYDER",
					},
				],
			});

			assert.deepStrictEqual(
				validateWithSchema(
					".spec/schemas/discord-webhook-payload.schema.json",
					payload,
				),
				[],
			);
			assert.strictEqual(payload.username, "Aegis-Intelligence");
			const embed = (payload.embeds as JsonObject[])[0];
			assert.strictEqual(embed.url, "https://osint-kaname.pages.dev");
			assert.strictEqual(embed.color, 3066993);
			const fields = embed.fields as JsonObject[];
			assert.ok(String(fields[0].value).includes("2026-05-27_Report"));
			assert.ok(String(fields[1].value).includes("[[能動的サイバー防御]]"));
			assert.ok(String(fields[2].value).includes("a1b2c3d4e5"));
			assert.strictEqual(embed.timestamp, "2026-05-27T09:50:00.000Z");
		},
	);
});

test("Crawler state repository-safety acceptance criteria", async (t) => {
	await t.test("crawler-state.json is ignored and never tracked in Git", () => {
		const gitignore = fs.readFileSync(".gitignore", "utf8");
		assert.match(gitignore, /(^|\n)crawler-state\.json(\n|$)/);

		const trackedFiles = execFileSync("git", ["ls-files"], {
			encoding: "utf8",
		})
			.split("\n")
			.filter(Boolean);
		assert.deepStrictEqual(
			trackedFiles.filter((filePath) =>
				filePath.endsWith("crawler-state.json"),
			),
			[],
		);
	});
});
