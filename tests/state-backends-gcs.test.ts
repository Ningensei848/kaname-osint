import { test } from "node:test";
import * as assert from "node:assert";
import { StateConflictError } from "../src/crawler/state";
import {
	GcsStateBackend,
	type FetchLike,
} from "../src/crawler/state-backends/gcs";
import type { CrawlerState } from "../src/types";

const state: CrawlerState = {
	last_execution: "2026-05-27T09:00:00.000Z",
	sources: {},
};

test("GcsStateBackend contract", async (t) => {
	await t.test("missing object bootstraps an empty crawler state", async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const fetchFn: FetchLike = async (url, init) => {
			calls.push({ url: String(url), init });
			return new Response("not found", { status: 404 });
		};

		const backend = new GcsStateBackend({
			bucket: "state-bucket",
			fetch: fetchFn,
		});
		const snapshot = await backend.load();

		assert.deepStrictEqual(snapshot.state.sources, {});
		assert.strictEqual(
			snapshot.state.last_execution,
			new Date(0).toISOString(),
		);
		assert.strictEqual(snapshot.generation, null);
		assert.strictEqual(calls[0].init?.method, "GET");
		assert.match(calls[0].url, /alt=media/);
	});

	await t.test(
		"matching generation save captures returned GCS generation",
		async () => {
			const calls: Array<{ url: string; init?: RequestInit }> = [];
			const fetchFn: FetchLike = async (url, init) => {
				calls.push({ url: String(url), init });
				return Response.json({ generation: "8" }, { status: 200 });
			};

			const backend = new GcsStateBackend({
				bucket: "state-bucket",
				fetch: fetchFn,
				accessToken: "token",
			});
			const snapshot = await backend.save(state, { ifGenerationMatch: "7" });

			assert.strictEqual(snapshot.generation, "8");
			assert.deepStrictEqual(snapshot.state, state);
			assert.strictEqual(calls[0].init?.method, "POST");
			assert.match(calls[0].url, /uploadType=media/);
			assert.match(calls[0].url, /ifGenerationMatch=7/);
			assert.match(String(calls[0].init?.body), /2026-05-27T09:00:00.000Z/);
		},
	);

	await t.test(
		"stale generation rejection maps to StateConflictError",
		async () => {
			const fetchFn: FetchLike = async () =>
				new Response(JSON.stringify({ error: { code: 412 } }), {
					status: 412,
				});

			const backend = new GcsStateBackend({
				bucket: "state-bucket",
				fetch: fetchFn,
			});
			await assert.rejects(
				() => backend.save(state, { ifGenerationMatch: "7" }),
				(error: unknown) => {
					assert.ok(error instanceof StateConflictError);
					assert.strictEqual(error.expectedGeneration, "7");
					assert.strictEqual(error.currentGeneration, null);
					return true;
				},
			);
		},
	);
	await t.test("unconditional save omits ifGenerationMatch", async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const fetchFn: FetchLike = async (url, init) => {
			calls.push({ url: String(url), init });
			return Response.json({ generation: "10" }, { status: 200 });
		};

		const backend = new GcsStateBackend({
			bucket: "state-bucket",
			fetch: fetchFn,
		});
		await backend.save(state, { ifGenerationMatch: null });

		assert.doesNotMatch(calls[0].url, /ifGenerationMatch/);
	});

	await t.test(
		"malformed existing object throws instead of bootstrapping",
		async () => {
			const fetchFn: FetchLike = async () =>
				new Response("{ not json", {
					status: 200,
					headers: { "x-goog-generation": "11" },
				});

			const backend = new GcsStateBackend({
				bucket: "state-bucket",
				fetch: fetchFn,
			});
			await assert.rejects(
				() => backend.load(),
				/Failed to parse existing crawler state from GCS/,
			);
		},
	);
});
