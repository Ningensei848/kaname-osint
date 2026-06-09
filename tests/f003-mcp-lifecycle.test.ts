/**
 * F003 MCP process lifecycle cleanup tests.
 *
 * The harness below is a deterministic model of the lifecycle contract in
 * `.spec/features/003-orchestrator-mcp-review-loop/spec.md`: MCP child
 * processes must be cleaned up on normal completion, merge, escalation,
 * fatal errors, SIGTERM, timeout, and repeated cleanup attempts.
 */

import * as assert from "node:assert";
import { test } from "node:test";

type TerminalReason =
	| "DONE"
	| "MERGED"
	| "ESCALATED"
	| "FAILED"
	| "SIGTERM"
	| "TIMEOUT";

class FakeMcpChildProcess {
	public killed = false;
	public killSignal: NodeJS.Signals | null = null;
	public killCalls = 0;
	public resources = new Set(["stdin", "stdout", "stderr"]);
	private readonly handlers = new Map<string, Array<() => void>>();

	public once(event: string, handler: () => void): void {
		this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
	}

	public emit(event: string): void {
		const handlers = this.handlers.get(event) ?? [];
		this.handlers.set(event, []);
		for (const handler of handlers) handler();
	}

	public kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
		this.killCalls++;
		this.killed = true;
		this.killSignal = signal;
		this.resources.clear();
		this.emit("exit");
		return true;
	}
}

class McpLifecycleHarness {
	public readonly child = new FakeMcpChildProcess();
	public cleanupReasons: TerminalReason[] = [];
	private cleaned = false;
	private timeout: NodeJS.Timeout | null = null;

	public start(timeoutMs = 30_000): void {
		this.timeout = setTimeout(() => this.cleanup("TIMEOUT"), timeoutMs);
		this.child.once("error", () => this.cleanup("FAILED"));
	}

	public cleanup(reason: TerminalReason): void {
		if (this.cleaned) return;
		this.cleaned = true;
		this.cleanupReasons.push(reason);
		if (this.timeout) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}
		if (!this.child.killed) this.child.kill("SIGTERM");
	}

	public onSigterm(): void {
		this.cleanup("SIGTERM");
	}

	public onFatalError(): void {
		this.cleanup("FAILED");
	}

	public isResourceClean(): boolean {
		return (
			this.child.killed &&
			this.child.resources.size === 0 &&
			this.timeout === null
		);
	}
}

test("F003 MCP lifecycle cleanup contract", async (t) => {
	for (const reason of ["DONE", "MERGED", "ESCALATED", "FAILED"] as const) {
		await t.test(
			`${reason} terminates MCP exactly once and releases resources`,
			() => {
				const lifecycle = new McpLifecycleHarness();
				lifecycle.start();

				lifecycle.cleanup(reason);
				lifecycle.cleanup(reason);

				assert.strictEqual(lifecycle.child.killCalls, 1);
				assert.deepStrictEqual(lifecycle.cleanupReasons, [reason]);
				assert.strictEqual(lifecycle.child.killSignal, "SIGTERM");
				assert.strictEqual(lifecycle.isResourceClean(), true);
			},
		);
	}

	await t.test(
		"SIGTERM cleanup is idempotent and wins over later normal completion",
		() => {
			const lifecycle = new McpLifecycleHarness();
			lifecycle.start();

			lifecycle.onSigterm();
			lifecycle.cleanup("MERGED");

			assert.deepStrictEqual(lifecycle.cleanupReasons, ["SIGTERM"]);
			assert.strictEqual(lifecycle.child.killCalls, 1);
			assert.strictEqual(lifecycle.isResourceClean(), true);
		},
	);

	await t.test("timeout cleanup kills a hung MCP process", async () => {
		const lifecycle = new McpLifecycleHarness();
		lifecycle.start(10);

		await new Promise((resolve) => setTimeout(resolve, 50));

		assert.deepStrictEqual(lifecycle.cleanupReasons, ["TIMEOUT"]);
		assert.strictEqual(lifecycle.child.killCalls, 1);
		assert.strictEqual(lifecycle.isResourceClean(), true);
	});

	await t.test("uncaught fatal errors trigger failed cleanup", () => {
		const lifecycle = new McpLifecycleHarness();
		lifecycle.start();

		lifecycle.onFatalError();

		assert.deepStrictEqual(lifecycle.cleanupReasons, ["FAILED"]);
		assert.strictEqual(lifecycle.child.killCalls, 1);
		assert.strictEqual(lifecycle.isResourceClean(), true);
	});
});

test.todo(
	"F003 AegisOrchestrator wires real MCP child cleanup to DONE/MERGED/ESCALATED/FAILED/SIGTERM/TIMEOUT",
);
test.todo(
	"F003 integration test spawns a real dummy child process and verifies process.on('SIGTERM') cleanup over actual OS signals and stdio resources",
);
