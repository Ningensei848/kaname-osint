/**
 * Feature 002 deterministic content guard executable tests.
 *
 * Scope: executable guard contracts. These tests encode the reviewer/CI
 * expectations for destructive Markdown changes, topic frontmatter, link graph
 * quality, orphan-score regression, and report novelty while importing
 * extracted production guard modules for the deterministic checks.
 *
 * Acceptance source: `.spec/features/002-wiki-incremental-update/*` and
 * `.spec/policies/content-integrity-policy.md`.
 */

import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import * as YAML from "yaml";
import { internalLinkGuard } from "../src/content/guards/internalLinkGuard";
import { noOverwriteGuard } from "../src/content/guards/noOverwriteGuard";
import { orphanScoreRegressionGuard } from "../src/content/guards/orphanScoreRegressionGuard";
import { reportNoveltyGuard } from "../src/content/guards/reportNoveltyGuard";
import type {
	GuardResult,
	TopicAliasMap,
	VaultDocument,
} from "../src/content/guards/types";

type JsonSchema = Record<string, unknown>;
type JsonObject = Record<string, unknown>;

interface ValidationError {
	path: string;
	message: string;
}

interface MarkdownDocument {
	frontmatter: JsonObject;
	body: string;
}

function fixturePath(...segments: string[]): string {
	return path.join(__dirname, "fixtures", "f002", ...segments);
}

function readFixture(...segments: string[]): string {
	return fs.readFileSync(fixturePath(...segments), "utf8");
}

function readJson(filePath: string): unknown {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseMarkdown(markdown: string): MarkdownDocument {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
	if (!match) return { frontmatter: {}, body: markdown };
	return {
		frontmatter: (YAML.parse(match[1]) ?? {}) as JsonObject,
		body: match[2],
	};
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

	if (
		schema.enum &&
		Array.isArray(schema.enum) &&
		!schema.enum.includes(value)
	) {
		errors.push({ path: currentPath, message: "expected enum value" });
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

		if (
			typeof schema.pattern === "string" &&
			!new RegExp(schema.pattern).test(value)
		) {
			errors.push({
				path: currentPath,
				message: `expected to match ${schema.pattern}`,
			});
		}

		if (schema.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
			errors.push({ path: currentPath, message: "expected date format" });
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
			default:
				return false;
		}
	});
}

function isRecord(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateTopicFrontmatter(
	markdown: string,
	schema: JsonSchema,
): GuardResult {
	const document = parseMarkdown(markdown);
	const errors = validateJsonSchema(schema, document.frontmatter).map(
		(error) => `${error.path}: ${error.message}`,
	);
	return { ok: errors.length === 0, errors };
}

function immutablePathGuard(
	changedPaths: string[],
	currentRunDate: string,
): GuardResult {
	const errors = changedPaths.filter((changedPath) => {
		if (changedPath === "ssot.yml") return true;
		const reportMatch = /^reports\/(\d{4}-\d{2}-\d{2})_Report\.md$/.exec(
			changedPath,
		);
		return reportMatch ? reportMatch[1] < currentRunDate : false;
	});
	return {
		ok: errors.length === 0,
		errors: errors.map(
			(changedPath) => `${changedPath} is immutable for this run`,
		),
	};
}

test("F002 topic frontmatter schema guard", async (t) => {
	const schema = readJson(
		".spec/schemas/topic-frontmatter.schema.json",
	) as JsonSchema;

	await t.test(
		"valid topic frontmatter satisfies the executable schema",
		() => {
			const result = validateTopicFrontmatter(
				readFixture("topics", "before", "nco.md"),
				schema,
			);
			assert.deepStrictEqual(result, { ok: true, errors: [] });
		},
	);

	await t.test("CRLF topic frontmatter satisfies the executable schema", () => {
		const result = validateTopicFrontmatter(
			readFixture("topics", "before", "nco.md").replace(/\n/g, "\r\n"),
			schema,
		);
		assert.deepStrictEqual(result, { ok: true, errors: [] });
	});

	await t.test(
		"invalid topic frontmatter rejects empty titles, bad tags, empty sources, bad dates, and unknown keys",
		() => {
			const result = validateTopicFrontmatter(
				readFixture("topics", "after", "nco.invalid-frontmatter.md"),
				schema,
			);
			assert.strictEqual(result.ok, false);
			assert.ok(result.errors.some((error) => error.startsWith("$.title")));
			assert.ok(result.errors.some((error) => error.startsWith("$.tags[0]")));
			assert.ok(
				result.errors.some((error) => error.startsWith("$.source_ids")),
			);
			assert.ok(result.errors.some((error) => error.startsWith("$.updated")));
			assert.ok(
				result.errors.some((error) => error.startsWith("$.unexpected")),
			);
		},
	);
});

test("F002 immutable path and no-overwrite guards", async (t) => {
	await t.test(
		"immutable files and past reports are blocked while current report and topics are mutable",
		() => {
			const result = immutablePathGuard(
				[
					"ssot.yml",
					"reports/2026-05-26_Report.md",
					"reports/2026-05-27_Report.md",
					"topics/gov-agencies/NCO.md",
				],
				"2026-05-27",
			);
			assert.strictEqual(result.ok, false);
			assert.deepStrictEqual(result.errors, [
				"ssot.yml is immutable for this run",
				"reports/2026-05-26_Report.md is immutable for this run",
			]);
		},
	);

	await t.test(
		"incremental topic update preserves every existing body line",
		() => {
			const result = noOverwriteGuard(
				readFixture("topics", "before", "nco.md"),
				readFixture("topics", "after", "nco.incremental.md"),
			);
			assert.deepStrictEqual(result, { ok: true, errors: [] });
		},
	);

	await t.test(
		"CRLF frontmatter and body line reordering do not create false overwrite failures",
		() => {
			const before = readFixture("topics", "before", "nco.md").replace(
				/\n/g,
				"\r\n",
			);
			const after = `---\r\ntitle: 能動的サイバー防御\r\naliases:\r\n  - ACD\r\ntags:\r\n  - policy/cybersecurity\r\nsource_ids:\r\n  - nisc\r\nupdated: 2026-05-27\r\nstatus: published\r\n---\r\n# 能動的サイバー防御\r\n\r\n## 既存ファクト\r\n- JPCERT/CC などの既存機関との連携が前提となる。\r\n- 2025年: 政府は官民連携を含む制度設計を進めた。\r\n\r\n## 概要\r\n能動的サイバー防御は、重大なサイバー攻撃を未然に防ぐための政策概念である。\r\n\r\n### 最新動向\r\n- 2026-05-27: 追加事実。\r\n`;
			const result = noOverwriteGuard(before, after);
			assert.deepStrictEqual(result, { ok: true, errors: [] });
		},
	);

	await t.test(
		"destructive rewrite is rejected because existing facts disappear",
		() => {
			const result = noOverwriteGuard(
				readFixture("topics", "before", "nco.md"),
				readFixture("topics", "after", "nco.destructive.md"),
			);
			assert.strictEqual(result.ok, false);
			assert.ok(
				result.errors.some((error) => error.includes("政府は官民連携")),
			);
		},
	);
});

test("F002 internal link graph guard", async (t) => {
	const knownTitles = new Set([
		"能動的サイバー防御",
		"JPCERT_CC",
		"サイバー演習CYDER",
	]);

	await t.test(
		"valid incremental links resolve against the known vault title set",
		() => {
			const result = internalLinkGuard(
				readFixture("topics", "after", "nco.incremental.md"),
				knownTitles,
			);
			assert.deepStrictEqual(result, { ok: true, errors: [] });
		},
	);

	await t.test("links with extra spaces resolve against known titles", () => {
		const result = internalLinkGuard(
			"関連項目: [[  JPCERT_CC  ]]",
			knownTitles,
		);
		assert.deepStrictEqual(result, { ok: true, errors: [] });
	});

	await t.test(
		"alias map entries resolve as valid internal link targets",
		() => {
			const aliases: TopicAliasMap = {
				ACD: {
					resolvedFilePath: "topics/gov-agencies/NCO.md",
					primaryTitle: "能動的サイバー防御",
				},
			};
			const result = internalLinkGuard(
				"詳細は [[ACD|能動的サイバー防御]] を参照。",
				knownTitles,
				aliases,
			);
			assert.deepStrictEqual(result, { ok: true, errors: [] });
		},
	);

	await t.test(
		"broken links fail deterministic validation before Reviewer approval",
		() => {
			const result = internalLinkGuard(
				readFixture("topics", "after", "nco.broken-link.md"),
				knownTitles,
			);
			assert.strictEqual(result.ok, false);
			assert.ok(
				result.errors.includes("broken internal link: 存在しないトピック"),
			);
		},
	);

	await t.test("double-wrapped Obsidian links are rejected", () => {
		const result = internalLinkGuard(
			readFixture("topics", "after", "nco.double-wrapped.md"),
			knownTitles,
		);
		assert.strictEqual(result.ok, false);
		assert.ok(result.errors.includes("internal link is double-wrapped"));
	});

	await t.test("space-separated nested Obsidian links are rejected", () => {
		const result = internalLinkGuard(
			"不正リンク [[ [[JPCERT_CC]] ]]",
			knownTitles,
		);
		assert.strictEqual(result.ok, false);
		assert.ok(result.errors.includes("internal link is double-wrapped"));
	});

	await t.test("triple-bracket Obsidian links are rejected", () => {
		const result = internalLinkGuard("不正リンク [[[JPCERT_CC]]]", knownTitles);
		assert.strictEqual(result.ok, false);
		assert.ok(result.errors.includes("internal link is double-wrapped"));
	});
});

test("F002 orphan score regression guard", async (t) => {
	const beforeVault: VaultDocument[] = [
		{
			path: "topics/NCO.md",
			title: "能動的サイバー防御",
			markdown: "# 能動的サイバー防御\n[[JPCERT_CC]] と連携する。",
		},
		{
			path: "topics/JPCERT_CC.md",
			title: "JPCERT_CC",
			markdown: "# JPCERT_CC\n[[能動的サイバー防御]] を支援する。",
		},
	];

	await t.test(
		"inbound-connected updates do not increase high-severity orphan count",
		() => {
			const afterVault = [
				beforeVault[0],
				{
					...beforeVault[1],
					markdown:
						"# JPCERT_CC\n[[能動的サイバー防御]] を支援する。[[サイバー演習CYDER]] と訓練面で関連する。",
				},
				{
					path: "topics/CYDER.md",
					title: "サイバー演習CYDER",
					markdown: "# サイバー演習CYDER\n[[JPCERT_CC]] と訓練面で関連する。",
				},
			];
			const result = orphanScoreRegressionGuard(beforeVault, afterVault);
			assert.deepStrictEqual(result, { ok: true, errors: [] });
		},
	);

	await t.test("new high-severity orphan growth fails CI", () => {
		const afterVault = [
			...beforeVault,
			{
				path: "topics/Isolated.md",
				title: "孤立新規トピック",
				markdown: "# 孤立新規トピック\nどの既存トピックにも接続していない。",
			},
		];
		const result = orphanScoreRegressionGuard(beforeVault, afterVault);
		assert.strictEqual(result.ok, false);
		assert.ok(result.errors[0].includes("孤立新規トピック"));
	});

	await t.test(
		"outbound-only new documents remain inbound orphans and fail CI",
		() => {
			const afterVault = [
				...beforeVault,
				{
					path: "topics/OutboundOnly.md",
					title: "アウトバウンドのみの新規トピック",
					markdown:
						"# アウトバウンドのみの新規トピック\n[[JPCERT_CC]] への参照はあるが、誰からも被リンクされていない。",
				},
			];
			const result = orphanScoreRegressionGuard(beforeVault, afterVault);
			assert.strictEqual(result.ok, false);
			assert.ok(result.errors[0].includes("アウトバウンドのみの新規トピック"));
		},
	);
});

test("F002 report novelty and duplicate suppression guard", async (t) => {
	const existingTopic = readFixture("topics", "before", "nco.md");
	const previousReport =
		"# Previous Report\n\n- ゼロトラスト導入計画は省庁横断で段階的に進められた。根拠: https://example.test/previous。";

	await t.test(
		"valid delta report has source evidence and an internal link while staying below duplicate threshold",
		() => {
			const result = reportNoveltyGuard(
				readFixture("reports", "valid-delta.md"),
				existingTopic,
				{ duplicateThreshold: 0.4 },
			);
			assert.deepStrictEqual(result, { ok: true, errors: [] });
		},
	);

	await t.test(
		"duplicated explanation without internal links is rejected",
		() => {
			const result = reportNoveltyGuard(
				readFixture("reports", "duplicate-without-link.md"),
				existingTopic,
				{ duplicateThreshold: 0.2 },
			);
			assert.strictEqual(result.ok, false);
			assert.ok(
				result.errors.some((error) =>
					error.startsWith("duplicate report threshold exceeded"),
				),
			);
			assert.ok(
				result.errors.includes("report item lacks required internal link"),
			);
		},
	);

	await t.test(
		"duplicate detection compares against the whole provided vault context",
		() => {
			const result = reportNoveltyGuard(
				"# 2026-05-28 Report\n\n- ゼロトラスト導入計画は省庁横断で段階的に進められます。根拠: https://example.test/new。詳細は [[能動的サイバー防御]] を参照。",
				[
					{
						path: "reports/2026-05-27_Report.md",
						title: "Previous Report",
						markdown: previousReport,
					},
					{
						path: "topics/NCO.md",
						title: "能動的サイバー防御",
						markdown: existingTopic,
					},
				],
				{ duplicateThreshold: 0.2 },
			);
			assert.strictEqual(result.ok, false);
			assert.ok(
				result.errors.some((error) =>
					error.startsWith("duplicate report threshold exceeded"),
				),
			);
		},
	);

	await t.test(
		"frontmatter-only evidence does not satisfy item-level report evidence",
		() => {
			const result = reportNoveltyGuard(
				"---\ntitle: 2026-05-28 Report\nsource_url: https://example.test/frontmatter-only\n---\n# Report\n\n- 新しい制度更新は [[能動的サイバー防御]] に関連する。",
				[existingTopic, previousReport],
				{ duplicateThreshold: 0.9 },
			);
			assert.strictEqual(result.ok, false);
			assert.ok(result.errors.includes("report item lacks source evidence"));
		},
	);
});

test.todo(
	"F002 production deterministic guard module exports the same verdicts as these executable fixtures",
);
test.todo(
	"F002 CI wires no-overwrite, frontmatter, link graph, orphan, and duplicate guards before Reviewer approval",
);
