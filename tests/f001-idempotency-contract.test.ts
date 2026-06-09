/**
 * Feature 001 executable acceptance tests.
 *
 * Scope: test-code-first contracts only.  These tests intentionally use local
 * fakes and fixtures so Claude/implementation agents can implement production
 * adapters without requiring GitHub, GCP, or network access.
 *
 * Acceptance source: `.spec/features/001-crawler-idempotency/acceptance.md`.
 */

import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { runOrchestration } from "../src/orchestrator";

type JsonSchema = Record<string, unknown>;
type JsonObject = Record<string, unknown>;

interface ValidationError {
	path: string;
	message: string;
}

interface StoredStateObject {
	content: JsonObject | null;
	generation: number;
}

class PreconditionFailedError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "PreconditionFailedError";
	}
}

class FakeCloudStorageStateBucket {
	private stored: StoredStateObject = { content: null, generation: 0 };

	public read(): StoredStateObject {
		return {
			content: this.stored.content
				? JSON.parse(JSON.stringify(this.stored.content))
				: null,
			generation: this.stored.generation,
		};
	}

	public write(
		content: JsonObject,
		ifGenerationMatch: number,
	): StoredStateObject {
		if (ifGenerationMatch !== this.stored.generation) {
			throw new PreconditionFailedError(
				`generation precondition failed: expected ${ifGenerationMatch}, current ${this.stored.generation}`,
			);
		}

		this.stored = {
			content: JSON.parse(JSON.stringify(content)),
			generation: this.stored.generation + 1,
		};

		return this.read();
	}
}

function fixturePath(fileName: string): string {
	return path.join(__dirname, "fixtures", "f001", fileName);
}

function readJson(filePath: string): unknown {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateJsonSchema(
	schema: JsonSchema,
	value: unknown,
	currentPath = "$",
): ValidationError[] {
	const errors: ValidationError[] = [];
	const typeRule = schema.type;

	if (typeRule !== undefined && !matchesType(typeRule, value)) {
		errors.push({
			path: currentPath,
			message: `expected type ${JSON.stringify(typeRule)}`,
		});
		return errors;
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

		if (isRecord(schema.additionalProperties)) {
			for (const [key, childValue] of Object.entries(value)) {
				errors.push(
					...validateJsonSchema(
						schema.additionalProperties,
						childValue,
						`${currentPath}.${key}`,
					),
				);
			}
		}
	}

	if (schema.type === "array" && Array.isArray(value)) {
		if (typeof schema.minItems === "number" && value.length < schema.minItems) {
			errors.push({
				path: currentPath,
				message: `expected at least ${schema.minItems} items`,
			});
		}

		if (isRecord(schema.items)) {
			value.forEach((item, index) => {
				errors.push(
					...validateJsonSchema(
						schema.items as JsonSchema,
						item,
						`${currentPath}[${index}]`,
					),
				);
			});
		}
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

		if (typeof schema.pattern === "string") {
			const pattern = new RegExp(schema.pattern);
			if (!pattern.test(value)) {
				errors.push({
					path: currentPath,
					message: `expected to match ${schema.pattern}`,
				});
			}
		}

		if (schema.format === "uri" && !isValidUri(value)) {
			errors.push({ path: currentPath, message: "expected URI format" });
		}

		if (schema.format === "date-time" && !isValidDateTime(value)) {
			errors.push({ path: currentPath, message: "expected date-time format" });
		}
	}

	return errors;
}

function matchesType(typeRule: unknown, value: unknown): boolean {
	const allowedTypes = Array.isArray(typeRule) ? typeRule : [typeRule];
	return allowedTypes.some((type) => {
		switch (type) {
			case "object":
				return isRecord(value) && !Array.isArray(value);
			case "array":
				return Array.isArray(value);
			case "string":
				return typeof value === "string";
			case "null":
				return value === null;
			case "boolean":
				return typeof value === "boolean";
			case "number":
				return typeof value === "number";
			default:
				return false;
		}
	});
}

function isRecord(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidUri(value: string): boolean {
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}

function isValidDateTime(value: string): boolean {
	const timestamp = Date.parse(value);
	return !Number.isNaN(timestamp) && /T/.test(value);
}

test("F001 schema fixtures are executable contract inputs", async (t) => {
	const ssotSchema = readJson(".spec/schemas/ssot.schema.json") as JsonSchema;
	const crawlerStateSchema = readJson(
		".spec/schemas/crawler-state.schema.json",
	) as JsonSchema;

	await t.test("valid SSoT fixture satisfies the SSoT JSON Schema", () => {
		const validSsot = readJson(fixturePath("ssot.valid.json"));
		assert.deepStrictEqual(validateJsonSchema(ssotSchema, validSsot), []);
	});

	await t.test(
		"invalid SSoT fixture exposes required-field, pattern, and URI errors",
		() => {
			const invalidSsot = readJson(fixturePath("ssot.invalid.json"));
			const errors = validateJsonSchema(ssotSchema, invalidSsot);
			assert.ok(errors.some((error) => error.path.endsWith(".id")));
			assert.ok(errors.some((error) => error.path.endsWith(".url")));
			assert.ok(
				errors.some((error) =>
					error.message.includes("missing required property description"),
				),
			);
		},
	);

	await t.test(
		"valid crawler-state fixture satisfies the external state schema",
		() => {
			const validState = readJson(fixturePath("crawler-state.valid.json"));
			assert.deepStrictEqual(
				validateJsonSchema(crawlerStateSchema, validState),
				[],
			);
		},
	);

	await t.test(
		"invalid crawler-state fixture rejects bad timestamps, hashes, and extra fields",
		() => {
			const invalidState = readJson(fixturePath("crawler-state.invalid.json"));
			const errors = validateJsonSchema(crawlerStateSchema, invalidState);
			assert.ok(errors.some((error) => error.path === "$.last_execution"));
			assert.ok(errors.some((error) => error.path.endsWith(".content_hash")));
			assert.ok(
				errors.some((error) => error.path === "$.unexpected_root_field"),
			);
			assert.ok(
				errors.some((error) =>
					error.path.endsWith(".unexpected_mutable_field"),
				),
			);
		},
	);
});

test("F001 Cloud Storage state generation-precondition behavior is deterministic", async (t) => {
	await t.test("first write to an empty object must use generation 0", () => {
		const bucket = new FakeCloudStorageStateBucket();
		const initial = bucket.read();
		assert.strictEqual(initial.content, null);
		assert.strictEqual(initial.generation, 0);

		const written = bucket.write(
			readJson(fixturePath("crawler-state.valid.json")) as JsonObject,
			0,
		);
		assert.strictEqual(written.generation, 1);
		assert.ok(written.content);
	});

	await t.test(
		"matching generation allows exactly one compare-and-swap update",
		() => {
			const bucket = new FakeCloudStorageStateBucket();
			bucket.write(
				readJson(fixturePath("crawler-state.valid.json")) as JsonObject,
				0,
			);

			const snapshot = bucket.read();
			const updated = {
				...snapshot.content,
				last_execution: "2026-05-27T10:00:00.000Z",
			} as JsonObject;

			const result = bucket.write(updated, snapshot.generation);
			assert.strictEqual(result.generation, snapshot.generation + 1);
			assert.strictEqual(
				result.content?.last_execution,
				"2026-05-27T10:00:00.000Z",
			);
		},
	);

	await t.test(
		"stale concurrent generation is rejected and stored state is unchanged",
		() => {
			const bucket = new FakeCloudStorageStateBucket();
			bucket.write(
				readJson(fixturePath("crawler-state.valid.json")) as JsonObject,
				0,
			);

			const workerA = bucket.read();
			const workerB = bucket.read();
			bucket.write(
				{ ...workerA.content, last_execution: "2026-05-27T10:00:00.000Z" },
				workerA.generation,
			);

			assert.throws(
				() =>
					bucket.write(
						{ ...workerB.content, last_execution: "2026-05-27T11:00:00.000Z" },
						workerB.generation,
					),
				PreconditionFailedError,
			);

			const finalState = bucket.read();
			assert.strictEqual(finalState.generation, 2);
			assert.strictEqual(
				finalState.content?.last_execution,
				"2026-05-27T10:00:00.000Z",
			);
		},
	);
});

test("F001 unchanged sources do not invoke Writer or MCP write paths", async (t) => {
	await t.test(
		"all unchanged diff records produce zero side-effect invocations",
		async () => {
			let startMcpCalls = 0;
			let writerCalls = 0;
			let reviewerCalls = 0;

			const { orchestrator, result } = await runOrchestration(
				[
					{ sourceId: "jpcert_cc", hasChanged: false, content: "unchanged" },
					{ sourceId: "nisc", hasChanged: false, content: "unchanged" },
				],
				{
					startMcp: () => {
						startMcpCalls++;
					},
					writeProposal: () => {
						writerCalls++;
						throw new Error("Writer must not run for unchanged sources");
					},
					reviewProposal: () => {
						reviewerCalls++;
						throw new Error("Reviewer must not run when no PR exists");
					},
				},
			);

			assert.strictEqual(result.exitCode, 0);
			assert.match(result.reason, /No changes detected/);
			assert.strictEqual(orchestrator.launchedMcp, false);
			assert.strictEqual(startMcpCalls, 0, "MCP process must not be started");
			assert.strictEqual(writerCalls, 0, "Writer must not be invoked");
			assert.strictEqual(reviewerCalls, 0, "Reviewer must not be invoked");
		},
	);
});

test.todo(
	"F001 Cloud Storage production adapter maps generation-precondition failures to safe degraded operation",
);
test.todo(
	"F001 unchanged source guard records zero create_or_update_file and zero create_pull_request MCP calls in replay fixtures",
);
