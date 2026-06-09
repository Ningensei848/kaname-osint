export interface GuardResult {
	ok: boolean;
	errors: string[];
}

export interface VaultDocument {
	path: string;
	title: string;
	markdown: string;
}

export interface TopicAliasMap {
	[keywordAlias: string]: {
		resolvedFilePath: string;
		primaryTitle: string;
	};
}
