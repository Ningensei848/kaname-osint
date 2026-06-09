import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseSsotYaml } from "../src/crawler/parser";

const tempDir = path.join(__dirname, "temp");

function writeTempYaml(fileName: string, content: string): string {
	fs.mkdirSync(tempDir, { recursive: true });
	const yamlPath = path.join(tempDir, fileName);
	fs.writeFileSync(yamlPath, content, "utf8");
	return yamlPath;
}

function captureWarnings<T>(callback: () => T): {
	result: T;
	warnings: string[];
} {
	const originalWarn = console.warn;
	const warnings: string[] = [];
	console.warn = (message?: unknown) => {
		warnings.push(String(message));
	};

	try {
		return { result: callback(), warnings };
	} finally {
		console.warn = originalWarn;
	}
}

test("SSoT Parser Tests", async (t) => {
	await t.test("should parse valid SSoT YAML correctly", () => {
		const yamlPath = writeTempYaml(
			"valid_ssot.yml",
			`
ssot_sources:
  - id: jpcert
    name: JPCERT/CC
    url: https://www.jpcert.or.jp/
    description: Security alerts and incidents
    feed_url: https://www.jpcert.or.jp/rss/jpcert.rdf
    custom_extraction_instruction: Extract latest alerts
`,
		);

		const sources = parseSsotYaml(yamlPath);
		assert.strictEqual(sources.length, 1);
		assert.strictEqual(sources[0].id, "jpcert");
		assert.strictEqual(sources[0].name, "JPCERT/CC");
		assert.strictEqual(sources[0].url, "https://www.jpcert.or.jp/");
		assert.strictEqual(sources[0].description, "Security alerts and incidents");
		assert.strictEqual(
			sources[0].feed_url,
			"https://www.jpcert.or.jp/rss/jpcert.rdf",
		);
		assert.strictEqual(
			sources[0].custom_extraction_instruction,
			"Extract latest alerts",
		);
	});

	await t.test(
		"should skip invalid sources and continue parsing valid sources",
		() => {
			const yamlPath = writeTempYaml(
				"mixed_valid_invalid_ssot.yml",
				`
ssot_sources:
  - id: valid_one
    name: Valid Source One
    url: https://example.com/one
    description: A valid source
  - id: invalid-id
    name: Source with bad ID pattern
    url: https://example.com/invalid-id
    description: Bad ID
  - id: invalid_url
    name: Bad URL
    url: not-a-url
    description: Bad URL
  - id: valid_two
    name: Valid Source Two
    url: https://example.com/two
    description: Another valid source
`,
			);

			const { result: sources, warnings } = captureWarnings(() =>
				parseSsotYaml(yamlPath),
			);

			assert.deepStrictEqual(
				sources.map((source) => source.id),
				["valid_one", "valid_two"],
			);
			assert.deepStrictEqual(warnings, [
				'[Degraded Mode] Skipping invalid SSoT source at index 1: ID "invalid-id" does not match pattern ^[a-z0-9_]+$',
				"[Degraded Mode] Skipping invalid SSoT source at index 2: Missing or invalid required parameter: url",
			]);
		},
	);

	await t.test("should throw error when ssot_sources list is missing", () => {
		const yamlPath = writeTempYaml(
			"missing_list.yml",
			`
wrong_root:
  - id: one
    name: One
    url: https://example.com
    description: One
`,
		);

		assert.throws(() => {
			parseSsotYaml(yamlPath);
		}, /unknown root key\(s\): wrong_root/);
	});

	await t.test("should reject unknown root keys", () => {
		const yamlPath = writeTempYaml(
			"unknown_root_key.yml",
			`
ssot_sources:
  - id: one
    name: One
    url: https://example.com
    description: One
unexpected: true
`,
		);

		assert.throws(() => {
			parseSsotYaml(yamlPath);
		}, /unknown root key\(s\): unexpected/);
	});

	await t.test("should skip sources with unknown source keys", () => {
		const yamlPath = writeTempYaml(
			"unknown_source_key.yml",
			`
ssot_sources:
  - id: one
    name: One
    url: https://example.com
    description: One
    unexpected: true
  - id: two
    name: Two
    url: https://example.com/two
    description: Two
`,
		);

		const { result: sources, warnings } = captureWarnings(() =>
			parseSsotYaml(yamlPath),
		);

		assert.deepStrictEqual(
			sources.map((source) => source.id),
			["two"],
		);
		assert.deepStrictEqual(warnings, [
			"[Degraded Mode] Skipping invalid SSoT source at index 0: Unknown source key(s): unexpected",
		]);
	});

	await t.test("should reject empty ssot_sources", () => {
		const yamlPath = writeTempYaml(
			"empty_sources.yml",
			`
ssot_sources: []
`,
		);

		assert.throws(() => {
			parseSsotYaml(yamlPath);
		}, /ssot_sources must contain at least one source/);
	});

	await t.test("should skip sources with invalid URL fields", () => {
		const yamlPath = writeTempYaml(
			"invalid_urls.yml",
			`
ssot_sources:
  - id: invalid_url
    name: Bad URL
    url: not-a-url
    description: Bad URL
  - id: valid_url
    name: Valid URL
    url: https://example.com/valid
    description: Valid URL
`,
		);

		const { result: sources, warnings } = captureWarnings(() =>
			parseSsotYaml(yamlPath),
		);

		assert.deepStrictEqual(
			sources.map((source) => source.id),
			["valid_url"],
		);
		assert.deepStrictEqual(warnings, [
			"[Degraded Mode] Skipping invalid SSoT source at index 0: Missing or invalid required parameter: url",
		]);
	});

	await t.test("should throw when all sources are invalid", () => {
		const yamlPath = writeTempYaml(
			"all_invalid_sources.yml",
			`
ssot_sources:
  - id: invalid-id
    name: Source with bad ID pattern
    url: https://example.com
    description: Bad ID
  - id: invalid_url
    name: Bad URL
    url: not-a-url
    description: Bad URL
`,
		);

		assert.throws(() => {
			captureWarnings(() => parseSsotYaml(yamlPath));
		}, /Invalid SSoT YAML structure: No valid sources found to process\./);
	});

	await t.test("should throw error when file does not exist", () => {
		assert.throws(() => {
			parseSsotYaml(path.join(tempDir, "non_existent.yml"));
		}, /SSoT configuration file not found/);
	});

	if (fs.existsSync(tempDir)) {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
