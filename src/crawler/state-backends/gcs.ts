import type { CrawlerState } from "../../types";
import {
	createInitialCrawlerState,
	parseCrawlerState,
	type SaveStateOptions,
	type StateBackendAdapter,
	type StateSnapshot,
} from "../state";
import { StateConflictError } from "../state-errors";

export type FetchLike = (
	input: string | URL,
	init?: RequestInit,
) => Promise<Response>;

export interface GcsStateBackendOptions {
	bucket: string;
	objectName?: string;
	fetch?: FetchLike;
	accessToken?: string;
	headers?: HeadersInit;
	apiBaseUrl?: string;
	uploadBaseUrl?: string;
}

export class GcsStateBackend implements StateBackendAdapter<CrawlerState> {
	private readonly objectName: string;
	private readonly fetchFn: FetchLike;
	private readonly apiBaseUrl: string;
	private readonly uploadBaseUrl: string;

	public constructor(private readonly options: GcsStateBackendOptions) {
		this.objectName = options.objectName ?? "crawler-state.json";
		this.fetchFn = options.fetch ?? fetch;
		this.apiBaseUrl =
			options.apiBaseUrl ?? "https://storage.googleapis.com/storage/v1";
		this.uploadBaseUrl =
			options.uploadBaseUrl ??
			"https://storage.googleapis.com/upload/storage/v1";
	}

	public async load(): Promise<StateSnapshot<CrawlerState>> {
		const response = await this.fetchFn(this.mediaUrl(), {
			method: "GET",
			headers: this.requestHeaders(),
		});

		if (response.status === 404) {
			return { state: createInitialCrawlerState(), generation: null };
		}

		if (!response.ok) {
			throw new Error(
				`Failed to load crawler state from GCS (${response.status} ${response.statusText})`,
			);
		}

		const raw = await response.text();
		let state: CrawlerState | null;
		try {
			state = parseCrawlerState(raw);
		} catch (error) {
			throw new Error(
				`Failed to parse existing crawler state from GCS: ${(error as Error).message}`,
			);
		}

		if (!state) {
			throw new Error("Existing crawler state object in GCS is invalid");
		}

		return {
			state,
			generation: response.headers.get("x-goog-generation"),
		};
	}

	public async save(
		state: CrawlerState,
		options: SaveStateOptions,
	): Promise<StateSnapshot<CrawlerState>> {
		const response = await this.fetchFn(
			this.uploadUrl(options.ifGenerationMatch),
			{
				method: "POST",
				headers: this.requestHeaders({ "content-type": "application/json" }),
				body: JSON.stringify(state),
			},
		);

		if (response.status === 409 || response.status === 412) {
			throw new StateConflictError("GCS crawler state generation is stale", {
				expectedGeneration: options.ifGenerationMatch ?? null,
				currentGeneration: response.headers.get("x-goog-generation"),
				cause: await safeResponseBody(response),
			});
		}

		if (!response.ok) {
			throw new Error(
				`Failed to save crawler state to GCS (${response.status} ${response.statusText})`,
			);
		}

		const metadata = await parseOptionalJson(response);
		return {
			state,
			generation:
				readGeneration(metadata) ?? response.headers.get("x-goog-generation"),
		};
	}

	private mediaUrl(): string {
		const url = new URL(
			`${this.apiBaseUrl}/b/${encodeURIComponent(this.options.bucket)}/o/${encodeURIComponent(this.objectName)}`,
		);
		url.searchParams.set("alt", "media");
		return url.toString();
	}

	private uploadUrl(ifGenerationMatch?: string | null): string {
		const url = new URL(
			`${this.uploadBaseUrl}/b/${encodeURIComponent(this.options.bucket)}/o`,
		);
		url.searchParams.set("uploadType", "media");
		url.searchParams.set("name", this.objectName);
		if (ifGenerationMatch !== null && ifGenerationMatch !== undefined) {
			url.searchParams.set("ifGenerationMatch", ifGenerationMatch);
		}
		return url.toString();
	}

	private requestHeaders(extra: HeadersInit = {}): HeadersInit {
		const headers = new Headers(this.options.headers);
		if (this.options.accessToken) {
			headers.set("authorization", `Bearer ${this.options.accessToken}`);
		}

		for (const [key, value] of new Headers(extra)) {
			headers.set(key, value);
		}

		return headers;
	}
}

async function safeResponseBody(response: Response): Promise<string | null> {
	try {
		return await response.text();
	} catch {
		return null;
	}
}

async function parseOptionalJson(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

function readGeneration(metadata: unknown): string | null {
	if (
		metadata &&
		typeof metadata === "object" &&
		"generation" in metadata &&
		typeof metadata.generation === "string"
	) {
		return metadata.generation;
	}

	return null;
}
