export type OrchestratorState =
	| "INIT"
	| "MCP_READY"
	| "PROPOSED"
	| "REJECTED"
	| "MERGED"
	| "ESCALATED"
	| "FAILED"
	| "DONE";

export type OrchestratorEvent =
	| "diff_empty"
	| "diff_found"
	| "writer_success"
	| "deterministic_guard_failed"
	| "reviewer_approved"
	| "loop_remaining"
	| "loop_exhausted"
	| "fatal_error";

export type OrchestratorAction =
	| "exit_0"
	| "start_mcp"
	| "wait_ci"
	| "comment_reject"
	| "squash_merge"
	| "writer_revise"
	| "create_issue"
	| "cleanup_mcp";

export interface TransitionContext {
	loopCount: number;
	maxLoops: number;
	allGatesPassed: boolean;
	prExists: boolean;
}

export interface TransitionResult {
	next: OrchestratorState;
	actions: OrchestratorAction[];
}

export interface TransitionRecord {
	state: OrchestratorState;
	event: OrchestratorEvent;
	context: TransitionContext;
	result: TransitionResult;
}

export function transition(
	state: OrchestratorState,
	event: OrchestratorEvent,
	context: TransitionContext,
): TransitionResult {
	if (event === "fatal_error") {
		return { next: "FAILED", actions: ["create_issue", "cleanup_mcp"] };
	}
	if (context.loopCount >= context.maxLoops && state === "REJECTED") {
		return { next: "ESCALATED", actions: ["create_issue", "cleanup_mcp"] };
	}

	if (state === "INIT" && event === "diff_empty") {
		return { next: "DONE", actions: ["exit_0"] };
	}
	if (state === "INIT" && event === "diff_found") {
		return { next: "MCP_READY", actions: ["start_mcp"] };
	}
	if (state === "MCP_READY" && event === "writer_success" && context.prExists) {
		return { next: "PROPOSED", actions: ["wait_ci"] };
	}
	if (state === "PROPOSED" && event === "deterministic_guard_failed") {
		return { next: "REJECTED", actions: ["comment_reject"] };
	}
	if (
		state === "PROPOSED" &&
		event === "reviewer_approved" &&
		context.allGatesPassed
	) {
		return { next: "MERGED", actions: ["squash_merge", "cleanup_mcp"] };
	}
	if (
		state === "REJECTED" &&
		event === "loop_remaining" &&
		context.loopCount < context.maxLoops
	) {
		return { next: "PROPOSED", actions: ["writer_revise"] };
	}
	if (
		state === "REJECTED" &&
		event === "loop_exhausted" &&
		context.loopCount >= context.maxLoops
	) {
		return { next: "ESCALATED", actions: ["create_issue", "cleanup_mcp"] };
	}

	return { next: "FAILED", actions: ["create_issue", "cleanup_mcp"] };
}
