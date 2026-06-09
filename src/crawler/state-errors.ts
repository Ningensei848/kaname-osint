export class StateConflictError extends Error {
	public readonly expectedGeneration: string | null;
	public readonly currentGeneration: string | null;
	public readonly cause: unknown;

	public constructor(
		message: string,
		options: {
			expectedGeneration: string | null;
			currentGeneration?: string | null;
			cause?: unknown;
		},
	) {
		super(message);
		this.name = "StateConflictError";
		this.expectedGeneration = options.expectedGeneration;
		this.currentGeneration = options.currentGeneration ?? null;
		this.cause = options.cause;
	}
}
