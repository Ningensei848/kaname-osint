/**
 * F003 explicit state-transition table tests.
 *
 * The table mirrors `.spec/features/003-orchestrator-mcp-review-loop/spec.md`
 * and provides an executable oracle for the future production state machine.
 */

import * as assert from "node:assert";
import { test } from "node:test";

import {
	type OrchestratorEvent,
	type OrchestratorState,
	type TransitionContext,
	type TransitionResult,
	transition,
} from "../src/orchestrator/state-machine";

test("F003 explicit orchestrator state transition table", async (t) => {
	const baseContext: TransitionContext = {
		loopCount: 0,
		maxLoops: 3,
		allGatesPassed: true,
		prExists: true,
	};

	const cases: Array<
		[OrchestratorState, OrchestratorEvent, TransitionContext, TransitionResult]
	> = [
		["INIT", "diff_empty", baseContext, { next: "DONE", actions: ["exit_0"] }],
		[
			"INIT",
			"diff_found",
			baseContext,
			{ next: "MCP_READY", actions: ["start_mcp"] },
		],
		[
			"MCP_READY",
			"writer_success",
			baseContext,
			{ next: "PROPOSED", actions: ["wait_ci"] },
		],
		[
			"PROPOSED",
			"deterministic_guard_failed",
			baseContext,
			{ next: "REJECTED", actions: ["comment_reject"] },
		],
		[
			"PROPOSED",
			"reviewer_approved",
			baseContext,
			{ next: "MERGED", actions: ["squash_merge", "cleanup_mcp"] },
		],
		[
			"REJECTED",
			"loop_remaining",
			{ ...baseContext, loopCount: 2 },
			{ next: "PROPOSED", actions: ["writer_revise"] },
		],
		[
			"REJECTED",
			"loop_exhausted",
			{ ...baseContext, loopCount: 3 },
			{ next: "ESCALATED", actions: ["create_issue", "cleanup_mcp"] },
		],
		[
			"INIT",
			"fatal_error",
			baseContext,
			{ next: "FAILED", actions: ["create_issue", "cleanup_mcp"] },
		],
		[
			"MCP_READY",
			"fatal_error",
			baseContext,
			{ next: "FAILED", actions: ["create_issue", "cleanup_mcp"] },
		],
		[
			"PROPOSED",
			"fatal_error",
			baseContext,
			{ next: "FAILED", actions: ["create_issue", "cleanup_mcp"] },
		],
		[
			"REJECTED",
			"fatal_error",
			baseContext,
			{ next: "FAILED", actions: ["create_issue", "cleanup_mcp"] },
		],
	];

	for (const [state, event, context, expected] of cases) {
		await t.test(`${state} + ${event} -> ${expected.next}`, () => {
			assert.deepStrictEqual(transition(state, event, context), expected);
		});
	}

	await t.test("reviewer_approved cannot merge when any gate is false", () => {
		assert.deepStrictEqual(
			transition("PROPOSED", "reviewer_approved", {
				...baseContext,
				allGatesPassed: false,
			}),
			{ next: "FAILED", actions: ["create_issue", "cleanup_mcp"] },
		);
	});

	await t.test(
		"loop counter invariant escalates even if loop_remaining is emitted after maxLoops",
		() => {
			assert.deepStrictEqual(
				transition("REJECTED", "loop_remaining", {
					...baseContext,
					loopCount: 4,
				}),
				{ next: "ESCALATED", actions: ["create_issue", "cleanup_mcp"] },
			);
		},
	);
});
