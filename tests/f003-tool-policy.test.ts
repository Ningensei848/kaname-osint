import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

import {
	allGreenMergePreconditions,
	type PolicyMcpToolCall,
	validateToolPolicy,
} from "../src/mcp/tool-policy";
import { AegisOrchestrator, type DiffResult } from "../src/orchestrator";

function readFixture(...segments: string[]): PolicyMcpToolCall {
	return JSON.parse(
		fs.readFileSync(
			path.join(__dirname, "fixtures", "f003", ...segments),
			"utf8",
		),
	) as PolicyMcpToolCall;
}

const changedDiff: DiffResult[] = [
	{ sourceId: "nco", hasChanged: true, content: "updated content" },
];

test("validateToolPolicy rejects broken F002 content guard verdict aggregation", () => {
	const call = readFixture("mcp", "valid", "merge-pull-request.json");

	assert.deepStrictEqual(
		validateToolPolicy(call, {
			...allGreenMergePreconditions,
			deterministicContentGuards: "failed",
		}),
		[
			"merge precondition deterministicContentGuards is failed",
			"merge preconditions are not all passed",
		],
	);
});

test("validateToolPolicy rejects indeterminate merge gates", () => {
	const call = readFixture("mcp", "valid", "merge-pull-request.json");

	assert.deepStrictEqual(
		validateToolPolicy(call, {
			...allGreenMergePreconditions,
			takumiGuard: "indeterminate",
		}),
		[
			"merge precondition takumiGuard is indeterminate",
			"merge preconditions are not all passed",
		],
	);
});

test("validateToolPolicy rejects disallowed writer branches and spec-external merge properties", () => {
	assert.ok(
		validateToolPolicy(
			readFixture("mcp", "invalid", "writer-main-branch.json"),
		).includes("Writer branch must be osint/*"),
	);

	const mergeCall = readFixture("mcp", "valid", "merge-pull-request.json");
	mergeCall.params.arguments.head = "main";
	assert.ok(
		validateToolPolicy(mergeCall).includes(
			"$.params.arguments.head: additional property is not allowed",
		),
	);
});

test("validateToolPolicy rejects disallowed writer paths", () => {
	assert.ok(
		validateToolPolicy(
			readFixture("mcp", "invalid", "writer-nested-topic-path.json"),
		).includes(
			"Writer path is not allowed: topics/bad/nested/sub/dir/exploit.md",
		),
	);
});

test("validateToolPolicy fails closed for invalid argument types and merge extras", () => {
	const writerCall = readFixture("mcp", "valid", "create-or-update-file.json");
	writerCall.params.arguments.branch = ["osint/content-update"];
	assert.ok(
		validateToolPolicy(writerCall).includes(
			"$.params.arguments.branch: expected type string",
		),
	);

	const mergeCall = readFixture("mcp", "valid", "merge-pull-request.json");
	mergeCall.params.arguments.base = "main";
	assert.ok(
		validateToolPolicy(mergeCall).includes(
			"$.params.arguments.base: additional property is not allowed",
		),
	);
});

test("AegisOrchestrator performs successful all-green squash merge through MCP", async () => {
	const calls: PolicyMcpToolCall[] = [];
	const orchestrator = new AegisOrchestrator(changedDiff, {
		mcpClient: {
			callTool: (call) => {
				calls.push(call);
			},
		},
		reviewProposal: () => ({
			approve: true,
			comment: "all deterministic gates passed",
			mergePreconditions: allGreenMergePreconditions,
		}),
	});

	const result = await orchestrator.run();

	assert.strictEqual(result.exitCode, 0);
	assert.strictEqual(orchestrator.prState?.status, "MERGED");
	assert.strictEqual(calls.length, 1);
	assert.strictEqual(calls[0].params.name, "merge_pull_request");
	assert.strictEqual(calls[0].params.arguments.merge_method, "squash");
	assert.deepStrictEqual(validateToolPolicy(calls[0]), []);
});

test("AegisOrchestrator blocks approved merges when any gate is indeterminate", async () => {
	const calls: PolicyMcpToolCall[] = [];
	const orchestrator = new AegisOrchestrator(changedDiff, {
		mcpClient: {
			callTool: (call) => {
				calls.push(call);
			},
		},
		reviewProposal: () => ({
			approve: true,
			comment: "reviewer approval is not enough without deterministic gates",
			mergePreconditions: {
				...allGreenMergePreconditions,
				ci: "indeterminate",
			},
		}),
	});

	const result = await orchestrator.run();

	assert.strictEqual(result.exitCode, 1);
	assert.strictEqual(orchestrator.state, "FAILED");
	assert.deepStrictEqual(calls, []);
	assert.match(result.reason, /Agreement failed|Orchestration failed/);
});
