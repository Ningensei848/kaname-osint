/**
 * tests/state.test.ts
 *
 * Covers: data-model.md §2, checklist.md §3 (idempotency), constitution.md §3 (idempotency)
 *
 * Key rules under test:
 *   - SHA-256 hash is deterministic for identical content
 *   - Different content always produces a different hash  (change-detection gate)
 *   - loadCrawlerState returns a sane default when file is absent
 *   - loadCrawlerState falls back gracefully on corrupt JSON
 *   - saveCrawlerState + loadCrawlerState round-trips correctly
 *   - updateSourceState never mutates the original state object (pure function)
 *   - updateSourceState records the new hash and header for a given source id
 */

import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	calculateHash,
	loadCrawlerState,
	saveCrawlerState,
	updateSourceState,
} from "../src/crawler/state";

const tempDir = path.join(__dirname, "temp_state");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup() {
	if (fs.existsSync(tempDir))
		fs.rmSync(tempDir, { recursive: true, force: true });
	fs.mkdirSync(tempDir, { recursive: true });
}

function teardown() {
	if (fs.existsSync(tempDir))
		fs.rmSync(tempDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("calculateHash", async (t) => {
	await t.test("returns a 64-char hex SHA-256 digest", () => {
		const hash = calculateHash("hello");
		assert.match(hash, /^[0-9a-f]{64}$/);
	});

	await t.test("is deterministic — same input always gives same hash", () => {
		const content = "JPCERT/CC advisory 2026-05-27";
		assert.strictEqual(calculateHash(content), calculateHash(content));
	});

	await t.test(
		"produces different hashes for different content (change-detection gate)",
		() => {
			const hash1 = calculateHash("version A");
			const hash2 = calculateHash("version B");
			assert.notStrictEqual(hash1, hash2);
		},
	);

	await t.test("treats a one-character difference as a change", () => {
		// constitution.md §3: even a 1-character diff must trigger the update path
		const hash1 = calculateHash("Same content.");
		const hash2 = calculateHash("Same content!");
		assert.notStrictEqual(hash1, hash2);
	});

	await t.test("empty string produces a consistent hash", () => {
		const h = calculateHash("");
		assert.match(h, /^[0-9a-f]{64}$/);
		assert.strictEqual(calculateHash(""), h);
	});
});

test("loadCrawlerState", async (t) => {
	setup();

	await t.test(
		"returns a default empty state when the file does not exist",
		() => {
			const missing = path.join(tempDir, "no-such-file.json");
			const state = loadCrawlerState(missing);
			assert.deepStrictEqual(state.sources, {});
			// last_execution should be the epoch (never executed)
			assert.strictEqual(state.last_execution, new Date(0).toISOString());
		},
	);

	await t.test("parses a well-formed crawler-state.json correctly", () => {
		const filePath = path.join(tempDir, "valid-state.json");
		const fixture = {
			last_execution: "2026-05-27T09:00:00.000Z",
			sources: {
				jpcert: {
					last_checked: "2026-05-27T09:00:00.000Z",
					content_hash: "abc123",
					last_modified_header: "Wed, 27 May 2026 09:00:00 GMT",
				},
			},
		};
		fs.writeFileSync(filePath, JSON.stringify(fixture), "utf8");

		const state = loadCrawlerState(filePath);
		assert.strictEqual(state.last_execution, "2026-05-27T09:00:00.000Z");
		assert.strictEqual(state.sources.jpcert.content_hash, "abc123");
	});

	await t.test(
		"falls back to an empty default state on corrupt JSON (resilience)",
		() => {
			// constitution.md §3: crawling failure of one source must not crash the system
			const filePath = path.join(tempDir, "corrupt-state.json");
			fs.writeFileSync(filePath, "{ this is not json ]]]", "utf8");

			const state = loadCrawlerState(filePath);
			assert.deepStrictEqual(state.sources, {});
		},
	);

	teardown();
});

test("saveCrawlerState + loadCrawlerState round-trip", async (t) => {
	setup();

	await t.test("persists state to disk and reloads it faithfully", () => {
		const filePath = path.join(tempDir, "state.json");
		const original = {
			last_execution: "2026-05-27T12:00:00.000Z",
			sources: {
				nco: {
					last_checked: "2026-05-27T12:00:00.000Z",
					content_hash: calculateHash("NCO page content"),
					last_modified_header: null,
				},
			},
		};

		saveCrawlerState(filePath, original);
		assert.ok(fs.existsSync(filePath), "file should be created");

		const reloaded = loadCrawlerState(filePath);
		assert.strictEqual(reloaded.last_execution, original.last_execution);
		assert.strictEqual(
			reloaded.sources.nco.content_hash,
			original.sources.nco.content_hash,
		);
		assert.strictEqual(reloaded.sources.nco.last_modified_header, null);
	});

	await t.test("creates parent directories if they do not exist", () => {
		const nested = path.join(tempDir, "a", "b", "c", "state.json");
		const state = { last_execution: new Date(0).toISOString(), sources: {} };
		saveCrawlerState(nested, state);
		assert.ok(fs.existsSync(nested));
	});

	teardown();
});

test("updateSourceState", async (t) => {
	const baseState = {
		last_execution: "2026-05-26T00:00:00.000Z",
		sources: {
			existing_source: {
				last_checked: "2026-05-26T00:00:00.000Z",
				content_hash: "oldhash",
				last_modified_header: null,
			},
		},
	};

	await t.test("does not mutate the original state (pure function)", () => {
		const before = JSON.stringify(baseState);
		updateSourceState(baseState, "jpcert", "newhash", null);
		assert.strictEqual(JSON.stringify(baseState), before);
	});

	await t.test(
		"adds a new source entry while preserving existing entries",
		() => {
			const updated = updateSourceState(
				baseState,
				"jpcert",
				"newhash",
				"Thu, 28 May 2026 00:00:00 GMT",
			);
			assert.ok("jpcert" in updated.sources, "new source should appear");
			assert.ok(
				"existing_source" in updated.sources,
				"existing source must be preserved",
			);
			assert.strictEqual(updated.sources.jpcert.content_hash, "newhash");
			assert.strictEqual(
				updated.sources.jpcert.last_modified_header,
				"Thu, 28 May 2026 00:00:00 GMT",
			);
		},
	);

	await t.test("overwrites the hash for an already-tracked source", () => {
		const updated = updateSourceState(
			baseState,
			"existing_source",
			"refreshedhash",
			null,
		);
		assert.strictEqual(
			updated.sources.existing_source.content_hash,
			"refreshedhash",
		);
	});

	await t.test("updates last_execution to a newer timestamp", () => {
		const updated = updateSourceState(baseState, "jpcert", "h", null);
		assert.ok(
			new Date(updated.last_execution) > new Date(baseState.last_execution),
			"last_execution should be updated",
		);
	});

	await t.test("accepts null as a valid last_modified_header", () => {
		const updated = updateSourceState(
			baseState,
			"nco",
			calculateHash("page"),
			null,
		);
		assert.strictEqual(updated.sources.nco.last_modified_header, null);
	});
});

test("Idempotency gate (spec.md §4.1, constitution.md §3, checklist.md §3)", async (t) => {
	/**
	 * Core invariant:
	 *   If content hash has not changed → no LLM call / commit should happen.
	 *   This test verifies the hash-comparison logic that guards that gate.
	 */

	await t.test(
		"identical content → hashes match → no-op path should be taken",
		() => {
			const content = "JPCERT/CC advisory contents (unchanged)";
			const storedHash = calculateHash(content);
			const freshHash = calculateHash(content);
			assert.strictEqual(storedHash, freshHash); // guard: hashes equal → early return
		},
	);

	await t.test(
		"updated content → hashes differ → update path should be taken",
		() => {
			const previousContent = "JPCERT/CC advisory contents v1";
			const currentContent = "JPCERT/CC advisory contents v2 (new alert added)";
			const storedHash = calculateHash(previousContent);
			const freshHash = calculateHash(currentContent);
			assert.notStrictEqual(storedHash, freshHash); // guard: hashes differ → proceed
		},
	);
});
