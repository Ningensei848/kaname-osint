import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CrawlerState } from "../../types";
import type { StateBackendAdapter, StateSnapshot } from "../state";
import { StateConflictError } from "../state-errors";

export class LocalFileStateBackend
	implements StateBackendAdapter<CrawlerState>
{
	public constructor(private readonly filePath: string) {}

	public async load(): Promise<StateSnapshot<CrawlerState>> {
		return loadCrawlerStateSnapshotFromFile(this.filePath);
	}

	public async save(
		state: CrawlerState,
		options: { ifGenerationMatch?: string | null },
	): Promise<StateSnapshot<CrawlerState>> {
		const current = loadCrawlerStateSnapshotFromFile(this.filePath);
		if (
			options.ifGenerationMatch !== null &&
			options.ifGenerationMatch !== undefined &&
			options.ifGenerationMatch !== current.generation
		) {
			throw new StateConflictError("Local crawler state generation is stale", {
				expectedGeneration: options.ifGenerationMatch,
				currentGeneration: current.generation,
			});
		}

		saveCrawlerStateToFile(this.filePath, state);
		return loadCrawlerStateSnapshotFromFile(this.filePath);
	}
}

export function loadCrawlerStateSnapshotFromFile(
	filePath: string,
): StateSnapshot<CrawlerState> {
	if (!fs.existsSync(filePath)) {
		return { state: createInitialState(), generation: null };
	}

	try {
		const raw = fs.readFileSync(filePath, "utf8");
		const state = parseState(raw);
		if (state) {
			return { state, generation: calculateLocalGeneration(raw) };
		}
	} catch (error) {
		console.warn(
			`Failed to parse crawler state file at ${filePath}. Starting with initial state. Error: ${(error as Error).message}`,
		);
	}

	return { state: createInitialState(), generation: null };
}

export function loadCrawlerStateFromFile(filePath: string): CrawlerState {
	return loadCrawlerStateSnapshotFromFile(filePath).state;
}

export function saveCrawlerStateToFile(
	filePath: string,
	state: CrawlerState,
): void {
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
}

function calculateLocalGeneration(raw: string): string {
	return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

function createInitialState(): CrawlerState {
	return {
		last_execution: new Date(0).toISOString(),
		sources: {},
	};
}

function parseState(raw: string): CrawlerState | null {
	const parsed = JSON.parse(raw);
	if (
		parsed &&
		typeof parsed === "object" &&
		"sources" in parsed &&
		parsed.sources &&
		typeof parsed.sources === "object"
	) {
		return parsed as CrawlerState;
	}

	return null;
}
