import { crawlSource, type Fetcher } from "./crawler/fetch";
import {
	calculateHash,
	StateConflictError,
	type StateBackendAdapter,
	updateSourceState,
} from "./crawler/state";
import type { CrawlerState, SsotSource } from "./types";
import {
	allGreenMergePreconditions,
	type GateStatus,
	type MergePreconditions,
	type PolicyMcpToolCall,
	validateToolPolicy,
} from "./mcp/tool-policy";
import {
	type OrchestratorState,
	type OrchestratorEvent,
	type TransitionContext,
	type TransitionRecord,
	transition,
} from "./orchestrator/state-machine";

export type OrchestratorGateStatus = GateStatus;
export type OrchestratorMergePreconditions = MergePreconditions;
export const defaultMergePreconditions = allGreenMergePreconditions;
export const validateOrchestratorToolPolicy = validateToolPolicy;

export interface McpToolCall extends PolicyMcpToolCall {
	params: {
		name: "create_issue";
		arguments: {
			owner: string;
			repo: string;
			title: string;
			body: string;
		};
	};
}

export interface McpClient {
	callTool: (call: McpToolCall) => Promise<unknown> | unknown;
}

export interface ToolMcpClient {
	callTool: (call: PolicyMcpToolCall) => Promise<unknown> | unknown;
}

export interface CrawlerEscalationDependencies {
	mcpClient: McpClient;
	owner: string;
	repo: string;
	fetcher?: Fetcher;
	stateBackend?: StateBackendAdapter<CrawlerState>;
	now?: () => Date;
	idFactory?: () => number;
	thirdPartyMailer?: { send: (message: unknown) => Promise<unknown> | unknown };
}

export interface CrawlerSourceSuccess {
	sourceId: string;
	content: string;
	lastModifiedHeader: string | null;
	isNotModified: boolean;
}

export interface CrawlerSourceFailure {
	sourceId: string;
	error: Error;
}

export interface CrawlerEscalationResult {
	policy: "continue_after_source_failure" | "state_conflict_aborted";
	successes: CrawlerSourceSuccess[];
	failures: CrawlerSourceFailure[];
	escalatedIssueCalls: McpToolCall[];
}

export interface DiffResult {
	sourceId: string;
	hasChanged: boolean;
	content: string;
}

export interface ReviewResult {
	approve: boolean;
	comment: string;
	mergePreconditions: MergePreconditions;
}

export interface PRState {
	prNumber: number;
	status: "OPEN" | "CLOSED" | "MERGED";
	commits: string[];
	approved: boolean;
	head?: string;
	base?: string;
}

export interface OrchestrationResult {
	exitCode: 0 | 1;
	reason: string;
}

export type ExecutionStatus =
	| "PENDING"
	| "PROPOSED"
	| "APPROVED"
	| "REJECTED"
	| "ESCALATED";

export interface OrchestratorDependencies {
	startMcp?: () => Promise<void> | void;
	mcpClient?: ToolMcpClient;
	owner?: string;
	repo?: string;
	writeProposal?: (
		loop: number,
		currentPr: PRState | null,
		diffData: DiffResult[],
	) => Promise<PRState> | PRState;
	reviewProposal: (
		loop: number,
		prState: PRState,
	) => Promise<ReviewResult> | ReviewResult;
	raiseIssue?: (
		loopCount: number,
		prState: PRState | null,
	) =>
		| Promise<{ title: string; body: string }>
		| { title: string; body: string };
}

export class AegisOrchestrator {
	public loopCount = 0;
	public readonly maxLoops: number;
	public prState: PRState | null = null;
	public state: OrchestratorState = "INIT";
	public executionStatus: ExecutionStatus = "PENDING";
	public raisedIssue: { title: string; body: string } | null = null;
	public launchedMcp = false;
	public readonly transitionHistory: TransitionRecord[] = [];

	public constructor(
		private readonly diffData: DiffResult[],
		private readonly dependencies: OrchestratorDependencies,
		maxLoops = 3,
	) {
		this.maxLoops = maxLoops;
	}

	public async run(): Promise<OrchestrationResult> {
		try {
			const hasAnyChange = this.diffData.some((diff) => diff.hasChanged);
			if (!hasAnyChange) {
				this.applyTransition("diff_empty");
				return { exitCode: 0, reason: "No changes detected. Idempotent skip." };
			}

			this.applyTransition("diff_found");
			this.launchedMcp = this.state === "MCP_READY";
			await this.dependencies.startMcp?.();

			this.loopCount++;
			this.prState = await this.runWriter(this.loopCount);
			this.applyTransition("writer_success");

			for (;;) {
				if (this.state !== "PROPOSED") {
					break;
				}

				const review = this.requireDeterministicReview(
					await this.dependencies.reviewProposal(this.loopCount, this.prState),
				);
				const allGatesPassed = areMergePreconditionsPassed(
					review.mergePreconditions,
				);
				const mergeCall = review.approve
					? this.buildMergePullRequestCall()
					: null;
				const policyErrors = mergeCall
					? validateToolPolicy(mergeCall, review.mergePreconditions)
					: [];

				if (review.approve && policyErrors.length > 0) {
					this.applyTransition("fatal_error", false);
					break;
				}

				const reviewState = this.applyTransition(
					review.approve ? "reviewer_approved" : "deterministic_guard_failed",
					allGatesPassed,
				);

				if (reviewState === "MERGED" && mergeCall) {
					await this.mergePr(mergeCall);
					return {
						exitCode: 0,
						reason: "Consensus reached and merged successfully.",
					};
				}

				if (reviewState !== "REJECTED") {
					break;
				}

				const loopEvent: OrchestratorEvent =
					this.loopCount >= this.maxLoops ? "loop_exhausted" : "loop_remaining";
				const loopState = this.applyTransition(loopEvent, review.approve);

				if (loopState === "PROPOSED") {
					this.loopCount++;
					this.prState = await this.runWriter(this.loopCount);
				}
			}

			if (this.state === "ESCALATED" || this.state === "FAILED") {
				this.raisedIssue = await this.raiseIssue();
				return {
					exitCode: 1,
					reason: "Agreement failed. Escalated via Issue.",
				};
			}

			this.applyTransition("fatal_error");
			this.raisedIssue = await this.raiseIssue();
			return { exitCode: 1, reason: "Orchestration failed." };
		} catch (error) {
			if (this.state !== "FAILED") {
				this.applyTransition("fatal_error");
			}
			this.raisedIssue = await this.raiseIssue();
			const message = error instanceof Error ? error.message : "Unknown error";
			return { exitCode: 1, reason: `Orchestration failed: ${message}` };
		}
	}

	private applyTransition(
		event: OrchestratorEvent,
		allGatesPassed = true,
	): OrchestratorState {
		const context = this.currentTransitionContext(allGatesPassed);
		const state = this.state;
		const result = transition(state, event, context);
		this.transitionHistory.push({ state, event, context, result });
		this.state = result.next;
		this.executionStatus = this.executionStatusFor(result.next);
		return result.next;
	}

	private currentTransitionContext(allGatesPassed: boolean): TransitionContext {
		return {
			loopCount: this.loopCount,
			maxLoops: this.maxLoops,
			allGatesPassed,
			prExists: this.prState !== null,
		};
	}

	private executionStatusFor(state: OrchestratorState): ExecutionStatus {
		if (state === "PROPOSED") {
			return "PROPOSED";
		}
		if (state === "REJECTED") {
			return "REJECTED";
		}
		if (state === "MERGED") {
			return "APPROVED";
		}
		if (state === "ESCALATED" || state === "FAILED") {
			return "ESCALATED";
		}
		return "PENDING";
	}

	private async mergePr(mergeCall: PolicyMcpToolCall): Promise<void> {
		if (!this.prState) {
			return;
		}
		await this.dependencies.mcpClient?.callTool(mergeCall);
		this.prState.approved = true;
		this.prState.status = "MERGED";
	}

	private buildMergePullRequestCall(): PolicyMcpToolCall {
		if (!this.prState) {
			throw new Error("Cannot build merge_pull_request without a PR");
		}
		return {
			jsonrpc: "2.0",
			method: "tools/call",
			params: {
				name: "merge_pull_request",
				arguments: {
					owner: this.dependencies.owner ?? "Ningensei848",
					repo: this.dependencies.repo ?? "kaname-vault",
					pull_number: this.prState.prNumber,
					merge_method: "squash",
					commit_title:
						"[Aegis-Reviewer] Self-Merge: Intelligence Update Passed Review",
				},
			},
			id: 103,
		};
	}

	private requireDeterministicReview(review: ReviewResult): ReviewResult {
		const verdicts = review.mergePreconditions;
		if (!verdicts) {
			throw new Error(
				"Reviewer must return deterministic merge precondition verdicts",
			);
		}
		for (const key of Object.keys(allGreenMergePreconditions)) {
			const status = verdicts[key as keyof MergePreconditions];
			if (!isGateStatus(status)) {
				throw new Error(
					`Reviewer merge precondition ${key} is missing or invalid`,
				);
			}
		}
		return review;
	}

	private async runWriter(loop: number): Promise<PRState> {
		if (this.dependencies.writeProposal) {
			return this.dependencies.writeProposal(loop, this.prState, this.diffData);
		}

		if (!this.prState) {
			return {
				prNumber: 42,
				status: "OPEN",
				commits: ["Initial intelligence commit"],
				approved: false,
			};
		}

		return {
			...this.prState,
			commits: [...this.prState.commits, `Revision commit ${loop}`],
		};
	}

	private async raiseIssue(): Promise<{ title: string; body: string }> {
		if (this.dependencies.raiseIssue) {
			return this.dependencies.raiseIssue(this.loopCount, this.prState);
		}

		return {
			title: "[System Error] Cooperative agent loop exceeded max limit",
			body: `Review loop failed to resolve after ${this.loopCount} iterations.`,
		};
	}
}

function areMergePreconditionsPassed(
	preconditions: MergePreconditions,
): boolean {
	return Object.values(preconditions).every((status) => status === "passed");
}

function isGateStatus(status: unknown): status is GateStatus {
	return (
		status === "passed" ||
		status === "failed" ||
		status === "unavailable" ||
		status === "indeterminate"
	);
}

export async function runOrchestration(
	diffData: DiffResult[],
	dependencies: OrchestratorDependencies,
	maxLoops = 3,
): Promise<{ orchestrator: AegisOrchestrator; result: OrchestrationResult }> {
	const orchestrator = new AegisOrchestrator(diffData, dependencies, maxLoops);
	const result = await orchestrator.run();
	return { orchestrator, result };
}

if (require.main === module) {
	console.log(
		"kaname orchestrator module loaded. Use runOrchestration() from Cloud Run entrypoint wiring.",
	);
}

export async function crawlSourcesWithFailureEscalation(
	sources: SsotSource[],
	dependencies: CrawlerEscalationDependencies,
): Promise<CrawlerEscalationResult> {
	const successes: CrawlerSourceSuccess[] = [];
	const failures: CrawlerSourceFailure[] = [];
	const escalatedIssueCalls: McpToolCall[] = [];
	const stateSnapshot = await dependencies.stateBackend?.load();
	let nextState = stateSnapshot?.state;

	for (const source of sources) {
		try {
			const previousSourceState = nextState?.sources[source.id];
			const result = await crawlSource(
				source,
				previousSourceState?.last_modified_header ?? null,
				{
					fetcher: dependencies.fetcher,
					retries: 3,
					delayMs: 0,
				},
			);
			successes.push({ sourceId: source.id, ...result });

			if (nextState && !result.isNotModified) {
				nextState = updateSourceState(
					nextState,
					source.id,
					calculateHash(result.content),
					result.lastModifiedHeader,
				);
			}
		} catch (error) {
			const normalizedError =
				error instanceof Error ? error : new Error(String(error));
			failures.push({ sourceId: source.id, error: normalizedError });
			const issueCall = buildCrawlerFailureIssueCall(
				source,
				normalizedError,
				dependencies,
			);
			escalatedIssueCalls.push(issueCall);
			await dependencies.mcpClient.callTool(issueCall);
		}
	}

	if (dependencies.stateBackend && nextState && stateSnapshot) {
		try {
			await dependencies.stateBackend.save(nextState, {
				ifGenerationMatch: stateSnapshot.generation,
			});
		} catch (error) {
			if (!(error instanceof StateConflictError)) {
				throw error;
			}

			console.warn(
				`Crawler state save conflict. Safe abort to prevent duplicate downstream work. Expected generation: ${error.expectedGeneration ?? "<none>"}. Current generation: ${error.currentGeneration ?? "<unknown>"}.`,
			);
			const issueCall = buildCrawlerStateConflictIssueCall(error, dependencies);
			escalatedIssueCalls.push(issueCall);
			await dependencies.mcpClient.callTool(issueCall);

			return {
				policy: "state_conflict_aborted",
				successes,
				failures,
				escalatedIssueCalls,
			};
		}
	}

	return {
		policy: "continue_after_source_failure",
		successes,
		failures,
		escalatedIssueCalls,
	};
}

function buildCrawlerStateConflictIssueCall(
	error: StateConflictError,
	dependencies: CrawlerEscalationDependencies,
): McpToolCall {
	const now = dependencies.now?.() ?? new Date();
	return {
		jsonrpc: "2.0",
		method: "tools/call",
		params: {
			name: "create_issue",
			arguments: {
				owner: dependencies.owner,
				repo: dependencies.repo,
				title: "[System Error] Crawler State Conflict",
				body: [
					"## crawler-state.json 世代競合",
					`- **発生日時**: ${now.toISOString()}`,
					`- **期待 generation**: ${error.expectedGeneration ?? "<none>"}`,
					`- **現在 generation**: ${error.currentGeneration ?? "<unknown>"}`,
					"- **ステータス**: 重複 Writer / MCP 実行とコスト暴走を防ぐため、安全に処理を中断しました。",
				].join("\n"),
			},
		},
		id: dependencies.idFactory?.() ?? 104,
	};
}

function buildCrawlerFailureIssueCall(
	source: SsotSource,
	error: Error,
	dependencies: CrawlerEscalationDependencies,
): McpToolCall {
	const now = dependencies.now?.() ?? new Date();
	return {
		jsonrpc: "2.0",
		method: "tools/call",
		params: {
			name: "create_issue",
			arguments: {
				owner: dependencies.owner,
				repo: dependencies.repo,
				title: `[System Error] Crawling Failed for ID: ${source.id}`,
				body: [
					"## 障害発生報告",
					`- **発生日時**: ${now.toISOString()}`,
					`- **対象ソース**: ${source.name}`,
					`- **エラー内容**: ${error.message}`,
					"- **ステータス**: 縮退運転を継続中です。GCP Cloud Loggingおよび接続ステータスを確認してください。",
				].join("\n"),
			},
		},
		id: dependencies.idFactory?.() ?? 104,
	};
}
