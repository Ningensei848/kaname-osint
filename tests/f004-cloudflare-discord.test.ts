import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import {
	GenerationMismatchError,
	buildDiscordPayload,
	evaluateAndPersistNotification,
	evaluateDiscordNotification,
	recordNotificationState,
	sendDiscordWithBoundedRetry,
	type CloudflareDeploymentEvent,
	type JsonObject,
	type NotificationState,
	type NotificationStateBackend,
	type NotificationStateSnapshot,
	type RetryPolicy,
	type UrlProbe,
} from "../src/notifications/cloudflare-discord";
import { assertQuartzGraphDisabledArtifact } from "./helpers/quartz-artifact-contract";

const repoRoot = process.cwd();
const publicBaseUrl = "https://osint-kaname.pages.dev";
const latestReportUrl = `${publicBaseUrl}/reports/2026-05-27_Report`;
type JsonSchema = Record<string, unknown>;

function readJson(relativePath: string): unknown {
	return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function readFixture<T>(...segments: string[]): T {
	return readJson(path.join("tests", "fixtures", "f004", ...segments)) as T;
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

	if (typeof value === "number" && typeof schema.minimum === "number") {
		if (value < schema.minimum) {
			errors.push({
				path: currentPath,
				message: `expected minimum ${schema.minimum}`,
			});
		}
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

function assertDiscordPayloadPolicy(payload: JsonObject): string[] {
	const errors = validateWithSchema(
		".spec/schemas/discord-webhook-payload.schema.json",
		payload,
	);
	const embed = Array.isArray(payload.embeds)
		? (payload.embeds[0] as JsonObject)
		: undefined;
	if (!embed) return [...errors, "embed is required"];
	const fields = Array.isArray(embed.fields)
		? (embed.fields as JsonObject[])
		: [];
	const reportField = fields.find((field) =>
		String(field.name).includes("更新要約レポート"),
	);
	if (!reportField || !String(reportField.value).includes("/reports/")) {
		errors.push("latest report field must link to the published report URL");
	}
	if (String(embed.url) !== publicBaseUrl) {
		errors.push("embed URL must be the public production base URL");
	}
	if (!fields.some((field) => String(field.name).includes("実行履歴"))) {
		errors.push("execution history field is required");
	}
	return errors;
}

class FakeExternalNotificationStateBackend implements NotificationStateBackend {
	loadCalls = 0;
	saveCalls = 0;
	saveGenerations: number[] = [];
	onBeforeSave?: () => void;

	constructor(
		private state: NotificationState,
		private generation: number,
	) {}

	async load(): Promise<NotificationStateSnapshot> {
		this.loadCalls += 1;
		return { state: cloneState(this.state), generation: this.generation };
	}

	async save(
		nextState: NotificationState,
		options: { ifGenerationMatch: number },
	): Promise<void> {
		this.saveCalls += 1;
		this.saveGenerations.push(options.ifGenerationMatch);
		this.onBeforeSave?.();
		if (options.ifGenerationMatch !== this.generation) {
			throw new GenerationMismatchError();
		}
		this.state = cloneState(nextState);
		this.generation += 1;
	}

	simulateConcurrentWrite(
		mutator: (state: NotificationState) => NotificationState,
	) {
		this.state = cloneState(mutator(this.state));
		this.generation += 1;
	}
}

function cloneState(state: NotificationState): NotificationState {
	return {
		notifiedDeploymentIds: [...state.notifiedDeploymentIds],
		notifiedCommitHashes: [...state.notifiedCommitHashes],
	};
}

// Fixture builder only: this URL probe simulates report reachability for tests.
function buildFixtureLiveReportProbe(
	liveUrls: Set<string>,
	checkedUrls: string[],
): UrlProbe {
	return async (url) => {
		checkedUrls.push(url);
		return liveUrls.has(url)
			? { ok: true, status: 200 }
			: { ok: false, status: 404 };
	};
}

test("F004 Cloudflare deployment fixtures match the webhook schema", async (t) => {
	for (const fixtureName of [
		"production-success.json",
		"preview-success.json",
		"production-failure.json",
		"production-pending.json",
		"production-wrong-branch.json",
	]) {
		await t.test(
			`${fixtureName} is structurally valid Cloudflare event JSON`,
			() => {
				const event = readFixture<CloudflareDeploymentEvent>(
					"cloudflare",
					fixtureName,
				);
				assert.deepStrictEqual(
					validateWithSchema(
						".spec/schemas/cloudflare-pages-deployment.schema.json",
						event,
					),
					[],
				);
			},
		);
	}
});

test("F004 production notification gate permits generic schema URI while business gate requires HTTPS", async () => {
	const event = readFixture<CloudflareDeploymentEvent>(
		"cloudflare",
		"production-success.json",
	);
	const httpEvent: CloudflareDeploymentEvent = {
		...event,
		deployment: {
			...event.deployment,
			url: "http://osint-kaname.pages.dev",
		},
	};
	assert.deepStrictEqual(
		validateWithSchema(
			".spec/schemas/cloudflare-pages-deployment.schema.json",
			httpEvent,
		),
		[],
	);

	const decision = await evaluateDiscordNotification(
		httpEvent,
		readFixture<NotificationState>("state", "notification-state.empty.json"),
		{
			publicBaseUrl: "http://osint-kaname.pages.dev",
			latestReportUrl:
				"https://osint-kaname.pages.dev/reports/2026-05-27_Report",
		},
		buildFixtureLiveReportProbe(new Set([latestReportUrl]), []),
	);
	assert.deepStrictEqual(decision, {
		shouldNotify: false,
		reason: "deployment and public base URLs must be HTTPS",
		reportUrlChecked: false,
	});
});

test("F004 production notification gate is impossible before production success", async (t) => {
	const emptyState = readFixture<NotificationState>(
		"state",
		"notification-state.empty.json",
	);
	const config = { publicBaseUrl, latestReportUrl };
	const cases: Array<[string, string]> = [
		["preview-success.json", "deployment is not production"],
		["production-failure.json", "deployment status is not success"],
		["production-pending.json", "deployment status is not success"],
		["production-wrong-branch.json", "deployment branch is not main"],
	];

	for (const [fixtureName, reason] of cases) {
		await t.test(
			`${fixtureName} does not notify and does not probe report URL`,
			async () => {
				const checkedUrls: string[] = [];
				const decision = await evaluateDiscordNotification(
					readFixture<CloudflareDeploymentEvent>("cloudflare", fixtureName),
					emptyState,
					config,
					buildFixtureLiveReportProbe(new Set([latestReportUrl]), checkedUrls),
				);

				assert.deepStrictEqual(decision, {
					shouldNotify: false,
					reason,
					reportUrlChecked: false,
				});
				assert.deepStrictEqual(checkedUrls, []);
			},
		);
	}

	await t.test(
		"wrong deployment URL blocks notification before report probing",
		async () => {
			const checkedUrls: string[] = [];
			const event = readFixture<CloudflareDeploymentEvent>(
				"cloudflare",
				"production-success.json",
			);
			const decision = await evaluateDiscordNotification(
				{
					...event,
					deployment: {
						...event.deployment,
						url: "https://evil.example.invalid",
					},
				},
				emptyState,
				config,
				buildFixtureLiveReportProbe(new Set([latestReportUrl]), checkedUrls),
			);

			assert.deepStrictEqual(decision, {
				shouldNotify: false,
				reason: "deployment URL does not match public base URL",
				reportUrlChecked: false,
			});
			assert.deepStrictEqual(checkedUrls, []);
		},
	);
});

test("F004 production notification gate requires mocked live report URL before Discord send", async (t) => {
	const event = readFixture<CloudflareDeploymentEvent>(
		"cloudflare",
		"production-success.json",
	);
	const emptyState = readFixture<NotificationState>(
		"state",
		"notification-state.empty.json",
	);
	const config = { publicBaseUrl, latestReportUrl };

	await t.test(
		"production success is still blocked when the latest report URL is not live",
		async () => {
			const checkedUrls: string[] = [];
			const decision = await evaluateDiscordNotification(
				event,
				emptyState,
				config,
				buildFixtureLiveReportProbe(new Set(), checkedUrls),
			);

			assert.deepStrictEqual(decision, {
				shouldNotify: false,
				reason: "latest report URL is not live",
				reportUrlChecked: true,
			});
			assert.deepStrictEqual(checkedUrls, [latestReportUrl]);
		},
	);

	await t.test(
		"production success with a live latest report URL can notify",
		async () => {
			const checkedUrls: string[] = [];
			const decision = await evaluateDiscordNotification(
				event,
				emptyState,
				config,
				buildFixtureLiveReportProbe(new Set([latestReportUrl]), checkedUrls),
			);

			assert.deepStrictEqual(decision, {
				shouldNotify: true,
				reason: "production deployment and report are live",
				reportUrlChecked: true,
			});
			assert.deepStrictEqual(checkedUrls, [latestReportUrl]);
		},
	);
});

test("F004 production idempotency state blocks repeated events", async (t) => {
	const event = readFixture<CloudflareDeploymentEvent>(
		"cloudflare",
		"production-success.json",
	);
	const config = { publicBaseUrl, latestReportUrl };

	await t.test("recording notification state is append-only and unique", () => {
		const emptyState = readFixture<NotificationState>(
			"state",
			"notification-state.empty.json",
		);
		assert.deepStrictEqual(recordNotificationState(emptyState, event), {
			notifiedDeploymentIds: [event.deployment.id],
			notifiedCommitHashes: [event.deployment.meta.commit_hash],
		});
	});

	await t.test("duplicate deployment id does not notify twice", async () => {
		const duplicateState = readFixture<NotificationState>(
			"state",
			"notification-state.duplicate.json",
		);
		const checkedUrls: string[] = [];
		const decision = await evaluateDiscordNotification(
			event,
			duplicateState,
			config,
			buildFixtureLiveReportProbe(new Set([latestReportUrl]), checkedUrls),
		);

		assert.deepStrictEqual(decision, {
			shouldNotify: false,
			reason: "deployment id was already notified",
			reportUrlChecked: false,
		});
		assert.deepStrictEqual(checkedUrls, []);
	});

	await t.test(
		"duplicate commit hash remains idempotent across deployment ids",
		async () => {
			const state: NotificationState = {
				notifiedDeploymentIds: [],
				notifiedCommitHashes: [event.deployment.meta.commit_hash],
			};
			const checkedUrls: string[] = [];
			const replayWithNewDeploymentId: CloudflareDeploymentEvent = {
				...event,
				deployment: { ...event.deployment, id: "deploy_replayed_different_id" },
			};

			const decision = await evaluateDiscordNotification(
				replayWithNewDeploymentId,
				state,
				config,
				buildFixtureLiveReportProbe(new Set([latestReportUrl]), checkedUrls),
			);

			assert.deepStrictEqual(decision, {
				shouldNotify: false,
				reason: "commit hash was already notified",
				reportUrlChecked: false,
			});
			assert.deepStrictEqual(checkedUrls, []);
		},
	);

	await t.test(
		"external notification state backend is loaded and saved with generation precondition",
		async () => {
			const backend = new FakeExternalNotificationStateBackend(
				readFixture<NotificationState>(
					"state",
					"notification-state.empty.json",
				),
				41,
			);
			const checkedUrls: string[] = [];
			const decision = await evaluateAndPersistNotification(
				event,
				backend,
				config,
				buildFixtureLiveReportProbe(new Set([latestReportUrl]), checkedUrls),
			);

			assert.deepStrictEqual(decision, {
				shouldNotify: true,
				reason: "production deployment and report are live",
				reportUrlChecked: true,
				stateSaved: true,
			});
			assert.strictEqual(backend.loadCalls, 1);
			assert.strictEqual(backend.saveCalls, 1);
			assert.deepStrictEqual(backend.saveGenerations, [41]);
			assert.deepStrictEqual(checkedUrls, [latestReportUrl]);
		},
	);

	await t.test(
		"generation mismatch fails closed before a duplicate Discord send can be committed",
		async () => {
			const backend = new FakeExternalNotificationStateBackend(
				readFixture<NotificationState>(
					"state",
					"notification-state.empty.json",
				),
				7,
			);
			backend.onBeforeSave = () =>
				backend.simulateConcurrentWrite((current) =>
					recordNotificationState(current, event),
				);
			const decision = await evaluateAndPersistNotification(
				event,
				backend,
				config,
				buildFixtureLiveReportProbe(new Set([latestReportUrl]), []),
			);

			assert.deepStrictEqual(decision, {
				shouldNotify: false,
				reason: "notification state generation precondition failed",
				reportUrlChecked: true,
				stateSaved: false,
			});
			assert.strictEqual(backend.loadCalls, 1);
			assert.strictEqual(backend.saveCalls, 1);
			assert.deepStrictEqual(backend.saveGenerations, [7]);
		},
	);
});

test("F004 Discord payload builder satisfies executable schema policy", async (t) => {
	await t.test("canonical fixture satisfies schema and policy checks", () => {
		const payload = readFixture<JsonObject>(
			"discord",
			"valid-deployment-payload.json",
		);
		assert.deepStrictEqual(assertDiscordPayloadPolicy(payload), []);
	});

	await t.test(
		"payload builder emits the same contract shape after the gate is green",
		() => {
			const event = readFixture<CloudflareDeploymentEvent>(
				"cloudflare",
				"production-success.json",
			);
			const payload = buildDiscordPayload({
				deployment: event.deployment,
				publicBaseUrl,
				latestReportUrl,
				relatedTopics: [
					{
						title: "能動的サイバー防御",
						url: `${publicBaseUrl}/topics/gov-agencies/NCO`,
					},
					{
						title: "サイバー演習CYDER",
						url: `${publicBaseUrl}/topics/cyber-exercises/CYDER`,
					},
				],
			});

			assert.deepStrictEqual(assertDiscordPayloadPolicy(payload), []);
		},
	);
});

test("F004 Quartz Graph disabled artifact contract", async (t) => {
	await t.test(
		"graph-disabled fixture contains no graph view UI or scripts",
		() => {
			const fixturePath =
				"tests/fixtures/f004/quartz-artifacts/graph-disabled.html";
			assert.deepStrictEqual(
				assertQuartzGraphDisabledArtifact([
					{
						path: fixturePath,
						html: fs.readFileSync(path.join(repoRoot, fixturePath), "utf8"),
					},
				]),
				[],
			);
		},
	);

	await t.test("graph-enabled fixture is rejected deterministically", () => {
		const fixturePath =
			"tests/fixtures/f004/quartz-artifacts/graph-enabled.html";
		assert.match(
			assertQuartzGraphDisabledArtifact([
				{
					path: fixturePath,
					html: fs.readFileSync(path.join(repoRoot, fixturePath), "utf8"),
				},
			]).join("\n"),
			/Graph View|global-graph|graph\.inline\.js|data-component=\["'\]Graph/,
		);
	});
});

test("F004 production Discord webhook retry is bounded and escalates safely", async (t) => {
	const retryPolicy: RetryPolicy = { maxAttempts: 3, backoffMs: [100, 500] };

	await t.test(
		"transient webhook failure retries without exceeding the bounded policy",
		async () => {
			let attempts = 0;
			const sleeps: number[] = [];
			const result = await sendDiscordWithBoundedRetry(
				async () => {
					attempts += 1;
					return attempts === 2
						? { ok: true, status: 204 }
						: { ok: false, status: 502 };
				},
				async (ms) => {
					sleeps.push(ms);
				},
				retryPolicy,
			);

			assert.strictEqual(result, "sent");
			assert.strictEqual(attempts, 2);
			assert.deepStrictEqual(sleeps, [100]);
		},
	);

	await t.test(
		"repeated webhook failure escalates to GitHub Issue without unbounded retry",
		async () => {
			let attempts = 0;
			const sleeps: number[] = [];
			const result = await sendDiscordWithBoundedRetry(
				async () => {
					attempts += 1;
					return { ok: false, status: 500 };
				},
				async (ms) => {
					sleeps.push(ms);
				},
				retryPolicy,
			);

			assert.strictEqual(result, "escalate_issue");
			assert.strictEqual(attempts, 3);
			assert.deepStrictEqual(sleeps, [100, 500]);
		},
	);
});

test.todo(
	"F004 production notification module uses external state backend family, not Git, for duplicate deployment notification state",
);
test.todo(
	"F004 integration tests live under tests/integration/ and may use real Cloudflare/Discord only behind explicit credentials",
);
