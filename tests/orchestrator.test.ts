/**
 * tests/orchestrator.test.ts
 *
 * Covers: spec.md §5.4 (Cooperative Loop), §5.6 (Failure Escalation),
 * business-rules.md §5 (Review Control), agent-logic.md §1 (Orchestrator Logic)
 */

import * as assert from "node:assert";
import { test } from "node:test";
import { allGreenMergePreconditions } from "../src/mcp/tool-policy";
import { AegisOrchestrator, type DiffResult } from "../src/orchestrator";
import {
	type OrchestratorEvent,
	type OrchestratorState,
	type TransitionContext,
	transition,
} from "../src/orchestrator/state-machine";

interface EventStep {
	state: OrchestratorState;
	event: OrchestratorEvent;
	context: TransitionContext;
	expectedNext: OrchestratorState;
}

const baseContext: TransitionContext = {
	loopCount: 0,
	maxLoops: 3,
	allGatesPassed: true,
	prExists: true,
};

function assertEventSequence(name: string, steps: EventStep[]): void {
	for (const [index, step] of steps.entries()) {
		const result = transition(step.state, step.event, step.context);
		assert.strictEqual(
			result.next,
			step.expectedNext,
			`${name} step ${index + 1}: ${step.state} + ${step.event}`,
		);
	}
}

test("orchestrator contract is expressed as transition-table event sequences", async (t) => {
	await t.test("diff_empty exits without MCP startup", () => {
		assertEventSequence("diff_empty", [
			{
				state: "INIT",
				event: "diff_empty",
				context: { ...baseContext, prExists: false },
				expectedNext: "DONE",
			},
		]);
	});

	await t.test("diff_found then writer_success proposes a PR", () => {
		assertEventSequence("writer proposal", [
			{
				state: "INIT",
				event: "diff_found",
				context: { ...baseContext, prExists: false },
				expectedNext: "MCP_READY",
			},
			{
				state: "MCP_READY",
				event: "writer_success",
				context: { ...baseContext, loopCount: 1 },
				expectedNext: "PROPOSED",
			},
		]);
	});

	await t.test("reviewer_approved merges only after all gates pass", () => {
		assertEventSequence("approved merge", [
			{
				state: "PROPOSED",
				event: "reviewer_approved",
				context: { ...baseContext, loopCount: 1, allGatesPassed: true },
				expectedNext: "MERGED",
			},
		]);
	});

	await t.test(
		"deterministic_guard_failed rejects, then loop_remaining revises",
		() => {
			assertEventSequence("single rejection revision", [
				{
					state: "PROPOSED",
					event: "deterministic_guard_failed",
					context: { ...baseContext, loopCount: 1, allGatesPassed: false },
					expectedNext: "REJECTED",
				},
				{
					state: "REJECTED",
					event: "loop_remaining",
					context: { ...baseContext, loopCount: 1, allGatesPassed: false },
					expectedNext: "PROPOSED",
				},
			]);
		},
	);

	await t.test("loop >= 3 escalates through the transition table", () => {
		assertEventSequence("loop exhausted", [
			{
				state: "REJECTED",
				event: "loop_exhausted",
				context: { ...baseContext, loopCount: 3, allGatesPassed: false },
				expectedNext: "ESCALATED",
			},
		]);
	});

	await t.test("fatal_error fails from any active state", () => {
		for (const state of [
			"INIT",
			"MCP_READY",
			"PROPOSED",
			"REJECTED",
		] as const) {
			assertEventSequence(`fatal from ${state}`, [
				{
					state,
					event: "fatal_error",
					context: { ...baseContext, loopCount: state === "INIT" ? 0 : 1 },
					expectedNext: "FAILED",
				},
			]);
		}
	});
});

test("AegisOrchestrator consumes transition table records for integration flow", async () => {
	const changedDiff: DiffResult[] = [
		{
			sourceId: "nco",
			hasChanged: true,
			content: "New cabinet decision details",
		},
	];

	const orchestrator = new AegisOrchestrator(changedDiff, {
		reviewProposal: (loop: number) => {
			if (loop === 1) {
				return {
					approve: false,
					comment: "Missing inbound link for orphan NICT note",
					mergePreconditions: {
						...allGreenMergePreconditions,
						deterministicContentGuards: "failed",
					},
				};
			}
			return {
				approve: true,
				comment: "Link fixed. Approved.",
				mergePreconditions: allGreenMergePreconditions,
			};
		},
	});

	const result = await orchestrator.run();

	assert.strictEqual(result.exitCode, 0);
	assert.strictEqual(orchestrator.state, "MERGED");
	assert.strictEqual(orchestrator.prState?.status, "MERGED");
	assert.deepStrictEqual(
		orchestrator.transitionHistory.map((record) => [
			record.state,
			record.event,
			record.result.next,
			record.result.actions,
		]),
		[
			["INIT", "diff_found", "MCP_READY", ["start_mcp"]],
			["MCP_READY", "writer_success", "PROPOSED", ["wait_ci"]],
			[
				"PROPOSED",
				"deterministic_guard_failed",
				"REJECTED",
				["comment_reject"],
			],
			["REJECTED", "loop_remaining", "PROPOSED", ["writer_revise"]],
			[
				"PROPOSED",
				"reviewer_approved",
				"MERGED",
				["squash_merge", "cleanup_mcp"],
			],
		],
	);

	for (const record of orchestrator.transitionHistory) {
		assert.deepStrictEqual(
			record.result,
			transition(record.state, record.event, record.context),
		);
	}
});

test("AegisOrchestrator escalates repeated guard failures via loop_exhausted", async () => {
	const changedDiff: DiffResult[] = [
		{
			sourceId: "jpcert",
			hasChanged: true,
			content: "Critical malware notice",
		},
	];

	const orchestrator = new AegisOrchestrator(changedDiff, {
		reviewProposal: () => ({
			approve: false,
			comment: "OFM layout violation: tags are malformed.",
			mergePreconditions: {
				...allGreenMergePreconditions,
				deterministicContentGuards: "failed",
			},
		}),
	});

	const result = await orchestrator.run();

	assert.strictEqual(result.exitCode, 1);
	assert.strictEqual(orchestrator.state, "ESCALATED");
	assert.strictEqual(orchestrator.loopCount, 3);
	assert.deepStrictEqual(orchestrator.transitionHistory.at(-1), {
		state: "REJECTED",
		event: "loop_exhausted",
		context: {
			loopCount: 3,
			maxLoops: 3,
			allGatesPassed: false,
			prExists: true,
		},
		result: {
			next: "ESCALATED",
			actions: ["create_issue", "cleanup_mcp"],
		},
	});
	assert.ok(orchestrator.raisedIssue, "System must raise an Issue");
	assert.strictEqual(orchestrator.prState?.status, "OPEN");
});
