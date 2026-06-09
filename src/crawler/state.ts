import * as crypto from "node:crypto";
import type { CrawlerState } from "../types";
import {
	loadCrawlerStateFromFile,
	saveCrawlerStateToFile,
} from "./state-backends/local";

export interface StateSnapshot<T> {
	state: T;
	generation: string | null;
}

export interface SaveStateOptions {
	ifGenerationMatch?: string | null;
}

export interface StateBackendAdapter<T> {
	load(): Promise<StateSnapshot<T>>;
	save(state: T, options: SaveStateOptions): Promise<StateSnapshot<T>>;
}

export { StateConflictError } from "./state-errors";
export function createInitialCrawlerState(): CrawlerState {
	return {
		last_execution: new Date(0).toISOString(),
		sources: {},
	};
}

export function parseCrawlerState(raw: string): CrawlerState | null {
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

export function calculateHash(content: string): string {
	return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function loadCrawlerState(filePath: string): CrawlerState {
	return loadCrawlerStateFromFile(filePath);
}

export function saveCrawlerState(filePath: string, state: CrawlerState): void {
	saveCrawlerStateToFile(filePath, state);
}

export function updateSourceState(
	state: CrawlerState,
	sourceId: string,
	contentHash: string,
	lastModifiedHeader: string | null,
): CrawlerState {
	const now = new Date().toISOString();

	const sourcesUpdate = {
		...state.sources,
		[sourceId]: {
			last_checked: now,
			content_hash: contentHash,
			last_modified_header: lastModifiedHeader,
		},
	};

	return {
		last_execution: now,
		sources: sourcesUpdate,
	};
}
