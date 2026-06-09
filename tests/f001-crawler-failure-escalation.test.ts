import { test } from "node:test";
import * as assert from "node:assert";
import {
	crawlSourcesWithFailureEscalation,
	type McpToolCall,
} from "../src/orchestrator";
import type { Fetcher } from "../src/crawler/fetch";
import { StateConflictError } from "../src/crawler/state";
import type { CrawlerState, SsotSource } from "../src/types";

test("F001 crawler retry failure escalates through GitHub MCP create_issue only", async () => {
	const sources: SsotSource[] = [
		{
			id: "nco",
			name: "国家サイバー統括室 (NCO: National Cyber Office)",
			url: "https://example.test/nco",
			description: "National Cyber Office source",
		},
		{
			id: "jpcert",
			name: "JPCERT/CC",
			url: "https://example.test/jpcert",
			description: "JPCERT source that must continue after nco fails",
		},
	];

	const fetchAttemptsByUrl = new Map<string, number>();
	const fakeFetcher: Fetcher = async (input) => {
		const url = String(input);
		fetchAttemptsByUrl.set(url, (fetchAttemptsByUrl.get(url) ?? 0) + 1);

		if (url === "https://example.test/nco") {
			return new Response("Internal Server Error", {
				status: 500,
				statusText: "Internal Server Error",
			});
		}

		return new Response(
			"<html><body><main>JPCERT advisory</main></body></html>",
			{
				status: 200,
				headers: {
					"Last-Modified": "Wed, 27 May 2026 09:30:00 GMT",
				},
			},
		);
	};

	const mcpCalls: McpToolCall[] = [];
	const fakeMcpClient = {
		callTool: (call: McpToolCall) => {
			mcpCalls.push(call);
		},
	};

	let thirdPartyMailerCalls = 0;
	const thirdPartyMailer = {
		send: () => {
			thirdPartyMailerCalls++;
		},
	};

	const result = await crawlSourcesWithFailureEscalation(sources, {
		mcpClient: fakeMcpClient,
		owner: "Ningensei848",
		repo: "kaname-vault",
		fetcher: fakeFetcher,
		now: () => new Date("2026-05-27T09:30:00.000Z"),
		idFactory: () => 104,
		thirdPartyMailer,
	});

	assert.strictEqual(fetchAttemptsByUrl.get("https://example.test/nco"), 3);
	assert.strictEqual(fetchAttemptsByUrl.get("https://example.test/jpcert"), 1);
	assert.strictEqual(mcpCalls.length, 1, "create_issue must fire exactly once");

	const createIssueCall = mcpCalls[0];
	assert.strictEqual(createIssueCall.jsonrpc, "2.0");
	assert.strictEqual(createIssueCall.method, "tools/call");
	assert.strictEqual(createIssueCall.id, 104);
	assert.strictEqual(createIssueCall.params.name, "create_issue");
	assert.deepStrictEqual(
		createIssueCall.params.arguments.owner,
		"Ningensei848",
	);
	assert.deepStrictEqual(createIssueCall.params.arguments.repo, "kaname-vault");
	assert.strictEqual(
		createIssueCall.params.arguments.title,
		"[System Error] Crawling Failed for ID: nco",
	);
	assert.ok(createIssueCall.params.arguments.body.includes("## 障害発生報告"));
	assert.ok(
		createIssueCall.params.arguments.body.includes(
			"- **発生日時**: 2026-05-27T09:30:00.000Z",
		),
	);
	assert.ok(
		createIssueCall.params.arguments.body.includes(
			"- **対象ソース**: 国家サイバー統括室 (NCO: National Cyber Office)",
		),
	);
	assert.ok(
		createIssueCall.params.arguments.body.includes(
			"HTTP Error: 500 Internal Server Error",
		),
	);
	assert.ok(
		createIssueCall.params.arguments.body.includes("連続3回失敗") ||
			createIssueCall.params.arguments.body.includes("after 3 attempts"),
	);
	assert.ok(
		createIssueCall.params.arguments.body.includes("縮退運転を継続中です"),
	);

	assert.strictEqual(
		thirdPartyMailerCalls,
		0,
		"external SMTP / third-party mailer must never be invoked",
	);
	assert.strictEqual(
		result.policy,
		"continue_after_source_failure",
		"spec: failed sources are escalated, then non-failed sources continue in degraded mode",
	);
	assert.deepStrictEqual(
		result.failures.map((failure) => failure.sourceId),
		["nco"],
	);
	assert.deepStrictEqual(
		result.successes.map((success) => success.sourceId),
		["jpcert"],
	);
	assert.strictEqual(result.escalatedIssueCalls[0], createIssueCall);
});

test("F001 crawler integrates StateBackendAdapter generation writes", async () => {
	const sources: SsotSource[] = [
		{
			id: "jpcert",
			name: "JPCERT/CC",
			url: "https://example.test/jpcert",
			description: "JPCERT source",
		},
	];
	const stateBackend = new RecordingStateBackend({
		last_execution: "2026-05-27T08:00:00.000Z",
		sources: {
			jpcert: {
				last_checked: "2026-05-27T08:00:00.000Z",
				content_hash: "oldhash",
				last_modified_header: "Wed, 27 May 2026 08:00:00 GMT",
			},
		},
	});
	let ifModifiedSince: string | null = null;
	const fakeFetcher: Fetcher = async (_input, init) => {
		ifModifiedSince = new Headers(init?.headers).get("if-modified-since");
		return new Response(
			"<html><body><main>Updated advisory</main></body></html>",
			{
				status: 200,
				headers: { "Last-Modified": "Wed, 27 May 2026 09:30:00 GMT" },
			},
		);
	};

	const result = await crawlSourcesWithFailureEscalation(sources, {
		mcpClient: { callTool: () => undefined },
		owner: "Ningensei848",
		repo: "kaname-vault",
		fetcher: fakeFetcher,
		stateBackend,
	});

	assert.strictEqual(result.policy, "continue_after_source_failure");
	assert.strictEqual(ifModifiedSince, "Wed, 27 May 2026 08:00:00 GMT");
	assert.strictEqual(stateBackend.loadCalls, 1);
	assert.strictEqual(stateBackend.saveCalls.length, 1);
	assert.strictEqual(stateBackend.saveCalls[0].ifGenerationMatch, "7");
	assert.strictEqual(
		stateBackend.saveCalls[0].state.sources.jpcert.last_modified_header,
		"Wed, 27 May 2026 09:30:00 GMT",
	);
	assert.notStrictEqual(
		stateBackend.saveCalls[0].state.sources.jpcert.content_hash,
		"oldhash",
	);
});

test("F001 crawler state generation conflict aborts safely via Issue", async () => {
	const sources: SsotSource[] = [
		{
			id: "jpcert",
			name: "JPCERT/CC",
			url: "https://example.test/jpcert",
			description: "JPCERT source",
		},
	];
	const stateBackend = new RecordingStateBackend({
		last_execution: "2026-05-27T08:00:00.000Z",
		sources: {},
	});
	stateBackend.conflictOnSave = true;
	const mcpCalls: McpToolCall[] = [];
	const fakeFetcher: Fetcher = async () =>
		new Response("<html><body><main>Updated advisory</main></body></html>", {
			status: 200,
		});

	const result = await crawlSourcesWithFailureEscalation(sources, {
		mcpClient: { callTool: (call) => mcpCalls.push(call) },
		owner: "Ningensei848",
		repo: "kaname-vault",
		fetcher: fakeFetcher,
		stateBackend,
		now: () => new Date("2026-05-27T09:30:00.000Z"),
		idFactory: () => 204,
	});

	assert.strictEqual(result.policy, "state_conflict_aborted");
	assert.strictEqual(mcpCalls.length, 1);
	assert.strictEqual(
		mcpCalls[0].params.arguments.title,
		"[System Error] Crawler State Conflict",
	);
	assert.match(mcpCalls[0].params.arguments.body, /安全に処理を中断/);
	assert.match(mcpCalls[0].params.arguments.body, /<unknown>/);
});

class RecordingStateBackend {
	public loadCalls = 0;
	public saveCalls: Array<{
		state: CrawlerState;
		ifGenerationMatch?: string | null;
	}> = [];
	public conflictOnSave = false;

	public constructor(private readonly state: CrawlerState) {}

	public async load() {
		this.loadCalls++;
		return { state: structuredClone(this.state), generation: "7" };
	}

	public async save(
		state: CrawlerState,
		options: { ifGenerationMatch?: string | null },
	) {
		this.saveCalls.push({ state: structuredClone(state), ...options });
		if (this.conflictOnSave) {
			throw new StateConflictError("stale write", {
				expectedGeneration: options.ifGenerationMatch ?? null,
				currentGeneration: null,
			});
		}
		return { state: structuredClone(state), generation: "8" };
	}
}
